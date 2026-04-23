import type { SceneNode } from "@/studio/project/types";
import { getCompositionThumbnail } from "@/element-system/Composition/thumbnailCache";
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

const buildSceneSourceSignature = (
	context: CanvasNodeThumbnailCapabilityContext<SceneNode>,
): string | null => {
	const scene = context.scene;
	if (!scene) return null;
	return `${scene.id}:${scene.updatedAt}`;
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
			const canvas = await getCompositionThumbnail({
				sceneRuntime: runtime,
				runtimeManager,
				sceneRevision: scene.updatedAt,
				displayFrame: NODE_THUMBNAIL_FRAME,
				width: targetSize.width,
				height: targetSize.height,
				pixelRatio: 1,
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
		},
	};
