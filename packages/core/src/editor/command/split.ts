import type { TimelineElement } from "../../element/types";
import { updateElementTime } from "../utils/timelineTime";

const normalizeOffsetFrames = (value: unknown): number => {
	if (!Number.isFinite(value as number)) return 0;
	return Math.max(0, Math.round(value as number));
};

export const buildSplitElements = (
	element: TimelineElement,
	splitFrame: number,
	fps: number,
	newId: string,
): { left: TimelineElement; right: TimelineElement } => {
	const originalStart = element.timeline.start;
	const originalEnd = element.timeline.end;
	const offsetFrames = normalizeOffsetFrames(element.timeline.offset);
	const leftDurationFrames = Math.max(0, splitFrame - originalStart);
	const rightDurationFrames = Math.max(0, originalEnd - splitFrame);
	const isReversed =
		(element.type === "VideoClip" ||
			element.type === "AudioClip" ||
			element.type === "CompositionAudioClip") &&
		Boolean((element.props as { reversed?: unknown } | undefined)?.reversed);
	const leftOffset = isReversed
		? offsetFrames + rightDurationFrames
		: offsetFrames;
	const rightOffset = isReversed
		? offsetFrames
		: offsetFrames + leftDurationFrames;

	const leftBase: TimelineElement = {
		...element,
		timeline: {
			...element.timeline,
			offset: leftOffset,
		},
	};
	const rightBase: TimelineElement = {
		...element,
		id: newId,
		timeline: {
			...element.timeline,
			offset: rightOffset,
		},
	};
	const left = updateElementTime(leftBase, originalStart, splitFrame, fps);
	const right = updateElementTime(rightBase, splitFrame, originalEnd, fps);
	return { left, right };
};
