import {
	type AudioBufferSink,
	AudioSample,
	AudioSampleSource,
	type WrappedAudioBuffer,
} from "mediabunny";
import { framesToSeconds } from "../../../utils/timecode";
import { mixTargetsIntoBlock, type PreparedMixTarget } from "./blockMixer";
import {
	createCompressorState,
	processCompressorInPlace,
} from "./effects/compressor";
import { resampleAudioBufferToInterleaved } from "./resampler";
import {
	type ExportAudioDspConfig,
	type PartialExportAudioDspSettings,
	resolveExportAudioDspConfig,
} from "./types";

const AUDIO_EPSILON = 1e-6;

const createAbortError = (): Error => {
	if (typeof DOMException !== "undefined") {
		return new DOMException("已取消", "AbortError");
	}
	const error = new Error("已取消");
	error.name = "AbortError";
	return error;
};

const throwIfAborted = (signal?: AbortSignal): void => {
	if (signal?.aborted) {
		throw createAbortError();
	}
};

type ExportAudioTimeline = {
	start?: number;
	end?: number;
	offset?: number;
};

export type ExportAudioRenderTarget = {
	id: string;
	timeline: ExportAudioTimeline;
	audioSink: AudioBufferSink;
	audioDuration: number;
	reversed: boolean;
	enabled: boolean;
	gains: Float32Array;
	hasAudibleFrame: boolean;
	sourceRangeStart: number;
	sourceRangeEnd: number;
};

const normalizeWrappedBuffer = (
	wrapped: WrappedAudioBuffer,
): { timestamp: number; duration: number; buffer: AudioBuffer } | null => {
	const buffer = wrapped?.buffer;
	if (!buffer) return null;
	const timestamp = Number.isFinite(wrapped.timestamp) ? wrapped.timestamp : 0;
	const duration =
		Number.isFinite(wrapped.duration) && wrapped.duration > 0
			? wrapped.duration
			: buffer.duration;
	if (!Number.isFinite(duration) || duration <= AUDIO_EPSILON) return null;
	return { timestamp, duration, buffer };
};

const decodeTarget = async ({
	target,
	sampleRate,
	numberOfChannels,
	signal,
}: {
	target: ExportAudioRenderTarget;
	sampleRate: number;
	numberOfChannels: number;
	signal?: AbortSignal;
}): Promise<PreparedMixTarget | null> => {
	throwIfAborted(signal);
	const decodeStart = Math.max(0, target.sourceRangeStart);
	const decodeEnd = Math.min(target.audioDuration, target.sourceRangeEnd);
	if (decodeEnd - decodeStart <= AUDIO_EPSILON) return null;

	const decodeStartFrame = Math.max(0, Math.round(decodeStart * sampleRate));
	const decodeEndFrame = Math.max(
		decodeStartFrame,
		Math.round(decodeEnd * sampleRate),
	);
	const sourceFrameCount = decodeEndFrame - decodeStartFrame;
	if (sourceFrameCount <= 0) return null;

	const sourceData = new Float32Array(sourceFrameCount * numberOfChannels);
	let hasContent = false;

	for await (const wrapped of target.audioSink.buffers(
		decodeStart,
		decodeEnd,
	)) {
		throwIfAborted(signal);
		const normalized = normalizeWrappedBuffer(wrapped);
		if (!normalized) continue;
		const chunkStart = normalized.timestamp;
		const chunkEnd = chunkStart + normalized.duration;
		if (chunkEnd <= decodeStart + AUDIO_EPSILON) continue;
		if (chunkStart >= decodeEnd - AUDIO_EPSILON) continue;

		const writeStart = Math.max(chunkStart, decodeStart);
		const writeEnd = Math.min(chunkEnd, decodeEnd);
		if (writeEnd - writeStart <= AUDIO_EPSILON) continue;

		const resampled = resampleAudioBufferToInterleaved({
			source: normalized.buffer,
			targetSampleRate: sampleRate,
			targetNumberOfChannels: numberOfChannels,
		});
		if (resampled.numberOfFrames <= 0) continue;

		const chunkStartFrame = Math.max(0, Math.round(chunkStart * sampleRate));
		const chunkEndFrame = chunkStartFrame + resampled.numberOfFrames;
		const writeStartFrame = Math.max(chunkStartFrame, decodeStartFrame);
		const writeEndFrame = Math.min(chunkEndFrame, decodeEndFrame);
		let framesToCopy = writeEndFrame - writeStartFrame;
		if (framesToCopy <= 0) continue;

		const srcFrameStart = writeStartFrame - chunkStartFrame;
		const dstFrameStart = writeStartFrame - decodeStartFrame;
		framesToCopy = Math.min(
			framesToCopy,
			resampled.numberOfFrames - srcFrameStart,
			sourceFrameCount - dstFrameStart,
		);
		if (framesToCopy <= 0) continue;

		for (let frame = 0; frame < framesToCopy; frame += 1) {
			const srcBase = (srcFrameStart + frame) * numberOfChannels;
			const dstBase = (dstFrameStart + frame) * numberOfChannels;
			for (let channel = 0; channel < numberOfChannels; channel += 1) {
				// 采用整数采样点对齐并覆盖写入，避免 chunk 边界重复叠加造成杂音
				sourceData[dstBase + channel] = resampled.data[srcBase + channel] ?? 0;
			}
		}
		hasContent = true;
	}

	if (!hasContent) return null;

	return {
		id: target.id,
		enabled: target.enabled,
		clipStartSeconds: 0,
		clipOffsetSeconds: 0,
		clipDurationSeconds: 0,
		reversed: target.reversed,
		decodeStartSeconds: decodeStart,
		decodeEndSeconds: decodeEnd,
		sourceData,
		sourceFrameCount,
		gains: target.gains,
	};
};

