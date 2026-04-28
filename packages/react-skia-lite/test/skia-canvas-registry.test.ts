import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkPicture } from "../src/skia/types";
import { skiaCanvasRegistry } from "../src/views/skiaCanvasRegistry";
import type { SkiaPictureViewHandle } from "../src/views/SkiaPictureView";

const createViewHandle = (overrides?: Partial<SkiaPictureViewHandle>) =>
	({
		setPicture: vi.fn(),
		getSize: vi.fn(() => ({ width: 0, height: 0 })),
		redraw: vi.fn(),
		makeImageSnapshot: vi.fn(),
		measure: vi.fn(),
		measureInWindow: vi.fn(),
		...overrides,
	}) as unknown as SkiaPictureViewHandle;

const createPicture = () =>
	({
		dispose: vi.fn(),
	}) as unknown as SkPicture;

beforeEach(() => {
	for (const id of Object.keys(skiaCanvasRegistry.views)) {
		delete skiaCanvasRegistry.views[id];
	}
	for (const id of Object.keys(skiaCanvasRegistry.deferredPictures)) {
		delete skiaCanvasRegistry.deferredPictures[id];
	}
});

describe("skiaCanvasRegistry", () => {
	it("registerView 会消费并清理 deferred picture", () => {
		const picture = createPicture();
		skiaCanvasRegistry.setCanvasProperty(1, "picture", picture);
		const setPicture = vi.fn();

		skiaCanvasRegistry.registerView(
			"1",
			createViewHandle({
				setPicture,
			}),
		);

		expect(setPicture).toHaveBeenCalledWith(picture);
		expect(skiaCanvasRegistry.deferredPictures["1"]).toBeUndefined();
	});

	it("setCanvasProperty 覆盖 deferred picture 时会释放旧 picture", () => {
		const pictureA = createPicture();
		const pictureB = createPicture();

		skiaCanvasRegistry.setCanvasProperty(2, "picture", pictureA);
		skiaCanvasRegistry.setCanvasProperty(2, "picture", pictureB);

		expect(pictureA.dispose).toHaveBeenCalledTimes(1);
		expect(skiaCanvasRegistry.deferredPictures["2"]).toBe(pictureB);
	});

	it("unregisterView 会清理缓存并释放 deferred picture", () => {
		const view = createViewHandle();
		const picture = createPicture();

		skiaCanvasRegistry.registerView("3", view);
		skiaCanvasRegistry.setCanvasProperty(4, "picture", picture);

		skiaCanvasRegistry.unregisterView("3");
		skiaCanvasRegistry.unregisterView("4");

		expect(skiaCanvasRegistry.views["3"]).toBeUndefined();
		expect(skiaCanvasRegistry.deferredPictures["4"]).toBeUndefined();
		expect(picture.dispose).toHaveBeenCalledTimes(1);
	});
});
