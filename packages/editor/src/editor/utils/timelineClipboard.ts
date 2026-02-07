import type { TimelineElement } from "@/dsl/types";
import { cloneValue, createCopySeed } from "./copyUtils";
import {
	type TimelinePostProcessOptions,
	finalizeTimelineElements,
} from "./mainTrackMagnet";
import {
	findAvailableTrack,
	getElementRole,
	getStoredTrackAssignments,
	getTrackCount,
	insertTrackAt,
	resolveDropTargetForRole,
} from "./trackAssignment";
import { collectLinkedTransitions, isTransitionElement } from "./transitions";

interface TimelineClipboardAnchor {
	sourceId: string | null;
	start: number;
	trackIndex: number;
}

export interface TimelineClipboardPayload {
	elements: TimelineElement[];
	primaryId: string | null;
	anchor: TimelineClipboardAnchor;
}

export interface BuildTimelineClipboardOptions {
	elements: TimelineElement[];
	selectedIds: string[];
	primaryId?: string | null;
}

export interface PasteTimelineClipboardOptions {
	payload: TimelineClipboardPayload;
	elements: TimelineElement[];
	targetTime: number;
	targetTrackIndex?: number;
	targetType?: "track" | "gap";
	postProcessOptions?: TimelinePostProcessOptions;
}

export interface PasteTimelineClipboardResult {
	elements: TimelineElement[];
	insertedIds: string[];
	primaryId: string | null;
}

const cloneTimelineElement = (element: TimelineElement): TimelineElement => {
	return {
		...element,
		props: cloneValue(element.props),
		transform: cloneValue(element.transform),
		render: cloneValue(element.render),
		timeline: cloneValue(element.timeline),
		...(element.clip ? { clip: cloneValue(element.clip) } : {}),
		...(element.transition
			? { transition: cloneValue(element.transition) }
			: {}),
	};
};

const getTrackIndex = (element: TimelineElement): number => {
	return element.timeline.trackIndex ?? 0;
};

const sortByTimeline = (a: TimelineElement, b: TimelineElement): number => {
	if (a.timeline.start !== b.timeline.start) {
		return a.timeline.start - b.timeline.start;
	}
	if (a.timeline.end !== b.timeline.end) {
		return a.timeline.end - b.timeline.end;
	}
	return a.id.localeCompare(b.id);
};

export const buildTimelineClipboardPayload = (
	options: BuildTimelineClipboardOptions,
): TimelineClipboardPayload | null => {
	if (options.selectedIds.length === 0) return null;

	const selectedSet = new Set(options.selectedIds);
	const copiedIds = collectLinkedTransitions(
		options.elements,
		options.selectedIds,
	);
	const copiedSet = new Set(copiedIds);
	const copiedElements = options.elements.filter((el) => copiedSet.has(el.id));
	if (copiedElements.length === 0) return null;

	const elementsById = new Map(copiedElements.map((el) => [el.id, el]));
	const fallbackAnchor =
		copiedElements.slice().sort((a, b) => {
			const selectedA = selectedSet.has(a.id) ? 0 : 1;
			const selectedB = selectedSet.has(b.id) ? 0 : 1;
			if (selectedA !== selectedB) return selectedA - selectedB;
			return sortByTimeline(a, b);
		})[0] ?? null;
	const resolvedPrimary =
		options.primaryId && copiedSet.has(options.primaryId)
			? options.primaryId
			: (fallbackAnchor?.id ?? null);
	const anchorElement =
		(resolvedPrimary ? elementsById.get(resolvedPrimary) : undefined) ??
		fallbackAnchor;

	if (!anchorElement) return null;

	return {
		elements: copiedElements.map((element) => cloneTimelineElement(element)),
		primaryId: resolvedPrimary,
		anchor: {
			sourceId: anchorElement.id,
			start: anchorElement.timeline.start,
			trackIndex: getTrackIndex(anchorElement),
		},
	};
};

const createPastedElement = (
	source: TimelineElement,
	nextId: string,
	idMap: Map<string, string>,
	deltaTime: number,
	deltaTrack: number,
): TimelineElement => {
	const cloned = cloneTimelineElement(source);
	const nextTransition = cloned.transition
		? cloneValue(cloned.transition)
		: undefined;

	if (nextTransition && isTransitionElement(source)) {
		const mappedFromId =
			typeof nextTransition.fromId === "string"
				? (idMap.get(nextTransition.fromId) ?? nextTransition.fromId)
				: nextTransition.fromId;
		const mappedToId =
			typeof nextTransition.toId === "string"
				? (idMap.get(nextTransition.toId) ?? nextTransition.toId)
				: nextTransition.toId;
		nextTransition.fromId = mappedFromId;
		nextTransition.toId = mappedToId;
	}

	return {
		...cloned,
		id: nextId,
		timeline: {
			...cloned.timeline,
			start: cloned.timeline.start + deltaTime,
			end: cloned.timeline.end + deltaTime,
			trackIndex: getTrackIndex(cloned) + deltaTrack,
		},
		...(nextTransition ? { transition: nextTransition } : {}),
	};
};

