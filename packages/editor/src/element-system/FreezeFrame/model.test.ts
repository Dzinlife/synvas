// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEditorRuntime } from "@/scene-editor/runtime/testUtils";
import { alignSourceTime, createFreezeFrameModel } from "./model";

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

const createMockCanvasEnvironment = () => {
	const context = {
		clearRect: vi.fn(),
	};
	const canvases: Array<{
		width: number;
		height: number;
		getContext: ReturnType<typeof vi.fn>;
	}> = [];
	const OffscreenCanvasMock = vi.fn(function (
		this: {
			width: number;
			height: number;
			getContext: ReturnType<typeof vi.fn>;
		},
		width: number,
		height: number,
	) {
		const canvas = {
			width,
			height,
			getContext: vi.fn(() => context),
		};
		canvases.push(canvas);
		return canvas;
	});
	vi.stubGlobal("OffscreenCanvas", OffscreenCanvasMock);
	return { canvases, context };
};

const createMockVideoSample = () => ({
	timestamp: 0,
	displayWidth: 1920,
	displayHeight: 1080,
	draw: vi.fn(),
	close: vi.fn(),
});

type MockVideoSample = ReturnType<typeof createMockVideoSample>;

const createVideoSampleGenerator = (
	sample = createMockVideoSample(),
): AsyncGenerator<MockVideoSample, void, unknown> =>
	(async function* () {
		yield sample;
	})();

const createMockVideoHandle = (options: {
	cachedImage?: object | null;
	decodedGenerator?: AsyncGenerator<MockVideoSample, void, unknown>;
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
		createMockCanvasEnvironment();
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

		const store = createFreezeFrameModel(
			"freeze-1",
			{
				uri: "clip.mp4",
				sourceTime: 1,
			},
			runtime,
		);
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
		const sample = createMockVideoSample();
		const handle = createMockVideoHandle({
			decodedGenerator: createVideoSampleGenerator(sample),
		});
		mocks.acquireVideoAsset.mockResolvedValue(handle);
		mocks.makeImageFromTextureSourceDirect.mockReturnValue(decodedImage);

		const store = createFreezeFrameModel(
			"freeze-2",
			{
				uri: "clip.mp4",
				sourceTime: 1.01,
			},
			runtime,
		);
		await store.getState().init();

		const alignedTime = alignSourceTime(1.01, 30);
		expect(handle.asset.getCachedFrame).toHaveBeenCalledWith(alignedTime);
		expect(handle.asset.videoSampleSink.samples).toHaveBeenCalledWith(
			alignedTime,
		);
		expect(sample.draw).toHaveBeenCalledWith(
			expect.anything(),
			0,
			0,
			1920,
			1080,
		);
		expect(mocks.makeImageFromTextureSourceDirect).toHaveBeenCalledWith(
			expect.objectContaining({
				width: 1920,
				height: 1080,
			}),
			{
				colorConversion: "browser",
			},
		);
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

		const store = createFreezeFrameModel(
			"freeze-3",
			{
				uri: "clip.mp4",
				sourceTime: 1,
			},
			runtime,
		);
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
				yield createMockVideoSample();
			})(),
			videoRotation: 90,
		});
		mocks.acquireVideoAsset.mockResolvedValue(handle);
		mocks.makeImageFromTextureSourceDirect.mockReturnValue(decodedImage);

		const store = createFreezeFrameModel(
			"freeze-rotation",
			{
				uri: "clip.mp4",
				sourceTime: 0,
			},
			runtime,
		);
		await store.getState().init();

		expect(store.getState().internal.videoRotation).toBe(90);
	});
});
