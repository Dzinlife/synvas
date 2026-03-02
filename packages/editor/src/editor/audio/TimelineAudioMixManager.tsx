import type React from "react";
import { useCallback, useEffect } from "react";
import type { TimelineStore } from "../contexts/TimelineContext";
import { useTimelineStore } from "../contexts/TimelineContext";
import {
	useModelRegistry,
	useTimelineStoreApi,
} from "../runtime/EditorRuntimeProvider";
import { getAudioPlaybackSessionKey } from "../playback/clipContinuityIndex";
import { isTimelineTrackAudible } from "../utils/trackAudibility";
import { isVideoSourceAudioMuted } from "../utils/videoClipAudioSeparation";
import {
	type AudioMixTarget,
	runTimelineAudioMixFrame,
} from "./TimelineAudioMixRunner";
import { setPreviewAudioDspSettings } from "@/audio/engine";
import type { AudioMixInstruction } from "./transitionAudioMix";

const invokeApplyAudioMix = (
	target: AudioMixTarget,
	instruction: AudioMixInstruction | null,
) => {
	const result = target.applyAudioMix(instruction);
	if (result && typeof (result as Promise<void>).then === "function") {
		void result;
	}
};

type AudioMixModelInternal = {
	audioDuration?: number;
	applyAudioMix?: (
		instruction: AudioMixInstruction | null,
	) => void | Promise<void>;
};

const collectAudioMixTargets = (
	state: TimelineStore,
	modelRegistry: ReturnType<typeof useModelRegistry>,
): Map<string, AudioMixTarget> => {
	const targets = new Map<string, AudioMixTarget>();
	for (const element of state.elements) {
		if (element.type !== "AudioClip" && element.type !== "VideoClip") continue;

		const store = modelRegistry.get(element.id);
		if (!store) continue;
		const internal = store.getState().internal as AudioMixModelInternal;
		if (typeof internal.applyAudioMix !== "function") continue;
		const audioDuration = internal.audioDuration ?? 0;
		const enabled =
			isTimelineTrackAudible(
				element.timeline,
				state.tracks,
				state.audioTrackStates,
			) && !(element.type === "VideoClip" && isVideoSourceAudioMuted(element));

		targets.set(element.id, {
			id: element.id,
			timeline: element.timeline,
			audioDuration,
			enabled,
			sessionKey: getAudioPlaybackSessionKey(state.elements, element.id),
			applyAudioMix: internal.applyAudioMix,
		});
	}
	return targets;
};

export const TimelineAudioMixManager: React.FC = () => {
	const timelineStore = useTimelineStoreApi();
	const modelRegistry = useModelRegistry();
	const audioSettings = useTimelineStore((state) => state.audioSettings);

	const runMix = useCallback(() => {
		const state = timelineStore.getState();
		const targets = collectAudioMixTargets(state, modelRegistry);
		runTimelineAudioMixFrame({
			isPlaying: state.isPlaying,
			isExporting: state.isExporting,
			displayTime: state.currentTime,
			fps: state.fps,
			elements: state.elements,
			tracks: state.tracks,
			audioTrackStates: state.audioTrackStates,
			targets,
		});
	}, [modelRegistry, timelineStore]);

	const stopAllMixTargets = useCallback(() => {
		const state = timelineStore.getState();
		const targets = collectAudioMixTargets(state, modelRegistry);
		const handledSessionKeys = new Set<string>();
		for (const target of targets.values()) {
			if (handledSessionKeys.has(target.sessionKey)) continue;
			handledSessionKeys.add(target.sessionKey);
			invokeApplyAudioMix(target, null);
		}
	}, [modelRegistry, timelineStore]);

	useEffect(() => {
		const trigger = () => {
			runMix();
		};
		const unsubscribers = [
			timelineStore.subscribe((state) => state.currentTime, trigger),
			timelineStore.subscribe((state) => state.isPlaying, trigger),
			timelineStore.subscribe((state) => state.isExporting, trigger),
			timelineStore.subscribe((state) => state.exportTime, trigger),
			timelineStore.subscribe((state) => state.elements, trigger),
			timelineStore.subscribe((state) => state.tracks, trigger),
			timelineStore.subscribe((state) => state.audioTrackStates, trigger),
			timelineStore.subscribe((state) => state.fps, trigger),
			modelRegistry.subscribe(trigger),
		];

		trigger();

		return () => {
			for (const unsubscribe of unsubscribers) {
				unsubscribe();
			}
			stopAllMixTargets();
		};
	}, [modelRegistry, runMix, stopAllMixTargets, timelineStore]);

	useEffect(() => {
		setPreviewAudioDspSettings(audioSettings);
	}, [audioSettings]);

	return null;
};
