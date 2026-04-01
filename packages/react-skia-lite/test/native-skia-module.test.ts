import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkPicture } from "../src/skia/types";
import { SkiaViewApi } from "../src/specs/NativeSkiaModule";
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
	for (const id of Object.keys(SkiaViewApi.views)) {
		delete SkiaViewApi.views[id];
	}
	for (const id of Object.keys(SkiaViewApi.deferedPictures)) {
		delete SkiaViewApi.deferedPictures[id];
	}
});

describe("SkiaViewApi", () => {
	it("registerView 会消费并清理 defered picture", () => {
		const picture = createPicture();
		SkiaViewApi.setJsiProperty(1, "picture", picture);
		const setPicture = vi.fn();

		SkiaViewApi.registerView(
			"1",
			createViewHandle({
				setPicture,
			}),
		);

		expect(setPicture).toHaveBeenCalledWith(picture);
		expect(SkiaViewApi.deferedPictures["1"]).toBeUndefined();
	});

	it("setJsiProperty 覆盖 defered picture 时会释放旧 picture", () => {
		const pictureA = createPicture();
		const pictureB = createPicture();

		SkiaViewApi.setJsiProperty(2, "picture", pictureA);
		SkiaViewApi.setJsiProperty(2, "picture", pictureB);

		expect(pictureA.dispose).toHaveBeenCalledTimes(1);
		expect(SkiaViewApi.deferedPictures["2"]).toBe(pictureB);
	});

	it("unregisterView 会清理缓存并释放 defered picture", () => {
		const view = createViewHandle();
		const picture = createPicture();

		SkiaViewApi.registerView("3", view);
		SkiaViewApi.setJsiProperty(4, "picture", picture);

		SkiaViewApi.unregisterView("3");
		SkiaViewApi.unregisterView("4");

		expect(SkiaViewApi.views["3"]).toBeUndefined();
		expect(SkiaViewApi.deferedPictures["4"]).toBeUndefined();
		expect(picture.dispose).toHaveBeenCalledTimes(1);
	});
});
