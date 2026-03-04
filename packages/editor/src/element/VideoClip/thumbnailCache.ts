import type { CanvasSink, Input } from "mediabunny";
import { resolveVideoKeyframeTime } from "./keyframeTimeCache";

const THUMBNAIL_CACHE_LIMIT = 800;

const thumbnailCache = new Map<string, HTMLCanvasElement>();
const thumbnailAccessOrder: string[] = [];
const thumbnailInflight = new Map<string, Promise<HTMLCanvasElement | null>>();

const videoSizeCache = new Map<string, { width: number; height: number }>();
const videoSizeInflight = new Map<
	string,
	Promise<{ width: number; height: number } | null>
>();

const touchThumbnailKey = (key: string) => {
	const index = thumbnailAccessOrder.indexOf(key);
	if (index >= 0) {
		thumbnailAccessOrder.splice(index, 1);
	}
	thumbnailAccessOrder.push(key);
};

const evictThumbnailsIfNeeded = () => {
	while (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
		const oldestKey = thumbnailAccessOrder.shift();
		if (!oldestKey) break;
		thumbnailCache.delete(oldestKey);
	}
};

const getFrameCanvas = async (
	videoSink: CanvasSink,
	time: number,
): Promise<HTMLCanvasElement | OffscreenCanvas | null> => {
	const iterator = videoSink.canvases(time);
	try {
		const frame = (await iterator.next()).value;
		return frame?.canvas ?? null;
	} finally {
		await iterator.return();
	}
};

export const getVideoSize = async (
	uri: string,
	videoSink?: CanvasSink | null,
): Promise<{ width: number; height: number } | null> => {
	const cached = videoSizeCache.get(uri);
	if (cached) return cached;
	if (!videoSink) return null;
	const inflight = videoSizeInflight.get(uri);
	if (inflight) return inflight;

	const promise = (async () => {
		const frameCanvas = await getFrameCanvas(videoSink, 0);
		if (!frameCanvas || frameCanvas.width <= 0 || frameCanvas.height <= 0) {
			return null;
		}
		const size = { width: frameCanvas.width, height: frameCanvas.height };
		videoSizeCache.set(uri, size);
		return size;
	})();

	videoSizeInflight.set(uri, promise);
	try {
		return await promise;
	} finally {
		videoSizeInflight.delete(uri);
	}
};

export const getThumbnail = async (options: {
	uri: string;
	time: number;
	timeKey: number;
	width: number;
	height: number;
	pixelRatio: number;
	videoSink?: CanvasSink | null;
	input?: Input | null;
	preferKeyframes?: boolean;
}): Promise<HTMLCanvasElement | null> => {
	const {
		uri,
		time,
		timeKey,
		width,
		height,
		pixelRatio,
		videoSink,
		input,
		preferKeyframes,
	} = options;
	let effectiveTime = time;
	let effectiveTimeKey = timeKey;
	if (preferKeyframes) {
		const keyTime = await resolveVideoKeyframeTime({
			uri,
			input,
			time,
			timeKey,
		});
		if (keyTime !== null) {
			const safeKeyTime = Math.max(0, keyTime);
			effectiveTime = safeKeyTime;
			effectiveTimeKey = Math.max(0, Math.round(safeKeyTime * 1000));
		}
	}
	const targetWidth = Math.max(1, Math.round(width * pixelRatio));
	const targetHeight = Math.max(1, Math.round(height * pixelRatio));
	const cacheKey = `${uri}|${effectiveTimeKey}|${targetWidth}x${targetHeight}`;

	const cached = thumbnailCache.get(cacheKey);
	if (cached) {
		touchThumbnailKey(cacheKey);
		return cached;
	}
	if (!videoSink) return null;

	const inflight = thumbnailInflight.get(cacheKey);
	if (inflight) {
		return inflight;
	}

	const promise = (async () => {
		const frameCanvas = await getFrameCanvas(videoSink, effectiveTime);
		if (!frameCanvas || frameCanvas.width <= 0 || frameCanvas.height <= 0) {
			return null;
		}

		const resultCanvas = document.createElement("canvas");
		resultCanvas.width = targetWidth;
		resultCanvas.height = targetHeight;
		const ctx = resultCanvas.getContext("2d");
		if (!ctx) return null;

		const scale = targetHeight / frameCanvas.height;
		const scaledWidth = frameCanvas.width * scale;
		if (scaledWidth > targetWidth) {
			const sourceWidth = targetWidth / scale;
			const sourceX = (frameCanvas.width - sourceWidth) / 2;
			ctx.drawImage(
				frameCanvas,
				sourceX,
				0,
				sourceWidth,
				frameCanvas.height,
				0,
				0,
				targetWidth,
				targetHeight,
			);
		} else {
			const offsetX = (targetWidth - scaledWidth) / 2;
			ctx.drawImage(
				frameCanvas,
				0,
				0,
				frameCanvas.width,
				frameCanvas.height,
				offsetX,
				0,
				scaledWidth,
				targetHeight,
			);
		}

		thumbnailCache.set(cacheKey, resultCanvas);
		touchThumbnailKey(cacheKey);
		evictThumbnailsIfNeeded();
		return resultCanvas;
	})();

	thumbnailInflight.set(cacheKey, promise);
	try {
		return await promise;
	} finally {
		thumbnailInflight.delete(cacheKey);
	}
};
