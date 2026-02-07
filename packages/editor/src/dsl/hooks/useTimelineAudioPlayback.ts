import { useEffect, useRef } from "react";
import {
	useFps,
	usePlaybackControl,
	useRenderTime,
	useTimelineStore,
} from "@/editor/contexts/TimelineContext";
import { framesToSeconds } from "@/utils/timecode";

interface UseTimelineAudioPlaybackOptions {
	id: string;
	uri?: string;
	isLoading: boolean;
	hasError: boolean;
	audioDuration: number;
	enabled?: boolean;
	stepPlayback: (seconds: number) => Promise<void>;
	stopPlayback: () => void;
}

export const useTimelineAudioPlayback = ({
	id,
	uri,
	isLoading,
	hasError,
	audioDuration,
	enabled = true,
	stepPlayback,
	stopPlayback,
}: UseTimelineAudioPlaybackOptions) => {
	const renderTimeFrames = useRenderTime();
	const { fps } = useFps();
	const { isPlaying } = usePlaybackControl();
	const isExporting = useTimelineStore((state) => state.isExporting);
	const timeline = useTimelineStore(
		(state) => state.getElementById(id)?.timeline,
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
		if (
			!enabled ||
			!uri ||
			isLoading ||
			hasError ||
			!timeline ||
			audioDuration <= 0
		) {
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
		enabled,
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
		return () => {
			stopPlaybackRef.current();
		};
	}, []);
};
