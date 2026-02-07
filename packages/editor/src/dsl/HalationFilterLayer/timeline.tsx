import type { TimelineProps } from "../model/types";

interface HalationFilterLayerTimelineProps extends TimelineProps {
	id: string;
}

export const HalationFilterLayerTimeline: React.FC<
	HalationFilterLayerTimelineProps
> = () => {
	return <div className="absolute inset-0 p-1">Halation</div>;
};
