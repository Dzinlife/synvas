// @vitest-environment jsdom

import type { WrappedCanvas } from "mediabunny";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEditorRuntime } from "@/editor/runtime/testUtils";
import {
	alignSourceTime,
	createFreezeFrameModel,
} from "./model";

const mocks = vi.hoisted(() => ({
	acquireVideoAsset: vi.fn(),
	makeImageFromNativeBuffer: vi.fn(),
}));

vi.mock("@/assets/videoAsset", () => ({
	acquireVideoAsset: mocks.acquireVideoAsset,
}));

vi.mock("react-skia-lite", () => ({
	Skia: {
		Image: {
			MakeImageFromNativeBuffer: mocks.makeImageFromNativeBuffer,
		},
	},
}));

const createWrappedCanvasGenerator = (
	canvas: HTMLCanvasElement,
): AsyncGenerator<WrappedCanvas, void, unknown> =>
	(async function* () {
		yield {
			canvas,
			timestamp: 0,
		} as WrappedCanvas;
	})();

const createMockVideoHandle = (options: {
	cachedImage?: object | null;
	decodedGenerator?: AsyncGenerator<WrappedCanvas, void, unknown>;
}) => {
	const canavses = vi.fn(
		(_sourceTime: number) =>
			options.decodedGenerator ??
			(async function* () {
				yield undefined as never;
			})(),
	);
	const asset = {
		videoSink: {
			canvases: canavses,
		},
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
		expect(handle.asset.videoSink.canvases).not.toHaveBeenCalled();
		expect(handle.asset.storeFrame).not.toHaveBeenCalled();
		expect(handle.asset.pinFrame).toHaveBeenCalledWith(cachedImage);
		expect(store.getState().internal.image).toBe(cachedImage);

		store.getState().dispose();
		expect(handle.asset.unpinFrame).toHaveBeenCalledWith(cachedImage);
		expect(handle.release).toHaveBeenCalledTimes(1);
	});

	it("缓存未命中时解码并回填缓存", async () => {
		const decodedImage = { id: "decoded-image" };
		const canvas = document.createElement("canvas");
		const handle = createMockVideoHandle({
			decodedGenerator: createWrappedCanvasGenerator(canvas),
		});
		mocks.acquireVideoAsset.mockResolvedValue(handle);
		const createImageBitmapMock = vi.fn(async () => ({ id: "bitmap" }));
		vi.stubGlobal("createImageBitmap", createImageBitmapMock);
		mocks.makeImageFromNativeBuffer.mockReturnValue(decodedImage);

		const store = createFreezeFrameModel("freeze-2", {
			uri: "clip.mp4",
			sourceTime: 1.01,
		}, runtime);
		await store.getState().init();

		const alignedTime = alignSourceTime(1.01, 30);
		expect(handle.asset.getCachedFrame).toHaveBeenCalledWith(alignedTime);
		expect(handle.asset.videoSink.canvases).toHaveBeenCalledWith(alignedTime);
		expect(createImageBitmapMock).toHaveBeenCalledWith(canvas);
		expect(mocks.makeImageFromNativeBuffer).toHaveBeenCalledTimes(1);
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
});
