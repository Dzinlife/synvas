import { TimelineElement } from "@nle/dsl/types";
import { normalizeStoredTrackIndices } from "./trackAssignment";
import { updateElementTime } from "./timelineTime";
import { reconcileTransitions } from "./transitions";

const MAIN_TRACK_INDEX = 0;
const DEFAULT_FPS = 30;
const normalizeFps = (value?: number): number => {
	if (!Number.isFinite(value) || value === undefined || value <= 0) {
		return DEFAULT_FPS;
	}
	return Math.round(value);
};

export interface MainTrackMagnetOptions {
	attachments?: Map<string, string[]>;
	autoAttach?: boolean;
	fps?: number;
	trackLockedMap?: Map<number, boolean>;
}

export interface TimelinePostProcessOptions extends MainTrackMagnetOptions {
	mainTrackMagnetEnabled?: boolean;
}

function isMainTrackElement(element: TimelineElement): boolean {
	return (element.timeline.trackIndex ?? 0) === MAIN_TRACK_INDEX;
}

function sortMainTrackElements(elements: TimelineElement[]): TimelineElement[] {
	return elements
		.filter(isMainTrackElement)
		.filter((element) => element.type !== "Transition")
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
}

function buildAttachmentUpdates(
	elementsById: Map<string, TimelineElement>,
	parentDeltas: Map<string, number>,
	attachments?: Map<string, string[]>,
	autoAttach?: boolean,
	trackLockedMap?: Map<number, boolean>,
): Map<string, { start: number; end: number }> {
	const updates = new Map<string, { start: number; end: number }>();
	if (!autoAttach || !attachments) return updates;

	for (const [parentId, delta] of parentDeltas.entries()) {
		if (delta === 0) continue;
		const childIds = attachments.get(parentId) ?? [];
		for (const childId of childIds) {
			if (updates.has(childId)) continue;
			const child = elementsById.get(childId);
			if (!child) continue;
			const childTrackIndex = child.timeline.trackIndex ?? MAIN_TRACK_INDEX;
			if (trackLockedMap?.get(childTrackIndex)) {
				continue;
			}
			const nextStart = child.timeline.start + delta;
			const nextEnd = child.timeline.end + delta;
			if (nextStart < 0) continue;
			updates.set(childId, { start: nextStart, end: nextEnd });
		}
	}

	return updates;
}

function applyTimelineUpdates(
	elements: TimelineElement[],
	updates: Map<string, { start: number; end: number }>,
	fps: number,
): TimelineElement[] {
	let didChange = false;
	const next = elements.map((el) => {
		const update = updates.get(el.id);
		if (!update) return el;
		if (
			update.start === el.timeline.start &&
			update.end === el.timeline.end
		) {
			return el;
		}
		didChange = true;
		return updateElementTime(el, update.start, update.end, fps);
	});

	return didChange ? next : elements;
}

function reflowMainTrack(
	elements: TimelineElement[],
	orderedIds: string[],
	startAt: number,
	options: MainTrackMagnetOptions,
): TimelineElement[] {
	const elementsById = new Map(elements.map((el) => [el.id, el]));
	const updates = new Map<string, { start: number; end: number }>();
	const parentDeltas = new Map<string, number>();

	let cursor = startAt;
	for (const id of orderedIds) {
		const element = elementsById.get(id);
		if (!element) continue;
		const duration = element.timeline.end - element.timeline.start;
		const nextStart = cursor;
		const nextEnd = cursor + duration;
		cursor = nextEnd;
		updates.set(id, { start: nextStart, end: nextEnd });
		const delta = nextStart - element.timeline.start;
		if (delta !== 0) {
			parentDeltas.set(id, delta);
		}
	}

	const attachmentUpdates = buildAttachmentUpdates(
		elementsById,
		parentDeltas,
		options.attachments,
		options.autoAttach,
		options.trackLockedMap,
	);
	for (const [id, update] of attachmentUpdates.entries()) {
		if (!updates.has(id)) {
			updates.set(id, update);
		}
	}

	return applyTimelineUpdates(elements, updates, normalizeFps(options.fps));
}

export function compactMainTrackElements(
	elements: TimelineElement[],
	options: MainTrackMagnetOptions,
): TimelineElement[] {
	const ordered = sortMainTrackElements(elements);
	if (ordered.length === 0) return elements;
	const startAt = 0;
	const orderedIds = ordered.map((el) => el.id);
	return reflowMainTrack(elements, orderedIds, startAt, options);
}

export function finalizeTimelineElements(
	elements: TimelineElement[],
	options: TimelinePostProcessOptions = {},
): TimelineElement[] {
	let normalized = normalizeStoredTrackIndices(elements);
	if (options.mainTrackMagnetEnabled) {
		normalized = compactMainTrackElements(normalized, {
			attachments: options.attachments,
			autoAttach: options.autoAttach,
			fps: options.fps,
			trackLockedMap: options.trackLockedMap,
		});
	}
	normalized = reconcileTransitions(normalized, options.fps);
	if (options.fps === undefined) {
		return normalized;
	}
	const fps = normalizeFps(options.fps);
	let didChange = false;
	const withTimecodes = normalized.map((el) => {
		const updated = updateElementTime(
			el,
			el.timeline.start,
			el.timeline.end,
			fps,
		);
		if (updated !== el) {
			didChange = true;
		}
		return updated;
	});
	return didChange ? withTimecodes : normalized;
}

