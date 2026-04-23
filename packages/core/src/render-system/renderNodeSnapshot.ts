import { type ReactNode } from "react";
import {
	getSkiaRenderBackend,
	NodeType,
	type SkImage,
	Skia,
	SkiaSGRoot,
	type SkPicture,
} from "react-skia-lite";

type SceneGraphNodeLike = {
	type?: string;
	children?: SceneGraphNodeLike[];
};

type DisposableLike = {
	dispose?: (() => void) | undefined;
};

const attachCleanupToDisposable = <T extends DisposableLike>(
	target: T,
	cleanup: () => void,
): T => {
	let disposed = false;
	const originalDispose =
		typeof target.dispose === "function" ? target.dispose.bind(target) : null;
	target.dispose = () => {
		if (disposed) return;
		disposed = true;
		try {
			originalDispose?.();
		} finally {
			cleanup();
		}
	};
	return target;
};

const hasBackdropFilterNode = (nodes: SceneGraphNodeLike[]): boolean => {
	return nodes.some((node) => {
		if (node.type === NodeType.BackdropFilter) {
			return true;
		}
		return hasBackdropFilterNode(node.children ?? []);
	});
};

const hasRenderTargetNode = (nodes: SceneGraphNodeLike[]): boolean => {
	return nodes.some((node) => {
		if (node.type === NodeType.RenderTarget) {
			return true;
		}
		return hasRenderTargetNode(node.children ?? []);
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
	let retainedResources: Array<() => void> = [];
	let isolatedSurface: DisposableLike | null = null;
	let isolatedSurfaceRetained = false;
	let isolatedSnapshotImage: DisposableLike | null = null;
	root.render(node);
	try {
		const renderBackend = getSkiaRenderBackend();
		const sceneChildren =
			(root.sg as { children?: SceneGraphNodeLike[] }).children ?? [];
		const shouldIsolateBackdrop = hasBackdropFilterNode(sceneChildren);
		const hasRenderTarget = hasRenderTargetNode(sceneChildren);
		if (
			!shouldIsolateBackdrop ||
			renderBackend.kind !== "webgpu" ||
			hasRenderTarget
		) {
			retainedResources = root.drawOnCanvas(canvas, {
				retainResources: true,
			});
		} else {
			// BackdropFilter 会读取当前画布内容；先在独立 raster surface 上重放一遍，
			// 再把结果录回 picture，避免外层 overlay 污染 scene。
			const surface = Skia.Surface.Make(size.width, size.height);
			if (!surface) {
				retainedResources = root.drawOnCanvas(canvas, {
					retainResources: true,
				});
			} else {
				isolatedSurface = surface;
				try {
					const surfaceCanvas = surface.getCanvas();
					surfaceCanvas.clear(Skia.Color("transparent"));
					retainedResources = root.drawOnCanvas(surfaceCanvas, {
						retainResources: true,
					});
					surface.flush();
					const copiedImage = surface.asImageCopy?.() ?? null;
					const image = copiedImage ?? surface.makeImageSnapshot();
					isolatedSnapshotImage = image;
					isolatedSurfaceRetained = copiedImage === null;
					canvas.drawImage(image, 0, 0);
					if (!isolatedSurfaceRetained) {
						isolatedSurface?.dispose?.();
						isolatedSurface = null;
					}
				} catch (error) {
					for (const cleanup of retainedResources) {
						cleanup();
					}
					retainedResources = [];
					isolatedSnapshotImage?.dispose?.();
					isolatedSnapshotImage = null;
					isolatedSurface?.dispose?.();
					isolatedSurface = null;
					throw error;
				}
			}
		}
		const picture = recorder.finishRecordingAsPicture();
		return attachCleanupToDisposable(picture, () => {
			for (const cleanup of retainedResources) {
				cleanup();
			}
			retainedResources = [];
			isolatedSnapshotImage?.dispose?.();
			isolatedSnapshotImage = null;
			if (isolatedSurfaceRetained) {
				isolatedSurface?.dispose?.();
				isolatedSurface = null;
			}
		});
	} finally {
		root.unmount();
		(canvas as { dispose?: () => void }).dispose?.();
		recorder.dispose?.();
	}
};

export const renderNodeToImage = (
	node: ReactNode,
	size: { width: number; height: number },
): SkImage | null => {
	if (size.width <= 0 || size.height <= 0) return null;
	const surface =
		Skia.Surface.MakeOffscreen(size.width, size.height) ??
		Skia.Surface.Make(size.width, size.height);
	if (!surface) return null;
	const root = new SkiaSGRoot(Skia);
	let retainedResources: Array<() => void> = [];
	try {
		root.render(node);
		const canvas = surface.getCanvas();
		canvas.clear(Skia.Color("transparent"));
		retainedResources = root.drawOnCanvas(canvas, {
			retainResources: true,
		});
		surface.flush();
		const image = surface.asImage?.() ?? surface.makeImageSnapshot();
		if (!image) {
			for (const cleanup of retainedResources) {
				cleanup();
			}
			retainedResources = [];
			surface.dispose?.();
			return null;
		}
		return attachCleanupToDisposable(image, () => {
			for (const cleanup of retainedResources) {
				cleanup();
			}
			retainedResources = [];
			surface.dispose?.();
		});
	} catch (error) {
		for (const cleanup of retainedResources) {
			cleanup();
		}
		surface.dispose?.();
		throw error;
	} finally {
		root.unmount();
	}
};
