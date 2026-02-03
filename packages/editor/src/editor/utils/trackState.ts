import type { TimelineElement } from "@/dsl/types";
import type { TimelineTrack } from "../timeline/types";
import type { ResolveRole } from "core/editor/utils/trackAssignment";
import {
	MAIN_TRACK_ID,
	reconcileTracks as reconcileTracksCore,
	type TrackReconcileResult,
} from "core/editor/utils/trackState";
import { getElementRoleFromComponent } from "../timeline/trackConfig";

const resolveRole: ResolveRole = (element: TimelineElement) =>
	getElementRoleFromComponent(element.component, "clip");

export { MAIN_TRACK_ID };
export type { TrackReconcileResult };

export const reconcileTracks = (
	elements: TimelineElement[],
	prevTracks: TimelineTrack[],
): TrackReconcileResult => {
	return reconcileTracksCore(elements, prevTracks, { resolveRole });
};
