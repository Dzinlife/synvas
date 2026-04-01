/* eslint-disable import/no-anonymous-default-export */
import type { SkPicture, SkRect } from "../skia/types";
import type { SkiaPictureViewHandle } from "../views/SkiaPictureView";
import type { ISkiaViewApi } from "../views/types";

export type ISkiaViewApiWeb = ISkiaViewApi & {
	views: Record<string, SkiaPictureViewHandle>;
	deferedPictures: Record<string, SkPicture>;
	registerView(nativeId: string, view: SkiaPictureViewHandle): void;
	unregisterView(nativeId: string): void;
};

const disposePictureIfPossible = (picture: SkPicture | undefined) => {
	if (!picture || typeof picture.dispose !== "function") {
		return;
	}
	try {
		picture.dispose();
	} catch {}
};

export const SkiaViewApi = {
	views: {},
	deferedPictures: {},
	deferedOnSize: {},
	web: true,
	registerView(nativeId: string, view: SkiaPictureViewHandle) {
		// Maybe a picture for this view was already set
		const deferredPicture = this.deferedPictures[nativeId];
		if (deferredPicture) {
			view.setPicture(deferredPicture);
			delete this.deferedPictures[nativeId];
		}
		this.views[nativeId] = view;
	},
	unregisterView(nativeId: string) {
		delete this.views[nativeId];
		const deferredPicture = this.deferedPictures[nativeId];
		if (!deferredPicture) {
			return;
		}
		delete this.deferedPictures[nativeId];
		disposePictureIfPossible(deferredPicture);
	},
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	setJsiProperty(nativeId: number, name: string, value: any) {
		if (name === "picture") {
			const id = `${nativeId}`;
			const view = this.views[id];
			if (!view) {
				const previousDeferredPicture = this.deferedPictures[id];
				if (previousDeferredPicture && previousDeferredPicture !== value) {
					disposePictureIfPossible(previousDeferredPicture);
				}
				this.deferedPictures[id] = value;
			} else {
				view.setPicture(value);
			}
		}
	},
	size(nativeId: number) {
		if (this.views[`${nativeId}`]) {
			return this.views[`${nativeId}`].getSize();
		} else {
			return { width: 0, height: 0 };
		}
	},
	requestRedraw(nativeId: number) {
		this.views[`${nativeId}`].redraw();
	},
	makeImageSnapshot(nativeId: number, rect?: SkRect) {
		return this.views[`${nativeId}`].makeImageSnapshot(rect);
	},
	makeImageSnapshotAsync(nativeId: number, rect?: SkRect) {
		return new Promise((resolve, reject) => {
			const result = this.views[`${nativeId}`].makeImageSnapshot(rect);
			if (result) {
				resolve(result);
			} else {
				reject(new Error("Failed to make image snapshot"));
			}
		});
	},
} as ISkiaViewApiWeb;
