import { TimelineElement } from "../../dsl/types";
import { updateElementTime } from "./timelineTime";
import {
	getElementRole,
	MAIN_TRACK_INDEX,
	type TrackRoleOptions,
} from "./trackAssignment";

interface TransitionLink {
	fromId: string;
	toId: string;
	boundary: number;
	trackIndex: number;
	trackId?: string;
}

const DEFAULT_FPS = 30;
const DEFAULT_TRANSITION_DURATION = 15;

const normalizeFps = (value?: number): number => {
	if (!Number.isFinite(value) || value === undefined || value <= 0) {
		return DEFAULT_FPS;
	}
	return Math.round(value);
};

export const TRANSITION_TYPE = "Transition";

export const isTransitionElement = (element: TimelineElement): boolean =>
	element.type === TRANSITION_TYPE;

export const getTransitionDuration = (element: TimelineElement): number => {
	if (!isTransitionElement(element)) return 0;
	const metaDuration = element.transition?.duration;
	const timelineDuration = element.timeline.end - element.timeline.start;
	const value =
		metaDuration ??
		(Number.isFinite(timelineDuration) && timelineDuration > 0
			? timelineDuration
			: DEFAULT_TRANSITION_DURATION);
	if (!Number.isFinite(value)) return DEFAULT_TRANSITION_DURATION;
	return Math.max(0, Math.round(value));
};

export const getTransitionBoundary = (element: TimelineElement): number => {
	if (!isTransitionElement(element)) return 0;
	const boundry = element.transition?.boundry;
	if (!Number.isFinite(boundry)) {
		const { head } = getTransitionDurationParts(getTransitionDuration(element));
		return (element.timeline.start ?? 0) + head;
	}
	return Math.round(boundry!);
};

export const getTransitionDurationParts = (
	duration: number,
): { duration: number; head: number; tail: number } => {
	const safeDuration = Math.max(0, Math.round(duration));
	const head = Math.floor(safeDuration / 2);
	const tail = safeDuration - head;
	return { duration: safeDuration, head, tail };
};

const resolveTransitionRange = (boundary: number, duration: number) => {
	const { head, tail } = getTransitionDurationParts(duration);
	return { start: boundary - head, end: boundary + tail, head, tail };
};

export const getTransitionRange = (
	element: TimelineElement,
): {
	start: number;
	end: number;
	duration: number;
	boundary: number;
	head: number;
	tail: number;
} => {
	const duration = getTransitionDuration(element);
	const boundary = getTransitionBoundary(element);
	const { start, end, head, tail } = resolveTransitionRange(boundary, duration);
	return {
		start,
		end,
		duration,
		boundary,
		head,
		tail,
	};
};
const isClipElement = (
	element: TimelineElement,
	options?: TrackRoleOptions,
): boolean =>
	getElementRole(element, options) === "clip" && !isTransitionElement(element);

const sortByTimeline = (a: TimelineElement, b: TimelineElement): number => {
	if (a.timeline.start !== b.timeline.start) {
		return a.timeline.start - b.timeline.start;
	}
	if (a.timeline.end !== b.timeline.end) {
		return a.timeline.end - b.timeline.end;
	}
	return a.id.localeCompare(b.id);
};

const getTransitionLinkFromMeta = (
	element: TimelineElement,
): { fromId?: string; toId?: string; boundry?: number } => {
	const meta = element.transition;
	if (!meta) return {};
	const fromId = typeof meta.fromId === "string" ? meta.fromId : undefined;
	const toId = typeof meta.toId === "string" ? meta.toId : undefined;
	const boundry =
		typeof meta.boundry === "number" ? Math.round(meta.boundry) : undefined;
	return { fromId, toId, boundry };
};

const resolvePairTrackId = (
	prev: TimelineElement,
	next: TimelineElement,
): string | undefined => {
	const prevId = prev.timeline.trackId;
	const nextId = next.timeline.trackId;
	if (prevId && nextId && prevId !== nextId) return undefined;
	return prevId ?? nextId;
};

