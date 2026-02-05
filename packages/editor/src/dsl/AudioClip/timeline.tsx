import {
	useFps,
	useTimelineScale,
	useTimelineStore,
} from "@/editor/contexts/TimelineContext";
import { AudioWaveformCanvas } from "@/dsl/AudioWaveformCanvas";
import { createModelSelector } from "../model/registry";
import type { TimelineProps } from "../model/types";
import type { AudioClipInternal, AudioClipProps } from "./model";

interface AudioClipTimelineProps extends TimelineProps {
	id: string;
}

const useAudioClipSelector = createModelSelector<
	AudioClipProps,
	AudioClipInternal
>();

export const AudioClipTimeline: React.FC<AudioClipTimelineProps> = ({
	id,
	start,
	end,
	fps,
}) => {
	const { timelineScale } = useTimelineScale();
	const name = useTimelineStore((state) => state.getElementById(id)?.name);
	const uri = useAudioClipSelector(id, (state) => state.props.uri);
	const audioSink = useAudioClipSelector(
		id,
		(state) => state.internal.audioSink,
	);
	const audioDuration = useAudioClipSelector(
		id,
		(state) => state.internal.audioDuration,
	);
	const isLoading = useAudioClipSelector(
		id,
		(state) => state.constraints.isLoading ?? false,
	);
	const hasError = useAudioClipSelector(
		id,
		(state) => state.constraints.hasError ?? false,
	);
	const offsetFrames = useTimelineStore(
		(state) => state.getElementById(id)?.timeline?.offset ?? 0,
	);
	const scrollLeft = useTimelineStore((state) => state.scrollLeft);
	const { fps: timelineFps } = useFps();
	const safeFps = Number.isFinite(fps) && fps > 0 ? fps : timelineFps;

	return (
		<div className="absolute inset-0 bg-emerald-800/80 overflow-hidden">
			{uri && audioSink && audioDuration > 0 && !hasError && (
				<AudioWaveformCanvas
					uri={uri}
					audioSink={audioSink}
					audioDuration={audioDuration}
					start={start}
					end={end}
					fps={safeFps}
					timelineScale={timelineScale}
					offsetFrames={offsetFrames}
					scrollLeft={scrollLeft}
					color="rgba(16, 185, 129, 0.9)"
					className="absolute inset-0"
				/>
			)}
			<div className="absolute inset-x-0 top-0 p-1 z-10">
				<div className="flex items-center gap-1 text-xs text-emerald-50">
					<span className="size-1.5 rounded-full bg-emerald-200" />
					<span className="truncate">{name || "Audio"}</span>
				</div>
			</div>

			{isLoading && (
				<div className="absolute inset-0 flex items-center justify-center bg-emerald-100/30 z-20">
					<div className="text-xs text-emerald-700">Loading...</div>
				</div>
			)}
			{hasError && (
				<div className="absolute inset-0 flex items-center justify-center bg-red-500/20 z-20">
					<div className="text-xs text-red-200">Load Failed</div>
				</div>
			)}
		</div>
	);
};
