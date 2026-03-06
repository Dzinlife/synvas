import { type ReactNode, createElement, type ComponentType } from "react";
import { Skia } from "react-skia-lite";
import {
	buildSkiaFrameSnapshot,
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
const thumbnailCache = new Map<string, HTMLCanvasElement>();
const thumbnailAccessOrder: string[] = [];
const thumbnailInflight = new Map<string, Promise<HTMLCanvasElement | null>>();
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

const renderPictureToCanvas = (params: {
	picture: NonNullable<Awaited<ReturnType<typeof buildSkiaFrameSnapshot>>["picture"]>;
	width: number;
	height: number;
}): HTMLCanvasElement | null => {
	const { picture, width, height } = params;
	if (width <= 0 || height <= 0) return null;
	// 缩略图缓存必须避免额外申请 WebGL context，否则 scene 节点较多时会触发上限。
	const surface = Skia.Surface.Make(width, height);
	if (!surface) return null;
	try {
		const skCanvas = surface.getCanvas();
		skCanvas.clear(Float32Array.of(0, 0, 0, 0));
		skCanvas.drawPicture(picture);
		surface.flush();
		const image = surface.makeImageSnapshot();
		try {
			const info = image.getImageInfo();
			const pixels = image.readPixels(0, 0, info);
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
			image.dispose();
		}
	} finally {
		surface.dispose();
	}
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
	const cacheKey = [
		sceneRuntime.ref.sceneId,
		sceneRevision,
		displayFrameKey,
		targetWidth,
		targetHeight,
	].join("|");

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
		const RuntimeProvider = EditorRuntimeProvider as RuntimeProviderComponent;
		const frameSnapshot = await buildSkiaFrameSnapshot(
			{
				elements: state.elements,
				displayTime: displayFrameKey,
				tracks: state.tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: Math.max(1, Math.round(state.fps || 30)),
					canvasSize: {
						width: targetWidth,
						height: targetHeight,
					},
					prepareTransitionPictures: false,
					forcePrepareFrames: false,
					awaitReady: false,
					getModelStore: (id) => sceneRuntime.modelRegistry.get(id),
					compositionPath: [sceneRuntime.ref.sceneId],
					frameChannel: "offscreen",
				},
			},
			{
				wrapRenderNode: (node) =>
					createElement(
						RuntimeProvider,
						{
							runtime: createScopedRuntime(sceneRuntime),
						},
						node,
					),
				resolveCompositionTimeline: (sceneId) => {
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
						wrapRenderNode: (childNode) =>
							createElement(
								RuntimeProvider,
								{
									runtime: createScopedRuntime(childRuntime),
								},
								childNode,
							),
					};
				},
			},
		);
		try {
			if (!frameSnapshot.picture) return null;
			const canvas = renderPictureToCanvas({
				picture: frameSnapshot.picture,
				width: targetWidth,
				height: targetHeight,
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