const buildClipPairs = (
	elements: TimelineElement[],
	options?: TrackRoleOptions,
) => {
	const clipsByTrack = new Map<number, TimelineElement[]>();
	for (const clip of elements.filter((el) => isClipElement(el, options))) {
		const trackIndex = clip.timeline.trackIndex ?? MAIN_TRACK_INDEX;
		const bucket = clipsByTrack.get(trackIndex);
		if (bucket) {
			bucket.push(clip);
		} else {
			clipsByTrack.set(trackIndex, [clip]);
		}
	}

	const pairs: TransitionLink[] = [];
	for (const [trackIndex, clips] of clipsByTrack.entries()) {
		const ordered = clips.slice().sort(sortByTimeline);
		for (let i = 0; i < ordered.length - 1; i += 1) {
			const prev = ordered[i];
			const next = ordered[i + 1];
			if (prev.timeline.end !== next.timeline.start) continue;
			pairs.push({
				fromId: prev.id,
				toId: next.id,
				boundary: prev.timeline.end,
				trackIndex,
				trackId: resolvePairTrackId(prev, next),
			});
		}
	}
	return pairs;
};

const ensureTransitionTimeline = (
	transition: TimelineElement,
	link: TransitionLink,
	fps: number,
): TimelineElement => {
	const duration = getTransitionDuration(transition);
	const { start, end } = resolveTransitionRange(link.boundary, duration);
	let next = transition;
	if (transition.timeline.start !== start || transition.timeline.end !== end) {
		next = updateElementTime(transition, start, end, fps);
	}

	let timelineChanged = false;
	let updatedTimeline = next.timeline;

	if ((updatedTimeline.trackIndex ?? MAIN_TRACK_INDEX) !== link.trackIndex) {
		updatedTimeline = {
			...updatedTimeline,
			trackIndex: link.trackIndex,
		};
		timelineChanged = true;
	}

	if (link.trackId && updatedTimeline.trackId !== link.trackId) {
		updatedTimeline = {
			...updatedTimeline,
			trackId: link.trackId,
		};
		timelineChanged = true;
	}

	if (updatedTimeline.role !== "clip") {
		updatedTimeline = {
			...updatedTimeline,
			role: "clip",
		};
		timelineChanged = true;
	}

	if (timelineChanged) {
		next = {
			...next,
			timeline: updatedTimeline,
		};
	}

	return next;
};

const resolveTransitionLink = (
	element: TimelineElement,
	pairsById: Map<string, TransitionLink>,
): TransitionLink | null => {
	const { fromId, toId } = getTransitionLinkFromMeta(element);
	if (fromId && toId) {
		return pairsById.get(`${fromId}::${toId}`) ?? null;
	}
	return null;
};

const buildTransitionDurationLimiter = (
	elements: TimelineElement[],
	pairsById: Map<string, TransitionLink>,
	options?: TrackRoleOptions,
) => {
	const clipsById = new Map<string, TimelineElement>();
	for (const el of elements) {
		if (!isClipElement(el, options)) continue;
		clipsById.set(el.id, el);
	}

	const incomingTailByClipId = new Map<string, number>();
	const outgoingHeadByClipId = new Map<string, number>();

	for (const el of elements) {
		if (!isTransitionElement(el)) continue;
		const link = resolveTransitionLink(el, pairsById);
		if (!link) continue;
		const { head, tail } = getTransitionDurationParts(
			getTransitionDuration(el),
		);
		const fromClip = clipsById.get(link.fromId);
		const toClip = clipsById.get(link.toId);
		if (fromClip && link.boundary === fromClip.timeline.end) {
			const current = outgoingHeadByClipId.get(fromClip.id) ?? 0;
			if (head > current) {
				outgoingHeadByClipId.set(fromClip.id, head);
			}
		}
		if (toClip && link.boundary === toClip.timeline.start) {
			const current = incomingTailByClipId.get(toClip.id) ?? 0;
			if (tail > current) {
				incomingTailByClipId.set(toClip.id, tail);
			}
		}
	}

	const getMaxDuration = (
		link: TransitionLink,
		transition: TimelineElement,
	): number => {
		const fromClip = clipsById.get(link.fromId);
		const toClip = clipsById.get(link.toId);
		if (!fromClip || !toClip) {
			return getTransitionDuration(transition);
		}
		const fromLength = Math.max(
			0,
			fromClip.timeline.end - fromClip.timeline.start,
		);
		const toLength = Math.max(0, toClip.timeline.end - toClip.timeline.start);
		const incomingTail = incomingTailByClipId.get(fromClip.id) ?? 0;
		const outgoingHead = outgoingHeadByClipId.get(toClip.id) ?? 0;
		const maxHead = Math.max(0, fromLength - incomingTail);
		const maxTail = Math.max(0, toLength - outgoingHead);
		// 限制转场时长，避免超过相邻片段或与其他转场重叠
		const maxDuration = Math.min(maxTail * 2, maxHead * 2 + 1);
		return Math.max(0, Math.round(maxDuration));
	};

	return { getMaxDuration };
};

