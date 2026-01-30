import type { TimelineProps } from "../model/types";

interface TransitionTimelineProps extends TimelineProps {
	id: string;
}

export const TransitionTimeline: React.FC<TransitionTimelineProps> = () => {
	return (
		<div className="absolute inset-0 flex items-center justify-center text-white"></div>
	);
};
