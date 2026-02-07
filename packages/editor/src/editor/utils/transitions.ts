import {
	collectLinkedTransitions as collectLinkedTransitionsCore,
	getTransitionBoundary,
	getTransitionDuration,
	getTransitionDurationParts,
	getTransitionRange,
	isTransitionElement,
	reconcileTransitions as reconcileTransitionsCore,
	TRANSITION_TYPE,
} from "core/editor/utils/transitions";
import type { TimelineElement } from "@/dsl/types";
import { resolveTimelineElementRole } from "./resolveRole";

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
	collectLinkedTransitionsCore(elements, selectedIds, {
		resolveRole: resolveTimelineElementRole,
	});

export const reconcileTransitions = (
	elements: TimelineElement[],
	fps?: number,
): TimelineElement[] =>
	reconcileTransitionsCore(elements, fps, {
		resolveRole: resolveTimelineElementRole,
	});
