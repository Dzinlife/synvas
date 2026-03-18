// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getThumbnail } from "./thumbnailCache";
import { resolveVideoKeyframeTime } from "./keyframeTimeCache";

vi.mock("./keyframeTimeCache", () => ({
	resolveVideoKeyframeTime: vi.fn(async () => null),
}));

const createVideoSample = (width: number, height: number) => ({
	displayWidth: width,
	displayHeight: height,
	draw: vi.fn(),
	close: vi.fn(),
});

const createVideoSampleSink = (
	sample: ReturnType<typeof createVideoSample>,
	spy: ReturnType<typeof vi.fn>,
) => {
	return {
		samples: spy.mockImplementation((_time: number) =>
			(async function* () {
				yield sample;
			})(),
		),
	};
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
		const sample = createVideoSample(320, 180);
		const samplesSpy = vi.fn();
		const sink = createVideoSampleSink(sample, samplesSpy);
		const mockedResolve = vi.mocked(resolveVideoKeyframeTime);

		const result = await getThumbnail({
			uri: "freeze-exact.mp4",
			time: 1.234,
			timeKey: 1234,
			width: 120,
			height: 67.5,
			pixelRatio: 1,
			videoSampleSink: sink as any,
			preferKeyframes: false,
		});

		expect(result).not.toBeNull();
		expect(mockedResolve).not.toHaveBeenCalled();
		expect(samplesSpy).toHaveBeenCalledWith(1.234);
		expect(sample.draw).toHaveBeenCalledTimes(1);
		expect(sample.close).toHaveBeenCalledTimes(1);
	});

	it("preferKeyframes=true 时走关键帧时间映射", async () => {
		const sample = createVideoSample(320, 180);
		const samplesSpy = vi.fn();
		const sink = createVideoSampleSink(sample, samplesSpy);
		const mockedResolve = vi.mocked(resolveVideoKeyframeTime);
		mockedResolve.mockResolvedValueOnce(2.5);

		const result = await getThumbnail({
			uri: "freeze-keyframe.mp4",
			time: 3,
			timeKey: 3000,
			width: 120,
			height: 67.5,
			pixelRatio: 1,
			videoSampleSink: sink as any,
			preferKeyframes: true,
		});

		expect(result).not.toBeNull();
		expect(mockedResolve).toHaveBeenCalledTimes(1);
		expect(samplesSpy).toHaveBeenCalledWith(2.5);
		expect(sample.draw).toHaveBeenCalledTimes(1);
		expect(sample.close).toHaveBeenCalledTimes(1);
	});
});
