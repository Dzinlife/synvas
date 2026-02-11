import type { CanvasSink, WrappedCanvas } from "mediabunny";

export interface WarmFramesFromKeyframeToTargetOptions<Frame> {
	videoSink: CanvasSink;
	targetTime: number;
	frameInterval: number;
	alignTime: (time: number) => number;
	resolveKeyframeTime: (args: {
		targetTime: number;
		timeKey: number;
	}) => Promise<number | null>;
	getCachedFrame: (alignedTime: number) => Frame | undefined;
	decodeWrappedFrame: (frame: WrappedCanvas) => Promise<Frame | null>;
	storeFrame: (alignedTime: number, frame: Frame) => void;
	shouldAbort?: () => boolean;
}

export interface WarmFramesFromKeyframeToTargetResult<Frame> {
	frame: Frame | null;
	frameTime: number | null;
	fromCache: boolean;
	decodeStartTime: number;
	decodeEndExclusive: number;
	decodedCount: number;
}

export const warmFramesFromKeyframeToTarget = async <Frame>({
	videoSink,
	targetTime,
	frameInterval,
	alignTime,
	resolveKeyframeTime,
	getCachedFrame,
	decodeWrappedFrame,
	storeFrame,
	shouldAbort,
}: WarmFramesFromKeyframeToTargetOptions<Frame>): Promise<
	WarmFramesFromKeyframeToTargetResult<Frame>
> => {
	const alignedTarget = alignTime(targetTime);
	const cached = getCachedFrame(alignedTarget);
	if (cached) {
		return {
			frame: cached,
			frameTime: alignedTarget,
			fromCache: true,
			decodeStartTime: alignedTarget,
			decodeEndExclusive: alignedTarget,
			decodedCount: 0,
		};
	}

	const safeFrameInterval =
		Number.isFinite(frameInterval) && frameInterval > 0
			? frameInterval
			: 1 / 30;
	const timeKey = Math.max(0, Math.round(alignedTarget * 1000));
	const keyTime = await resolveKeyframeTime({
		targetTime: alignedTarget,
		timeKey,
	});
	const decodeStart = Math.min(
		alignedTarget,
		keyTime !== null ? Math.max(0, keyTime) : alignedTarget,
	);
	// 这里加半帧余量，兼容 end-exclusive 迭代器，确保目标附近帧能被读到。
	const decodeEndExclusive = alignedTarget + safeFrameInterval * 0.5;

	let decodedCount = 0;
	let bestFrame: Frame | null = null;
	let bestFrameTime: number | null = null;
	const iterator = videoSink.canvases(decodeStart, decodeEndExclusive);
	try {
		while (true) {
			if (shouldAbort?.()) break;
			const result = await iterator.next();
			if (result.done) break;
			const wrapped = result.value;
			const decoded = await decodeWrappedFrame(wrapped);
			if (!decoded) continue;
			const alignedFrameTime = alignTime(wrapped.timestamp);
			storeFrame(alignedFrameTime, decoded);
			decodedCount += 1;
			if (
				alignedFrameTime <= alignedTarget &&
				(bestFrameTime === null || alignedFrameTime >= bestFrameTime)
			) {
				bestFrame = decoded;
				bestFrameTime = alignedFrameTime;
			}
		}
	} finally {
		await iterator.return?.();
	}

	return {
		frame: bestFrame,
		frameTime: bestFrameTime,
		fromCache: false,
		decodeStartTime: decodeStart,
		decodeEndExclusive,
		decodedCount,
	};
};
