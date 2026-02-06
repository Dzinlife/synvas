import type { AudioBufferSink } from "mediabunny";

const WAVEFORM_CACHE_LIMIT = 600;
const WAVEFORM_CACHE_VERSION = "v4";
const LOUDNESS_BIN_SECONDS = 1 / 240;
const LOUDNESS_CHUNK_BIN_COUNT = 2048;
const LOUDNESS_CHUNK_DURATION = LOUDNESS_BIN_SECONDS * LOUDNESS_CHUNK_BIN_COUNT;
const LOUDNESS_CHUNK_CACHE_LIMIT = 1200;

const waveformCache = new Map<string, HTMLCanvasElement>();
const waveformAccessOrder: string[] = [];
const waveformInflight = new Map<string, Promise<HTMLCanvasElement | null>>();

type LoudnessChunk = {
	chunkIndex: number;
	loudness: Float32Array;
	peak: Float32Array;
	hasData: Uint8Array;
};

const loudnessChunkCache = new Map<string, LoudnessChunk>();
const loudnessChunkAccessOrder: string[] = [];
const loudnessChunkInflight = new Map<string, Promise<LoudnessChunk | null>>();

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

const getLoudnessChunkKey = (uri: string, chunkIndex: number) =>
	`${WAVEFORM_CACHE_VERSION}|${uri}|loudness:${chunkIndex}`;

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

const clampNumber = (value: number, min: number, max: number) => {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
};

const getPeakBlend = (secondsPerPixel: number): number => {
	if (secondsPerPixel >= 0.05) return 0.08;
	if (secondsPerPixel >= 0.02) return 0.12;
	if (secondsPerPixel >= 0.01) return 0.16;
	if (secondsPerPixel >= 0.004) return 0.22;
	return 0.3;
};

const getSmoothingRadius = (secondsPerPixel: number): number => {
	if (secondsPerPixel >= 0.05) return 4;
	if (secondsPerPixel >= 0.02) return 3;
	if (secondsPerPixel >= 0.008) return 2;
	return 1;
};

const getLoudnessGain = (secondsPerPixel: number): number => {
	if (secondsPerPixel >= 0.05) return 2.1;
	if (secondsPerPixel >= 0.02) return 1.9;
	if (secondsPerPixel >= 0.008) return 1.7;
	return 1.5;
};

const createEmptyLoudnessChunk = (chunkIndex: number): LoudnessChunk => ({
	chunkIndex,
	loudness: new Float32Array(LOUDNESS_CHUNK_BIN_COUNT),
	peak: new Float32Array(LOUDNESS_CHUNK_BIN_COUNT),
	hasData: new Uint8Array(LOUDNESS_CHUNK_BIN_COUNT),
});

