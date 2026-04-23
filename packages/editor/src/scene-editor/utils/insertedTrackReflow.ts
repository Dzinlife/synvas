import type { TimelineElement } from "core/timeline-system/types";
import {
	findAvailableTrack,
	getElementRole,
	getStoredTrackAssignments,
	getTrackCount,
	resolveDropTargetForRole,
} from "./trackAssignment";

const getTrackIndex = (element: TimelineElement): number => {
	return element.timeline.trackIndex ?? 0;
};

const sortByTimeline = (a: TimelineElement, b: TimelineElement): number => {
	if (a.timeline.start !== b.timeline.start) {
		return a.timeline.start - b.timeline.start;
	}
	if (a.timeline.end !== b.timeline.end) {
		return a.timeline.end - b.timeline.end;
	}
	return a.id.localeCompare(b.id);
};

export const reflowInsertedElementsOnTracks = (
	baseElements: TimelineElement[],
	insertedElements: TimelineElement[],
): TimelineElement[] => {
	if (insertedElements.length === 0) return insertedElements;

	const reconciled = insertedElements.map((element) => element);
	const orderedInsertedIds = reconciled
		.slice()
		.sort(sortByTimeline)
		.map((element) => element.id);

	for (const elementId of orderedInsertedIds) {
		const targetIndex = reconciled.findIndex(
			(element) => element.id === elementId,
		);
		if (targetIndex < 0) continue;
		const target = reconciled[targetIndex];
		const merged = [...baseElements, ...reconciled];
		const assignments = getStoredTrackAssignments(merged);
		const role = getElementRole(target);
		const resolvedDropTarget = resolveDropTargetForRole(
			{
				type: "track",
				trackIndex: getTrackIndex(target),
			},
			role,
			merged,
			assignments,
		);
		const finalTrack = findAvailableTrack(
			target.timeline.start,
			target.timeline.end,
			resolvedDropTarget.trackIndex,
			role,
			merged,
			assignments,
			target.id,
			getTrackCount(assignments),
		);
		if (finalTrack === target.timeline.trackIndex) continue;
		reconciled[targetIndex] = {
			...target,
			timeline: {
				...target.timeline,
				trackIndex: finalTrack,
			},
		};
	}

	return reconciled;
};
