import type React from "react";
import { useCallback, useEffect } from "react";
import { setPreviewAudioDspSettings } from "@/audio/engine";
import type { TimelineStore } from "../contexts/TimelineContext";
import { useTimelineStore } from "../contexts/TimelineContext";
import { getAudioPlaybackSessionKey } from "../playback/clipContinuityIndex";
import {
	useEditorRuntime,
	useModelRegistry,
	useTimelineStoreApi,
} from "../runtime/EditorRuntimeProvider";
import type { StudioRuntimeManager, TimelineRuntime } from "../runtime/types";
import { isTimelineTrackAudible } from "../utils/trackAudibility";
import { isVideoSourceAudioMuted } from "../utils/videoClipAudioSeparation";
import { buildCompositionAudioGraph } from "./buildCompositionAudioGraph";
import {
	type AudioMixTarget,
	runTimelineAudioMixFrame,
} from "./TimelineAudioMixRunner";
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
	const runtime = useEditorRuntime();
	const timelineStore = useTimelineStoreApi();
	const modelRegistry = useModelRegistry();
	const audioSettings = useTimelineStore((state) => state.audioSettings);
	const runtimeCandidate = runtime as Partial<StudioRuntimeManager>;
	const runtimeManager =
		typeof runtimeCandidate.getTimelineRuntime === "function" &&
		typeof runtimeCandidate.listTimelineRuntimes === "function"
			? (runtime as unknown as StudioRuntimeManager)
			: null;

	const resolveOwnerTimelineRuntime =
		useCallback((): TimelineRuntime | null => {
			if (!runtimeManager) return null;
			for (const timelineRuntime of runtimeManager.listTimelineRuntimes()) {
				if (
					timelineRuntime.timelineStore === timelineStore &&
					timelineRuntime.modelRegistry === modelRegistry
				) {
					return timelineRuntime;
				}
			}
			return runtimeManager.getActiveEditTimelineRuntime();
		}, [modelRegistry, runtimeManager, timelineStore]);

	const buildCompositionTargets = useCallback(() => {
		const ownerRuntime = resolveOwnerTimelineRuntime();
		if (!ownerRuntime || !runtimeManager) return null;
		return buildCompositionAudioGraph({
			rootRuntime: ownerRuntime,
			runtimeManager,
		});
	}, [resolveOwnerTimelineRuntime, runtimeManager]);

	const runMix = useCallback(() => {
		const state = timelineStore.getState();
		const compositionGraph = buildCompositionTargets();
		const targets =
			compositionGraph?.previewTargets ??
			collectAudioMixTargets(state, modelRegistry);
		runTimelineAudioMixFrame({
			isPlaying: state.isPlaying,
			isExporting: state.isExporting,
			displayTime: state.currentTime,
			fps: state.fps,
			elements: compositionGraph?.mixElements ?? state.elements,
			tracks: compositionGraph?.mixTracks ?? state.tracks,
			audioTrackStates: state.audioTrackStates,
			targets,
		});
	}, [buildCompositionTargets, modelRegistry, timelineStore]);

	const stopAllMixTargets = useCallback(() => {
		const state = timelineStore.getState();
		const compositionGraph = buildCompositionTargets();
		const targets =
			compositionGraph?.previewTargets ??
			collectAudioMixTargets(state, modelRegistry);
		for (const target of targets.values()) {
			invokeApplyAudioMix(target, null);
		}
	}, [buildCompositionTargets, modelRegistry, timelineStore]);

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
