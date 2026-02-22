import type { TimelineElement } from "../dsl/types";
import type { SceneDocument, StudioProject } from "./types";

export const selectActiveSceneId = (project: StudioProject): string | null =>
	project.ui.activeSceneId;

export const selectFocusedSceneId = (project: StudioProject): string | null =>
	project.ui.focusedSceneId;

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
	selectSceneById(project, project.ui.focusedSceneId);

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
