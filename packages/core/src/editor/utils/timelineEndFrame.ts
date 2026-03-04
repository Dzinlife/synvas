import type { TimelineElement } from "../../element/types";

export const resolveTimelineEndFrame = (elements: TimelineElement[]): number => {
	return Math.max(
		0,
		elements.reduce((maxFrame, element) => {
			if (element.type === "Filter") return maxFrame;
			const endFrame = Math.round(element.timeline.end ?? 0);
			return Math.max(maxFrame, endFrame);
		}, 0),
	);
};
