import type { TimelineTrack } from "../timeline";

export type AudioTrackControlState = Pick<
	TimelineTrack,
	"locked" | "muted" | "solo"
>;

export type AudioTrackControlStateMap = Record<number, AudioTrackControlState>;

export const DEFAULT_AUDIO_TRACK_CONTROL_STATE: AudioTrackControlState = {
	locked: false,
	muted: false,
	solo: false,
};

export const getAudioTrackControlState = (
	audioTrackStates: AudioTrackControlStateMap,
	trackIndex: number,
): AudioTrackControlState => {
	if (trackIndex >= 0) {
		return DEFAULT_AUDIO_TRACK_CONTROL_STATE;
	}
	return audioTrackStates[trackIndex] ?? DEFAULT_AUDIO_TRACK_CONTROL_STATE;
};
