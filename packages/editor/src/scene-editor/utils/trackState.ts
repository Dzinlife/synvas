import type { TimelineElement } from "core/timeline-system/types";
import {
	MAIN_TRACK_ID,
	reconcileTracks as reconcileTracksCore,
	type TrackReconcileResult,
} from "core/timeline-system/utils/trackState";
import type { TimelineTrack } from "../timeline/types";
import { resolveTimelineElementRole } from "./resolveRole";

export { MAIN_TRACK_ID };
export type { TrackReconcileResult };

export const reconcileTracks = (
	elements: TimelineElement[],
	prevTracks: TimelineTrack[],
): TrackReconcileResult => {
	return reconcileTracksCore(elements, prevTracks, {
		resolveRole: resolveTimelineElementRole,
	});
};
