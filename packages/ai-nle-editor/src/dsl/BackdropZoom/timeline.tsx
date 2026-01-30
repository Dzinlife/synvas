import type { TimelineProps } from "../model/types";

interface BackdropZoomTimelineProps extends TimelineProps {
	id: string;
}

export const BackdropZoomTimeline: React.FC<BackdropZoomTimelineProps> = () => {
	return (
		<div className="absolute inset-0 flex items-center justify-center text-white text-xs">
			Backdrop Zoom
		</div>
	);
};
