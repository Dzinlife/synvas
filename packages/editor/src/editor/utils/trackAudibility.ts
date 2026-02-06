import type { TimelineMeta } from "@/dsl/types";
import type { TimelineTrack } from "../timeline/types";
import {
	type AudioTrackControlStateMap,
	getAudioTrackControlState,
} from "./audioTrackState";

type TrackAudibilityState = Pick<TimelineTrack, "hidden" | "muted" | "solo">;

const resolveTimelineTrack = (
	timeline: TimelineMeta | undefined,
	tracks: TimelineTrack[],
	audioTrackStates: AudioTrackControlStateMap,
): TrackAudibilityState | null => {
	if (!timeline) return null;
	if (timeline.trackId) {
		const trackById = tracks.find((track) => track.id === timeline.trackId);
		if (trackById) return trackById;
	}
	const trackIndex = timeline.trackIndex ?? 0;
	if (trackIndex < 0) {
		const audioTrack = getAudioTrackControlState(audioTrackStates, trackIndex);
		return {
			hidden: false,
			muted: audioTrack.muted,
			solo: audioTrack.solo,
		};
	}
	if (trackIndex >= tracks.length) return null;
	return tracks[trackIndex] ?? null;
};

export const isTimelineTrackAudible = (
	timeline: TimelineMeta | undefined,
	tracks: TimelineTrack[],
	audioTrackStates: AudioTrackControlStateMap = {},
): boolean => {
	const hasSoloTrack =
		tracks.some((track) => track.solo) ||
		Object.values(audioTrackStates).some((track) => track.solo);
	const track = resolveTimelineTrack(timeline, tracks, audioTrackStates);
	if (!track) {
		return !hasSoloTrack;
	}
	if (track.hidden || track.muted) {
		return false;
	}
	if (hasSoloTrack && !track.solo) {
		return false;
	}
	return true;
};

export const isTimelineTrackMuted = (
	timeline: TimelineMeta | undefined,
	tracks: TimelineTrack[],
	audioTrackStates: AudioTrackControlStateMap = {},
): boolean => {
	const track = resolveTimelineTrack(timeline, tracks, audioTrackStates);
	return track?.muted ?? false;
};
