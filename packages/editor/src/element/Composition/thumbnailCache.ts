import { type ReactNode, createElement, type ComponentType } from "react";
import {
	AlphaType,
	ColorType,
	getSkiaRenderBackend,
	Skia,
	SkiaSGRoot,
} from "react-skia-lite";
import {
	buildSkiaFrameSnapshot,
	buildSkiaRenderState,
} from "@/scene-editor/preview/buildSkiaTree";
import { EditorRuntimeProvider } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type {
	EditorRuntime,
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import type { TimelineElement } from "core/element/types";

const THUMBNAIL_CACHE_LIMIT = 240;
const THUMBNAIL_CACHE_VERSION = 2;
const SHARED_RASTER_SURFACE_MIN_SIZE = 512;
const thumbnailCache = new Map<string, HTMLCanvasElement>();
const thumbnailAccessOrder: string[] = [];
const thumbnailInflight = new Map<string, Promise<HTMLCanvasElement | null>>();
let sharedRasterSurface:
	| {
			surface: NonNullable<ReturnType<typeof Skia.Surface.Make>>;
			width: number;
			height: number;
	  }
	| null = null;
let rasterQueue: Promise<void> = Promise.resolve();
const yieldToMainThread = () =>
	new Promise<void>((resolve) => {
		window.setTimeout(resolve, 0);
	});

type RuntimeProviderComponent = ComponentType<{
	runtime: EditorRuntime;
	children?: ReactNode;
}>;

const getTrackIndexForElement = (element: TimelineElement) =>
	element.timeline.trackIndex ?? 0;

const sortByTrackIndex = (items: TimelineElement[]) => {
	return items
		.map((element, index) => ({
			element,
			index,
			trackIndex: getTrackIndexForElement(element),
		}))
		.sort((left, right) => {
			if (left.trackIndex !== right.trackIndex) {
				return left.trackIndex - right.trackIndex;
			}
			return left.index - right.index;
		})
		.map(({ element }) => element);
};

const touchThumbnailKey = (key: string) => {
	const index = thumbnailAccessOrder.indexOf(key);
	if (index >= 0) {
		thumbnailAccessOrder.splice(index, 1);
	}
	thumbnailAccessOrder.push(key);
};

const evictThumbnailsIfNeeded = () => {
	while (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
		const oldestKey = thumbnailAccessOrder.shift();
		if (!oldestKey) break;
		thumbnailCache.delete(oldestKey);
	}
};

const createScopedRuntime = (
	runtime: Pick<EditorRuntime, "id" | "timelineStore" | "modelRegistry">,
): EditorRuntime => ({
	id: runtime.id,
	timelineStore: runtime.timelineStore,
	modelRegistry: runtime.modelRegistry,
});

const resolveThumbnailCacheKey = (params: {
	sceneRuntime: TimelineRuntime;
	sceneRevision: number;
	displayFrame: number;
	width: number;
	height: number;
	pixelRatio: number;
}) => {
	const targetWidth = Math.max(1, Math.round(params.width * params.pixelRatio));
	const targetHeight = Math.max(1, Math.round(params.height * params.pixelRatio));
	const displayFrameKey = Math.max(0, Math.round(params.displayFrame));
	return [
		THUMBNAIL_CACHE_VERSION,
		params.sceneRuntime.ref.sceneId,
		params.sceneRevision,
		displayFrameKey,
		targetWidth,
		targetHeight,
	].join("|");
};

const getSharedRasterSurface = (params: { width: number; height: number }) => {
	const requiredWidth = Math.max(
		SHARED_RASTER_SURFACE_MIN_SIZE,
		Math.ceil(params.width),
	);
	const requiredHeight = Math.max(
		SHARED_RASTER_SURFACE_MIN_SIZE,
		Math.ceil(params.height),
	);
	if (
		sharedRasterSurface &&
		sharedRasterSurface.width >= requiredWidth &&
		sharedRasterSurface.height >= requiredHeight
	) {
		return sharedRasterSurface.surface;
	}
	sharedRasterSurface?.surface.dispose();
	sharedRasterSurface = null;
	const surface =
		Skia.Surface.MakeOffscreen(requiredWidth, requiredHeight) ??
		Skia.Surface.Make(requiredWidth, requiredHeight);
	if (!surface) return null;
	sharedRasterSurface = {
		surface,
		width: requiredWidth,
		height: requiredHeight,
	};
	return surface;
};

const enqueueRasterTask = <T,>(task: () => Promise<T>): Promise<T> => {
	const next = rasterQueue.then(task, task);
	rasterQueue = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
};

const renderPictureToCanvas = async (params: {
	picture: NonNullable<Awaited<ReturnType<typeof buildSkiaFrameSnapshot>>["picture"]>;
	width: number;
	height: number;
	sourceCanvasSize: {
		width: number;
		height: number;
	};
}): Promise<HTMLCanvasElement | null> => {
	return enqueueRasterTask(async () => {
		const { picture, width, height, sourceCanvasSize } = params;
		if (width <= 0 || height <= 0) return null;
		// 复用单个 GPU surface，避免每张缩略图都新建 WebGL context，
		// 同时让 VideoClip 的纹理帧走 GPU 栅格化路径，避免软件 surface 读出黑帧。
		const surface = getSharedRasterSurface({ width, height });
		if (!surface) return null;
		const skCanvas = surface.getCanvas();
		skCanvas.save();
		try {
			skCanvas.clear(Float32Array.of(0, 0, 0, 0));
			const safeSourceWidth = Math.max(1, sourceCanvasSize.width || width);
			const safeSourceHeight = Math.max(1, sourceCanvasSize.height || height);
			const scale = Math.min(width / safeSourceWidth, height / safeSourceHeight);
			const scaledWidth = safeSourceWidth * scale;
			const scaledHeight = safeSourceHeight * scale;
			const offsetX = (width - scaledWidth) * 0.5;
			const offsetY = (height - scaledHeight) * 0.5;
			skCanvas.translate(offsetX, offsetY);
			skCanvas.scale(scale, scale);
			skCanvas.drawPicture(picture);
			surface.flush();
			const pixels = skCanvas.readPixels(0, 0, {
				width,
				height,
				colorType: ColorType.RGBA_8888,
				alphaType: AlphaType.Unpremul,
			});
			if (!pixels) return null;
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d");
			if (!ctx) return null;
			ctx.putImageData(
				new ImageData(new Uint8ClampedArray(pixels), width, height),
				0,
				0,
			);
			return canvas;
		} finally {
			skCanvas.restore();
		}
	});
};

const renderNodeToCanvas = async (params: {
	node: ReactNode;
	width: number;
	height: number;
	sourceCanvasSize: {
		width: number;
		height: number;
	};
}): Promise<HTMLCanvasElement | null> => {
	return enqueueRasterTask(async () => {
		const { node, width, height, sourceCanvasSize } = params;
		if (width <= 0 || height <= 0) return null;
		const surface = getSharedRasterSurface({ width, height });
		if (!surface) return null;
		const skCanvas = surface.getCanvas();
		const root = new SkiaSGRoot(Skia);
		const retainedResources: Array<() => void> = [];
		skCanvas.save();
		try {
			skCanvas.clear(Float32Array.of(0, 0, 0, 0));
			const safeSourceWidth = Math.max(1, sourceCanvasSize.width || width);
			const safeSourceHeight = Math.max(1, sourceCanvasSize.height || height);
			const scale = Math.min(width / safeSourceWidth, height / safeSourceHeight);
			const scaledWidth = safeSourceWidth * scale;
			const scaledHeight = safeSourceHeight * scale;
			const offsetX = (width - scaledWidth) * 0.5;
			const offsetY = (height - scaledHeight) * 0.5;
			skCanvas.translate(offsetX, offsetY);
			skCanvas.scale(scale, scale);
			root.render(node);
			retainedResources.push(
				...root.drawOnCanvas(skCanvas, {
					retainResources: true,
				}),
			);
			surface.flush();
			const pixels = skCanvas.readPixels(0, 0, {
				width,
				height,
				colorType: ColorType.RGBA_8888,
				alphaType: AlphaType.Unpremul,
			});
			if (!pixels) return null;
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d");
			if (!ctx) return null;
			ctx.putImageData(
				new ImageData(new Uint8ClampedArray(pixels), width, height),
				0,
				0,
			);
			return canvas;
		} finally {
			for (const cleanup of retainedResources) {
				try {
					cleanup();
				} catch {}
			}
			root.unmount();
			skCanvas.restore();
		}
	});
};

export const getCompositionThumbnail = async (params: {
	sceneRuntime: TimelineRuntime;
	runtimeManager: StudioRuntimeManager;
	sceneRevision: number;
	displayFrame: number;
	width: number;
	height: number;
	pixelRatio: number;
}): Promise<HTMLCanvasElement | null> => {
	const {
		sceneRuntime,
		runtimeManager,
		sceneRevision,
		displayFrame,
		width,
		height,
		pixelRatio,
	} = params;
	if (width <= 0 || height <= 0) return null;

	const targetWidth = Math.max(1, Math.round(width * pixelRatio));
	const targetHeight = Math.max(1, Math.round(height * pixelRatio));
	const displayFrameKey = Math.max(0, Math.round(displayFrame));
	const cacheKey = resolveThumbnailCacheKey({
		sceneRuntime,
		sceneRevision,
		displayFrame,
		width,
		height,
		pixelRatio,
	});

	const cached = thumbnailCache.get(cacheKey);
	if (cached) {
		touchThumbnailKey(cacheKey);
		return cached;
	}

	const inflight = thumbnailInflight.get(cacheKey);
	if (inflight) return inflight;

	const promise = (async () => {
		await yieldToMainThread();
		const state = sceneRuntime.timelineStore.getState();
		const renderBackend = getSkiaRenderBackend();
		const sourceCanvasSize =
			state.canvasSize?.width > 0 && state.canvasSize?.height > 0
				? state.canvasSize
				: {
						width: targetWidth,
						height: targetHeight,
					};
		const RuntimeProvider = EditorRuntimeProvider as RuntimeProviderComponent;
		const sharedArgs = {
			elements: state.elements,
			displayTime: displayFrameKey,
			tracks: state.tracks,
			getTrackIndexForElement,
			sortByTrackIndex,
			prepare: {
				isExporting: false,
				fps: Math.max(1, Math.round(state.fps || 30)),
				canvasSize: sourceCanvasSize,
				prepareTransitionPictures: false,
				forcePrepareFrames: true,
				awaitReady: true,
				getModelStore: (id: string) => sceneRuntime.modelRegistry.get(id),
				compositionPath: [sceneRuntime.ref.sceneId],
				frameChannel: "offscreen" as const,
			},
		};
		const sharedOverrides = {
			wrapRenderNode: (node: ReactNode) =>
				createElement(
					RuntimeProvider,
					{
						runtime: createScopedRuntime(sceneRuntime),
					},
					node,
				),
			resolveCompositionTimeline: (sceneId: string) => {
				const childRuntime = runtimeManager.getTimelineRuntime(
					toSceneTimelineRef(sceneId),
				);
				if (!childRuntime) return null;
				const childState = childRuntime.timelineStore.getState();
				return {
					sceneId,
					elements: childState.elements,
					tracks: childState.tracks,
					fps: childState.fps,
					canvasSize: childState.canvasSize,
					getModelStore: (id: string) => childRuntime.modelRegistry.get(id),
					wrapRenderNode: (childNode: ReactNode) =>
						createElement(
							RuntimeProvider,
							{
								runtime: createScopedRuntime(childRuntime),
							},
							childNode,
						),
				};
			},
		};

		if (renderBackend.kind === "webgpu") {
			const renderState = await buildSkiaRenderState(
				sharedArgs,
				sharedOverrides,
			);
			try {
				await renderState.ready;
				const canvas = await renderNodeToCanvas({
					node: createElement(
						RuntimeProvider,
						{
							runtime: createScopedRuntime(sceneRuntime),
						},
						renderState.children,
					),
					width: targetWidth,
					height: targetHeight,
					sourceCanvasSize,
				});
				if (!canvas) return null;
				thumbnailCache.set(cacheKey, canvas);
				touchThumbnailKey(cacheKey);
				evictThumbnailsIfNeeded();
				return canvas;
			} finally {
				renderState.dispose();
			}
		}

		const frameSnapshot = await buildSkiaFrameSnapshot(sharedArgs, sharedOverrides);
		try {
			if (!frameSnapshot.picture) return null;
			const canvas = await renderPictureToCanvas({
				picture: frameSnapshot.picture,
				width: targetWidth,
				height: targetHeight,
				sourceCanvasSize,
			});
			if (!canvas) return null;
			thumbnailCache.set(cacheKey, canvas);
			touchThumbnailKey(cacheKey);
			evictThumbnailsIfNeeded();
			return canvas;
		} finally {
			frameSnapshot.dispose();
		}
	})();

	thumbnailInflight.set(cacheKey, promise);
	try {
		return await promise;
	} finally {
		thumbnailInflight.delete(cacheKey);
	}
};

export const peekCompositionThumbnail = (params: {
	sceneRuntime: TimelineRuntime;
	sceneRevision: number;
	displayFrame: number;
	width: number;
	height: number;
	pixelRatio: number;
}): HTMLCanvasElement | null => {
	const cacheKey = resolveThumbnailCacheKey(params);
	const cached = thumbnailCache.get(cacheKey);
	if (!cached) return null;
	touchThumbnailKey(cacheKey);
	return cached;
};
