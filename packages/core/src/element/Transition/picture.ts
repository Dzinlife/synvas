import { type ReactNode } from "react";
import {
	getSkiaRenderBackend,
	NodeType,
	Skia,
	SkiaSGRoot,
	type SkPicture,
} from "react-skia-lite";

type SceneGraphNodeLike = {
	type?: string;
	children?: SceneGraphNodeLike[];
};

const hasBackdropFilterNode = (nodes: SceneGraphNodeLike[]): boolean => {
	return nodes.some((node) => {
		if (node.type === NodeType.BackdropFilter) {
			return true;
		}
		return hasBackdropFilterNode(node.children ?? []);
	});
};

export const renderNodeToPicture = (
	node: ReactNode,
	size: { width: number; height: number },
): SkPicture | null => {
	if (size.width <= 0 || size.height <= 0) return null;
	const recorder = Skia.PictureRecorder();
	const canvas = recorder.beginRecording({
		x: 0,
		y: 0,
		width: size.width,
		height: size.height,
	});
	const root = new SkiaSGRoot(Skia);
	root.render(node);
	try {
		const renderBackend = getSkiaRenderBackend();
		const shouldIsolateBackdrop = hasBackdropFilterNode(
			(root.sg as { children?: SceneGraphNodeLike[] }).children ?? [],
		);
		if (!shouldIsolateBackdrop || renderBackend.kind !== "webgpu") {
			root.drawOnCanvas(canvas);
			return recorder.finishRecordingAsPicture();
		}

		// BackdropFilter 会读取当前画布内容；先在独立 raster surface 上重放一遍，
		// 再把结果录回 picture，避免外层 overlay 污染 scene。
		const surface = Skia.Surface.Make(size.width, size.height);
		if (!surface) {
			root.drawOnCanvas(canvas);
			return recorder.finishRecordingAsPicture();
		}
		try {
			const surfaceCanvas = surface.getCanvas();
			surfaceCanvas.clear(Skia.Color("transparent"));
			root.drawOnCanvas(surfaceCanvas);
			surface.flush();
			const image = surface.makeImageSnapshot();
			try {
				canvas.drawImage(image, 0, 0);
			} finally {
				image.dispose?.();
			}
		} finally {
			surface.dispose?.();
		}
	} finally {
		root.unmount();
	}
	return recorder.finishRecordingAsPicture();
};
