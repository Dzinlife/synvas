import type { AudioBufferSink } from "mediabunny";

const WAVEFORM_CACHE_LIMIT = 600;

const waveformCache = new Map<string, HTMLCanvasElement>();
const waveformAccessOrder: string[] = [];
const waveformInflight = new Map<string, Promise<HTMLCanvasElement | null>>();

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

const clampNumber = (value: number, min: number, max: number) => {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
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
	const cacheKey = `${uri}|${startKey}-${endKey}|${targetWidth}x${targetHeight}|${color}`;

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

		const peaks = new Float32Array(bucketCount);

		try {
			const safeDecodeStart = Number.isFinite(decodeStart ?? NaN)
				? Math.max(0, decodeStart as number)
				: Math.max(0, windowStart);
			const safeDecodeEnd = Number.isFinite(decodeEnd ?? NaN)
				? Math.max(0, decodeEnd as number)
				: Math.max(0, windowEnd);
			if (safeDecodeEnd > safeDecodeStart) {
				for await (const wrapped of audioSink.buffers(
					safeDecodeStart,
					safeDecodeEnd,
				)) {
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

					const overlapStart = Math.max(windowStart, bufferStart);
					const overlapEnd = Math.min(windowEnd, bufferEnd);
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
					const maxSamples = bucketCount * 200;
					const step = Math.max(1, Math.floor(totalSamples / maxSamples));

					const channelCount = buffer.numberOfChannels;
					const channels: Float32Array[] = [];
					for (let c = 0; c < channelCount; c += 1) {
						channels.push(buffer.getChannelData(c));
					}

					const bucketScale = 1 / (sampleRate * bucketDuration);
					const bucketBase = (bufferStart - windowStart) / bucketDuration;

					for (let i = startSample; i < endSample; i += step) {
						let peak = 0;
						for (let c = 0; c < channelCount; c += 1) {
							const value = Math.abs(channels[c][i]);
							if (value > peak) peak = value;
						}
						if (peak <= 0) continue;

						const rawIndex = bucketBase + i * bucketScale;
						const bucketIndex = Math.floor(rawIndex);
						if (bucketIndex < 0 || bucketIndex >= bucketCount) continue;

						if (peak > peaks[bucketIndex]) {
							peaks[bucketIndex] = peak;
						}
					}
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
		ctx.fillStyle = color;

		const midY = targetHeight / 2;
		for (let x = 0; x < bucketCount; x += 1) {
			const amplitude = clampNumber(peaks[x], 0, 1);
			if (amplitude <= 0) continue;
			const barHeight = amplitude * targetHeight;
			const top = midY - barHeight / 2;
			ctx.fillRect(x, top, 1, barHeight);
		}

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