const buildLoudnessChunk = async (options: {
	chunkIndex: number;
	audioSink: AudioBufferSink;
}): Promise<LoudnessChunk | null> => {
	const { chunkIndex, audioSink } = options;
	const chunk = createEmptyLoudnessChunk(chunkIndex);
	const chunkStart = chunkIndex * LOUDNESS_CHUNK_DURATION;
	const chunkEnd = chunkStart + LOUDNESS_CHUNK_DURATION;
	const decodeStart = Math.max(0, chunkStart);
	const decodeEnd = Math.max(decodeStart, chunkEnd);
	if (!Number.isFinite(decodeStart) || !Number.isFinite(decodeEnd)) return null;
	if (decodeEnd <= decodeStart) return chunk;

	const loudnessSum = new Float32Array(LOUDNESS_CHUNK_BIN_COUNT);
	const loudnessCount = new Uint32Array(LOUDNESS_CHUNK_BIN_COUNT);

	try {
		for await (const wrapped of audioSink.buffers(decodeStart, decodeEnd)) {
			const buffer = wrapped?.buffer;
			if (!buffer) continue;
			const sampleRate = buffer.sampleRate;
			if (!Number.isFinite(sampleRate) || sampleRate <= 0) continue;

			const bufferStart = wrapped.timestamp;
			const bufferDuration =
				Number.isFinite(wrapped.duration) && wrapped.duration > 0
					? wrapped.duration
					: buffer.length / sampleRate;
			const bufferEnd = bufferStart + bufferDuration;

			const overlapStart = Math.max(chunkStart, bufferStart);
			const overlapEnd = Math.min(chunkEnd, bufferEnd);
			if (overlapEnd <= overlapStart) continue;

			const startSample = Math.max(
				0,
				Math.floor((overlapStart - bufferStart) * sampleRate),
			);
			const endSample = Math.min(
				buffer.length,
				Math.ceil((overlapEnd - bufferStart) * sampleRate),
			);
			if (endSample <= startSample) continue;

			const totalSamples = endSample - startSample;
			const baseStep = Math.max(
				1,
				Math.floor((sampleRate * LOUDNESS_BIN_SECONDS) / 8),
			);
			const maxSamples = LOUDNESS_CHUNK_BIN_COUNT * 256;
			const loadStep = Math.max(1, Math.ceil(totalSamples / maxSamples));
			const step = Math.max(baseStep, loadStep);
			const probeCount = step > 1 ? Math.min(4, step) : 1;
			const probeStride = probeCount > 1 ? step / probeCount : 0;

			const channelCount = buffer.numberOfChannels;
			const channels: Float32Array[] = [];
			for (let c = 0; c < channelCount; c += 1) {
				channels.push(buffer.getChannelData(c));
			}

			const binScale = 1 / (sampleRate * LOUDNESS_BIN_SECONDS);
			const binBase = (bufferStart - chunkStart) / LOUDNESS_BIN_SECONDS;

			for (let i = startSample; i < endSample; i += step) {
				let framePeak = 0;
				let frameLoudnessSum = 0;
				let frameValueCount = 0;
				if (probeCount <= 1) {
					for (let c = 0; c < channelCount; c += 1) {
						const value = Math.abs(channels[c][i]);
						if (value > framePeak) framePeak = value;
						frameLoudnessSum += value;
						frameValueCount += 1;
					}
				} else {
					for (let p = 0; p < probeCount; p += 1) {
						const index = Math.min(
							endSample - 1,
							Math.floor(i + p * probeStride),
						);
						for (let c = 0; c < channelCount; c += 1) {
							const value = Math.abs(channels[c][index]);
							if (value > framePeak) framePeak = value;
							frameLoudnessSum += value;
							frameValueCount += 1;
						}
					}
				}
				if (frameValueCount <= 0) continue;

				const frameLoudness = frameLoudnessSum / frameValueCount;
				const binIndex = Math.floor(binBase + i * binScale);
				if (binIndex < 0 || binIndex >= LOUDNESS_CHUNK_BIN_COUNT) continue;

				if (framePeak > chunk.peak[binIndex]) {
					chunk.peak[binIndex] = framePeak;
				}
				loudnessSum[binIndex] += frameLoudness;
				loudnessCount[binIndex] += 1;
			}
		}
	} catch (error) {
		console.warn("Failed to build loudness chunk:", error);
		return null;
	}

	for (let i = 0; i < LOUDNESS_CHUNK_BIN_COUNT; i += 1) {
		const count = loudnessCount[i];
		if (count <= 0) continue;
		chunk.loudness[i] = loudnessSum[i] / count;
		chunk.hasData[i] = 1;
	}
	return chunk;
};

