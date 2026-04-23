import { useTimelineStore } from "@/scene-editor/contexts/TimelineContext";
import { createModelSelector } from "../model/registry";
import type { TimelineProps } from "../model/types";
import type { FancyTextInternal, FancyTextProps } from "./model";

interface FancyTextTimelineProps extends TimelineProps {
	id: string;
}

const useFancyTextSelector = createModelSelector<FancyTextProps, FancyTextInternal>();

export const FancyTextTimeline: React.FC<FancyTextTimelineProps> = ({ id }) => {
	const text = useFancyTextSelector(id, (state) => state.props.text);
	const name = useTimelineStore((state) => state.getElementById(id)?.name);
	const preview = text.trim() || name || "Fancy Text";

	return (
		<div className="absolute inset-0 p-1 bg-amber-600/90 text-white">
			<div className="flex items-center gap-1 text-xs">
				<div className="rounded-xs px-1 py-0.5 bg-black/25 font-semibold">
					FT
				</div>
				<span className="truncate">{preview}</span>
			</div>
		</div>
	);
};
