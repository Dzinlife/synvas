import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import {
	type VideoNodePlaybackController,
	type VideoNodePlaybackSnapshot,
	releaseVideoNodePlaybackController,
	retainVideoNodePlaybackController,
} from "./playbackController";

const EMPTY_SNAPSHOT: VideoNodePlaybackSnapshot = {
	isLoading: false,
	isReady: false,
	isPlaying: false,
	currentFrame: null,
	currentTime: 0,
	duration: 0,
	errorMessage: "未初始化视频播放控制器",
};

interface UseVideoNodePlaybackOptions {
	nodeId: string;
	assetUri: string | null;
	fps: number;
	runtimeManager: StudioRuntimeManager | null;
	active?: boolean;
}

export const useVideoNodePlayback = ({
	nodeId,
	assetUri,
	fps,
	runtimeManager,
	active = true,
}: UseVideoNodePlaybackOptions) => {
	const [controller, setController] =
		useState<VideoNodePlaybackController | null>(null);

	useEffect(() => {
		const retained = retainVideoNodePlaybackController(nodeId);
		setController(retained);
		return () => {
			releaseVideoNodePlaybackController(nodeId);
		};
	}, [nodeId]);

	useEffect(() => {
		if (!controller) return;
		controller.bind({
			assetUri,
			fps,
			runtimeManager,
			active,
		});
	}, [active, assetUri, controller, fps, runtimeManager]);

	const subscribe = useCallback(
		(listener: () => void) => {
			if (!controller) {
				return () => {};
			}
			return controller.subscribe(listener);
		},
		[controller],
	);

	const getSnapshot = useCallback(() => {
		if (!controller) return EMPTY_SNAPSHOT;
		return controller.getSnapshot();
	}, [controller]);

	const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	const play = useCallback(async () => {
		if (!controller) return;
		await controller.play();
	}, [controller]);

	const pause = useCallback(() => {
		if (!controller) return;
		controller.pause();
	}, [controller]);

	const togglePlayback = useCallback(async () => {
		if (!controller) return;
		await controller.togglePlayback();
	}, [controller]);

	const seekToTime = useCallback(
		async (seconds: number) => {
			if (!controller) return;
			await controller.seekToTime(seconds);
		},
		[controller],
	);

	return {
		snapshot,
		play,
		pause,
		togglePlayback,
		seekToTime,
	};
};
