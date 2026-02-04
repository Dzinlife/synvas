import { useTimelineStore } from "@/editor/contexts/TimelineContext";
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

export const AudioClipTimeline: React.FC<AudioClipTimelineProps> = ({ id }) => {
	useAudioClipSelector(id, (state) => state.props.uri);
	const name = useTimelineStore((state) => state.getElementById(id)?.name);

	return (
		<div className="absolute inset-0 p-1 bg-emerald-800/80">
			<div className="flex items-center gap-1 text-xs text-emerald-50">
				<span className="size-1.5 rounded-full bg-emerald-200" />
				<span className="truncate">{name || "Audio"}</span>
			</div>
		</div>
	);
};
