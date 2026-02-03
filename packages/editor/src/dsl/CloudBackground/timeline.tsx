import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import type { TimelineProps } from "../model/types";

interface CloudBackgroundTimelineProps extends TimelineProps {
	id: string;
}

export const CloudBackgroundTimeline: React.FC<
	CloudBackgroundTimelineProps
> = ({ id }) => {
	const name = useTimelineStore(
		(state) => state.getElementById(id)?.name,
	);

	return (
		<div className="absolute inset-0 p-1">
			<div className="flex gap-1">
				<span>{name || "Cloud Background"}</span>
			</div>
		</div>
	);
};
