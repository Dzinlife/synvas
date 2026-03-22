import type { TimelineElement } from "core/element/types";
import type { SceneNode } from "core/studio/types";
import { createElement, type ComponentType, type ReactNode } from "react";
import { Skia } from "react-skia-lite";
import { buildSkiaFrameSnapshot } from "@/scene-editor/preview/buildSkiaTree";
import { EditorRuntimeProvider } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type {
	EditorRuntime,
	StudioRuntimeManager,
} from "@/scene-editor/runtime/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import type {
	CanvasNodeThumbnailCapability,
	CanvasNodeThumbnailCapabilityContext,
} from "../types";
import {
	encodeCanvasThumbnailBlob,
	NODE_THUMBNAIL_FRAME,
	resolveThumbnailSize,
} from "../thumbnail/utils";

type RuntimeProviderComponent = ComponentType<{
	runtime: EditorRuntime;
	children?: ReactNode;
}>;
type ResolveCompositionTimeline = NonNullable<
	NonNullable<Parameters<typeof buildSkiaFrameSnapshot>[1]>["resolveCompositionTimeline"]
>;
type ResolvedCompositionTimeline = NonNullable<
	Awaited<ReturnType<ResolveCompositionTimeline>>
>;

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

const createScopedRuntime = (
	runtime: Pick<EditorRuntime, "id" | "timelineStore" | "modelRegistry">,
): EditorRuntime => ({
	id: runtime.id,
	timelineStore: runtime.timelineStore,
	modelRegistry: runtime.modelRegistry,
});

const renderScenePictureToCanvas = (params: {
	picture: NonNullable<Awaited<ReturnType<typeof buildSkiaFrameSnapshot>>["picture"]>;
	sourceCanvasSize: {
		width: number;
		height: number;
	};
	targetSize: {
		width: number;
		height: number;
	};
}): HTMLCanvasElement | null => {
	const { picture, sourceCanvasSize, targetSize } = params;
	if (targetSize.width <= 0 || targetSize.height <= 0) return null;
	const surface =
		Skia.Surface.MakeOffscreen(targetSize.width, targetSize.height) ??
		Skia.Surface.Make(targetSize.width, targetSize.height);
	if (!surface) return null;
	try {
		const skCanvas = surface.getCanvas();
		skCanvas.save();
		try {
			skCanvas.clear(Float32Array.of(0, 0, 0, 0));
			const safeSourceWidth = Math.max(1, sourceCanvasSize.width);
			const safeSourceHeight = Math.max(1, sourceCanvasSize.height);
			const scale = Math.min(
				targetSize.width / safeSourceWidth,
				targetSize.height / safeSourceHeight,
			);
			const scaledWidth = safeSourceWidth * scale;
			const scaledHeight = safeSourceHeight * scale;
			const offsetX = (targetSize.width - scaledWidth) * 0.5;
			const offsetY = (targetSize.height - scaledHeight) * 0.5;
			skCanvas.translate(offsetX, offsetY);
			skCanvas.scale(scale, scale);
			skCanvas.drawPicture(picture);
			surface.flush();
			const snapshotRect = Skia.XYWHRect(
				0,
				0,
				targetSize.width,
				targetSize.height,
			);
			const snapshotImage = surface.makeImageSnapshot(snapshotRect);
			const image = snapshotImage.makeNonTextureImage();
			try {
				const info = image.getImageInfo();
				const pixels = image.readPixels(0, 0, info);
				if (!pixels) return null;
				const canvas = document.createElement("canvas");
				canvas.width = targetSize.width;
				canvas.height = targetSize.height;
				const ctx = canvas.getContext("2d");
				if (!ctx) return null;
				ctx.putImageData(
					new ImageData(
						new Uint8ClampedArray(pixels),
						targetSize.width,
						targetSize.height,
					),
					0,
					0,
				);
				return canvas;
			} finally {
				image.dispose();
				snapshotImage.dispose();
			}
		} finally {
			skCanvas.restore();
		}
	} finally {
		surface.dispose();
	}
};

const buildSceneSourceSignature = (
	context: CanvasNodeThumbnailCapabilityContext<SceneNode>,
): string | null => {
	const scene = context.scene;
	if (!scene) return null;
	return `${scene.id}:${scene.updatedAt}`;
};

const buildCompositionTimelineResolver = (
	runtimeManager: StudioRuntimeManager,
	RuntimeProvider: RuntimeProviderComponent,
): ResolveCompositionTimeline => {
	return (sceneId: string) => {
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
		} as ResolvedCompositionTimeline;
	};
};

export const sceneNodeThumbnailCapability: CanvasNodeThumbnailCapability<SceneNode> =
	{
		getSourceSignature: buildSceneSourceSignature,
		generate: async (context) => {
			const scene = context.scene;
			const runtimeManager = context.runtimeManager;
			if (!scene || !runtimeManager) return null;
			const sourceSignature = buildSceneSourceSignature(context);
			if (!sourceSignature) return null;

			const runtime = runtimeManager.ensureTimelineRuntime(
				toSceneTimelineRef(scene.id),
			);
			const state = runtime.timelineStore.getState();
			const sourceCanvasSize = {
				width: Math.max(
					1,
					Math.round(
						state.canvasSize?.width ||
							scene.timeline.canvas.width ||
							context.node.width ||
							1,
					),
				),
				height: Math.max(
					1,
					Math.round(
						state.canvasSize?.height ||
							scene.timeline.canvas.height ||
							context.node.height ||
							1,
					),
				),
			};
			const targetSize = resolveThumbnailSize(
				sourceCanvasSize.width,
				sourceCanvasSize.height,
			);
			const RuntimeProvider = EditorRuntimeProvider as RuntimeProviderComponent;
			const frameSnapshot = await buildSkiaFrameSnapshot(
				{
					elements: state.elements,
					displayTime: NODE_THUMBNAIL_FRAME,
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
						getModelStore: (id) => runtime.modelRegistry.get(id),
						compositionPath: [runtime.ref.sceneId],
						frameChannel: "offscreen",
					},
				},
				{
					wrapRenderNode: (node) =>
						createElement(
							RuntimeProvider,
							{
								runtime: createScopedRuntime(runtime),
							},
							node,
						),
					resolveCompositionTimeline: buildCompositionTimelineResolver(
						runtimeManager,
						RuntimeProvider,
					),
				},
			);
			try {
				if (!frameSnapshot.picture) return null;
				const canvas = renderScenePictureToCanvas({
					picture: frameSnapshot.picture,
					sourceCanvasSize,
					targetSize,
				});
				if (!canvas) return null;
				const blob = await encodeCanvasThumbnailBlob(canvas);
				if (!blob) return null;
				return {
					blob,
					sourceSignature,
					frame: NODE_THUMBNAIL_FRAME,
					sourceSize: sourceCanvasSize,
				};
			} finally {
				frameSnapshot.dispose();
			}
		},
	};
