import type {
	ExportTimelineAsVideoOptions,
} from "core/editor/exportVideo";
import {
	__applyAudioMixPlanAtFrameForTests,
	__collectExportAudioTargetsForTests,
	__resolveExportAudioTransitionFrameStateForTests,
} from "core/editor/exportVideo";
import {
	type PreparedMixTarget,
	mixTargetsIntoBlock,
} from "core/editor/audio/dsp/blockMixer";
import { resampleAudioBufferToInterleaved } from "core/editor/audio/dsp/resampler";
import {
	clipGainDbToLinear,
	normalizeClipGainDb,
} from "core/editor/audio/clipGain";
import type {
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import { buildCompositionAudioGraph } from "@/scene-editor/audio/buildCompositionAudioGraph";

const WAVEFORM_CACHE_LIMIT = 240;
const waveformCache = new Map<string, HTMLCanvasElement>();
const waveformAccessOrder: string[] = [];
const waveformInflight = new Map<string, Promise<HTMLCanvasElement | null>>();

const DEFAULT_MIX_SAMPLE_RATE = 12000;
const DEFAULT_BLOCK_SIZE = 2048;
const LOUDNESS_BIN_SECONDS = 1 / 240;
const LOUDNESS_CHUNK_BIN_COUNT = 2048;
const LOUDNESS_CHUNK_DURATION = LOUDNESS_BIN_SECONDS * LOUDNESS_CHUNK_BIN_COUNT;
const LOUDNESS_CHUNK_CACHE_LIMIT = 1200;
const WAVEFORM_DB_FLOOR = -48;
const WAVEFORM_DB_RANGE = -WAVEFORM_DB_FLOOR;
const WAVEFORM_MIN_LINEAR = 10 ** (WAVEFORM_DB_FLOOR / 20);
const WAVEFORM_HOT_DB_THRESHOLD = -6;
const WAVEFORM_HOT_LINEAR_THRESHOLD = 10 ** (WAVEFORM_HOT_DB_THRESHOLD / 20);
const DEFAULT_WAVEFORM_HOT_COLOR = "rgba(239, 68, 68, 0.95)";

type ExportAudioTarget = NonNullable<
	ReturnType<typeof __collectExportAudioTargetsForTests>["audioTargets"]
>[number];

type LoudnessChunk = {
	chunkIndex: number;
	peak: Float32Array;
	hasData: Uint8Array;
};

type SceneWaveformSource = {
	fps: number;
	graph: ReturnType<typeof buildCompositionAudioGraph>;
	transitionCurveById: Record<string, "linear" | "equal-power" | undefined>;
};

const loudnessChunkCache = new Map<string, LoudnessChunk>();
const loudnessChunkAccessOrder: string[] = [];
const loudnessChunkInflight = new Map<string, Promise<LoudnessChunk | null>>();

const clampNumber = (value: number, min: number, max: number) => {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
};

const framesToSeconds = (frames: number, fps: number): number => {
	const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
	return frames / safeFps;
};

const touchWaveformKey = (key: string) => {
	const index = waveformAccessOrder.indexOf(key);
	if (index >= 0) {
		waveformAccessOrder.splice(index, 1);
	}
	waveformAccessOrder.push(key);
};

const evictWaveformsIfNeeded = () => {
	while (waveformCache.size > WAVEFORM_CACHE_LIMIT) {
		const oldestKey = waveformAccessOrder.shift();
		if (!oldestKey) break;
		waveformCache.delete(oldestKey);
	}
};

const getLoudnessChunkKey = (params: {
	sceneId: string;
	sceneRevision: number;
	fps: number;
	chunkIndex: number;
}) =>
	`${params.sceneId}|rev:${params.sceneRevision}|fps:${params.fps}|loudness:${params.chunkIndex}`;

const touchLoudnessChunkKey = (key: string) => {
	const index = loudnessChunkAccessOrder.indexOf(key);
	if (index >= 0) {
		loudnessChunkAccessOrder.splice(index, 1);
	}
	loudnessChunkAccessOrder.push(key);
};

const evictLoudnessChunksIfNeeded = () => {
	while (loudnessChunkCache.size > LOUDNESS_CHUNK_CACHE_LIMIT) {
		const oldestKey = loudnessChunkAccessOrder.shift();
		if (!oldestKey) break;
		loudnessChunkCache.delete(oldestKey);
	}
};

const resolveTransitionCurveById = (
	elements: ExportTimelineAsVideoOptions["elements"],
) => {
	const curveById: Record<string, "linear" | "equal-power" | undefined> = {};
	for (const element of elements) {
		if (element.type !== "Transition") continue;
		const curve = (element.props as { audioCurve?: unknown } | undefined)
			?.audioCurve;
		if (curve === "linear" || curve === "equal-power") {
			curveById[element.id] = curve;
		}
	}
	return curveById;
};

const createEmptyLoudnessChunk = (chunkIndex: number): LoudnessChunk => ({
	chunkIndex,
	peak: new Float32Array(LOUDNESS_CHUNK_BIN_COUNT),
	hasData: new Uint8Array(LOUDNESS_CHUNK_BIN_COUNT),
});

const createSceneWaveformSource = (params: {
	sceneRuntime: TimelineRuntime;
	runtimeManager: StudioRuntimeManager;
}): SceneWaveformSource => {
	const { sceneRuntime, runtimeManager } = params;
	const rootState = sceneRuntime.timelineStore.getState();
	const fps = Math.max(1, Math.round(rootState.fps || 30));
	const graph = buildCompositionAudioGraph({
		rootRuntime: sceneRuntime,
		runtimeManager,
	});
	return {
		fps,
		graph,
		transitionCurveById: resolveTransitionCurveById(graph.mixElements),
	};
};

const resolvePreparedMixTarget = async (params: {
	target: ExportAudioTarget;
	fps: number;
	sampleRate: number;
}): Promise<PreparedMixTarget | null> => {
	const { target, fps, sampleRate } = params;
	const decodeStart = Math.max(0, target.sourceRangeStart);
	const decodeEnd = Math.min(target.audioDuration, target.sourceRangeEnd);
	if (!Number.isFinite(decodeStart) || !Number.isFinite(decodeEnd)) return null;
	if (decodeEnd <= decodeStart) return null;

	const decodeStartFrame = Math.max(0, Math.round(decodeStart * sampleRate));
	const decodeEndFrame = Math.max(
		decodeStartFrame,
		Math.round(decodeEnd * sampleRate),
	);
	const sourceFrameCount = decodeEndFrame - decodeStartFrame;
	if (sourceFrameCount <= 0) return null;

	const sourceData = new Float32Array(sourceFrameCount);
	let hasContent = false;

	for await (const wrapped of target.audioSink.buffers(decodeStart, decodeEnd)) {
		const buffer = wrapped?.buffer;
		if (!buffer) continue;
		const chunkStart = Number.isFinite(wrapped.timestamp) ? wrapped.timestamp : 0;
		const chunkDuration =
			Number.isFinite(wrapped.duration) && wrapped.duration > 0
				? wrapped.duration
				: buffer.duration;
		const chunkEnd = chunkStart + chunkDuration;
		if (chunkEnd <= decodeStart || chunkStart >= decodeEnd) continue;

		const resampled = resampleAudioBufferToInterleaved({
			source: buffer,
			targetSampleRate: sampleRate,
			targetNumberOfChannels: 1,
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
			sourceData[dstFrameStart + frame] = resampled.data[srcFrameStart + frame] ?? 0;
		}
		hasContent = true;
	}

	if (!hasContent) return null;

	return {
		id: target.id,
		enabled: target.enabled,
		clipStartSeconds: framesToSeconds(target.timeline.start ?? 0, fps),
		clipOffsetSeconds: framesToSeconds(target.timeline.offset ?? 0, fps),
		clipDurationSeconds: framesToSeconds(
			(target.timeline.end ?? 0) - (target.timeline.start ?? 0),
			fps,
		),
		reversed: target.reversed,
		decodeStartSeconds: decodeStart,
		decodeEndSeconds: decodeEnd,
		sourceData,
		sourceFrameCount,
		gains: target.gains,
	};
};

const buildSceneLoudnessChunk = async (params: {
	chunkIndex: number;
	source: SceneWaveformSource;
}): Promise<LoudnessChunk | null> => {
	const { chunkIndex, source } = params;
	if (chunkIndex < 0) return null;

	const chunk = createEmptyLoudnessChunk(chunkIndex);
	const chunkStartSeconds = chunkIndex * LOUDNESS_CHUNK_DURATION;
	const chunkEndSeconds = chunkStartSeconds + LOUDNESS_CHUNK_DURATION;
	const chunkStartFrame = Math.max(0, Math.floor(chunkStartSeconds * source.fps));
	const chunkEndFrame = Math.max(
		chunkStartFrame + 1,
		Math.ceil(chunkEndSeconds * source.fps),
	);
	const durationFrames = Math.max(1, chunkEndFrame - chunkStartFrame);
	const durationSeconds = framesToSeconds(durationFrames, source.fps);
	const options = {
		elements: source.graph.mixElements,
		tracks: source.graph.mixTracks,
		fps: source.fps,
		canvasSize: { width: 1, height: 1 },
		buildSkiaFrameSnapshot: (() => {
			throw new Error("scene waveform cache does not build frames");
		}) as ExportTimelineAsVideoOptions["buildSkiaFrameSnapshot"],
		audio: {
			getAudioSourceByElementId: (elementId: string) =>
				source.graph.exportAudioSourceMap.get(elementId) ?? null,
			getAudioSessionKeyByElementId: (elementId: string) =>
				source.graph.sessionKeyMap.get(elementId) ?? null,
			isElementAudioEnabled: (elementId: string) =>
				source.graph.enabledMap.get(elementId) ?? false,
		},
	} satisfies ExportTimelineAsVideoOptions;

	const collected = __collectExportAudioTargetsForTests(options, durationFrames);
	if (collected.audioTargets.length === 0) {
		return chunk;
	}

	for (let frame = chunkStartFrame; frame < chunkEndFrame; frame += 1) {
		const transitionFrameState =
			__resolveExportAudioTransitionFrameStateForTests({
				elements: source.graph.mixElements,
				tracks: source.graph.mixTracks,
				frame,
			});
		__applyAudioMixPlanAtFrameForTests({
			frame,
			startFrame: chunkStartFrame,
			fps: source.fps,
			audioClips: collected.audioClips,
			audioClipTargetsById: collected.audioClipTargetsById,
			audioTargetsBySessionKey: collected.audioTargetsBySessionKey,
			transitionFrameState,
			transitionCurveById: source.transitionCurveById,
		});
	}

	const preparedTargets = (
		await Promise.all(
			collected.audioTargets.map((target) =>
				resolvePreparedMixTarget({
					target,
					fps: source.fps,
					sampleRate: DEFAULT_MIX_SAMPLE_RATE,
				}),
			),
		)
	).filter((target): target is PreparedMixTarget => Boolean(target));
	if (preparedTargets.length === 0) {
		return chunk;
	}

	const totalOutputFrames = Math.max(
		1,
		Math.ceil(durationSeconds * DEFAULT_MIX_SAMPLE_RATE),
	);
	const blockBuffer = new Float32Array(DEFAULT_BLOCK_SIZE);
	const exportStartSeconds = framesToSeconds(chunkStartFrame, source.fps);

	for (
		let outputStartFrame = 0;
		outputStartFrame < totalOutputFrames;
		outputStartFrame += DEFAULT_BLOCK_SIZE
	) {
		const outputFrameCount = Math.min(
			DEFAULT_BLOCK_SIZE,
			totalOutputFrames - outputStartFrame,
		);
		const output = blockBuffer.subarray(0, outputFrameCount);
		mixTargetsIntoBlock({
			targets: preparedTargets,
			output,
			outputStartFrame,
			outputFrameCount,
			outputSampleRate: DEFAULT_MIX_SAMPLE_RATE,
			numberOfChannels: 1,
			exportStartSeconds,
			fps: source.fps,
		});
		for (let frame = 0; frame < outputFrameCount; frame += 1) {
			const sampleSeconds =
				exportStartSeconds + (outputStartFrame + frame) / DEFAULT_MIX_SAMPLE_RATE;
			const binIndex = Math.floor(
				(sampleSeconds - chunkStartSeconds) / LOUDNESS_BIN_SECONDS,
			);
			if (binIndex < 0 || binIndex >= LOUDNESS_CHUNK_BIN_COUNT) continue;
			chunk.hasData[binIndex] = 1;
			const amplitude = Math.abs(output[frame] ?? 0);
			if (amplitude > chunk.peak[binIndex]) {
				chunk.peak[binIndex] = amplitude;
			}
		}
	}

	return chunk;
};

const getSceneLoudnessChunk = async (params: {
	sceneRuntime: TimelineRuntime;
	sceneRevision: number;
	fps: number;
	chunkIndex: number;
	getSource: () => SceneWaveformSource;
}): Promise<LoudnessChunk | null> => {
	const { sceneRuntime, sceneRevision, fps, chunkIndex, getSource } = params;
	if (chunkIndex < 0) return null;

	const chunkKey = getLoudnessChunkKey({
		sceneId: sceneRuntime.ref.sceneId,
		sceneRevision,
		fps,
		chunkIndex,
	});
	const cached = loudnessChunkCache.get(chunkKey);
	if (cached) {
		touchLoudnessChunkKey(chunkKey);
		return cached;
	}

	const inflight = loudnessChunkInflight.get(chunkKey);
	if (inflight) return inflight;

	const promise = (async () => {
		const chunk = await buildSceneLoudnessChunk({
			chunkIndex,
			source: getSource(),
		});
		if (!chunk) return null;
		loudnessChunkCache.set(chunkKey, chunk);
		touchLoudnessChunkKey(chunkKey);
		evictLoudnessChunksIfNeeded();
		return chunk;
	})();

	loudnessChunkInflight.set(chunkKey, promise);
	try {
		return await promise;
	} finally {
		loudnessChunkInflight.delete(chunkKey);
	}
};

const getSceneLoudnessChunksForRange = async (params: {
	sceneRuntime: TimelineRuntime;
	sceneRevision: number;
	fps: number;
	getSource: () => SceneWaveformSource;
	windowStart: number;
	windowEnd: number;
}): Promise<Map<number, LoudnessChunk>> => {
	const {
		sceneRuntime,
		sceneRevision,
		fps,
		getSource,
		windowStart,
		windowEnd,
	} = params;
	const rangeStart = Math.max(0, windowStart);
	const rangeEnd = Math.max(0, windowEnd);
	const chunkMap = new Map<number, LoudnessChunk>();
	if (rangeEnd <= rangeStart) return chunkMap;

	const startBin = Math.floor(rangeStart / LOUDNESS_BIN_SECONDS);
	const endBinExclusive = Math.max(
		startBin + 1,
		Math.ceil(rangeEnd / LOUDNESS_BIN_SECONDS),
	);
	const startChunk = Math.floor(startBin / LOUDNESS_CHUNK_BIN_COUNT);
	const endChunk = Math.floor((endBinExclusive - 1) / LOUDNESS_CHUNK_BIN_COUNT);

	const chunkPromises: Promise<LoudnessChunk | null>[] = [];
	for (let chunkIndex = startChunk; chunkIndex <= endChunk; chunkIndex += 1) {
		chunkPromises.push(
			getSceneLoudnessChunk({
				sceneRuntime,
				sceneRevision,
				fps,
				chunkIndex,
				getSource,
			}),
		);
	}
	const chunkList = await Promise.all(chunkPromises);
	for (const chunk of chunkList) {
		if (!chunk) continue;
		chunkMap.set(chunk.chunkIndex, chunk);
	}
	return chunkMap;
};

const getSmoothingRadius = (secondsPerPixel: number): number => {
	if (secondsPerPixel >= 0.05) return 4;
	if (secondsPerPixel >= 0.02) return 3;
	if (secondsPerPixel >= 0.008) return 2;
	return 1;
};

const normalizeAmplitudeToWaveHeight = (amplitude: number): number => {
	const safeAmplitude = clampNumber(amplitude, 0, 1);
	if (safeAmplitude <= 0) return 0;
	const db = 20 * Math.log10(Math.max(safeAmplitude, WAVEFORM_MIN_LINEAR));
	return clampNumber((db - WAVEFORM_DB_FLOOR) / WAVEFORM_DB_RANGE, 0, 1);
};

const renderWaveformCanvas = (params: {
	peaks: Float32Array;
	width: number;
	height: number;
	color: string;
	gainDb: number;
	hotColor?: string;
}): HTMLCanvasElement | null => {
	const { peaks, width, height, color, gainDb, hotColor } = params;
	if (width <= 0 || height <= 0 || peaks.length <= 0) return null;

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	const safeGainDb = normalizeClipGainDb(gainDb);
	const gainLinear = clipGainDbToLinear(safeGainDb);
	const safeHotColor = hotColor ?? DEFAULT_WAVEFORM_HOT_COLOR;
	const topPadding = Math.max(1, Math.round(height * 0.04));
	const lineBottomPadding = Math.max(1, Math.round(height * 0.04));
	const lineBottomY = height - lineBottomPadding;
	const drawHeight = Math.max(1, lineBottomY - topPadding);
	const yValues = new Float32Array(peaks.length);
	const hotFlags = new Uint8Array(peaks.length);

	for (let i = 0; i < peaks.length; i += 1) {
		const gainAdjustedAmplitudeRaw = peaks[i] * gainLinear;
		const gainAdjustedAmplitude = clampNumber(gainAdjustedAmplitudeRaw, 0, 1);
		if (gainAdjustedAmplitudeRaw >= WAVEFORM_HOT_LINEAR_THRESHOLD) {
			hotFlags[i] = 1;
		}
		const visualAmplitude = normalizeAmplitudeToWaveHeight(
			gainAdjustedAmplitude,
		);
		yValues[i] = topPadding + (1 - visualAmplitude) * drawHeight;
	}

	ctx.clearRect(0, 0, width, height);

	const firstLineX = 0.5;
	const lastLineX = Math.max(firstLineX, peaks.length - 0.5);
	ctx.beginPath();
	ctx.moveTo(-2, height + 2);
	ctx.lineTo(firstLineX, yValues[0] ?? lineBottomY);
	for (let x = 1; x < peaks.length; x += 1) {
		ctx.lineTo(x + 0.5, yValues[x]);
	}
	ctx.lineTo(lastLineX, yValues[Math.max(0, peaks.length - 1)] ?? lineBottomY);
	ctx.lineTo(width + 2, height + 2);
	ctx.closePath();
	ctx.fillStyle = color;
	ctx.globalAlpha = 0.35;
	ctx.fill();
	ctx.globalAlpha = 1;

	ctx.beginPath();
	for (let x = 0; x < peaks.length; x += 1) {
		const drawX = x + 0.5;
		const drawY = yValues[x];
		if (x === 0) {
			ctx.moveTo(drawX, drawY);
		} else {
			ctx.lineTo(drawX, drawY);
		}
	}
	ctx.strokeStyle = color;
	ctx.lineWidth = 1.5;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.stroke();

	ctx.beginPath();
	let hasHotSegment = false;
	for (let x = 0; x < peaks.length; x += 1) {
		if (!hotFlags[x]) continue;
		const drawX = x + 0.5;
		const drawY = yValues[x];
		if (!hasHotSegment || !hotFlags[x - 1]) {
			ctx.moveTo(drawX, drawY);
		} else {
			ctx.lineTo(drawX, drawY);
		}
		hasHotSegment = true;
	}
	if (hasHotSegment) {
		ctx.strokeStyle = safeHotColor;
		ctx.lineWidth = 1.6;
		ctx.stroke();
	}

	return canvas;
};

export const getSceneWaveformThumbnail = async (params: {
	sceneRuntime: TimelineRuntime;
	runtimeManager: StudioRuntimeManager;
	sceneRevision: number;
	windowStartFrame: number;
	windowEndFrame: number;
	width: number;
	height: number;
	pixelRatio: number;
	color: string;
	gainDb?: number;
	hotColor?: string;
}): Promise<HTMLCanvasElement | null> => {
	const {
		sceneRuntime,
		runtimeManager,
		sceneRevision,
		windowStartFrame,
		windowEndFrame,
		width,
		height,
		pixelRatio,
		color,
		gainDb = 0,
		hotColor,
	} = params;

	if (windowEndFrame <= windowStartFrame) return null;
	if (width <= 0 || height <= 0) return null;

	const targetWidth = Math.max(1, Math.round(width * pixelRatio));
	const targetHeight = Math.max(1, Math.round(height * pixelRatio));
	const cacheKey = [
		sceneRuntime.ref.sceneId,
		sceneRevision,
		windowStartFrame,
		windowEndFrame,
		targetWidth,
		targetHeight,
		color,
		normalizeClipGainDb(gainDb).toFixed(3),
		hotColor ?? "",
	].join("|");

	const cached = waveformCache.get(cacheKey);
	if (cached) {
		touchWaveformKey(cacheKey);
		return cached;
	}

	const inflight = waveformInflight.get(cacheKey);
	if (inflight) return inflight;

	const promise = (async () => {
		const rootState = sceneRuntime.timelineStore.getState();
		const fps = Math.max(1, Math.round(rootState.fps || 30));
		const durationFrames = Math.max(1, windowEndFrame - windowStartFrame);
		const durationSeconds = framesToSeconds(durationFrames, fps);
		const windowStartSeconds = framesToSeconds(windowStartFrame, fps);
		const windowEndSeconds = framesToSeconds(windowEndFrame, fps);
		const bucketCount = Math.max(1, targetWidth);
		const secondsPerPixel = durationSeconds / bucketCount;
		const peaks = new Float32Array(bucketCount);
		let source: SceneWaveformSource | null = null;
		const getSource = () => {
			source ??= createSceneWaveformSource({
				sceneRuntime,
				runtimeManager,
			});
			return source;
		};
		const chunkMap = await getSceneLoudnessChunksForRange({
			sceneRuntime,
			sceneRevision,
			fps,
			getSource,
			windowStart: windowStartSeconds,
			windowEnd: windowEndSeconds,
		});

		const bucketDuration = durationSeconds / bucketCount;
		for (let i = 0; i < bucketCount; i += 1) {
			const bucketStart = windowStartSeconds + i * bucketDuration;
			const bucketEnd = bucketStart + bucketDuration;
			const startBin = Math.floor(
				Math.max(0, bucketStart) / LOUDNESS_BIN_SECONDS,
			);
			const endBinExclusive = Math.max(
				startBin + 1,
				Math.ceil(Math.max(0, bucketEnd) / LOUDNESS_BIN_SECONDS),
			);
			let bucketPeak = 0;
			for (let bin = startBin; bin < endBinExclusive; bin += 1) {
				if (bin < 0) continue;
				const chunkIndex = Math.floor(bin / LOUDNESS_CHUNK_BIN_COUNT);
				const chunk = chunkMap.get(chunkIndex);
				if (!chunk) continue;
				const localIndex = bin - chunkIndex * LOUDNESS_CHUNK_BIN_COUNT;
				if (localIndex < 0 || localIndex >= LOUDNESS_CHUNK_BIN_COUNT) {
					continue;
				}
				if (!chunk.hasData[localIndex]) continue;
				const binPeak = chunk.peak[localIndex];
				if (binPeak > bucketPeak) {
					bucketPeak = binPeak;
				}
			}
			if (bucketPeak <= 0) continue;
			peaks[i] = clampNumber(bucketPeak, 0, 1);
		}

		if (bucketCount > 2) {
			const smoothed = new Float32Array(bucketCount);
			const smoothingRadius = getSmoothingRadius(secondsPerPixel);
			for (let i = 0; i < bucketCount; i += 1) {
				let weightSum = 0;
				let valueSum = 0;
				for (
					let offset = -smoothingRadius;
					offset <= smoothingRadius;
					offset += 1
				) {
					const index = i + offset;
					if (index < 0 || index >= bucketCount) continue;
					const weight = smoothingRadius + 1 - Math.abs(offset);
					weightSum += weight;
					valueSum += peaks[index] * weight;
				}
				smoothed[i] = weightSum > 0 ? valueSum / weightSum : peaks[i];
			}
			peaks.set(smoothed);
		}
		// 补齐单点空洞，避免重采样后出现针孔式断裂
		if (bucketCount > 2) {
			for (let i = 1; i < bucketCount - 1; i += 1) {
				if (peaks[i] > 0.0001) continue;
				const prev = peaks[i - 1];
				const next = peaks[i + 1];
				if (prev <= 0.0001 || next <= 0.0001) continue;
				peaks[i] = (prev + next) / 2;
			}
		}

		const canvas = renderWaveformCanvas({
			peaks,
			width: targetWidth,
			height: targetHeight,
			color,
			gainDb,
			hotColor,
		});
		if (!canvas) return null;
		waveformCache.set(cacheKey, canvas);
		touchWaveformKey(cacheKey);
		evictWaveformsIfNeeded();
		return canvas;
	})();

	waveformInflight.set(cacheKey, promise);
	try {
		return await promise;
	} finally {
		waveformInflight.delete(cacheKey);
	}
};
