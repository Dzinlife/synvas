import { useTimelineStore } from "@/scene-editor/contexts/TimelineContext";
import { createModelSelector } from "../model/registry";
import type { TimelineProps } from "../model/types";
import type { TextInternal, TextProps } from "./model";

interface TextTimelineProps extends TimelineProps {
	id: string;
}

const useTextSelector = createModelSelector<TextProps, TextInternal>();

export const TextTimeline: React.FC<TextTimelineProps> = ({ id }) => {
	const text = useTextSelector(id, (state) => state.props.text);
	const name = useTimelineStore((state) => state.getElementById(id)?.name);
	const preview = text.trim() || name || "Text";

	return (
		<div className="absolute inset-0 p-1 bg-cyan-700/90 text-white">
			<div className="flex items-center gap-1 text-xs">
				<div className="rounded-xs px-1 py-0.5 bg-black/25 font-semibold">
					T
				</div>
				<span className="truncate">{preview}</span>
			</div>
		</div>
	);
};