const resolvePreparedTarget = async ({
	target,
	fps,
	sampleRate,
	numberOfChannels,
	signal,
}: {
	target: ExportAudioRenderTarget;
	fps: number;
	sampleRate: number;
	numberOfChannels: number;
	signal?: AbortSignal;
}): Promise<PreparedMixTarget | null> => {
	const decoded = await decodeTarget({
		target,
		sampleRate,
		numberOfChannels,
		signal,
	});
	if (!decoded) return null;
	decoded.clipStartSeconds = framesToSeconds(target.timeline.start ?? 0, fps);
	decoded.clipOffsetSeconds = framesToSeconds(target.timeline.offset ?? 0, fps);
	decoded.clipDurationSeconds = framesToSeconds(
		(target.timeline.end ?? 0) - (target.timeline.start ?? 0),
		fps,
	);
	decoded.reversed = target.reversed;
	return decoded;
};

const dbToGain = (db: number): number => Math.pow(10, db / 20);

const applyMasterGain = ({
	data,
	gain,
}: {
	data: Float32Array;
	gain: number;
}) => {
	if (Math.abs(gain - 1) <= AUDIO_EPSILON) return;
	for (let i = 0; i < data.length; i += 1) {
		data[i] = (data[i] ?? 0) * gain;
	}
};

const clampPcm = (data: Float32Array) => {
	for (let i = 0; i < data.length; i += 1) {
		const value = data[i] ?? 0;
		if (value > 1) {
			data[i] = 1;
			continue;
		}
		if (value < -1) {
			data[i] = -1;
		}
	}
};

const resolveDspConfig = (
	override?: PartialExportAudioDspSettings,
): ExportAudioDspConfig => {
	return resolveExportAudioDspConfig(override);
};

export const renderMixedAudioForExport = async ({
	targets,
	startFrame,
	endFrame,
	fps,
	audioSource,
	dspConfig,
	signal,
}: {
	targets: ExportAudioRenderTarget[];
	startFrame: number;
	endFrame: number;
	fps: number;
	audioSource: AudioSampleSource;
	dspConfig?: PartialExportAudioDspSettings;
	signal?: AbortSignal;
}): Promise<boolean> => {
	throwIfAborted(signal);
	const activeTargets = targets.filter(
		(target) =>
			target.enabled &&
			target.hasAudibleFrame &&
			target.sourceRangeEnd - target.sourceRangeStart > AUDIO_EPSILON,
	);
	if (activeTargets.length === 0) {
		return false;
	}

	const config = resolveDspConfig(dspConfig);
	const sampleRate = config.exportSampleRate;
	const blockSize = config.exportBlockSize;
	const numberOfChannels = config.numberOfChannels;

	const preparedTargets: PreparedMixTarget[] = [];
	for (const target of activeTargets) {
		throwIfAborted(signal);
		const prepared = await resolvePreparedTarget({
			target,
			fps,
			sampleRate,
			numberOfChannels,
			signal,
		});
		if (!prepared) continue;
		preparedTargets.push(prepared);
	}
	if (preparedTargets.length === 0) {
		return false;
	}

	const exportDuration = framesToSeconds(endFrame - startFrame, fps);
	if (exportDuration <= AUDIO_EPSILON) return false;
	const exportStartSeconds = framesToSeconds(startFrame, fps);
	const totalFrames = Math.max(1, Math.ceil(exportDuration * sampleRate));
	const masterGain = dbToGain(config.masterGainDb);
	const compressorState = createCompressorState({
		config: config.compressor,
		sampleRate,
	});
	const blockBuffer = new Float32Array(blockSize * numberOfChannels);

	for (let frameStart = 0; frameStart < totalFrames; frameStart += blockSize) {
		throwIfAborted(signal);
		const blockFrames = Math.min(blockSize, totalFrames - frameStart);
		const block = blockBuffer.subarray(0, blockFrames * numberOfChannels);
		mixTargetsIntoBlock({
			targets: preparedTargets,
			output: block,
			outputStartFrame: frameStart,
			outputFrameCount: blockFrames,
			outputSampleRate: sampleRate,
			numberOfChannels,
			exportStartSeconds,
			fps,
		});
		applyMasterGain({ data: block, gain: masterGain });
		processCompressorInPlace({
			data: block,
			numberOfChannels,
			config: config.compressor,
			state: compressorState,
		});
		clampPcm(block);

		const sampleData = new Float32Array(block.length);
		sampleData.set(block);
		const audioSample = new AudioSample({
			format: "f32",
			sampleRate,
			numberOfChannels,
			timestamp: frameStart / sampleRate,
			data: sampleData,
		});
		await audioSource.add(audioSample);
		audioSample.close();
		throwIfAborted(signal);
	}

	return true;
};
