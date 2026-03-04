// @vitest-environment jsdom

import type { CanvasSink, WrappedCanvas } from "mediabunny";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getThumbnail } from "./thumbnailCache";
import { resolveVideoKeyframeTime } from "./keyframeTimeCache";

vi.mock("./keyframeTimeCache", () => ({
	resolveVideoKeyframeTime: vi.fn(async () => null),
}));

const createFrameGenerator = (
	canvas: HTMLCanvasElement,
): AsyncGenerator<WrappedCanvas, void, unknown> =>
	(async function* () {
		yield {
			canvas,
			timestamp: 0,
		} as WrappedCanvas;
	})();

const createVideoSink = (
	canvas: HTMLCanvasElement,
	spy: ReturnType<typeof vi.fn>,
): CanvasSink => {
	return {
		canvases: spy.mockImplementation((_time: number) =>
			createFrameGenerator(canvas),
		),
	} as unknown as CanvasSink;
};

describe("thumbnailCache.getThumbnail", () => {
	beforeEach(() => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
			() =>
				({
					drawImage: vi.fn(),
				}) as any,
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("preferKeyframes=false 时按精确时间取帧", async () => {
		const source = document.createElement("canvas");
		source.width = 320;
		source.height = 180;
		const canvasesSpy = vi.fn();
		const sink = createVideoSink(source, canvasesSpy);
		const mockedResolve = vi.mocked(resolveVideoKeyframeTime);

		const result = await getThumbnail({
			uri: "freeze-exact.mp4",
			time: 1.234,
			timeKey: 1234,
			width: 120,
			height: 67.5,
			pixelRatio: 1,
			videoSink: sink,
			preferKeyframes: false,
		});

		expect(result).not.toBeNull();
		expect(mockedResolve).not.toHaveBeenCalled();
		expect(canvasesSpy).toHaveBeenCalledWith(1.234);
	});

	it("preferKeyframes=true 时走关键帧时间映射", async () => {
		const source = document.createElement("canvas");
		source.width = 320;
		source.height = 180;
		const canvasesSpy = vi.fn();
		const sink = createVideoSink(source, canvasesSpy);
		const mockedResolve = vi.mocked(resolveVideoKeyframeTime);
		mockedResolve.mockResolvedValueOnce(2.5);

		const result = await getThumbnail({
			uri: "freeze-keyframe.mp4",
			time: 3,
			timeKey: 3000,
			width: 120,
			height: 67.5,
			pixelRatio: 1,
			videoSink: sink,
			preferKeyframes: true,
		});

		expect(result).not.toBeNull();
		expect(mockedResolve).toHaveBeenCalledTimes(1);
		expect(canvasesSpy).toHaveBeenCalledWith(2.5);
	});
});