export const collectLinkedTransitions = (
	elements: TimelineElement[],
	selectedIds: string[],
	options?: TrackRoleOptions,
): string[] => {
	if (selectedIds.length < 2) return selectedIds;

	const selectedSet = new Set(selectedIds);
	const pairs = buildClipPairs(elements, options);
	const transitions = elements.filter(isTransitionElement);

	if (transitions.length === 0 || pairs.length === 0) {
		return selectedIds;
	}

	const transitionsByPair = new Map<string, TimelineElement[]>();

	for (const transition of transitions) {
		const { fromId, toId } = getTransitionLinkFromMeta(transition);
		if (!fromId || !toId) continue;
		const key = `${fromId}::${toId}`;
		const list = transitionsByPair.get(key) ?? [];
		list.push(transition);
		transitionsByPair.set(key, list);
	}

	const extraIds = new Set<string>();
	for (const pair of pairs) {
		if (!selectedSet.has(pair.fromId) || !selectedSet.has(pair.toId)) {
			continue;
		}
		const key = `${pair.fromId}::${pair.toId}`;
		const matched = transitionsByPair.get(key);
		if (matched && matched.length > 0) {
			for (const transition of matched) {
				extraIds.add(transition.id);
			}
		}
	}

	if (extraIds.size === 0) return selectedIds;
	return Array.from(new Set([...selectedIds, ...extraIds]));
};

export const reconcileTransitions = (
	elements: TimelineElement[],
	fps?: number,
	options?: TrackRoleOptions,
): TimelineElement[] => {
	const transitions = elements.filter(isTransitionElement);
	if (transitions.length === 0) return elements;

	const pairs = buildClipPairs(elements, options);
	if (pairs.length === 0) {
		const filtered = elements.filter((el) => !isTransitionElement(el));
		return filtered.length === elements.length ? elements : filtered;
	}

	const pairsById = new Map<string, TransitionLink>();
	for (const pair of pairs) {
		pairsById.set(`${pair.fromId}::${pair.toId}`, pair);
	}

	const fpsValue = normalizeFps(fps);
	const durationLimiter = buildTransitionDurationLimiter(
		elements,
		pairsById,
		options,
	);
	const usedPairs = new Set<string>();
	let didChange = false;
	const next: TimelineElement[] = [];

	for (const element of elements) {
		if (!isTransitionElement(element)) {
			next.push(element);
			continue;
		}

		const link = resolveTransitionLink(element, pairsById);
		if (!link) {
			didChange = true;
			continue;
		}

		const pairKey = `${link.fromId}::${link.toId}`;
		if (usedPairs.has(pairKey)) {
			didChange = true;
			continue;
		}
		usedPairs.add(pairKey);

		let updated = element;
		const currentDuration = getTransitionDuration(element);
		const nextTransition = {
			duration: currentDuration,
			boundry: link.boundary,
			fromId: link.fromId,
			toId: link.toId,
		};
		if (
			element.transition?.fromId !== link.fromId ||
			element.transition?.toId !== link.toId ||
			element.transition?.boundry !== link.boundary ||
			element.transition?.duration !== currentDuration
		) {
			updated = {
				...updated,
				transition: nextTransition,
			};
			didChange = true;
		}

		const normalized = ensureTransitionTimeline(updated, link, fpsValue);
		if (normalized !== updated) {
			didChange = true;
		}

		const maxDuration = durationLimiter.getMaxDuration(link, normalized);
		const normalizedDuration = getTransitionDuration(normalized);
		if (normalizedDuration > maxDuration) {
			const { start, end } = resolveTransitionRange(link.boundary, maxDuration);
			next.push(
				updateElementTime(
					{
						...normalized,
						transition: {
							duration: maxDuration,
							boundry: link.boundary,
							fromId: link.fromId,
							toId: link.toId,
						},
					},
					start,
					end,
					fpsValue,
				),
			);
			didChange = true;
			continue;
		}

		next.push(normalized);
	}

	return didChange ? next : elements;
};