export function shiftMainTrackElementsAfter(
	elements: TimelineElement[],
	targetId: string,
	newEnd: number,
	delta: number,
	options: TimelinePostProcessOptions,
): TimelineElement[] {
	const ordered = sortMainTrackElements(elements);
	if (ordered.length === 0) return elements;
	const targetIndex = ordered.findIndex((el) => el.id === targetId);
	if (targetIndex === -1) {
		return elements;
	}

	const elementsById = new Map(elements.map((el) => [el.id, el]));
	const updates = new Map<string, { start: number; end: number }>();
	const parentDeltas = new Map<string, number>();

	const target = ordered[targetIndex];
	updates.set(targetId, { start: target.timeline.start, end: newEnd });

	if (delta !== 0) {
		for (let i = targetIndex + 1; i < ordered.length; i++) {
			const element = ordered[i];
			const nextStart = element.timeline.start + delta;
			const nextEnd = element.timeline.end + delta;
			updates.set(element.id, { start: nextStart, end: nextEnd });
			parentDeltas.set(element.id, delta);
		}
	}

	const attachmentUpdates = buildAttachmentUpdates(
		elementsById,
		parentDeltas,
		options.attachments,
		options.autoAttach,
		options.trackLockedMap,
	);
	for (const [id, update] of attachmentUpdates.entries()) {
		if (!updates.has(id)) {
			updates.set(id, update);
		}
	}

	const updated = applyTimelineUpdates(
		elements,
		updates,
		normalizeFps(options.fps),
	);
	const magnetEnabled = options.mainTrackMagnetEnabled ?? true;
	return finalizeTimelineElements(updated, {
		mainTrackMagnetEnabled: magnetEnabled,
		attachments: options.attachments,
		autoAttach: options.autoAttach,
		fps: options.fps,
	});
}

export function reorderMainTrackElementsByInsert(
	elements: TimelineElement[],
	targetId: string,
	dropStart: number,
	options: TimelinePostProcessOptions,
): TimelineElement[] {
	const ordered = sortMainTrackElements(elements);
	if (ordered.length <= 1) {
		// 单元素也需要执行主轨磁吸归一化
		return finalizeTimelineElements(elements, options);
	}
	const target = ordered.find((el) => el.id === targetId);
	if (!target) return elements;

	const duration = target.timeline.end - target.timeline.start;
	const dropCenter = dropStart + duration / 2;
	const others = ordered.filter((el) => el.id !== targetId);

	let insertIndex = others.findIndex((el) => {
		const center =
			el.timeline.start + (el.timeline.end - el.timeline.start) / 2;
		return center > dropCenter;
	});
	if (insertIndex < 0) {
		insertIndex = others.length;
	}

	const newOrder = [
		...others.slice(0, insertIndex),
		target,
		...others.slice(insertIndex),
	];
	const startAt = ordered[0].timeline.start;
	const orderedIds = newOrder.map((el) => el.id);
	const updated = reflowMainTrack(elements, orderedIds, startAt, options);
	const magnetEnabled = options.mainTrackMagnetEnabled ?? true;
	return finalizeTimelineElements(updated, {
		mainTrackMagnetEnabled: magnetEnabled,
		attachments: options.attachments,
		autoAttach: options.autoAttach,
		fps: options.fps,
	});
}

export function insertElementIntoMainTrack(
	elements: TimelineElement[],
	targetId: string,
	dropStart: number,
	options: TimelinePostProcessOptions,
	targetOverride?: TimelineElement,
): TimelineElement[] {
	let updated = elements;
	let target = updated.find((el) => el.id === targetId) ?? null;

	if (!target && targetOverride) {
		updated = [...updated, targetOverride];
		target = targetOverride;
	}

	if (!target) {
		return elements;
	}

	if ((target.timeline.trackIndex ?? 0) !== MAIN_TRACK_INDEX) {
		updated = updated.map((el) =>
			el.id === targetId
				? {
						...el,
						timeline: {
							...el.timeline,
							trackIndex: MAIN_TRACK_INDEX,
						},
					}
				: el,
		);
	}

	return reorderMainTrackElementsByInsert(
		updated,
		targetId,
		dropStart,
		options,
	);
}

export function insertElementsIntoMainTrackGroup(
	elements: TimelineElement[],
	targetIds: string[],
	dropStart: number,
	options: TimelinePostProcessOptions,
): TimelineElement[] {
	if (targetIds.length === 0)
		return finalizeTimelineElements(elements, options);
	const targetSet = new Set(targetIds);

	const updated = elements.map((el) =>
		targetSet.has(el.id)
			? {
					...el,
					timeline: {
						...el.timeline,
						trackIndex: MAIN_TRACK_INDEX,
					},
				}
			: el,
	);

	const ordered = sortMainTrackElements(updated);
	const selected = ordered.filter((el) => targetSet.has(el.id));
	if (selected.length === 0) {
		return finalizeTimelineElements(updated, options);
	}

	const others = ordered.filter((el) => !targetSet.has(el.id));
	const groupDuration = selected.reduce(
		(sum, el) => sum + (el.timeline.end - el.timeline.start),
		0,
	);
	const dropCenter = dropStart + groupDuration / 2;

	let insertIndex = others.findIndex((el) => {
		const center =
			el.timeline.start + (el.timeline.end - el.timeline.start) / 2;
		return center > dropCenter;
	});
	if (insertIndex < 0) {
		insertIndex = others.length;
	}

	const newOrder = [
		...others.slice(0, insertIndex),
		...selected,
		...others.slice(insertIndex),
	];
	const orderedIds = newOrder.map((el) => el.id);
	const reflowed = reflowMainTrack(updated, orderedIds, 0, options);

	return finalizeTimelineElements(reflowed, {
		mainTrackMagnetEnabled: options.mainTrackMagnetEnabled ?? true,
		attachments: options.attachments,
		autoAttach: options.autoAttach,
	});
}
