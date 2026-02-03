import type { TimelineElement } from "@/dsl/types";
import type { ResolveRole } from "core/editor/utils/trackAssignment";
import {
	TRANSITION_TYPE,
	collectLinkedTransitions as collectLinkedTransitionsCore,
	getTransitionBoundary,
	getTransitionDuration,
	getTransitionDurationParts,
	getTransitionRange,
	isTransitionElement,
	reconcileTransitions as reconcileTransitionsCore,
} from "core/editor/utils/transitions";
import { getElementRoleFromComponent } from "../timeline/trackConfig";

const resolveRole: ResolveRole = (element: TimelineElement) =>
	getElementRoleFromComponent(element.component, "clip");

export {
	TRANSITION_TYPE,
	isTransitionElement,
	getTransitionDuration,
	getTransitionBoundary,
	getTransitionDurationParts,
	getTransitionRange,
};

export const collectLinkedTransitions = (
	elements: TimelineElement[],
	selectedIds: string[],
): string[] =>
	collectLinkedTransitionsCore(elements, selectedIds, { resolveRole });

export const reconcileTransitions = (
	elements: TimelineElement[],
	fps?: number,
): TimelineElement[] =>
	reconcileTransitionsCore(elements, fps, { resolveRole });
