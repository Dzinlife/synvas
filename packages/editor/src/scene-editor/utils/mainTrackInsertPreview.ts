import type { TimelineElement } from "core/element/types";
import { getElementRole } from "./trackAssignment";

export type MainTrackPreviewMode = "box" | "insert-line";

export interface MainTrackDropPreview {
	mode: MainTrackPreviewMode;
	insertTime: number;
}

interface ResolveMainTrackDropPreviewOptions {
	excludeElementIds?: Iterable<string>;
}

const normalizeInsertTime = (insertPointerTime: number): number => {
	if (!Number.isFinite(insertPointerTime)) return 0;
	return Math.max(0, Math.round(insertPointerTime));
};

const getMainTrackClips = (
	elements: TimelineElement[],
	excludedIds: Set<string>,
): TimelineElement[] =>
	elements
		.filter((element) => (element.timeline.trackIndex ?? 0) === 0)
		.filter((element) => element.type !== "Transition")
		.filter((element) => getElementRole(element) === "clip")
		.filter((element) => !excludedIds.has(element.id))
		.slice()
		.sort((a, b) => {
			if (a.timeline.start !== b.timeline.start) {
				return a.timeline.start - b.timeline.start;
			}
			if (a.timeline.end !== b.timeline.end) {
				return a.timeline.end - b.timeline.end;
			}
			return a.id.localeCompare(b.id);
		});

export const resolveMainTrackDropPreview = (
	elements: TimelineElement[],
	insertPointerTime: number,
	options: ResolveMainTrackDropPreviewOptions = {},
): MainTrackDropPreview => {
	const decisionTime = normalizeInsertTime(insertPointerTime);
	const excludedIds = new Set(options.excludeElementIds ?? []);
	const clips = getMainTrackClips(elements, excludedIds);
	let insertIndex = clips.findIndex((clip) => {
		const center =
			clip.timeline.start + (clip.timeline.end - clip.timeline.start) / 2;
		return center > decisionTime;
	});
	if (insertIndex < 0) {
		insertIndex = clips.length;
	}
	const nextClip = insertIndex < clips.length ? clips[insertIndex] : null;
	if (nextClip) {
		return { mode: "insert-line", insertTime: nextClip.timeline.start };
	}
	const tailTime = clips.length > 0 ? clips[clips.length - 1].timeline.end : 0;
	return { mode: "box", insertTime: tailTime };
};
