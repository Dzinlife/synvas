import type { TimelineElement } from "core/dsl/types";
import type { AudioTrackControlStateMap } from "./audioTrackState";

export const pruneAudioTrackStates = (
	elements: TimelineElement[],
	audioTrackStates: AudioTrackControlStateMap,
): AudioTrackControlStateMap => {
	// 保留默认音轨（-1）的状态，避免空轨时面板状态被清空
	const activeTrackIndices = new Set<number>([-1]);
	for (const element of elements) {
		const trackIndex = element.timeline.trackIndex ?? 0;
		if (trackIndex < 0) {
			activeTrackIndices.add(trackIndex);
		}
	}
	const currentEntries = Object.entries(audioTrackStates);
	if (currentEntries.length === 0) return audioTrackStates;

	let didChange = false;
	const nextStates: AudioTrackControlStateMap = {};
	for (const [trackIndexRaw, state] of currentEntries) {
		const trackIndex = Number(trackIndexRaw);
		if (!activeTrackIndices.has(trackIndex)) {
			didChange = true;
			continue;
		}
		nextStates[trackIndex] = state;
	}
	if (!didChange) return audioTrackStates;
	return nextStates;
};
