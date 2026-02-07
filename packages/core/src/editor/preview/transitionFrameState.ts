import type { TimelineElement } from "../../dsl/types";
import type { TimelineTrack } from "../timeline/types";

export type ActiveTransitionFrameState = {
	id: string;
	component: string;
	fromId: string;
	toId: string;
	start: number;
	end: number;
	boundary: number;
	duration: number;
	head: number;
	tail: number;
	progress: number;
};

export type TransitionFrameState = {
	activeTransitions: ActiveTransitionFrameState[];
	hiddenElementIds: string[];
};

const clampProgress = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
};

const resolveTransitionDuration = (element: TimelineElement): number => {
	const durationFromMeta = element.transition?.duration;
	if (typeof durationFromMeta === "number" && Number.isFinite(durationFromMeta)) {
		return Math.max(0, Math.round(durationFromMeta));
	}
	const timelineDuration = element.timeline.end - element.timeline.start;
	if (!Number.isFinite(timelineDuration)) return 0;
	return Math.max(0, Math.round(timelineDuration));
};

const resolveTransitionDurationParts = (duration: number) => {
	const safeDuration = Math.max(0, Math.round(duration));
	const head = Math.floor(safeDuration / 2);
	const tail = safeDuration - head;
	return { duration: safeDuration, head, tail };
};

const resolveTransitionBoundary = (
	element: TimelineElement,
	parts: { head: number },
) => {
	const boundry = element.transition?.boundry;
	if (typeof boundry === "number" && Number.isFinite(boundry)) {
		return Math.round(boundry);
	}
	return Math.round((element.timeline.start ?? 0) + parts.head);
};

export const resolveTransitionFrameState = ({
	elements,
	displayTime,
	tracks,
	getTrackIndexForElement,
	isTransitionElement,
}: {
	elements: TimelineElement[];
	displayTime: number;
	tracks: TimelineTrack[];
	getTrackIndexForElement: (element: TimelineElement) => number;
	isTransitionElement: (element: TimelineElement) => boolean;
}): TransitionFrameState => {
	const elementsById = new Map(elements.map((el) => [el.id, el] as const));
	const activeTransitions: ActiveTransitionFrameState[] = [];
	const hiddenElementIds = new Set<string>();

	for (const element of elements) {
		if (!isTransitionElement(element)) continue;
		const trackIndex = getTrackIndexForElement(element);
		if (tracks[trackIndex]?.hidden) continue;
		const start = element.timeline.start ?? 0;
		const end = element.timeline.end ?? 0;
		if (displayTime < start || displayTime >= end) continue;

		const { fromId, toId } = element.transition ?? {};
		if (!fromId || !toId) continue;
		const fromElement = elementsById.get(fromId);
		const toElement = elementsById.get(toId);
		if (!fromElement || !toElement) continue;
		if (isTransitionElement(fromElement) || isTransitionElement(toElement)) {
			continue;
		}

		const duration = resolveTransitionDuration(element);
		const parts = resolveTransitionDurationParts(duration);
		const boundary = resolveTransitionBoundary(element, parts);
		const progress =
			parts.duration > 0
				? clampProgress((displayTime - start) / parts.duration)
				: 0;

		activeTransitions.push({
			id: element.id,
			component: element.component,
			fromId,
			toId,
			start,
			end,
			boundary,
			duration: parts.duration,
			head: parts.head,
			tail: parts.tail,
			progress,
		});
		hiddenElementIds.add(fromId);
		hiddenElementIds.add(toId);
	}

	return {
		activeTransitions,
		hiddenElementIds: Array.from(hiddenElementIds),
	};
};
