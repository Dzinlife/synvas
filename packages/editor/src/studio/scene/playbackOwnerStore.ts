import { create } from "zustand";
import type { TimelineRef, TimelineRuntimeId } from "@/scene-editor/runtime/types";
import { buildTimelineRuntimeIdFromRef } from "./timelineRefAdapter";

interface PlaybackOwnerState {
	ownerTimelineRef: TimelineRef | null;
	ownerRuntimeId: TimelineRuntimeId | null;
	setOwner: (ref: TimelineRef | null) => void;
	clearOwner: () => void;
}

export const usePlaybackOwnerStore = create<PlaybackOwnerState>((set) => ({
	ownerTimelineRef: null,
	ownerRuntimeId: null,
	setOwner: (ref) => {
		if (!ref) {
			set({
				ownerTimelineRef: null,
				ownerRuntimeId: null,
			});
			return;
		}
		set({
			ownerTimelineRef: ref,
			ownerRuntimeId: buildTimelineRuntimeIdFromRef(ref),
		});
	},
	clearOwner: () => {
		set({
			ownerTimelineRef: null,
			ownerRuntimeId: null,
		});
	},
}));
