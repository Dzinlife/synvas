import type { TimelineElement } from "../dsl/types";
import type { CanvasNode, SceneDocument, StudioProject } from "./types";

export const selectActiveSceneId = (project: StudioProject): string | null =>
	project.ui.activeSceneId;

export const selectFocusedNodeId = (project: StudioProject): string | null =>
	project.ui.focusedNodeId;

export const selectFocusedNode = (project: StudioProject): CanvasNode | null => {
	const nodeId = selectFocusedNodeId(project);
	if (!nodeId) return null;
	return project.canvas.nodes.find((node) => node.id === nodeId) ?? null;
};

export const selectFocusedSceneId = (project: StudioProject): string | null => {
	const focusedNode = selectFocusedNode(project);
	if (!focusedNode || focusedNode.type !== "scene") return null;
	return focusedNode.sceneId;
};

export const selectSceneById = (
	project: StudioProject,
	sceneId: string | null | undefined,
): SceneDocument | null => {
	if (!sceneId) return null;
	return project.scenes[sceneId] ?? null;
};

export const selectActiveScene = (project: StudioProject): SceneDocument | null =>
	selectSceneById(project, project.ui.activeSceneId);

export const selectFocusedScene = (project: StudioProject): SceneDocument | null =>
	selectSceneById(project, selectFocusedSceneId(project));

export const selectTimelineForActiveScene = (
	project: StudioProject,
): SceneDocument["timeline"] | null => {
	return selectActiveScene(project)?.timeline ?? null;
};

export const selectElementsForActiveScene = (
	project: StudioProject,
): TimelineElement[] => {
	const timeline = selectTimelineForActiveScene(project);
	return timeline?.elements ?? [];
};
