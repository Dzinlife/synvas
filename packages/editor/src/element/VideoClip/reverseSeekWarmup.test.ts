import type { CanvasSink, WrappedCanvas } from "mediabunny";
import { describe, expect, it, vi } from "vitest";
import { warmFramesFromKeyframeToTarget } from "./reverseSeekWarmup";

const createSink = (timestamps: number[]) => {
	const canvasesMock = vi.fn((_start: number, _end: number) =>
		(async function* () {
			for (const timestamp of timestamps) {
				yield {
					timestamp,
					canvas: {} as HTMLCanvasElement,
				} as WrappedCanvas;
			}
		})(),
	);
	return {
		sink: {
			canvases: canvasesMock,
		} as unknown as CanvasSink,
		canvasesMock,
	};
};

describe("reverseSeekWarmup", () => {
	it("首次 miss 会按关键帧区间解码并缓存", async () => {
		const { sink, canvasesMock } = createSink([0.2, 0.24, 0.28]);
		const frameCache = new Map<number, string>();
		const result = await warmFramesFromKeyframeToTarget({
			videoSink: sink,
			targetTime: 0.28,
			frameInterval: 0.04,
			alignTime: (time) => Math.round(time * 100) / 100,
			resolveKeyframeTime: async () => 0.2,
			getCachedFrame: (aligned) => frameCache.get(aligned),
			decodeWrappedFrame: async (frame) =>
				`frame-${frame.timestamp.toFixed(2)}`,
			storeFrame: (aligned, frame) => {
				frameCache.set(aligned, frame);
			},
		});

		expect(result.frame).toBe("frame-0.28");
		expect(result.fromCache).toBe(false);
		expect(result.decodedCount).toBe(3);
		expect(frameCache.get(0.2)).toBe("frame-0.20");
		expect(frameCache.get(0.24)).toBe("frame-0.24");
		expect(frameCache.get(0.28)).toBe("frame-0.28");
		expect(canvasesMock).toHaveBeenCalledTimes(1);
		const [decodeStart, decodeEndExclusive] = canvasesMock.mock.calls[0] as [
			number,
			number,
		];
		expect(decodeStart).toBe(0.2);
		expect(decodeEndExclusive).toBeCloseTo(0.3, 8);
	});

	it("同一目标帧二次请求命中缓存，不重复解码", async () => {
		const { sink, canvasesMock } = createSink([0.2, 0.24, 0.28]);
		const frameCache = new Map<number, string>([[0.28, "cached-0.28"]]);
		const resolveKeyframeTime = vi.fn(async () => 0.2);
		const result = await warmFramesFromKeyframeToTarget({
			videoSink: sink,
			targetTime: 0.28,
			frameInterval: 0.04,
			alignTime: (time) => Math.round(time * 100) / 100,
			resolveKeyframeTime,
			getCachedFrame: (aligned) => frameCache.get(aligned),
			decodeWrappedFrame: async (frame) =>
				`frame-${frame.timestamp.toFixed(2)}`,
			storeFrame: (aligned, frame) => {
				frameCache.set(aligned, frame);
			},
		});

		expect(result.frame).toBe("cached-0.28");
		expect(result.fromCache).toBe(true);
		expect(resolveKeyframeTime).not.toHaveBeenCalled();
		expect(canvasesMock).not.toHaveBeenCalled();
	});

	it("未找到关键帧或可用帧时返回空结果供上层回退", async () => {
		const { sink, canvasesMock } = createSink([]);
		const result = await warmFramesFromKeyframeToTarget({
			videoSink: sink,
			targetTime: 1.0,
			frameInterval: 0.04,
			alignTime: (time) => Math.round(time * 100) / 100,
			resolveKeyframeTime: async () => null,
			getCachedFrame: () => undefined,
			decodeWrappedFrame: async () => null,
			storeFrame: () => {},
		});

		expect(result.frame).toBeNull();
		expect(result.fromCache).toBe(false);
		expect(result.decodeStartTime).toBe(1);
		expect(canvasesMock).toHaveBeenCalledWith(1, 1.02);
	});

	it("中断时不会继续写入后续帧缓存", async () => {
		const { sink } = createSink([0.2, 0.24, 0.28]);
		const frameCache = new Map<number, string>();
		let shouldAbort = false;
		const result = await warmFramesFromKeyframeToTarget({
			videoSink: sink,
			targetTime: 0.28,
			frameInterval: 0.04,
			alignTime: (time) => Math.round(time * 100) / 100,
			resolveKeyframeTime: async () => 0.2,
			getCachedFrame: (aligned) => frameCache.get(aligned),
			decodeWrappedFrame: async (frame) => {
				shouldAbort = true;
				return `frame-${frame.timestamp.toFixed(2)}`;
			},
			storeFrame: (aligned, frame) => {
				frameCache.set(aligned, frame);
			},
			shouldAbort: () => shouldAbort,
		});

		expect(result.decodedCount).toBe(1);
		expect(frameCache.size).toBe(1);
		expect(result.frame).toBe("frame-0.20");
	});
});
