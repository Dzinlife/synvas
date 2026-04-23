// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEditorRuntime } from "@/scene-editor/runtime/testUtils";
import {
	alignSourceTime,
	createFreezeFrameModel,
} from "./model";

const mocks = vi.hoisted(() => ({
	acquireVideoAsset: vi.fn(),
	makeImageFromTextureSourceDirect: vi.fn(),
}));

vi.mock("@/assets/videoAsset", () => ({
	acquireVideoAsset: mocks.acquireVideoAsset,
}));

vi.mock("react-skia-lite", () => ({
	makeImageFromTextureSourceDirect: mocks.makeImageFromTextureSourceDirect,
}));

const createVideoSampleGenerator = (
	frame: VideoFrame,
): AsyncGenerator<any, void, unknown> =>
	(async function* () {
		yield {
			timestamp: 0,
			toVideoFrame: vi.fn(() => frame),
			close: vi.fn(),
		};
	})();

const createMockVideoSample = (frame: VideoFrame) => ({
	timestamp: 0,
	toVideoFrame: vi.fn(() => frame),
	close: vi.fn(),
});

const createMockVideoHandle = (options: {
	cachedImage?: object | null;
	decodedGenerator?: AsyncGenerator<any, void, unknown>;
	videoRotation?: 0 | 90 | 180 | 270;
}) => {
	const samples = vi.fn(
		(_sourceTime: number) =>
			options.decodedGenerator ??
			(async function* () {
				yield undefined as never;
			})(),
	);
	const asset = {
		videoSampleSink: {
			samples,
		},
		videoRotation: options.videoRotation ?? 0,
		getCachedFrame: vi.fn(() => options.cachedImage ?? undefined),
		storeFrame: vi.fn(),
		pinFrame: vi.fn(),
		unpinFrame: vi.fn(),
	};
	return {
		asset,
		release: vi.fn(),
	};
};

describe("FreezeFrame model", () => {
	const runtime = createTestEditorRuntime("freeze-frame-model-test");
	const timelineStore = runtime.timelineStore;

	beforeEach(() => {
		vi.clearAllMocks();
		timelineStore.setState({ fps: 30 });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("缓存命中时直接复用 VideoAsset.frameCache", async () => {
		const cachedImage = { id: "cached-image" };
		const handle = createMockVideoHandle({
			cachedImage,
		});
		mocks.acquireVideoAsset.mockResolvedValue(handle);

		const store = createFreezeFrameModel("freeze-1", {
			uri: "clip.mp4",
			sourceTime: 1,
		}, runtime);
		await store.getState().init();

		expect(mocks.acquireVideoAsset).toHaveBeenCalledWith("clip.mp4");
		expect(handle.asset.getCachedFrame).toHaveBeenCalledWith(1);
		expect(handle.asset.videoSampleSink.samples).not.toHaveBeenCalled();
		expect(handle.asset.storeFrame).not.toHaveBeenCalled();
		expect(handle.asset.pinFrame).toHaveBeenCalledWith(cachedImage);
		expect(store.getState().internal.image).toBe(cachedImage);

		store.getState().dispose();
		expect(handle.asset.unpinFrame).toHaveBeenCalledWith(cachedImage);
		expect(handle.release).toHaveBeenCalledTimes(1);
	});

	it("缓存未命中时解码并回填缓存", async () => {
		const decodedImage = { id: "decoded-image" };
		const frame = { id: "frame", close: vi.fn() } as unknown as VideoFrame;
		const handle = createMockVideoHandle({
			decodedGenerator: createVideoSampleGenerator(frame),
		});
		mocks.acquireVideoAsset.mockResolvedValue(handle);
		mocks.makeImageFromTextureSourceDirect.mockReturnValue(decodedImage);

		const store = createFreezeFrameModel("freeze-2", {
			uri: "clip.mp4",
			sourceTime: 1.01,
		}, runtime);
		await store.getState().init();

		const alignedTime = alignSourceTime(1.01, 30);
		expect(handle.asset.getCachedFrame).toHaveBeenCalledWith(alignedTime);
		expect(handle.asset.videoSampleSink.samples).toHaveBeenCalledWith(
			alignedTime,
		);
		expect(mocks.makeImageFromTextureSourceDirect).toHaveBeenCalledWith(frame);
		expect(mocks.makeImageFromTextureSourceDirect).toHaveBeenCalledTimes(1);
		expect(handle.asset.storeFrame).toHaveBeenCalledWith(
			alignedTime,
			decodedImage,
		);
		expect(handle.asset.pinFrame).toHaveBeenCalledWith(decodedImage);
		expect(store.getState().internal.image).toBe(decodedImage);
	});

	it("切换定格帧与 dispose 会正确 pin/unpin", async () => {
		const imageA = { id: "image-a" };
		const imageB = { id: "image-b" };
		const handleA = createMockVideoHandle({
			cachedImage: imageA,
		});
		const handleB = createMockVideoHandle({
			cachedImage: imageB,
		});
		mocks.acquireVideoAsset
			.mockResolvedValueOnce(handleA)
			.mockResolvedValueOnce(handleB);

		const store = createFreezeFrameModel("freeze-3", {
			uri: "clip.mp4",
			sourceTime: 1,
		}, runtime);
		await store.getState().init();
		store.getState().setProps({ sourceTime: 2 });
		await store.getState().init();

		expect(handleA.asset.pinFrame).toHaveBeenCalledWith(imageA);
		expect(handleA.asset.unpinFrame).toHaveBeenCalledWith(imageA);
		expect(handleA.release).toHaveBeenCalledTimes(1);
		expect(handleB.asset.pinFrame).toHaveBeenCalledWith(imageB);

		store.getState().dispose();
		expect(handleB.asset.unpinFrame).toHaveBeenCalledWith(imageB);
		expect(handleB.release).toHaveBeenCalledTimes(1);
	});

	it("解码完成后会同步写入视频旋转元数据", async () => {
		const decodedImage = { id: "decoded-image" };
		const handle = createMockVideoHandle({
			decodedGenerator: (async function* () {
				yield createMockVideoSample({ close: vi.fn() } as unknown as VideoFrame);
			})(),
			videoRotation: 90,
		});
		mocks.acquireVideoAsset.mockResolvedValue(handle);
		mocks.makeImageFromTextureSourceDirect.mockReturnValue(decodedImage);

		const store = createFreezeFrameModel("freeze-rotation", {
			uri: "clip.mp4",
			sourceTime: 0,
		}, runtime);
		await store.getState().init();

		expect(store.getState().internal.videoRotation).toBe(90);
	});
});
