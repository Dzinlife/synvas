import type { TimelineElement } from "core/dsl/types";
import type { FreezeFrameProps } from "@/dsl/FreezeFrame/model";
import { calculateVideoTime } from "@/dsl/VideoClip/model";
import { framesToSeconds, secondsToFrames } from "@/utils/timecode";
import { insertElementIntoMainTrack } from "../utils/mainTrackMagnet";
import { buildTimelineMeta } from "../utils/timelineTime";
import { reflowInsertedElementsOnTracks } from "../utils/insertedTrackReflow";
import { isTransitionElement, reconcileTransitions } from "../utils/transitions";
import { buildSplitElements } from "core/editor/command/split";

const MAIN_TRACK_INDEX = 0;
const DEFAULT_FREEZE_DURATION_SECONDS = 3;

type FreezeCandidate = TimelineElement<{
	reversed?: boolean;
}>;

const isFreezeCandidateElement = (
	element: TimelineElement | null,
	currentTime: number,
): element is FreezeCandidate => {
	if (!element || element.type !== "VideoClip") return false;
	if (!element.assetId) return false;
	if (currentTime <= element.timeline.start) return false;
	if (currentTime >= element.timeline.end) return false;
	return true;
};

const remapTransitionsAfterSplit = (
	elements: TimelineElement[],
	options: {
		clipId: string;
		rightClipId: string;
		originalEnd: number;
	},
): TimelineElement[] => {
	const { clipId, rightClipId, originalEnd } = options;
	let didChange = false;
	const next = elements.map((element) => {
		if (!isTransitionElement(element)) return element;
		const transition = element.transition;
		if (!transition) return element;
		if (transition.fromId !== clipId) return element;
		if (transition.boundry !== originalEnd) return element;
		didChange = true;
		return {
			...element,
			transition: {
				...transition,
				fromId: rightClipId,
			},
		};
	});
	return didChange ? next : elements;
};

export const resolveFreezeCandidate = (options: {
	elements: TimelineElement[];
	selectedIds: string[];
	primaryId: string | null;
	currentTime: number;
}): FreezeCandidate | null => {
	if (!options.primaryId) return null;
	if (options.selectedIds.length !== 1) return null;
	const target =
		options.elements.find((el) => el.id === options.primaryId) ?? null;
	if (!isFreezeCandidateElement(target, options.currentTime)) return null;
	return target;
};

export const applyFreezeFrame = (options: {
	elements: TimelineElement[];
	candidate: FreezeCandidate;
	splitFrame: number;
	fps: number;
	rippleEditingEnabled: boolean;
	attachments?: Map<string, string[]>;
	autoAttach?: boolean;
	trackLockedMap?: Map<number, boolean>;
	createElementId: () => string;
}): TimelineElement[] => {
	const {
		elements,
		candidate,
		fps,
		rippleEditingEnabled,
		attachments,
		autoAttach,
		trackLockedMap,
		createElementId,
	} = options;
	const splitFrame = Math.max(0, Math.round(options.splitFrame));
	const targetIndex = elements.findIndex((el) => el.id === candidate.id);
	if (targetIndex < 0) return elements;
	const target = elements[targetIndex];
	if (!isFreezeCandidateElement(target, splitFrame)) return elements;

	const rightClipId = createElementId();
	const freezeId = createElementId();
	const freezeDurationFrames = Math.max(
		1,
		secondsToFrames(DEFAULT_FREEZE_DURATION_SECONDS, fps),
	);
	const { left, right } = buildSplitElements(target, splitFrame, fps, rightClipId);
	const startSeconds = framesToSeconds(target.timeline.start, fps);
	const splitSeconds = framesToSeconds(splitFrame, fps);
	const offsetSeconds = framesToSeconds(target.timeline.offset ?? 0, fps);
	const clipDuration = framesToSeconds(
		target.timeline.end - target.timeline.start,
		fps,
	);
	const sourceTime = calculateVideoTime({
		start: startSeconds,
		timelineTime: splitSeconds,
		videoDuration: Number.POSITIVE_INFINITY,
		reversed: Boolean(target.props.reversed),
		offset: offsetSeconds,
		clipDuration,
	});
	const sourceFrame = secondsToFrames(sourceTime, fps);

	const freezeElement: TimelineElement<FreezeFrameProps> = {
		id: freezeId,
		type: "FreezeFrame",
		component: "freeze-frame",
		name: "定格",
		assetId: target.assetId,
		props: {
			sourceElementId: target.id,
			sourceFrame,
			sourceTime,
		},
		...(target.transform ? { transform: target.transform } : {}),
		...(target.render ? { render: target.render } : {}),
		timeline: buildTimelineMeta(
			{
				start: splitFrame,
				end: splitFrame + freezeDurationFrames,
				trackIndex: target.timeline.trackIndex ?? 0,
				...(target.timeline.trackId
					? { trackId: target.timeline.trackId }
					: {}),
				role: target.timeline.role ?? "clip",
			},
			fps,
		),
	};

	const next = [...elements];
	next[targetIndex] = left;
	next.splice(targetIndex + 1, 0, freezeElement, right);
	const remapped = remapTransitionsAfterSplit(next, {
		clipId: target.id,
		rightClipId,
		originalEnd: target.timeline.end,
	});

	const isMainTrack = (target.timeline.trackIndex ?? 0) === MAIN_TRACK_INDEX;
	if (isMainTrack && rippleEditingEnabled) {
		return insertElementIntoMainTrack(
			remapped,
			freezeId,
			splitFrame - freezeDurationFrames / 2,
			{
				rippleEditingEnabled: true,
				attachments,
				autoAttach,
				fps,
				trackLockedMap,
			},
		);
	}

	const insertedSet = new Set([freezeId, rightClipId]);
	const baseElements = remapped.filter((element) => !insertedSet.has(element.id));
	const insertedElements = remapped.filter((element) =>
		insertedSet.has(element.id),
	);
	const reflowedInserted = reflowInsertedElementsOnTracks(
		baseElements,
		insertedElements,
	);
	const insertedById = new Map(
		reflowedInserted.map((element) => [element.id, element]),
	);
	const merged = remapped.map(
		(element) => insertedById.get(element.id) ?? element,
	);
	return reconcileTransitions(merged, fps);
};
