import { useCallback } from "react";
import { resolveTimelineEndFrame } from "core/timeline-system/utils/timelineEndFrame";
import type { TimelineElement } from "core/timeline-system/types";
import { createTransformMeta } from "@/element-system/transform";
import { useProjectStore } from "@/projects/projectStore";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import { findAttachments } from "@/scene-editor/utils/attachments";
import { finalizeTimelineElements } from "@/scene-editor/utils/mainTrackMagnet";
import { buildTimelineMeta } from "@/scene-editor/utils/timelineTime";
import { resolveSceneTimelineInsertionSize } from "@/node-system/timelineInsertionSize";
import { wouldCreateSceneCompositionCycle } from "@/studio/scene/sceneComposition";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import type { CanvasNode } from "@/studio/project/types";
import { secondsToFrames } from "@/utils/timecode";

interface UseCanvasSceneTimelineInsertionInput {
	runtimeManager: StudioRuntimeManager | null;
	updateSceneTimeline: ReturnType<
		typeof useProjectStore.getState
	>["updateSceneTimeline"];
}

export const useCanvasSceneTimelineInsertion = ({
	runtimeManager,
	updateSceneTimeline,
}: UseCanvasSceneTimelineInsertionInput) => {
	return useCallback(
		(node: CanvasNode, sceneId: string) => {
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const targetScene = latestProject.scenes[sceneId];
			if (!targetScene) return;

			const appendImageElement = (
				elements: TimelineElement[],
				fps: number,
				rippleEditingEnabled: boolean,
				autoAttach: boolean,
				targetCanvasSize: { width: number; height: number },
			): TimelineElement[] => {
				if (node.type !== "image" || !node.assetId) return elements;
				const start = resolveTimelineEndFrame(elements);
				const duration = Math.max(1, secondsToFrames(5, fps));
				const sourceAsset =
					latestProject.assets.find((asset) => asset.id === node.assetId) ??
					null;
				const { width, height } = resolveSceneTimelineInsertionSize({
					sourceSize: sourceAsset?.meta?.sourceSize,
					fallbackSize: node,
					targetSize: targetCanvasSize,
				});
				const nextElement: TimelineElement = {
					id: `element-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					type: "Image",
					component: "image",
					name: node.name,
					assetId: node.assetId,
					props: {},
					transform: createTransformMeta({
						width,
						height,
						positionX: 0,
						positionY: 0,
					}),
					timeline: buildTimelineMeta(
						{
							start,
							end: start + duration,
							trackIndex: 0,
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
				return finalizeTimelineElements([...elements, nextElement], {
					rippleEditingEnabled,
					attachments: autoAttach ? findAttachments(elements) : undefined,
					autoAttach,
					fps,
				});
			};

			const appendCompositionElement = (
				elements: TimelineElement[],
				fps: number,
				rippleEditingEnabled: boolean,
				autoAttach: boolean,
				targetCanvasSize: { width: number; height: number },
			): TimelineElement[] => {
				if (node.type !== "scene") return elements;
				const sourceScene = latestProject.scenes[node.sceneId];
				if (!sourceScene) return elements;
				if (
					wouldCreateSceneCompositionCycle(
						latestProject,
						sceneId,
						sourceScene.id,
					)
				) {
					return elements;
				}
				const sourceRuntime = runtimeManager?.getTimelineRuntime(
					toSceneTimelineRef(sourceScene.id),
				);
				const sourceTimelineState = sourceRuntime?.timelineStore.getState();
				const sourceElements =
					sourceTimelineState?.elements ?? sourceScene.timeline.elements;
				const sourceFps = Math.max(
					1,
					Math.round(
						sourceTimelineState?.fps ?? sourceScene.timeline.fps ?? fps,
					),
				);
				const sourceCanvasSize =
					sourceTimelineState?.canvasSize ?? sourceScene.timeline.canvas;
				const sourceDuration = resolveTimelineEndFrame(sourceElements);
				const durationBySource = Math.max(
					1,
					Math.round((sourceDuration / sourceFps) * fps),
				);
				const fallbackDuration = Math.max(1, secondsToFrames(5, fps));
				const duration =
					sourceDuration > 0 ? durationBySource : fallbackDuration;
				const start = resolveTimelineEndFrame(elements);
				const { width, height } = resolveSceneTimelineInsertionSize({
					sourceSize: sourceCanvasSize,
					fallbackSize: node,
					targetSize: targetCanvasSize,
				});
				const nextElement: TimelineElement = {
					id: `element-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
							start,
							end: start + duration,
							trackIndex: 0,
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
				return finalizeTimelineElements([...elements, nextElement], {
					rippleEditingEnabled,
					attachments: autoAttach ? findAttachments(elements) : undefined,
					autoAttach,
					fps,
				});
			};

			const appendElement = (
				elements: TimelineElement[],
				fps: number,
				rippleEditingEnabled: boolean,
				autoAttach: boolean,
				targetCanvasSize: { width: number; height: number },
			): TimelineElement[] => {
				if (node.type === "image") {
					return appendImageElement(
						elements,
						fps,
						rippleEditingEnabled,
						autoAttach,
						targetCanvasSize,
					);
				}
				if (node.type === "scene") {
					return appendCompositionElement(
						elements,
						fps,
						rippleEditingEnabled,
						autoAttach,
						targetCanvasSize,
					);
				}
				return elements;
			};

			if (runtimeManager) {
				const timelineRuntime = runtimeManager.getTimelineRuntime(
					toSceneTimelineRef(sceneId),
				);
				if (timelineRuntime) {
					const timelineState = timelineRuntime.timelineStore.getState();
					timelineState.setElements((prev) => {
						return appendElement(
							prev,
							timelineState.fps,
							timelineState.rippleEditingEnabled,
							timelineState.autoAttach,
							timelineState.canvasSize,
						);
					});
					return;
				}
			}

			const nextElements = appendElement(
				targetScene.timeline.elements,
				targetScene.timeline.fps,
				targetScene.timeline.settings.rippleEditingEnabled,
				targetScene.timeline.settings.autoAttach,
				targetScene.timeline.canvas,
			);
			if (nextElements === targetScene.timeline.elements) return;
			updateSceneTimeline(sceneId, {
				...targetScene.timeline,
				elements: nextElements,
			});
		},
		[runtimeManager, updateSceneTimeline],
	);
};
