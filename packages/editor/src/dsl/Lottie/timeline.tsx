import { LottieIcon } from "@/components/icons";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import type { TimelineProps } from "../model/types";

interface LottieTimelineProps extends TimelineProps {
	id: string;
}

export const LottieTimeline: React.FC<LottieTimelineProps> = ({ id }) => {
	const name = useTimelineStore(
		(state) => state.getElementById(id)?.name,
	);

	return (
		<div className="absolute inset-0 p-1">
			<div className="flex gap-1">
				<div className="rounded-xs size-4.5 overflow-clip">
					<LottieIcon className="size-full" />
				</div>
				<span>{name || "Lottie"}</span>
			</div>
		</div>
	);
};
