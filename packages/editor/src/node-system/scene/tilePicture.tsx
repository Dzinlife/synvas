import type { SceneNode } from "@/studio/project/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import type { CanvasNodeTilePictureCapability } from "../types";
import { buildSceneNodeFrameSnapshot } from "./frameSnapshot";
import { getSceneNodeLastLiveFrame } from "./lastLiveFrame";

export const sceneNodeTilePictureCapability: CanvasNodeTilePictureCapability<SceneNode> =
	{
		preferOverThumbnail: ({ node, scene }) => {
			return Boolean(getSceneNodeLastLiveFrame(node, scene));
		},
		getSourceSignature: ({ node, scene }) => {
			return getSceneNodeLastLiveFrame(node, scene)?.sourceSignature ?? null;
		},
		generate: async ({ node, scene, runtimeManager }) => {
			const lastLiveFrame = getSceneNodeLastLiveFrame(node, scene);
			if (!lastLiveFrame) return null;
			const runtime = runtimeManager.getTimelineRuntime(
				toSceneTimelineRef(node.sceneId),
			);
			if (!runtime) return null;
			const state = runtime.timelineStore.getState();
			const frameSnapshot = await buildSceneNodeFrameSnapshot({
				node,
				runtime,
				runtimeManager,
				elements: state.elements,
				tracks: state.tracks,
				displayTime: lastLiveFrame.displayTime,
				frameIndex: lastLiveFrame.frameIndex,
				fps: lastLiveFrame.fps,
				canvasSize: {
					width: lastLiveFrame.sourceWidth,
					height: lastLiveFrame.sourceHeight,
				},
				frameChannel: "offscreen",
			});
			return {
				picture: frameSnapshot.picture,
				sourceWidth: frameSnapshot.sourceWidth,
				sourceHeight: frameSnapshot.sourceHeight,
				dispose: frameSnapshot.dispose,
				disposeIncludesPicture: true,
			};
		},
	};
