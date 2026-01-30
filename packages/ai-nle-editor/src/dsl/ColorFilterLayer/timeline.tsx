import type { TimelineProps } from "../model/types";

interface ColorFilterLayerTimelineProps extends TimelineProps {
	id: string;
}

export const ColorFilterLayerTimeline: React.FC<
	ColorFilterLayerTimelineProps
> = () => {
	return <div className="absolute inset-0 p-1">Color Filter</div>;
};
