import type { SkPicture, SkRect } from "../skia/types";
import type { SkiaPictureViewHandle } from "./SkiaPictureView";
import type { SkiaCanvasRegistry } from "./types";

export type SkiaCanvasRegistryWeb = SkiaCanvasRegistry & {
	views: Record<string, SkiaPictureViewHandle>;
	deferredPictures: Record<string, SkPicture>;
	registerView(canvasId: string, view: SkiaPictureViewHandle): void;
	unregisterView(canvasId: string): void;
};

let nextSkiaCanvasId = 1000;

export const createSkiaCanvasId = () => nextSkiaCanvasId++;

const disposePictureIfPossible = (picture: SkPicture | undefined) => {
	if (!picture || typeof picture.dispose !== "function") {
		return;
	}
	try {
		picture.dispose();
	} catch {}
};

export const skiaCanvasRegistry = {
	views: {},
	deferredPictures: {},
	web: true,
	registerView(canvasId: string, view: SkiaPictureViewHandle) {
		const deferredPicture = this.deferredPictures[canvasId];
		if (deferredPicture) {
			view.setPicture(deferredPicture);
			delete this.deferredPictures[canvasId];
		}
		this.views[canvasId] = view;
	},
	unregisterView(canvasId: string) {
		delete this.views[canvasId];
		const deferredPicture = this.deferredPictures[canvasId];
		if (!deferredPicture) {
			return;
		}
		delete this.deferredPictures[canvasId];
		disposePictureIfPossible(deferredPicture);
	},
	setCanvasProperty<T>(canvasId: number, name: string, value: T) {
		if (name !== "picture") {
			return;
		}
		const id = `${canvasId}`;
		const view = this.views[id];
		if (!view) {
			const previousDeferredPicture = this.deferredPictures[id];
			if (previousDeferredPicture && previousDeferredPicture !== value) {
				disposePictureIfPossible(previousDeferredPicture);
			}
			this.deferredPictures[id] = value as SkPicture;
			return;
		}
		view.setPicture(value as SkPicture);
	},
	size(canvasId: number) {
		return this.views[`${canvasId}`]?.getSize() ?? { width: 0, height: 0 };
	},
	requestRedraw(canvasId: number) {
		this.views[`${canvasId}`]?.redraw();
	},
	makeImageSnapshot(canvasId: number, rect?: SkRect) {
		return this.views[`${canvasId}`]?.makeImageSnapshot(rect) ?? null;
	},
	makeImageSnapshotAsync(canvasId: number, rect?: SkRect) {
		return new Promise((resolve, reject) => {
			const result = this.views[`${canvasId}`]?.makeImageSnapshot(rect);
			if (result) {
				resolve(result);
			} else {
				reject(new Error("Failed to make image snapshot"));
			}
		});
	},
} as SkiaCanvasRegistryWeb;
