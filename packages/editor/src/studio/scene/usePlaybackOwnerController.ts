import { useCallback, useEffect } from "react";
import { useStudioRuntimeManager } from "@/editor/runtime/EditorRuntimeProvider";
import type { StudioRuntimeManager, TimelineRef } from "@/editor/runtime/types";
import { usePlaybackOwnerStore } from "./playbackOwnerStore";
import {
	buildTimelineRuntimeIdFromRef,
	isTimelineRefEqual,
} from "./timelineRefAdapter";

const pauseRuntimePlayback = (
	ref: TimelineRef,
	options: {
		getTimelineRuntime: StudioRuntimeManager["getTimelineRuntime"];
	},
): void => {
	const runtime = options.getTimelineRuntime(ref);
	if (!runtime) return;
	runtime.timelineStore.getState().pause();
};

export const usePlaybackOwnerController = () => {
	const runtimeManager = useStudioRuntimeManager();
	const ownerTimelineRef = usePlaybackOwnerStore(
		(state) => state.ownerTimelineRef,
	);
	const ownerRuntimeId = usePlaybackOwnerStore((state) => state.ownerRuntimeId);
	const setOwner = usePlaybackOwnerStore((state) => state.setOwner);
	const clearOwner = usePlaybackOwnerStore((state) => state.clearOwner);

	const requestPlay = useCallback(
		(ref: TimelineRef) => {
			const targetRuntime = runtimeManager.ensureTimelineRuntime(ref);
			const targetRuntimeId = buildTimelineRuntimeIdFromRef(ref);
			for (const runtime of runtimeManager.listTimelineRuntimes()) {
				if (runtime.id === targetRuntimeId) continue;
				if (!runtime.timelineStore.getState().isPlaying) continue;
				runtime.timelineStore.getState().pause();
			}
			const state = targetRuntime.timelineStore.getState();
			const startTime = state.getDisplayTime();
			state.setPreviewTime(null);
			state.setCurrentTime(startTime);
			state.play();
			setOwner(ref);
		},
		[runtimeManager, setOwner],
	);

	const requestPause = useCallback(
		(ref?: TimelineRef) => {
			const targetRef = ref ?? ownerTimelineRef;
			if (!targetRef) return;
			pauseRuntimePlayback(targetRef, {
				getTimelineRuntime: runtimeManager.getTimelineRuntime,
			});
			const latestOwner = usePlaybackOwnerStore.getState().ownerTimelineRef;
			if (isTimelineRefEqual(latestOwner, targetRef)) {
				clearOwner();
			}
		},
		[clearOwner, ownerTimelineRef, runtimeManager.getTimelineRuntime],
	);

	const togglePlayback = useCallback(
		(ref: TimelineRef) => {
			const targetRuntime = runtimeManager.ensureTimelineRuntime(ref);
			const isOwner = isTimelineRefEqual(ownerTimelineRef, ref);
			const isPlaying = targetRuntime.timelineStore.getState().isPlaying;
			if (isOwner && isPlaying) {
				requestPause(ref);
				return;
			}
			requestPlay(ref);
		},
		[ownerTimelineRef, requestPause, requestPlay, runtimeManager],
	);

	const stopAll = useCallback(() => {
		for (const runtime of runtimeManager.listTimelineRuntimes()) {
			if (!runtime.timelineStore.getState().isPlaying) continue;
			runtime.timelineStore.getState().pause();
		}
		clearOwner();
	}, [clearOwner, runtimeManager]);

	const isOwner = useCallback(
		(ref: TimelineRef): boolean => {
			return isTimelineRefEqual(ownerTimelineRef, ref);
		},
		[ownerTimelineRef],
	);

	const isOwnerPlaying = useCallback(
		(ref: TimelineRef): boolean => {
			const runtime = runtimeManager.getTimelineRuntime(ref);
			if (!runtime) return false;
			return isOwner(ref) && runtime.timelineStore.getState().isPlaying;
		},
		[isOwner, runtimeManager],
	);

	useEffect(() => {
		if (!ownerTimelineRef) return;
		const runtime = runtimeManager.getTimelineRuntime(ownerTimelineRef);
		if (!runtime) {
			clearOwner();
			return;
		}
		return runtime.timelineStore.subscribe(
			(state) => state.isPlaying,
			(isPlaying) => {
				if (isPlaying) return;
				const latestOwnerRuntimeId =
					usePlaybackOwnerStore.getState().ownerRuntimeId;
				if (latestOwnerRuntimeId !== runtime.id) return;
				usePlaybackOwnerStore.getState().clearOwner();
			},
			{ fireImmediately: true },
		);
	}, [clearOwner, ownerTimelineRef, runtimeManager]);

	return {
		ownerTimelineRef,
		ownerRuntimeId,
		requestPlay,
		requestPause,
		togglePlayback,
		stopAll,
		isOwner,
		isOwnerPlaying,
	};
};