const shiftElementsForGapInsert = (
	elements: TimelineElement[],
	insertTrackIndex: number,
): TimelineElement[] => {
	const assignments = getStoredTrackAssignments(elements);
	const updatedAssignments = insertTrackAt(insertTrackIndex, assignments);
	let didChange = false;
	const shifted = elements.map((element) => {
		const nextTrack = updatedAssignments.get(element.id);
		if (nextTrack === undefined || nextTrack === element.timeline.trackIndex) {
			return element;
		}
		didChange = true;
		return {
			...element,
			timeline: {
				...element.timeline,
				trackIndex: nextTrack,
			},
		};
	});
	return didChange ? shifted : elements;
};

const reconcilePastedElementTracks = (
	baseElements: TimelineElement[],
	pastedElements: TimelineElement[],
): TimelineElement[] => {
	if (pastedElements.length === 0) return pastedElements;

	const reconciled = pastedElements.map((element) => element);
	const orderedPastedIds = reconciled
		.slice()
		.sort(sortByTimeline)
		.map((element) => element.id);

	for (const elementId of orderedPastedIds) {
		const targetIndex = reconciled.findIndex(
			(element) => element.id === elementId,
		);
		if (targetIndex < 0) continue;
		const target = reconciled[targetIndex];
		const merged = [...baseElements, ...reconciled];
		const assignments = getStoredTrackAssignments(merged);
		const role = getElementRole(target);
		const resolvedDropTarget = resolveDropTargetForRole(
			{
				type: "track",
				trackIndex: getTrackIndex(target),
			},
			role,
			merged,
			assignments,
		);
		const finalTrack = findAvailableTrack(
			target.timeline.start,
			target.timeline.end,
			resolvedDropTarget.trackIndex,
			role,
			merged,
			assignments,
			target.id,
			getTrackCount(assignments),
		);
		reconciled[targetIndex] = {
			...target,
			timeline: {
				...target.timeline,
				trackIndex: finalTrack,
			},
		};
	}

	return reconciled;
};

export const pasteTimelineClipboardPayload = (
	options: PasteTimelineClipboardOptions,
): PasteTimelineClipboardResult => {
	const sourceElements = options.payload.elements;
	if (sourceElements.length === 0) {
		return {
			elements: options.elements,
			insertedIds: [],
			primaryId: null,
		};
	}

	const targetTime = Math.max(0, Math.round(options.targetTime));
	const targetTrackIndex = Math.round(
		options.targetTrackIndex ?? options.payload.anchor.trackIndex,
	);
	const deltaTime = targetTime - options.payload.anchor.start;
	const deltaTrack = targetTrackIndex - options.payload.anchor.trackIndex;
	const seed = createCopySeed();
	const idMap = new Map<string, string>();
	sourceElements.forEach((source, index) => {
		idMap.set(source.id, `element-${seed}-${index}`);
	});

	let pastedElements = sourceElements.map((source) => {
		const nextId = idMap.get(source.id) ?? source.id;
		return createPastedElement(source, nextId, idMap, deltaTime, deltaTrack);
	});

	const minStart = pastedElements.reduce(
		(minValue, element) => Math.min(minValue, element.timeline.start),
		Number.POSITIVE_INFINITY,
	);
	if (minStart < 0) {
		const shift = -minStart;
		pastedElements = pastedElements.map((element) => ({
			...element,
			timeline: {
				...element.timeline,
				start: element.timeline.start + shift,
				end: element.timeline.end + shift,
			},
		}));
	}

	const targetType = options.targetType ?? "track";
	const shiftedElements =
		targetType === "gap"
			? shiftElementsForGapInsert(options.elements, targetTrackIndex)
			: options.elements;
	const reconciledPastedElements = reconcilePastedElementTracks(
		shiftedElements,
		pastedElements,
	);
	const finalized = finalizeTimelineElements(
		[...shiftedElements, ...reconciledPastedElements],
		options.postProcessOptions,
	);

	const insertedSet = new Set(idMap.values());
	const insertedIds = finalized
		.filter((element) => insertedSet.has(element.id))
		.map((element) => element.id);
	const mappedPrimaryId = options.payload.primaryId
		? (idMap.get(options.payload.primaryId) ?? null)
		: null;
	const primaryId =
		(mappedPrimaryId && insertedIds.includes(mappedPrimaryId)
			? mappedPrimaryId
			: insertedIds[0]) ?? null;

	return {
		elements: finalized,
		insertedIds,
		primaryId,
	};
};
