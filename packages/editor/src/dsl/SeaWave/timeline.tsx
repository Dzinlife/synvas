import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import type { TimelineProps } from "../model/types";

interface SeaWaveTimelineProps extends TimelineProps {
	id: string;
}

export const SeaWaveTimeline: React.FC<
	SeaWaveTimelineProps
> = ({ id }) => {
	const name = useTimelineStore(
		(state) => state.getElementById(id)?.name,
	);

	return (
		<div className="absolute inset-0 p-1">
			<div className="flex gap-1">
				<span className="text-white text-xs truncate">{name || "Sea Wave"}</span>
			</div>
		</div>
	);
};
