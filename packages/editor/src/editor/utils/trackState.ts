import type { TimelineElement } from "@/dsl/types";
import type { TimelineTrack } from "../timeline/types";
import {
	MAIN_TRACK_ID,
	reconcileTracks as reconcileTracksCore,
	type TrackReconcileResult,
} from "core/editor/utils/trackState";
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
