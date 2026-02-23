// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEditorRuntime } from "@/editor/runtime/testUtils";
import { createImageModel } from "./model";

const mocks = vi.hoisted(() => ({
	acquireImageAsset: vi.fn(),
}));

vi.mock("@/assets/imageAsset", () => ({
	acquireImageAsset: mocks.acquireImageAsset,
}));

const createMockHandle = (image: object) => {
	return {
		asset: {
			uri: "mock://image",
			image,
			width: 100,
			height: 100,
		},
		release: vi.fn(),
	};
};

const createDeferred = <T,>() => {
	let resolvePromise: ((value: T) => void) | null = null;
	let rejectPromise: ((reason?: unknown) => void) | null = null;
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		promise,
		resolve: (value: T) => {
			resolvePromise?.(value);
		},
		reject: (reason?: unknown) => {
			rejectPromise?.(reason);
		},
	};
};

describe("Image model", () => {
	const runtime = createTestEditorRuntime("image-model-test");

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("init 会通过 imageAsset 缓存加载图片", async () => {
		const image = { id: "image-a" };
		const handle = createMockHandle(image);
		mocks.acquireImageAsset.mockResolvedValue(handle);

		const store = createImageModel(
			"image-1",
			{ uri: "https://example.com/image-a.png" },
			runtime,
		);

		await store.getState().init();

		expect(mocks.acquireImageAsset).toHaveBeenCalledWith(
			"https://example.com/image-a.png",
		);
		expect(store.getState().internal.image).toBe(image);
		expect(store.getState().internal.isReady).toBe(true);
		expect(store.getState().constraints.isLoading).toBe(false);

		store.getState().dispose();
		expect(handle.release).toHaveBeenCalledTimes(1);
		expect(store.getState().internal.image).toBeNull();
	});

	it("并发 init 时不会被旧请求覆盖", async () => {
		const deferredA = createDeferred<ReturnType<typeof createMockHandle>>();
		const deferredB = createDeferred<ReturnType<typeof createMockHandle>>();
		mocks.acquireImageAsset
			.mockReturnValueOnce(deferredA.promise)
			.mockReturnValueOnce(deferredB.promise);

		const store = createImageModel(
			"image-2",
			{ uri: "https://example.com/image-b.png" },
			runtime,
		);

		const initA = store.getState().init();
		const initB = store.getState().init();

		const imageB = { id: "image-b" };
		const handleB = createMockHandle(imageB);
		deferredB.resolve(handleB);
		await initB;

		expect(store.getState().internal.image).toBe(imageB);
		const imageA = { id: "image-a" };
		const handleA = createMockHandle(imageA);
		deferredA.resolve(handleA);
		await initA;

		expect(handleA.release).toHaveBeenCalledTimes(1);
		expect(store.getState().internal.image).toBe(imageB);

		store.getState().dispose();
		expect(handleB.release).toHaveBeenCalledTimes(1);
	});
});