const getLoudnessChunk = async (options: {
	uri: string;
	chunkIndex: number;
	audioSink: AudioBufferSink;
}): Promise<LoudnessChunk | null> => {
	const { uri, chunkIndex, audioSink } = options;
	if (chunkIndex < 0) return null;

	const chunkKey = getLoudnessChunkKey(uri, chunkIndex);
	const cached = loudnessChunkCache.get(chunkKey);
	if (cached) {
		touchLoudnessChunkKey(chunkKey);
		return cached;
	}

	const inflight = loudnessChunkInflight.get(chunkKey);
	if (inflight) return inflight;

	const promise = (async () => {
		const chunk = await buildLoudnessChunk({ chunkIndex, audioSink });
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

const getLoudnessChunksForRange = async (options: {
	uri: string;
	audioSink: AudioBufferSink;
	windowStart: number;
	windowEnd: number;
}): Promise<Map<number, LoudnessChunk>> => {
	const { uri, audioSink, windowStart, windowEnd } = options;
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
	for (let i = startChunk; i <= endChunk; i += 1) {
		chunkPromises.push(getLoudnessChunk({ uri, chunkIndex: i, audioSink }));
	}
	const chunkList = await Promise.all(chunkPromises);
	for (const chunk of chunkList) {
		if (!chunk) continue;
		chunkMap.set(chunk.chunkIndex, chunk);
	}
	return chunkMap;
};

export const getWaveformThumbnail = async (options: {
	uri: string;
	windowStart: number;
	windowEnd: number;
	decodeStart?: number;
	decodeEnd?: number;
	width: number;
	height: number;
	pixelRatio: number;
	audioSink?: AudioBufferSink | null;
	color: string;
}): Promise<HTMLCanvasElement | null> => {
	const {
		uri,
		windowStart,
		windowEnd,
		decodeStart,
		decodeEnd,
		width,
		height,
		pixelRatio,
		audioSink,
		color,
	} = options;

	if (!audioSink) return null;
	if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) return null;
	if (windowEnd <= windowStart) return null;
	if (width <= 0 || height <= 0) return null;

	const startKey = Math.round(windowStart * 1000);
	const endKey = Math.round(windowEnd * 1000);
	const targetWidth = Math.max(1, Math.round(width * pixelRatio));
	const targetHeight = Math.max(1, Math.round(height * pixelRatio));
	const cacheKey = `${WAVEFORM_CACHE_VERSION}|${uri}|${startKey}-${endKey}|${targetWidth}x${targetHeight}|${color}`;

	const cached = waveformCache.get(cacheKey);
	if (cached) {
		touchWaveformKey(cacheKey);
		return cached;
	}

	const inflight = waveformInflight.get(cacheKey);
	if (inflight) return inflight;

	const promise = (async () => {
		const bucketCount = Math.max(1, targetWidth);
		const duration = windowEnd - windowStart;
		if (!Number.isFinite(duration) || duration <= 0) return null;
		const bucketDuration = duration / bucketCount;
		if (!Number.isFinite(bucketDuration) || bucketDuration <= 0) return null;

		// 基于固定分辨率响度缓存再重采样到当前像素，缩放不重复读音频
		const peakBlend = getPeakBlend(bucketDuration);
		const smoothingRadius = getSmoothingRadius(bucketDuration);
		const loudnessGain = getLoudnessGain(bucketDuration);
		const peaks = new Float32Array(bucketCount);

		try {
			const safeDecodeStart = Number.isFinite(decodeStart ?? NaN)
				? Math.max(0, decodeStart as number)
				: Math.max(0, windowStart);
			const safeDecodeEnd = Number.isFinite(decodeEnd ?? NaN)
				? Math.max(0, decodeEnd as number)
				: Math.max(0, windowEnd);
			const sampleWindowStart = Math.max(windowStart, safeDecodeStart);
			const sampleWindowEnd = Math.min(windowEnd, safeDecodeEnd);
			const chunkMap =
				sampleWindowEnd > sampleWindowStart
					? await getLoudnessChunksForRange({
							uri,
							audioSink,
							windowStart: sampleWindowStart,
							windowEnd: sampleWindowEnd,
						})
					: new Map<number, LoudnessChunk>();

			for (let i = 0; i < bucketCount; i += 1) {
				const bucketStart = windowStart + i * bucketDuration;
				const bucketEnd = bucketStart + bucketDuration;
				const sampleStart = Math.max(bucketStart, sampleWindowStart);
				const sampleEnd = Math.min(bucketEnd, sampleWindowEnd);
				if (sampleEnd <= sampleStart) continue;

				const startBin = Math.floor(
					Math.max(0, sampleStart) / LOUDNESS_BIN_SECONDS,
				);
				const endBinExclusive = Math.max(
					startBin + 1,
					Math.ceil(Math.max(0, sampleEnd) / LOUDNESS_BIN_SECONDS),
				);
				let bucketPeak = 0;
				let bucketLoudnessSum = 0;
				let bucketLoudnessCount = 0;
				for (let bin = startBin; bin < endBinExclusive; bin += 1) {
					if (bin < 0) continue;
					const chunkIndex = Math.floor(bin / LOUDNESS_CHUNK_BIN_COUNT);
					const chunk = chunkMap.get(chunkIndex);
					if (!chunk) continue;
					const localIndex = bin - chunkIndex * LOUDNESS_CHUNK_BIN_COUNT;
					if (localIndex < 0 || localIndex >= LOUDNESS_CHUNK_BIN_COUNT)
						continue;
					if (!chunk.hasData[localIndex]) continue;
					const binPeak = chunk.peak[localIndex];
					if (binPeak > bucketPeak) bucketPeak = binPeak;
					bucketLoudnessSum += chunk.loudness[localIndex];
					bucketLoudnessCount += 1;
				}
				if (bucketLoudnessCount <= 0) continue;

				const loudness = bucketLoudnessSum / bucketLoudnessCount;
				const loudnessEnvelope = clampNumber(loudness * loudnessGain, 0, 1);
				peaks[i] = clampNumber(
					loudnessEnvelope * (1 - peakBlend) + bucketPeak * peakBlend,
					0,
					1,
				);
			}
			if (bucketCount > 2) {
				const smoothed = new Float32Array(bucketCount);
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
			// 补齐单点空洞，避免折线和填充出现针孔式断裂
			if (bucketCount > 2) {
				for (let i = 1; i < bucketCount - 1; i += 1) {
					if (peaks[i] > 0.0001) continue;
					const prev = peaks[i - 1];
					const next = peaks[i + 1];
					if (prev <= 0.0001 || next <= 0.0001) continue;
					peaks[i] = (prev + next) / 2;
				}
			}
		} catch (error) {
			console.warn("Failed to build waveform:", error);
			return null;
		}

		const canvas = document.createElement("canvas");
		canvas.width = targetWidth;
		canvas.height = targetHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;

		ctx.clearRect(0, 0, targetWidth, targetHeight);
		const topPadding = Math.max(1, Math.round(targetHeight * 0.06));
		const lineBottomPadding = Math.max(1, Math.round(targetHeight * 0.08));
		const lineBottomY = targetHeight - lineBottomPadding;
		const drawHeight = Math.max(1, lineBottomY - topPadding);
		const yValues = new Float32Array(bucketCount);
		for (let x = 0; x < bucketCount; x += 1) {
			const amplitude = clampNumber(peaks[x], 0, 1);
			const visualAmplitude = amplitude ** 0.85;
			yValues[x] = topPadding + (1 - visualAmplitude) * drawHeight;
		}

		const firstLineX = 0.5;
		const lastLineX = Math.max(firstLineX, bucketCount - 0.5);
		const leftOutsideX = -2;
		const rightOutsideX = targetWidth + 2;
		const fillBottomY = targetHeight + 2;
		ctx.beginPath();
		ctx.moveTo(leftOutsideX, fillBottomY);
		ctx.lineTo(firstLineX, yValues[0] ?? lineBottomY);
		for (let x = 1; x < bucketCount; x += 1) {
			ctx.lineTo(x + 0.5, yValues[x]);
		}
		ctx.lineTo(lastLineX, yValues[Math.max(0, bucketCount - 1)] ?? lineBottomY);
		ctx.lineTo(rightOutsideX, fillBottomY);
		ctx.closePath();
		ctx.fillStyle = color;
		ctx.globalAlpha = 0.35;
		ctx.fill();
		ctx.globalAlpha = 1;

		ctx.beginPath();
		for (let x = 0; x < bucketCount; x += 1) {
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
