import type { CanvasSink, WrappedCanvas } from "mediabunny";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	__resetVideoPlaybackSessionPoolForTests,
	releaseVideoPlaybackSession,
	retainVideoPlaybackSession,
	stepVideoPlaybackSession,
} from "./videoPlaybackSessionPool";

vi.mock("@/scene-editor/contexts/TimelineContext", () => ({
	useTimelineStore: {
		getState: () => ({
			isExporting: false,
		}),
	},
}));

const createSink = (timestamps: number[]): CanvasSink => {
	return {
		canvases: vi.fn((_start: number) =>
			(async function* () {
				for (const timestamp of timestamps) {
					yield {
						timestamp,
						canvas: {} as HTMLCanvasElement,
					} as WrappedCanvas;
				}
			})(),
		),
	} as unknown as CanvasSink;
};

describe("videoPlaybackSessionPool", () => {
	afterEach(() => {
		__resetVideoPlaybackSessionPoolForTests();
	});

	it("同一 session 连续步进不重建迭代器", async () => {
		const sink = createSink([0.0, 0.04, 0.08, 0.12]);
		retainVideoPlaybackSession("session:a");
		const frame1 = await stepVideoPlaybackSession({
			key: "session:a",
			sink,
			targetTime: 0.05,
			backJumpThresholdSeconds: 0.1,
		});
		const frame2 = await stepVideoPlaybackSession({
			key: "session:a",
			sink,
			targetTime: 0.1,
			backJumpThresholdSeconds: 0.1,
		});
		expect(frame1?.timestamp).toBe(0.04);
		expect(frame2?.timestamp).toBe(0.08);
		expect(sink.canvases).toHaveBeenCalledTimes(1);
		releaseVideoPlaybackSession("session:a");
	});

	it("回跳超过阈值会重建迭代器", async () => {
		const sink = createSink([0.1, 0.2, 0.3]);
		retainVideoPlaybackSession("session:b");
		await stepVideoPlaybackSession({
			key: "session:b",
			sink,
			targetTime: 0.25,
			backJumpThresholdSeconds: 0.05,
		});
		await stepVideoPlaybackSession({
			key: "session:b",
			sink,
			targetTime: 0.0,
			backJumpThresholdSeconds: 0.05,
		});
		expect(sink.canvases).toHaveBeenCalledTimes(2);
		releaseVideoPlaybackSession("session:b");
	});

	it("阈值为 0 时任意回退都会重建迭代器", async () => {
		const sink = createSink([0.1, 0.2, 0.3, 0.4]);
		retainVideoPlaybackSession("session:reverse");
		const frame1 = await stepVideoPlaybackSession({
			key: "session:reverse",
			sink,
			targetTime: 0.35,
			backJumpThresholdSeconds: 0,
		});
		const frame2 = await stepVideoPlaybackSession({
			key: "session:reverse",
			sink,
			targetTime: 0.25,
			backJumpThresholdSeconds: 0,
		});
		expect(frame1?.timestamp).toBe(0.3);
		expect(frame2?.timestamp).toBe(0.2);
		expect(sink.canvases).toHaveBeenCalledTimes(2);
		releaseVideoPlaybackSession("session:reverse");
	});

	it("启动后不会展示时间戳晚于目标时间的首帧", async () => {
		const sink = createSink([1.1, 1.2, 1.3]);
		retainVideoPlaybackSession("session:c");
		const frame = await stepVideoPlaybackSession({
			key: "session:c",
			sink,
			targetTime: 1.05,
			backJumpThresholdSeconds: 0.1,
		});
		expect(frame).toBeNull();
		releaseVideoPlaybackSession("session:c");
	});
});
