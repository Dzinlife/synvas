import { useEffect, useRef } from "react";
import {
	useFps,
	usePlaybackControl,
	useRenderTime,
	useTimelineStore,
} from "@/editor/contexts/TimelineContext";
import { framesToSeconds } from "@/utils/timecode";
import { createModelSelector } from "../model/registry";
import type { AudioClipInternal, AudioClipProps } from "./model";

interface AudioClipRendererProps extends AudioClipProps {
	id: string;
}

const useAudioClipSelector = createModelSelector<
	AudioClipProps,
	AudioClipInternal
>();

const AudioClipRenderer: React.FC<AudioClipRendererProps> = ({ id }) => {
	const renderTimeFrames = useRenderTime();
	const { fps } = useFps();
	const { isPlaying } = usePlaybackControl();
	const isExporting = useTimelineStore((state) => state.isExporting);
	const timeline = useTimelineStore(
		(state) => state.getElementById(id)?.timeline,
	);

	const uri = useAudioClipSelector(id, (state) => state.props.uri);
	const isLoading = useAudioClipSelector(
		id,
		(state) => state.constraints.isLoading ?? false,
	);
	const hasError = useAudioClipSelector(
		id,
		(state) => state.constraints.hasError ?? false,
	);
	const audioDuration = useAudioClipSelector(
		id,
		(state) => state.internal.audioDuration,
	);
	const stepPlayback = useAudioClipSelector(
		id,
		(state) => state.internal.stepPlayback,
	);
	const stopPlayback = useAudioClipSelector(
		id,
		(state) => state.internal.stopPlayback,
	);

	const stepPlaybackRef = useRef(stepPlayback);
	const stopPlaybackRef = useRef(stopPlayback);

	useEffect(() => {
		stepPlaybackRef.current = stepPlayback;
	}, [stepPlayback]);

	useEffect(() => {
		stopPlaybackRef.current = stopPlayback;
	}, [stopPlayback]);

	useEffect(() => {
		if (isExporting) {
			stopPlaybackRef.current();
			return;
		}
		if (!uri || isLoading || hasError || !timeline || audioDuration <= 0) {
			stopPlaybackRef.current();
			return;
		}

		const safeFps = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 30;
		const clipStartSeconds = framesToSeconds(timeline.start ?? 0, safeFps);
		const clipEndSeconds = framesToSeconds(timeline.end ?? 0, safeFps);

		if (isPlaying) {
			const currentSeconds = framesToSeconds(renderTimeFrames, safeFps);
			if (
				currentSeconds < clipStartSeconds ||
				currentSeconds >= clipEndSeconds
			) {
				stopPlaybackRef.current();
				return;
			}
			stepPlaybackRef.current(currentSeconds);
			return;
		}

		stopPlaybackRef.current();
	}, [
		audioDuration,
		fps,
		hasError,
		isExporting,
		isLoading,
		isPlaying,
		renderTimeFrames,
		timeline,
		uri,
	]);

	useEffect(() => {
		const clipId = id;
		return () => {
			// 组件实例切换到其他片段时，清理旧片段的播放状态
			if (!clipId) return;
			stopPlaybackRef.current();
		};
	}, [id]);

	return null;
};

export default AudioClipRenderer;
