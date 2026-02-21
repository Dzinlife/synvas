import type { TimelineElement } from "../dsl/types";
import type { MainTimelineDocument, StudioProject, StudioScope } from "./types";

export const selectStudioScope = (project: StudioProject): StudioScope =>
	project.ui.activeScope;

export const selectTimelineForScope = (
	project: StudioProject,
	scope: StudioScope = project.ui.activeScope,
): MainTimelineDocument | null => {
	if (scope.type === "main") {
		return project.timeline;
	}
	const composition = project.compositions[scope.compositionId];
	if (!composition) return null;
	return {
		...project.timeline,
		elements: composition.elements,
	};
};

export const selectElementsForScope = (
	project: StudioProject,
	scope: StudioScope = project.ui.activeScope,
): TimelineElement[] => {
	const timeline = selectTimelineForScope(project, scope);
	return timeline?.elements ?? [];
};
