import type { TimelineElement } from "core/dsl/types";

type ClipKind = "AudioClip" | "VideoClip";

type ClipInfo = {
	id: string;
	type: ClipKind;
	uri: string;
	trackIndex: number;
	start: number;
	end: number;
	offset: number;
	reversed: boolean;
};

type ContinuityIndex = {
	audioById: Map<string, string>;
	videoById: Map<string, string>;
};

const continuityIndexCache = new WeakMap<
	readonly TimelineElement[],
	ContinuityIndex
>();

const normalizeInt = (value: unknown, fallback = 0): number => {
	if (!Number.isFinite(value as number)) return fallback;
	return Math.round(value as number);
};

const resolveOffset = (element: TimelineElement): number => {
	return Math.max(0, normalizeInt(element.timeline.offset, 0));
};

const resolveTrackIndex = (element: TimelineElement): number => {
	return normalizeInt(element.timeline.trackIndex, 0);
};

const hasMutedVideoSourceAudio = (element: TimelineElement): boolean => {
	return element.type === "VideoClip" && element.clip?.muteSourceAudio === true;
};

const resolveDuration = (element: TimelineElement): number => {
	const start = normalizeInt(element.timeline.start, 0);
	const end = normalizeInt(element.timeline.end, start);
	return Math.max(0, end - start);
};

const resolveTransitionBoundary = (element: TimelineElement): number => {
	const transition = element.transition;
	if (
		transition &&
		typeof transition.boundry === "number" &&
		Number.isFinite(transition.boundry)
	) {
		return Math.round(transition.boundry);
	}
	const start = normalizeInt(element.timeline.start, 0);
	const durationFromTransition =
		transition &&
		typeof transition.duration === "number" &&
		Number.isFinite(transition.duration)
			? Math.max(0, Math.round(transition.duration))
			: resolveDuration(element);
	return start + Math.floor(durationFromTransition / 2);
};

const sourceAtTimelineFrame = (
	clip: Pick<ClipInfo, "start" | "end" | "offset" | "reversed">,
	timelineFrame: number,
): number => {
	const duration = Math.max(0, clip.end - clip.start);
	if (clip.reversed) {
		return clip.offset + duration - (timelineFrame - clip.start);
	}
	return clip.offset + (timelineFrame - clip.start);
};

const buildTransitionBoundarySet = (elements: readonly TimelineElement[]) => {
	const set = new Set<string>();
	for (const element of elements) {
		if (element.type !== "Transition") continue;
		const transition = element.transition;
		if (!transition?.fromId || !transition?.toId) continue;
		const boundary = resolveTransitionBoundary(element);
		set.add(`${transition.fromId}|${transition.toId}|${boundary}`);
	}
	return set;
};

const hasBoundaryTransition = (
	boundarySet: Set<string>,
	prevId: string,
	nextId: string,
	boundary: number,
): boolean => {
	return boundarySet.has(`${prevId}|${nextId}|${boundary}`);
};

const isContinuous = (
	prev: ClipInfo,
	next: ClipInfo,
	boundarySet: Set<string>,
): boolean => {
	if (prev.end !== next.start) return false;
	if (hasBoundaryTransition(boundarySet, prev.id, next.id, prev.end)) {
		return false;
	}
	const prevSource = sourceAtTimelineFrame(prev, prev.end);
	const nextSource = sourceAtTimelineFrame(next, next.start);
	return prevSource === nextSource;
};

const compareClipOrder = (a: ClipInfo, b: ClipInfo): number => {
	if (a.start !== b.start) return a.start - b.start;
	if (a.end !== b.end) return a.end - b.end;
	return a.id.localeCompare(b.id);
};

const assignSessionKeysForGroup = (
	group: ClipInfo[],
	kind: "audio" | "video",
	target: Map<string, string>,
	boundarySet: Set<string>,
): void => {
	const sorted = [...group].sort(compareClipOrder);
	let chainHeadId: string | null = null;
	for (let index = 0; index < sorted.length; index += 1) {
		const current = sorted[index];
		if (index === 0) {
			chainHeadId = current.id;
		} else {
			const previous = sorted[index - 1];
			if (!previous || !chainHeadId) {
				chainHeadId = current.id;
			} else if (!isContinuous(previous, current, boundarySet)) {
				chainHeadId = current.id;
			}
		}
		const sessionKey =
			kind === "audio"
				? `audio|${current.uri}|${current.reversed}|${chainHeadId}`
				: `video|${current.trackIndex}|${current.uri}|${current.reversed}|${chainHeadId}`;
		target.set(current.id, sessionKey);
	}
};

const buildContinuityIndex = (
	elements: readonly TimelineElement[],
): ContinuityIndex => {
	const audioById = new Map<string, string>();
	const videoById = new Map<string, string>();
	const audioGroups = new Map<string, ClipInfo[]>();
	const videoGroups = new Map<string, ClipInfo[]>();
	const boundarySet = buildTransitionBoundarySet(elements);

	for (const element of elements) {
		if (element.type !== "AudioClip" && element.type !== "VideoClip") continue;
		const uri =
			typeof (element.props as { uri?: unknown } | undefined)?.uri === "string"
				? ((element.props as { uri?: string }).uri ?? "")
				: "";
		if (!uri) continue;

		const clipInfo: ClipInfo = {
			id: element.id,
			type: element.type,
			uri,
			trackIndex: resolveTrackIndex(element),
			start: normalizeInt(element.timeline.start, 0),
			end: normalizeInt(element.timeline.end, 0),
			offset: resolveOffset(element),
			reversed:
				element.type === "VideoClip"
					? Boolean(
							(element.props as { reversed?: unknown } | undefined)?.reversed,
						)
					: false,
		};

		if (!hasMutedVideoSourceAudio(element)) {
			const audioGroupKey = `${clipInfo.uri}|${clipInfo.reversed}`;
			const audioGroup = audioGroups.get(audioGroupKey);
			if (audioGroup) {
				audioGroup.push(clipInfo);
			} else {
				audioGroups.set(audioGroupKey, [clipInfo]);
			}
		}

		if (clipInfo.type !== "VideoClip") {
			continue;
		}

		const groupKey = `${clipInfo.trackIndex}|${clipInfo.uri}|${clipInfo.reversed}`;
		const group = videoGroups.get(groupKey);
		if (group) {
			group.push(clipInfo);
		} else {
			videoGroups.set(groupKey, [clipInfo]);
		}
	}

	for (const group of audioGroups.values()) {
		assignSessionKeysForGroup(group, "audio", audioById, boundarySet);
	}
	for (const group of videoGroups.values()) {
		assignSessionKeysForGroup(group, "video", videoById, boundarySet);
	}

	return { audioById, videoById };
};

const getContinuityIndex = (
	elements: readonly TimelineElement[],
): ContinuityIndex => {
	const cached = continuityIndexCache.get(elements);
	if (cached) return cached;
	const next = buildContinuityIndex(elements);
	continuityIndexCache.set(elements, next);
	return next;
};

export const getAudioPlaybackSessionKey = (
	elements: readonly TimelineElement[],
	clipId: string,
): string => {
	return getContinuityIndex(elements).audioById.get(clipId) ?? `clip:${clipId}`;
};

export const getVideoPlaybackSessionKey = (
	elements: readonly TimelineElement[],
	clipId: string,
): string => {
	return getContinuityIndex(elements).videoById.get(clipId) ?? `clip:${clipId}`;
};
