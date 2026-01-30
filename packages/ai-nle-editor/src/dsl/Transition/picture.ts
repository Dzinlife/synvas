import type { ReactNode } from "react";
import { Skia, SkiaSGRoot, type SkPicture } from "react-skia-lite";

export const renderNodeToPicture = async (
	node: ReactNode,
	size: { width: number; height: number },
): Promise<SkPicture | null> => {
	if (size.width <= 0 || size.height <= 0) return null;
	const recorder = Skia.PictureRecorder();
	const canvas = recorder.beginRecording({
		x: 0,
		y: 0,
		width: size.width,
		height: size.height,
	});
	const root = new SkiaSGRoot(Skia);
	await root.render(node);
	root.drawOnCanvas(canvas);
	root.unmount();
	return recorder.finishRecordingAsPicture();
};
