import {
	loadTimelineFromObject,
	saveTimelineToObject,
	type TimelineJSON,
} from "core/editor/timelineLoader";
import type {
	TimelineStore,
	TimelineStoreApi,
} from "@/editor/contexts/TimelineContext";
import { reconcileTracks } from "@/editor/utils/trackState";
import { clampFrame } from "@/utils/timecode";

const cloneAudioSettings = (audio: TimelineStore["audioSettings"]) => ({
	...audio,
	compressor: { ...audio.compressor },
});

export const applyTimelineJsonToStore = (
	timeline: TimelineJSON,
	timelineStore: TimelineStoreApi,
): void => {
	const data = loadTimelineFromObject(timeline);
	const { tracks, elements } = reconcileTracks(data.elements, data.tracks);
	timelineStore.setState((state) => ({
		currentTime: clampFrame(state.currentTime),
		elements,
		assets: data.assets,
		tracks,
		audioTrackStates: {},
		scrollLeft: 0,
		canvasSize: data.canvas,
		fps: data.fps,
		snapEnabled: data.settings.snapEnabled,
		autoAttach: data.settings.autoAttach,
		rippleEditingEnabled: data.settings.rippleEditingEnabled,
		previewAxisEnabled: data.settings.previewAxisEnabled,
		audioSettings: cloneAudioSettings(data.settings.audio),
	}));
	timelineStore.getState().resetHistory();
};

export const snapshotTimelineFromStore = (
	timelineStore: TimelineStoreApi,
): TimelineJSON => {
	const state = timelineStore.getState();
	return saveTimelineToObject(
		state.elements,
		state.fps,
		state.canvasSize,
		state.tracks,
		{
			snapEnabled: state.snapEnabled,
			autoAttach: state.autoAttach,
			rippleEditingEnabled: state.rippleEditingEnabled,
			previewAxisEnabled: state.previewAxisEnabled,
			audio: cloneAudioSettings(state.audioSettings),
		},
		state.assets,
	);
};
