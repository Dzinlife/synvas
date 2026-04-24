import { resolveTimelineEndFrame } from "core/timeline-system/utils/timelineEndFrame";
import type { TimelineElement } from "core/timeline-system/types";
import type { SceneNode } from "@/studio/project/types";
import { createTransformMeta } from "@/element-system/transform";
import { buildTimelineMeta } from "@/scene-editor/utils/timelineTime";
import { wouldCreateSceneCompositionCycle } from "@/studio/scene/sceneComposition";
import { secondsToFrames } from "@/utils/timecode";
import { resolveSceneTimelineInsertionSize } from "../timelineInsertionSize";
import type { CanvasNodeToTimelineElementContext } from "../types";

export const convertSceneNodeToTimelineElement = ({
	node,
	project,
	targetSceneId,
	scene,
	fps,
	startFrame,
	trackIndex,
	createElementId,
}: CanvasNodeToTimelineElementContext<SceneNode>): TimelineElement | null => {
	const sourceScene = scene ?? project.scenes[node.sceneId] ?? null;
	if (!sourceScene) return null;
	if (
		targetSceneId &&
		wouldCreateSceneCompositionCycle(project, targetSceneId, sourceScene.id)
	) {
		return null;
	}
	const sourceDuration = resolveTimelineEndFrame(sourceScene.timeline.elements);
	const sourceFps = Math.max(1, Math.round(sourceScene.timeline.fps ?? fps));
	const durationBySource = Math.max(
		1,
		Math.round((sourceDuration / sourceFps) * fps),
	);
	const fallbackDuration = Math.max(1, secondsToFrames(5, fps));
	const duration = sourceDuration > 0 ? durationBySource : fallbackDuration;
	const targetScene = targetSceneId ? project.scenes[targetSceneId] : null;
	const { width, height } = resolveSceneTimelineInsertionSize({
		sourceSize: sourceScene.timeline.canvas,
		fallbackSize: node,
		targetSize: targetScene?.timeline.canvas,
	});
	return {
		id: createElementId(),
		type: "Composition",
		component: "composition",
		name: sourceScene.name?.trim() || node.name || "Composition",
		props: {
			sceneId: sourceScene.id,
		},
		transform: createTransformMeta({
			width,
			height,
			positionX: 0,
			positionY: 0,
		}),
		timeline: buildTimelineMeta(
			{
				start: startFrame,
				end: startFrame + duration,
				trackIndex: trackIndex >= 0 ? trackIndex : 0,
				role: "clip",
			},
			fps,
		),
		render: {
			zIndex: 0,
			visible: true,
			opacity: 1,
		},
	};
};
