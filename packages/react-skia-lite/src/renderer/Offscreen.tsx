import type { ReactElement } from "react";
import { Skia } from "../skia";
import type { SkPicture, SkRect, SkSize } from "../skia/types";
import { attachDisposeCleanup } from "../skia/web/Host";
import { SkiaSGRoot } from "../sksg/Reconciler";

export const drawAsPicture = async (element: ReactElement, bounds?: SkRect) => {
	const recorder = Skia.PictureRecorder();
	const canvas = recorder.beginRecording(bounds);
	const root = new SkiaSGRoot(Skia);
	await root.render(element);
	const retainedResources = root.drawOnCanvas(canvas, {
		retainResources: true,
	});
	const picture = recorder.finishRecordingAsPicture();
	if (retainedResources.length > 0) {
		attachDisposeCleanup(picture, () => {
			for (const cleanup of retainedResources) {
				cleanup();
			}
		});
	}
	root.unmount();
	return picture;
};

export const drawAsImage = async (element: ReactElement, size: SkSize) => {
	return drawAsImageFromPicture(await drawAsPicture(element), size);
};

export const drawAsImageFromPicture = (picture: SkPicture, size: SkSize) => {
	"worklet";
	const surface = Skia.Surface.MakeOffscreen(size.width, size.height)!;
	const canvas = surface.getCanvas();
	canvas.drawPicture(picture);
	surface.flush();
	const image = surface.makeImageSnapshot();
	return image.makeNonTextureImage();
};
