/**
 * Timeline element drag-and-drop behavior (single + multi).
 */

import { TimelineElement } from "@/dsl/types";
import { useDrag } from "@use-gesture/react";
import {
	insertElementIntoMainTrack,
	insertElementsIntoMainTrackGroup,
} from "core/editor/utils/mainTrackMagnet";
import { useCallback, useMemo, useRef } from "react";
import { DragGhostState, useTimelineStore } from "../contexts/TimelineContext";
import { findTimelineDropTargetFromScreenPosition } from "../drag/timelineDropTargets";
import {
	finalizeTimelineElements,
	shiftMainTrackElementsAfter,
} from "../utils/mainTrackMagnet";
import { applySnap, applySnapForDrag, collectSnapPoints } from "../utils/snap";
import { updateElementTime } from "../utils/timelineTime";
import {
	getElementRole,
	hasOverlapOnStoredTrack,
	hasRoleConflictOnStoredTrack,
	resolveDropTargetForRole,
} from "../utils/trackAssignment";
import {
	collectLinkedTransitions,
	getTransitionBoundary,
	getTransitionDuration,
	getTransitionDurationParts,
	isTransitionElement,
} from "../utils/transitions";
import {
	calculateDragResult,
	calculateFinalTrack,
	SIGNIFICANT_VERTICAL_MOVE_RATIO,
} from "./index";
import { getElementHeightForTrack } from "./trackConfig";
import { ExtendedDropTarget, SnapPoint } from "./types";

interface UseTimelineElementDndOptions {
	element: TimelineElement;
	trackIndex: number;
	trackY: number;
	ratio: number;
	fps: number;
	trackHeight: number;
	trackCount: number;
	trackAssignments: Map<string, number>;
	maxDuration?: number;
	elements: TimelineElement[];
	currentTime: number;
	snapEnabled: boolean;
	autoAttach: boolean;
	rippleEditingEnabled: boolean;
	attachments: Map<string, string[]>;
	selectedIds: string[];
	select: (id: string, additive?: boolean) => void;
	setSelection: (ids: string[], primaryId?: string | null) => void;
	updateTimeRange: (
		elementId: string,
		start: number,
		end: number,
		options?: { offsetDelta?: number },
	) => void;
	moveWithAttachments: (
		elementId: string,
		start: number,
		end: number,
		dropTarget: { trackIndex: number; type: "track" | "gap" },
		attachedChildren: { id: string; start: number; end: number }[],
	) => void;
	setElements: (
		elements:
			| TimelineElement[]
			| ((prev: TimelineElement[]) => TimelineElement[]),
	) => void;
	setIsDragging: (isDragging: boolean) => void;
	setActiveSnapPoint: (point: SnapPoint | null) => void;
	setActiveDropTarget: (target: ExtendedDropTarget | null) => void;
	setDragGhosts: (ghosts: DragGhostState[]) => void;
	setLocalStartTime: (time: number | null) => void;
	setLocalEndTime: (time: number | null) => void;
	setLocalTrackY: (y: number | null) => void;
	setLocalTransitionDuration: (duration: number | null) => void;
	stopAutoScroll: () => void;
	updateAutoScrollFromPosition: (
		screenX: number,
		containerLeft: number,
		containerRight: number,
	) => void;
	updateAutoScrollYFromPosition: (
		screenY: number,
		containerTop: number,
		containerBottom: number,
	) => void;
	elementRef: React.RefObject<HTMLDivElement | null>;
	transitionDuration: number;
}

interface DragRefs {
	initialStart: number;
	initialEnd: number;
	initialTrack: number;
	initialOffset: number;
	currentStart: number;
	currentEnd: number;
}

const syncCanvasContent = (source: HTMLElement, clone: HTMLElement): void => {
	const sourceCanvases = source.querySelectorAll("canvas");
	if (sourceCanvases.length === 0) return;
	const cloneCanvases = clone.querySelectorAll("canvas");
	const count = Math.min(sourceCanvases.length, cloneCanvases.length);
	for (let i = 0; i < count; i++) {
		const sourceCanvas = sourceCanvases[i];
		const cloneCanvas = cloneCanvases[i];
		cloneCanvas.width = sourceCanvas.width;
		cloneCanvas.height = sourceCanvas.height;
		const ctx = cloneCanvas.getContext("2d");
		if (ctx) {
			ctx.drawImage(sourceCanvas, 0, 0);
		}
	}
};

const cloneGhostNode = (ghostSource: HTMLElement): HTMLElement => {
	const clone = ghostSource.cloneNode(true) as HTMLElement;
	clone.removeAttribute("data-timeline-element");
	clone.style.position = "relative";
	clone.style.left = "0";
	clone.style.top = "0";
	clone.style.opacity = "1";
	syncCanvasContent(ghostSource, clone);
	return clone;
};

const createGhostFromNode = (
	ghostSource: HTMLElement,
	element: TimelineElement,
	ghostId: string = element.id,
): DragGhostState => {
	const rect = ghostSource.getBoundingClientRect();
	const clone = cloneGhostNode(ghostSource);

	return {
		elementId: ghostId,
		element,
		screenX: rect.left,
		screenY: rect.top,
		width: rect.width,
		height: rect.height,
		clonedNode: clone,
	};
};

const createCopySeed = () =>
	`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const createTrackId = () => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `track-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 6)}`;
};

const cloneValue = <T>(value: T): T => {
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof structuredClone === "function") {
		try {
			return structuredClone(value);
		} catch {
			// fall through to JSON clone
		}
	}
	try {
		return JSON.parse(JSON.stringify(value)) as T;
	} catch {
		return value;
	}
};

const normalizeOffsetFrames = (value: unknown): number => {
	if (!Number.isFinite(value as number)) return 0;
	return Math.max(0, Math.round(value as number));
};

const isOffsetElement = (element: TimelineElement): boolean =>
	element.type === "VideoClip" || element.type === "AudioClip";

const isClipElement = (element: TimelineElement): boolean =>
	getElementRole(element) === "clip" && !isTransitionElement(element);

const getElementOffsetFrames = (element: TimelineElement): number | null => {
	if (!isOffsetElement(element)) return null;
	return normalizeOffsetFrames(element.timeline.offset);
};

const getTransitionLinkIds = (
	transition: TimelineElement,
): { fromId?: string; toId?: string } => {
	const meta = transition.transition;
	const fromId = typeof meta?.fromId === "string" ? meta.fromId : undefined;
	const toId = typeof meta?.toId === "string" ? meta.toId : undefined;
	return { fromId, toId };
};

const resolveTransitionClips = (
	transition: TimelineElement,
	elements: TimelineElement[],
): { from?: TimelineElement; to?: TimelineElement } => {
	const { fromId, toId } = getTransitionLinkIds(transition);
	let from = fromId ? elements.find((el) => el.id === fromId) : undefined;
	let to = toId ? elements.find((el) => el.id === toId) : undefined;
	if (!from || !to) {
		const boundary = getTransitionBoundary(transition);
		const trackIndex = transition.timeline.trackIndex ?? 0;
		if (!from) {
			from = elements.find(
				(el) =>
					isClipElement(el) &&
					(el.timeline.trackIndex ?? 0) === trackIndex &&
					el.timeline.end === boundary,
			);
		}
		if (!to) {
			to = elements.find(
				(el) =>
					isClipElement(el) &&
					(el.timeline.trackIndex ?? 0) === trackIndex &&
					el.timeline.start === boundary,
			);
		}
	}
	if (from && !isClipElement(from)) {
		from = undefined;
	}
	if (to && !isClipElement(to)) {
		to = undefined;
	}
	return { from, to };
};

const getTransitionMaxDuration = (
	transition: TimelineElement,
	elements: TimelineElement[],
	fallbackDuration: number,
): number => {
	if (!isTransitionElement(transition)) return fallbackDuration;
	const { from, to } = resolveTransitionClips(transition, elements);
	if (!from || !to) return fallbackDuration;
	const fromLength = Math.max(0, from.timeline.end - from.timeline.start);
	const toLength = Math.max(0, to.timeline.end - to.timeline.start);
	let incomingTail = 0;
	let outgoingHead = 0;
	for (const el of elements) {
		if (!isTransitionElement(el)) continue;
		if (el.id === transition.id) continue;
		const { fromId, toId } = getTransitionLinkIds(el);
		if (toId === from.id && getTransitionBoundary(el) === from.timeline.start) {
			const { tail } = getTransitionDurationParts(getTransitionDuration(el));
			incomingTail = Math.max(incomingTail, tail);
		}
		if (fromId === to.id && getTransitionBoundary(el) === to.timeline.end) {
			const { head } = getTransitionDurationParts(getTransitionDuration(el));
			outgoingHead = Math.max(outgoingHead, head);
		}
	}
	const maxHead = Math.max(0, fromLength - incomingTail);
	const maxTail = Math.max(0, toLength - outgoingHead);
	// 限制转场时长，避免超过相邻片段或与其他转场重叠
	const maxDuration = Math.min(maxTail * 2, maxHead * 2 + 1);
	return Math.max(0, Math.round(maxDuration));
};

const applyElementOffsetDelta = (
	element: TimelineElement,
	offsetDelta: number,
): TimelineElement => {
	if (offsetDelta === 0) return element;
	const offsetFrames = getElementOffsetFrames(element);
	if (offsetFrames === null) return element;
	const nextOffset = Math.max(0, offsetFrames + offsetDelta);
	if (nextOffset === offsetFrames) return element;
	return {
		...element,
		timeline: {
			...element.timeline,
			offset: nextOffset,
		},
	};
};

type PipelineStage<T> = (state: T) => T;

const runPipeline = <T>(state: T, stages: PipelineStage<T>[]): T => {
	return stages.reduce((acc, stage) => stage(acc), state);
};

interface GroupSpan {
	start: number;
	end: number;
	compactDuration: number;
}

const computeGroupSpan = (
	selection: Iterable<{ start: number; end: number }>,
	deltaFrames: number,
): GroupSpan => {
	let spanStart = Number.POSITIVE_INFINITY;
	let spanEnd = Number.NEGATIVE_INFINITY;
	let compactDuration = 0;

	for (const { start, end } of selection) {
		const shiftedStart = start + deltaFrames;
		const shiftedEnd = end + deltaFrames;
		spanStart = Math.min(spanStart, shiftedStart);
		spanEnd = Math.max(spanEnd, shiftedEnd);
		compactDuration += end - start;
	}

	if (!Number.isFinite(spanStart)) {
		return { start: 0, end: 0, compactDuration: 0 };
	}

	return { start: spanStart, end: spanEnd, compactDuration };
};

export const useTimelineElementDnd = ({
	element,
	trackIndex,
	trackY,
	ratio,
	fps,
	trackHeight,
	trackCount,
	trackAssignments,
	maxDuration,
	elements,
	currentTime,
	snapEnabled,
	autoAttach,
	rippleEditingEnabled,
	attachments,
	selectedIds,
	select,
	setSelection,
	updateTimeRange,
	moveWithAttachments,
	setElements,
	setIsDragging,
	setActiveSnapPoint,
	setActiveDropTarget,
	setDragGhosts,
	setLocalStartTime,
	setLocalEndTime,
	setLocalTrackY,
	setLocalTransitionDuration,
	stopAutoScroll,
	updateAutoScrollFromPosition,
	updateAutoScrollYFromPosition,
	elementRef,
	transitionDuration,
}: UseTimelineElementDndOptions) => {
	const dragRefs = useRef<DragRefs>({
		initialStart: 0,
		initialEnd: 0,
		initialTrack: 0,
		initialOffset: 0,
		currentStart: element.timeline.start,
		currentEnd: element.timeline.end,
	});
	const elementRole = getElementRole(element);
	const elementHeight = getElementHeightForTrack(trackHeight);
	const tracks = useTimelineStore((state) => state.tracks);
	const trackLockedMap = useMemo(() => {
		return new Map(
			tracks.map((track, index) => [index, track.locked ?? false]),
		);
	}, [tracks]);
	const dragSelectedIdsRef = useRef<string[]>([]);
	const transitionDurationRef = useRef(transitionDuration);
	const dragInitialElementsRef = useRef<
		Map<string, { start: number; end: number; trackIndex: number }>
	>(new Map());
	const dragMinStartRef = useRef(0);
	const initialElementsSnapshotRef = useRef<TimelineElement[]>([]);
	const initialGhostsRef = useRef<DragGhostState[]>([]);
	const initialMouseOffsetRef = useRef({ x: 0, y: 0 });
	const initialScrollLeftRef = useRef(0);
	const clonedNodeRef = useRef<HTMLElement | null>(null);
	const copyModeRef = useRef(false);
	const copyIdMapRef = useRef<Map<string, string>>(new Map());
	const applyTrackAssignments = useCallback(
		(nextElements: TimelineElement[]) => {
			return nextElements;
		},
		[],
	);

	const finalizeWithTrackAssignments = useCallback(
		(nextElements: TimelineElement[]) => {
			const finalized = finalizeTimelineElements(nextElements, {
				rippleEditingEnabled,
				attachments,
				autoAttach,
				fps,
				trackLockedMap,
			});
			return applyTrackAssignments(finalized);
		},
		[
			applyTrackAssignments,
			rippleEditingEnabled,
			attachments,
			autoAttach,
			fps,
			trackLockedMap,
		],
	);

	const resolveMovedChildrenTracks = (
		nextElements: TimelineElement[],
		movedChildren: Map<string, { start: number; end: number }>,
	) => {
		if (movedChildren.size === 0) return nextElements;
		let updated = nextElements;
		for (const childId of movedChildren.keys()) {
			const child = updated.find((el) => el.id === childId);
			if (!child) continue;
			const currentTrack = child.timeline.trackIndex ?? 1;
			const childRole = getElementRole(child);
			const maxStoredTrack = Math.max(
				0,
				...updated.map((el) => el.timeline.trackIndex ?? 0),
			);
			let availableTrack = currentTrack;
			// 从当前轨道向上查找空位，避免联动后重叠
			for (let track = currentTrack; track <= maxStoredTrack + 1; track++) {
				if (hasRoleConflictOnStoredTrack(childRole, track, updated, childId)) {
					continue;
				}
				if (
					!hasOverlapOnStoredTrack(
						child.timeline.start,
						child.timeline.end,
						track,
						updated,
						childId,
					)
				) {
					availableTrack = track;
					break;
				}
			}
			if (availableTrack !== currentTrack) {
				updated = updated.map((el) =>
					el.id === childId
						? {
								...el,
								timeline: {
									...el.timeline,
									trackIndex: availableTrack,
								},
							}
						: el,
				);
			}
		}
		return updated;
	};

	const updateTransitionDurationValue = (
		transition: TimelineElement,
		duration: number,
	) => {
		if (!transition.transition) return transition;
		const boundary = getTransitionBoundary(transition);
		const { head, tail } = getTransitionDurationParts(duration);
		const start = boundary - head;
		const end = boundary + tail;
		return updateElementTime(
			{
				...transition,
				transition: {
					...transition.transition,
					duration,
					boundry: boundary,
				},
			},
			start,
			end,
			fps,
		);
	};

	const getCopyId = (sourceId: string) => copyIdMapRef.current.get(sourceId);
	const createCopyElement = (source: TimelineElement, copyId: string) => {
		const baseProps = cloneValue(source.props) as Record<string, unknown>;
		let nextProps = baseProps;
		let nextTransition = source.transition
			? cloneValue(source.transition)
			: undefined;

		if (isTransitionElement(source)) {
			const fromId =
				typeof source.transition?.fromId === "string"
					? source.transition?.fromId
					: undefined;
			const toId =
				typeof source.transition?.toId === "string"
					? source.transition?.toId
					: undefined;
			const mappedFromId = fromId ? (getCopyId(fromId) ?? fromId) : undefined;
			const mappedToId = toId ? (getCopyId(toId) ?? toId) : undefined;
			if (nextTransition && (mappedFromId !== fromId || mappedToId !== toId)) {
				nextTransition = {
					...nextTransition,
					...(mappedFromId ? { fromId: mappedFromId } : {}),
					...(mappedToId ? { toId: mappedToId } : {}),
				};
			}
		}

		return {
			...source,
			id: copyId,
			props: nextProps,
			transform: cloneValue(source.transform),
			render: cloneValue(source.render),
			timeline: { ...source.timeline },
			...(source.clip ? { clip: cloneValue(source.clip) } : {}),
			...(nextTransition ? { transition: nextTransition } : {}),
		};
	};

	dragRefs.current.currentStart = element.timeline.start;
	dragRefs.current.currentEnd = element.timeline.end;

	const storedTrackIndex = element.timeline.trackIndex ?? 0;
	const isRippleEditingActive = rippleEditingEnabled && storedTrackIndex === 0;
	const isTransition = isTransitionElement(element);
	const supportsOffset = isOffsetElement(element);
	const clampStartByMaxDuration = (
		start: number,
		snapPoint: SnapPoint | null,
	) => {
		if (maxDuration === undefined) {
			return { start, snapPoint };
		}
		const minStart = dragRefs.current.initialEnd - maxDuration;
		if (start < minStart) {
			return { start: minStart, snapPoint: null };
		}
		return { start, snapPoint };
	};
	const clampEndByMaxDuration = (end: number, snapPoint: SnapPoint | null) => {
		if (maxDuration === undefined) {
			return { end, snapPoint };
		}
		const maxEnd = dragRefs.current.initialStart + maxDuration;
		if (end > maxEnd) {
			return { end: maxEnd, snapPoint: null };
		}
		return { end, snapPoint };
	};
	const clampStartByOffset = (start: number, snapPoint: SnapPoint | null) => {
		const initialOffset = dragRefs.current.initialOffset;
		if (initialOffset <= 0) {
			return { start, snapPoint };
		}
		const minStart = Math.max(0, dragRefs.current.initialStart - initialOffset);
		if (start < minStart) {
			return { start: minStart, snapPoint: null };
		}
		return { start, snapPoint };
	};

	const getStoredTrackNeighbors = (
		referenceStart: number,
		referenceEnd: number,
	) => {
		let prevEnd: number | null = null;
		let nextStart: number | null = null;
		for (const el of elements) {
			if (el.id === element.id) continue;
			if (el.type === "Transition") continue;
			const elTrack = el.timeline.trackIndex ?? 0;
			if (elTrack !== storedTrackIndex) continue;
			if (el.timeline.end <= referenceStart) {
				prevEnd =
					prevEnd === null
						? el.timeline.end
						: Math.max(prevEnd, el.timeline.end);
			}
			if (el.timeline.start >= referenceEnd) {
				nextStart =
					nextStart === null
						? el.timeline.start
						: Math.min(nextStart, el.timeline.start);
			}
		}
		return { prevEnd, nextStart };
	};

	const getMainTrackDropTime = (
		screenX: number,
		screenY: number,
		scrollLeft: number,
	): number | null => {
		const mainZone = document.querySelector<HTMLElement>(
			'[data-track-drop-zone="main"]',
		);
		if (!mainZone) return null;
		const rect = mainZone.getBoundingClientRect();
		if (
			screenY < rect.top ||
			screenY > rect.bottom ||
			screenX < rect.left ||
			screenX > rect.right
		) {
			return null;
		}
		const contentArea = mainZone.querySelector<HTMLElement>(
			'[data-track-content-area="main"]',
		);
		if (!contentArea) return null;
		const contentRect = contentArea.getBoundingClientRect();
		const localX = screenX - contentRect.left + scrollLeft;
		return Math.max(0, Math.round(localX / ratio));
	};

	const getMainTrackDropStart = (
		screenX: number,
		screenY: number,
		scrollLeft: number,
		offsetX: number,
	): number | null => {
		const dropTime = getMainTrackDropTime(screenX, screenY, scrollLeft);
		if (dropTime === null) return null;
		return Math.max(0, dropTime - Math.round(offsetX / ratio));
	};

	const bindLeftDrag = useDrag(
		({ movement: [mx], first, last, event, tap }) => {
			if (tap) return;
			if (isTransition) {
				if (first) {
					event?.stopPropagation();
					if (!selectedIds.includes(element.id)) {
						select(element.id);
					}
					setIsDragging(true);
					transitionDurationRef.current = transitionDuration;
				}

				const deltaFrames = Math.round(mx / ratio);
				const nextDuration = Math.max(
					0,
					transitionDurationRef.current - deltaFrames * 2,
				);
				const maxDuration = getTransitionMaxDuration(
					element,
					elements,
					transitionDurationRef.current,
				);
				const clampedDuration = Math.min(nextDuration, maxDuration);

				if (last) {
					const hasDurationChange =
						clampedDuration !== transitionDurationRef.current;
					setIsDragging(false);
					setActiveSnapPoint(null);
					setLocalTransitionDuration(null);
					if (Math.abs(mx) > 0 && hasDurationChange) {
						setElements((prev) =>
							prev.map((el) =>
								el.id === element.id
									? updateTransitionDurationValue(el, clampedDuration)
									: el,
							),
						);
					}
				} else {
					setLocalTransitionDuration(clampedDuration);
				}
				return;
			}
			if (first) {
				event?.stopPropagation();
				if (!selectedIds.includes(element.id)) {
					select(element.id);
				}
				setIsDragging(true);
				dragRefs.current.initialStart = dragRefs.current.currentStart;
				dragRefs.current.initialEnd = dragRefs.current.currentEnd;
				dragRefs.current.initialOffset = getElementOffsetFrames(element) ?? 0;
			}

			const deltaFrames = Math.round(mx / ratio);
			if (isRippleEditingActive) {
				let previewStart = Math.max(
					0,
					Math.min(
						dragRefs.current.initialStart + deltaFrames,
						dragRefs.current.initialEnd - 1,
					),
				);

				if (!supportsOffset && maxDuration !== undefined) {
					previewStart = Math.max(
						previewStart,
						dragRefs.current.initialEnd - maxDuration,
					);
				}

				let snapPoint = null;
				if (snapEnabled) {
					const snapPoints = collectSnapPoints(
						elements,
						currentTime,
						element.id,
					);
					const snapped = applySnap(previewStart, snapPoints, ratio);
					if (
						snapped.snapPoint &&
						snapped.time >= 0 &&
						snapped.time < dragRefs.current.initialEnd - 1
					) {
						previewStart = snapped.time;
						snapPoint = snapped.snapPoint;
					}
				}
				if (!supportsOffset) {
					({ start: previewStart, snapPoint } = clampStartByMaxDuration(
						previewStart,
						snapPoint,
					));
				}
				({ start: previewStart, snapPoint } = clampStartByOffset(
					previewStart,
					snapPoint,
				));

				const effectiveDelta = previewStart - dragRefs.current.initialStart;
				let newEnd = dragRefs.current.initialEnd - effectiveDelta;
				newEnd = Math.max(dragRefs.current.initialStart + 1, newEnd);
				if (!supportsOffset && maxDuration !== undefined) {
					newEnd = Math.min(
						newEnd,
						dragRefs.current.initialStart + maxDuration,
					);
				}

				if (last) {
					setIsDragging(false);
					setActiveSnapPoint(null);
					if (Math.abs(mx) > 0) {
						const delta = newEnd - dragRefs.current.initialEnd;
						const offsetDelta = previewStart - dragRefs.current.initialStart;
						setElements((prev) => {
							const shifted = shiftMainTrackElementsAfter(
								prev,
								element.id,
								newEnd,
								delta,
								{
									attachments,
									autoAttach,
									fps,
									trackLockedMap,
								},
							);
							if (offsetDelta === 0) return shifted;
							return shifted.map((el) =>
								el.id === element.id
									? applyElementOffsetDelta(el, offsetDelta)
									: el,
							);
						});
					}
				} else {
					setLocalStartTime(previewStart);
					setActiveSnapPoint(snapPoint);
				}
				return;
			}

			let newStart = Math.max(
				0,
				Math.min(
					dragRefs.current.initialStart + deltaFrames,
					dragRefs.current.initialEnd - 1,
				),
			);

			if (!supportsOffset && maxDuration !== undefined) {
				newStart = Math.max(
					newStart,
					dragRefs.current.initialEnd - maxDuration,
				);
			}

			let snapPoint = null;
			if (snapEnabled) {
				const snapPoints = collectSnapPoints(elements, currentTime, element.id);
				const snapped = applySnap(newStart, snapPoints, ratio);
				if (
					snapped.snapPoint &&
					snapped.time >= 0 &&
					snapped.time < dragRefs.current.initialEnd - 1
				) {
					newStart = snapped.time;
					snapPoint = snapped.snapPoint;
				}
			}
			if (!supportsOffset) {
				({ start: newStart, snapPoint } = clampStartByMaxDuration(
					newStart,
					snapPoint,
				));
			}
			({ start: newStart, snapPoint } = clampStartByOffset(
				newStart,
				snapPoint,
			));

			let clampedByNeighbor = false;
			const shouldClampByNeighbor =
				storedTrackIndex > 0 ||
				(storedTrackIndex === 0 && !rippleEditingEnabled);
			if (shouldClampByNeighbor) {
				// 主轨关闭波纹编辑时，禁止与相邻元素重叠
				const { prevEnd } = getStoredTrackNeighbors(
					dragRefs.current.initialStart,
					dragRefs.current.initialEnd,
				);
				if (prevEnd !== null && newStart < prevEnd) {
					newStart = prevEnd;
					clampedByNeighbor = true;
				}
			}

			if (clampedByNeighbor) {
				snapPoint = null;
			}

			if (last) {
				setIsDragging(false);
				setActiveSnapPoint(null);
				if (Math.abs(mx) > 0) {
					const offsetDelta = newStart - dragRefs.current.initialStart;
					updateTimeRange(element.id, newStart, dragRefs.current.initialEnd, {
						offsetDelta,
					});
				}
			} else {
				setLocalStartTime(newStart);
				setActiveSnapPoint(snapPoint);
			}
		},
		// 关闭 pointer capture，避免手柄移动后丢失拖拽事件
		// 不设置 axis，避免首帧纵向位移导致锁定到 y 轴后整段拖拽失效
		{ filterTaps: true, pointer: { capture: false } },
	);

	const bindRightDrag = useDrag(
		({ movement: [mx], first, last, event, tap }) => {
			if (tap) return;
			if (isTransition) {
				if (first) {
					event?.stopPropagation();
					if (!selectedIds.includes(element.id)) {
						select(element.id);
					}
					setIsDragging(true);
					transitionDurationRef.current = transitionDuration;
				}

				const deltaFrames = Math.round(mx / ratio);
				const nextDuration = Math.max(
					0,
					transitionDurationRef.current + deltaFrames * 2,
				);
				const maxDuration = getTransitionMaxDuration(
					element,
					elements,
					transitionDurationRef.current,
				);
				const clampedDuration = Math.min(nextDuration, maxDuration);

				if (last) {
					const hasDurationChange =
						clampedDuration !== transitionDurationRef.current;
					setIsDragging(false);
					setActiveSnapPoint(null);
					setLocalTransitionDuration(null);
					if (Math.abs(mx) > 0 && hasDurationChange) {
						setElements((prev) =>
							prev.map((el) =>
								el.id === element.id
									? updateTransitionDurationValue(el, clampedDuration)
									: el,
							),
						);
					}
				} else {
					setLocalTransitionDuration(clampedDuration);
				}
				return;
			}
			if (first) {
				event?.stopPropagation();
				setIsDragging(true);
				dragRefs.current.initialStart = dragRefs.current.currentStart;
				dragRefs.current.initialEnd = dragRefs.current.currentEnd;
			}

			const deltaFrames = Math.round(mx / ratio);
			if (isRippleEditingActive) {
				let newEnd = Math.max(
					dragRefs.current.initialStart + 1,
					dragRefs.current.initialEnd + deltaFrames,
				);

				if (maxDuration !== undefined) {
					newEnd = Math.min(
						newEnd,
						dragRefs.current.initialStart + maxDuration,
					);
				}

				let snapPoint = null;
				if (snapEnabled) {
					const snapPoints = collectSnapPoints(
						elements,
						currentTime,
						element.id,
					);
					const snapped = applySnap(newEnd, snapPoints, ratio);
					if (
						snapped.snapPoint &&
						snapped.time > dragRefs.current.initialStart + 1
					) {
						newEnd = snapped.time;
						snapPoint = snapped.snapPoint;
					}
				}
				({ end: newEnd, snapPoint } = clampEndByMaxDuration(newEnd, snapPoint));

				if (last) {
					setIsDragging(false);
					setActiveSnapPoint(null);
					if (Math.abs(mx) > 0) {
						const delta = newEnd - dragRefs.current.initialEnd;
						setElements((prev) =>
							shiftMainTrackElementsAfter(prev, element.id, newEnd, delta, {
								attachments,
								autoAttach,
								fps,
								trackLockedMap,
							}),
						);
					}
				} else {
					setLocalEndTime(newEnd);
					setActiveSnapPoint(snapPoint);
				}
				return;
			}

			let newEnd = Math.max(
				dragRefs.current.initialStart + 1,
				dragRefs.current.initialEnd + deltaFrames,
			);

			if (maxDuration !== undefined) {
				newEnd = Math.min(newEnd, dragRefs.current.initialStart + maxDuration);
			}

			let snapPoint = null;
			if (snapEnabled) {
				const snapPoints = collectSnapPoints(elements, currentTime, element.id);
				const snapped = applySnap(newEnd, snapPoints, ratio);
				if (
					snapped.snapPoint &&
					snapped.time > dragRefs.current.initialStart + 1
				) {
					newEnd = snapped.time;
					snapPoint = snapped.snapPoint;
				}
			}
			({ end: newEnd, snapPoint } = clampEndByMaxDuration(newEnd, snapPoint));

			let clampedByNeighbor = false;
			const shouldClampByNeighbor =
				storedTrackIndex > 0 ||
				(storedTrackIndex === 0 && !rippleEditingEnabled);
			if (shouldClampByNeighbor) {
				// 主轨关闭波纹编辑时，禁止与相邻元素重叠
				const { nextStart } = getStoredTrackNeighbors(
					dragRefs.current.initialStart,
					dragRefs.current.initialEnd,
				);
				if (nextStart !== null && newEnd > nextStart) {
					newEnd = nextStart;
					clampedByNeighbor = true;
				}
			}

			if (clampedByNeighbor) {
				snapPoint = null;
			}

			if (last) {
				setIsDragging(false);
				setActiveSnapPoint(null);
				if (Math.abs(mx) > 0) {
					updateTimeRange(element.id, dragRefs.current.initialStart, newEnd);
				}
			} else {
				setLocalEndTime(newEnd);
				setActiveSnapPoint(snapPoint);
			}
		},
		// 关闭 pointer capture，避免手柄移动后丢失拖拽事件
		// 不设置 axis，避免首帧纵向位移导致锁定到 y 轴后整段拖拽失效
		{ filterTaps: true, pointer: { capture: false } },
	);

	const bindBodyDrag = useDrag(
		({ movement: [mx, my], first, last, event, tap, xy }) => {
			if (tap) return;
			const currentScrollLeft = useTimelineStore.getState().scrollLeft;
			const maxStoredTrack = Math.max(
				0,
				...elements.map((el) => el.timeline.trackIndex ?? 0),
			);
			const otherTrackCount = Math.max(maxStoredTrack, trackCount - 1, 0);

			if (first) {
				event?.stopPropagation();
				setIsDragging(true);
				const baseSelectedIds = selectedIds.includes(element.id)
					? selectedIds
					: [element.id];
				if (!selectedIds.includes(element.id)) {
					setSelection([element.id], element.id);
				}
				const dragSelectedIds = collectLinkedTransitions(
					elements,
					baseSelectedIds,
				);
				dragSelectedIdsRef.current = dragSelectedIds;
				const isCopyDragStart = Boolean(
					(event as MouseEvent | undefined)?.altKey,
				);
				copyModeRef.current = isCopyDragStart;
				if (isCopyDragStart) {
					const seed = createCopySeed();
					const nextMap = new Map<string, string>();
					dragSelectedIds.forEach((sourceId, index) => {
						nextMap.set(sourceId, `element-${seed}-${index}`);
					});
					copyIdMapRef.current = nextMap;
				} else {
					copyIdMapRef.current = new Map();
				}

				const initialMap = new Map<
					string,
					{ start: number; end: number; trackIndex: number }
				>();
				let minStart = Infinity;
				for (const el of elements) {
					if (!dragSelectedIds.includes(el.id)) continue;
					const trackIndexValue = el.timeline.trackIndex ?? 0;
					initialMap.set(el.id, {
						start: el.timeline.start,
						end: el.timeline.end,
						trackIndex: trackIndexValue,
					});
					minStart = Math.min(minStart, el.timeline.start);
				}
				dragInitialElementsRef.current = initialMap;
				dragMinStartRef.current = Number.isFinite(minStart) ? minStart : 0;
				initialElementsSnapshotRef.current = elements;

				dragRefs.current.initialStart = dragRefs.current.currentStart;
				dragRefs.current.initialEnd = dragRefs.current.currentEnd;
				dragRefs.current.initialTrack = trackIndex;
				initialScrollLeftRef.current = currentScrollLeft;

				const target = event?.target as HTMLElement;
				const rect = target
					?.closest("[data-timeline-element]")
					?.getBoundingClientRect();
				if (rect) {
					initialMouseOffsetRef.current = {
						x: xy[0] - rect.left,
						y: xy[1] - rect.top,
					};
				}

				const isMultiDrag = dragSelectedIds.length > 1;
				if (!isMultiDrag) {
					const ghostId =
						copyModeRef.current && getCopyId(element.id)
							? (getCopyId(element.id) ?? element.id)
							: element.id;
					if (elementRef.current) {
						clonedNodeRef.current = cloneGhostNode(elementRef.current);
					}

					const ghostWidth = isTransition
						? Math.max(6, transitionDuration * ratio)
						: (dragRefs.current.currentEnd - dragRefs.current.currentStart) *
							ratio;
					setDragGhosts([
						{
							elementId: ghostId,
							element,
							screenX: xy[0] - initialMouseOffsetRef.current.x,
							screenY: xy[1] - initialMouseOffsetRef.current.y,
							width: ghostWidth,
							height: elementHeight,
							clonedNode: clonedNodeRef.current,
						},
					]);
				} else {
					const ghosts: DragGhostState[] = [];
					for (const selectedId of dragSelectedIds) {
						const ghostSource = document.querySelector<HTMLElement>(
							`[data-element-id="${selectedId}"]`,
						);
						const ghostElement = elements.find((el) => el.id === selectedId);
						if (!ghostSource || !ghostElement) continue;
						const ghostId =
							copyModeRef.current && getCopyId(selectedId)
								? (getCopyId(selectedId) ?? selectedId)
								: selectedId;
						ghosts.push(
							createGhostFromNode(ghostSource, ghostElement, ghostId),
						);
					}
					initialGhostsRef.current = ghosts;
					setDragGhosts(ghosts);
				}
			}

			const isCopyDrag = copyModeRef.current;
			const scrollDelta = currentScrollLeft - initialScrollLeftRef.current;
			const adjustedDeltaX = mx + scrollDelta;

			const isMultiDrag =
				dragSelectedIdsRef.current.length > 1 &&
				dragSelectedIdsRef.current.includes(element.id);
			if (isMultiDrag) {
				let deltaFrames = Math.round(adjustedDeltaX / ratio);
				const minStart = dragMinStartRef.current;
				if (deltaFrames < -minStart) {
					deltaFrames = -minStart;
				}

				const initialMap = dragInitialElementsRef.current;
				const draggedInitial = initialMap.get(element.id);
				const selectedSet = new Set(dragSelectedIdsRef.current);
				const hasSignificantVerticalMove =
					Math.abs(my) > trackHeight * SIGNIFICANT_VERTICAL_MOVE_RATIO;
				const baseElements =
					initialElementsSnapshotRef.current.length > 0
						? initialElementsSnapshotRef.current
						: elements;
				const baseElementMap = new Map(baseElements.map((el) => [el.id, el]));
				const draggedBaseTrack =
					draggedInitial?.trackIndex ?? dragRefs.current.initialTrack;
				const baseDropTarget = hasSignificantVerticalMove
					? findTimelineDropTargetFromScreenPosition(
							xy[0],
							xy[1],
							otherTrackCount,
							trackHeight,
						)
					: {
							trackIndex: draggedBaseTrack,
							type: "track" as const,
						};
				const mainDropTime = getMainTrackDropTime(
					xy[0],
					xy[1],
					currentScrollLeft,
				);
				const dragSelectedIds = dragSelectedIdsRef.current;
				const isMainTrackCandidate =
					mainDropTime !== null &&
					dragSelectedIds.every((selectedId) => {
						const selectedElement = elements.find((el) => el.id === selectedId);
						if (!selectedElement) return false;
						if (isTransitionElement(selectedElement)) return true;
						return getElementRole(selectedElement) === "clip";
					});
				const shouldUseRippleEditingMulti =
					rippleEditingEnabled && isMainTrackCandidate;

				const snapResult = runPipeline(
					{ deltaFrames, snapPoint: null as SnapPoint | null },
					snapEnabled && !shouldUseRippleEditingMulti
						? [
								(state) => {
									let bestDelta = state.deltaFrames;
									let bestSnapPoint: SnapPoint | null = null;
									let bestDistance = Infinity;

									for (const selectedId of dragSelectedIdsRef.current) {
										const initial =
											dragInitialElementsRef.current.get(selectedId);
										if (!initial) continue;
										const snapExcludeId =
											isCopyDrag && getCopyId(selectedId)
												? (getCopyId(selectedId) ?? selectedId)
												: selectedId;
										const snapPoints = collectSnapPoints(
											baseElements,
											currentTime,
											snapExcludeId,
										);
										const snapped = applySnapForDrag(
											initial.start + state.deltaFrames,
											initial.end + state.deltaFrames,
											snapPoints,
											ratio,
										);
										if (!snapped.snapPoint) continue;
										const snappedDelta = snapped.start - initial.start;
										if (snappedDelta < -minStart) continue;
										const distance = Math.abs(snappedDelta - state.deltaFrames);
										if (distance < bestDistance) {
											bestDistance = distance;
											bestDelta = snappedDelta;
											bestSnapPoint = snapped.snapPoint;
										}
									}

									return { deltaFrames: bestDelta, snapPoint: bestSnapPoint };
								},
							]
						: [],
				);

				deltaFrames = snapResult.deltaFrames;
				const snapPoint = snapResult.snapPoint;
				const baseStart =
					draggedInitial?.start ?? dragRefs.current.initialStart;
				const baseEnd = draggedInitial?.end ?? dragRefs.current.initialEnd;
				const nextStart = baseStart + deltaFrames;
				const nextEnd = baseEnd + deltaFrames;
				const {
					start: rawGroupSpanStart,
					end: rawGroupSpanEnd,
					compactDuration: groupCompactDuration,
				} = computeGroupSpan(initialMap.values(), deltaFrames);
				const groupSpanStart = Number.isFinite(rawGroupSpanStart)
					? rawGroupSpanStart
					: nextStart;
				const groupSpanEnd = Number.isFinite(rawGroupSpanEnd)
					? rawGroupSpanEnd
					: nextEnd;
				const selectedRanges = dragSelectedIds
					.map((selectedId) => {
						const initial = initialMap.get(selectedId);
						if (!initial) return null;
						return {
							id: selectedId,
							start: initial.start + deltaFrames,
							end: initial.end + deltaFrames,
							trackIndex: initial.trackIndex,
						};
					})
					.filter(
						(
							range,
						): range is {
							id: string;
							start: number;
							end: number;
							trackIndex: number;
						} => Boolean(range),
					);
				const selectedRangesForOverlap = selectedRanges.filter((range) => {
					const selectedElement = baseElementMap.get(range.id);
					return selectedElement && !isTransitionElement(selectedElement);
				});
				const anchorRanges = selectedRanges.filter(
					(range) => range.trackIndex === draggedBaseTrack,
				);
				const effectiveAnchorRanges =
					anchorRanges.length > 0
						? anchorRanges
						: [
								{
									id: element.id,
									start: nextStart,
									end: nextEnd,
									trackIndex: draggedBaseTrack,
								},
							];
				const overlapCandidates = isCopyDrag
					? baseElements
					: baseElements.filter((el) => !selectedSet.has(el.id));
				const hasRangesOverlapOnTrack = (
					ranges: { start: number; end: number }[],
					targetTrack: number,
				) =>
					ranges.some((range) =>
						hasOverlapOnStoredTrack(
							range.start,
							range.end,
							targetTrack,
							overlapCandidates,
						),
					);
				const hasInternalOverlap = (
					ranges: { start: number; end: number }[],
				) => {
					if (ranges.length < 2) return false;
					const sorted = [...ranges].sort((a, b) => a.start - b.start);
					let lastEnd = sorted[0].end;
					for (let i = 1; i < sorted.length; i += 1) {
						const current = sorted[i];
						if (current.start < lastEnd) {
							return true;
						}
						lastEnd = Math.max(lastEnd, current.end);
					}
					return false;
				};
				// 主轨道禁用吸附时，重叠则拒绝落主轨
				const mainTrackOverlap =
					isMainTrackCandidate &&
					(hasInternalOverlap(selectedRangesForOverlap) ||
						hasRangesOverlapOnTrack(selectedRangesForOverlap, 0));
				const canDropToMainTrack =
					isMainTrackCandidate && (rippleEditingEnabled || !mainTrackOverlap);
				const forceMainTrackPlacement =
					!shouldUseRippleEditingMulti && canDropToMainTrack;

				let resolvedDropTarget = resolveDropTargetForRole(
					baseDropTarget,
					elementRole,
					elements,
					trackAssignments,
				);
				if (canDropToMainTrack) {
					resolvedDropTarget = { type: "track", trackIndex: 0 };
				} else if (mainDropTime !== null) {
					resolvedDropTarget = { type: "track", trackIndex: draggedBaseTrack };
				}

				const maxStoredTrack = Math.max(
					0,
					...baseElements.map((el) => el.timeline.trackIndex ?? 0),
				);
				const finalTrackResult = forceMainTrackPlacement
					? { trackIndex: 0, displayType: "track" as const, needsInsert: false }
					: (() => {
							if (resolvedDropTarget.type === "gap") {
								return {
									trackIndex: resolvedDropTarget.trackIndex,
									displayType: "gap" as const,
									needsInsert: true,
								};
							}
							const targetTrack = resolvedDropTarget.trackIndex;
							const targetHasOverlap =
								hasRoleConflictOnStoredTrack(
									elementRole,
									targetTrack,
									overlapCandidates,
								) ||
								hasRangesOverlapOnTrack(effectiveAnchorRanges, targetTrack);
							if (!targetHasOverlap) {
								return {
									trackIndex: targetTrack,
									displayType: "track" as const,
									needsInsert: false,
								};
							}
							const aboveTrack = targetTrack + 1;
							const aboveHasOverlap =
								aboveTrack <= maxStoredTrack &&
								(hasRoleConflictOnStoredTrack(
									elementRole,
									aboveTrack,
									overlapCandidates,
								) ||
									hasRangesOverlapOnTrack(effectiveAnchorRanges, aboveTrack));
							if (!aboveHasOverlap && aboveTrack <= maxStoredTrack) {
								return {
									trackIndex: aboveTrack,
									displayType: "track" as const,
									needsInsert: false,
								};
							}
							return {
								trackIndex: targetTrack + 1,
								displayType: "gap" as const,
								needsInsert: true,
							};
						})();
				// 统一处理插入轨道后的索引偏移
				const shouldInsertTrack = finalTrackResult.displayType === "gap";
				const insertTrackIndex = shouldInsertTrack
					? finalTrackResult.trackIndex
					: null;
				const shiftForInsert = (trackValue: number) =>
					insertTrackIndex !== null && trackValue >= insertTrackIndex
						? trackValue + 1
						: trackValue;
				const draggedAfterInsert = shiftForInsert(draggedBaseTrack);
				const trackDelta = finalTrackResult.trackIndex - draggedAfterInsert;
				const resolveExistingTrackId = (
					targetTrackIndex: number,
				): string | null => {
					if (insertTrackIndex === null) {
						return tracks[targetTrackIndex]?.id ?? null;
					}
					if (targetTrackIndex === insertTrackIndex) {
						return null;
					}
					const sourceIndex =
						targetTrackIndex > insertTrackIndex
							? targetTrackIndex - 1
							: targetTrackIndex;
					return tracks[sourceIndex]?.id ?? null;
				};
				// 计算多轨选中的目标轨道映射，避免角色冲突与时间重叠
				const buildSelectedTrackMapping = (
					obstacleElements: TimelineElement[],
				) => {
					const shiftedObstacles = obstacleElements.map((el) => {
						const baseTrack = el.timeline.trackIndex ?? 0;
						const shiftedTrack = shiftForInsert(baseTrack);
						if (shiftedTrack === baseTrack) return el;
						return {
							...el,
							timeline: {
								...el.timeline,
								trackIndex: shiftedTrack,
							},
						};
					});
					const trackGroups = new Map<
						number,
						{
							role: ReturnType<typeof getElementRole>;
							ranges: { start: number; end: number }[];
						}
					>();
					for (const [id, initial] of initialMap.entries()) {
						if (!selectedSet.has(id)) continue;
						const element = baseElementMap.get(id);
						if (!element) continue;
						const role = getElementRole(element);
						let group = trackGroups.get(initial.trackIndex);
						if (!group) {
							group = { role, ranges: [] };
							trackGroups.set(initial.trackIndex, group);
						}
						group.ranges.push({
							start: initial.start + deltaFrames,
							end: initial.end + deltaFrames,
						});
					}

					const requestedTrackMap = new Map<number, number>();
					for (const track of trackGroups.keys()) {
						requestedTrackMap.set(
							track,
							Math.max(0, shiftForInsert(track) + trackDelta),
						);
					}

					const mapping = new Map<number, number>();
					const occupiedTracks = new Set<number>();
					const anchorRequested = Math.max(
						0,
						shiftForInsert(draggedBaseTrack) + trackDelta,
					);
					mapping.set(draggedBaseTrack, anchorRequested);
					occupiedTracks.add(anchorRequested);

					const sortedTracks = [...trackGroups.keys()].sort((a, b) => a - b);
					for (const track of sortedTracks) {
						if (track === draggedBaseTrack) continue;
						const group = trackGroups.get(track);
						if (!group) continue;
						const requestedTrack =
							requestedTrackMap.get(track) ??
							Math.max(0, shiftForInsert(track) + trackDelta);
						let candidate = requestedTrack;
						// 多轨选中时逐个向上查找可用轨道，避免角色冲突/重叠
						while (true) {
							if (!occupiedTracks.has(candidate)) {
								const roleConflict = hasRoleConflictOnStoredTrack(
									group.role,
									candidate,
									shiftedObstacles,
								);
								const hasOverlap = group.ranges.some((range) =>
									hasOverlapOnStoredTrack(
										range.start,
										range.end,
										candidate,
										shiftedObstacles,
									),
								);
								if (!roleConflict && !hasOverlap) {
									break;
								}
							}
							candidate += 1;
						}
						mapping.set(track, candidate);
						occupiedTracks.add(candidate);
					}

					return mapping;
				};
				const snapShift = deltaFrames * ratio - adjustedDeltaX;
				const ghostDeltaX = mx + snapShift;
				const ghostDeltaY = my;

				if (!last) {
					setDragGhosts(
						initialGhostsRef.current.map((ghost) => ({
							...ghost,
							screenX: ghost.screenX + ghostDeltaX,
							screenY: ghost.screenY + ghostDeltaY,
						})),
					);
				}

				if (last) {
					if (isCopyDrag) {
						const hasMovement = Math.abs(mx) > 0 || Math.abs(my) > 0;
						const dragSelectedIds = dragSelectedIdsRef.current;
						const copyIds = dragSelectedIds
							.map((id) => getCopyId(id))
							.filter((id): id is string => Boolean(id));
						const primaryCopyId = getCopyId(element.id) ?? copyIds[0] ?? null;

						if (hasMovement && copyIds.length > 0) {
							if (shouldUseRippleEditingMulti) {
								const copies = dragSelectedIds
									.map((sourceId) => {
										const source = elements.find((el) => el.id === sourceId);
										const copyId = getCopyId(sourceId);
										if (!source || !copyId) return null;
										return createCopyElement(source, copyId);
									})
									.filter(Boolean) as TimelineElement[];
								if (copies.length > 0) {
									const dropStartForRippleEditing = groupSpanStart;
									setElements((prev) =>
										applyTrackAssignments(
											insertElementsIntoMainTrackGroup(
												[...prev, ...copies],
												copyIds,
												dropStartForRippleEditing,
												{
													rippleEditingEnabled,
													attachments,
													autoAttach,
													fps,
													trackLockedMap,
												},
											),
										),
									);
									setSelection(copyIds, primaryCopyId);
								}
							} else if (forceMainTrackPlacement) {
								const copies = dragSelectedIds
									.map((sourceId) => {
										const initial = initialMap.get(sourceId);
										const source = elements.find((el) => el.id === sourceId);
										const copyId = getCopyId(sourceId);
										if (!initial || !source || !copyId) return null;
										const copy = createCopyElement(source, copyId);
										const timed = updateElementTime(
											copy,
											initial.start + deltaFrames,
											initial.end + deltaFrames,
											fps,
										);
										return {
											...timed,
											timeline: { ...timed.timeline, trackIndex: 0 },
										};
									})
									.filter(Boolean) as TimelineElement[];

								if (copies.length > 0) {
									setElements((prev) =>
										finalizeTimelineElements([...prev, ...copies], {
											rippleEditingEnabled,
											attachments,
											autoAttach,
											fps,
											trackLockedMap,
										}),
									);
									setSelection(copyIds, primaryCopyId);
								}
							} else {
								const selectedTrackMapping =
									buildSelectedTrackMapping(baseElements);
								const newTrackIdByIndex = new Map<number, string>();
								const resolveCopyTrackId = (targetTrackIndex: number) => {
									const existingTrackId =
										resolveExistingTrackId(targetTrackIndex);
									if (existingTrackId) return existingTrackId;
									let nextId = newTrackIdByIndex.get(targetTrackIndex);
									if (!nextId) {
										nextId = createTrackId();
										newTrackIdByIndex.set(targetTrackIndex, nextId);
									}
									return nextId;
								};

								const copies = dragSelectedIds
									.map((sourceId) => {
										const initial = initialMap.get(sourceId);
										const source = elements.find((el) => el.id === sourceId);
										const copyId = getCopyId(sourceId);
										if (!initial || !source || !copyId) return null;
										const nextStart = initial.start + deltaFrames;
										const nextEnd = initial.end + deltaFrames;
										const baseTrack = shiftForInsert(initial.trackIndex);
										const mappedTrack = selectedTrackMapping.get(
											initial.trackIndex,
										);
										const nextTrack = Math.max(
											0,
											mappedTrack ?? baseTrack + trackDelta,
										);
										const targetTrackId = resolveCopyTrackId(nextTrack);
										const copy = createCopyElement(source, copyId);
										const timed = updateElementTime(
											copy,
											nextStart,
											nextEnd,
											fps,
										);
										return {
											...timed,
											timeline: {
												...timed.timeline,
												trackIndex: nextTrack,
												trackId: targetTrackId,
											},
										};
									})
									.filter(Boolean) as TimelineElement[];

								if (copies.length > 0) {
									setElements((prev) => {
										const shifted =
											insertTrackIndex !== null
												? prev.map((el) => {
														const baseTrack = el.timeline.trackIndex ?? 0;
														if (baseTrack >= insertTrackIndex) {
															return {
																...el,
																timeline: {
																	...el.timeline,
																	trackIndex: baseTrack + 1,
																},
															};
														}
														return el;
													})
												: prev;
										return finalizeWithTrackAssignments([
											...shifted,
											...copies,
										]);
									});
									setSelection(copyIds, primaryCopyId);
								}
							}
						}

						setIsDragging(false);
						setActiveSnapPoint(null);
						setActiveDropTarget(null);
						setDragGhosts([]);
						setLocalTrackY(null);
						stopAutoScroll();
						return;
					}

					if (shouldUseRippleEditingMulti) {
						setLocalStartTime(null);
						setLocalEndTime(null);
						const dropStartForRippleEditing = groupSpanStart;

						setElements((prev) =>
							insertElementsIntoMainTrackGroup(
								prev,
								dragSelectedIds,
								dropStartForRippleEditing,
								{
									rippleEditingEnabled,
									attachments,
									autoAttach,
									fps,
									trackLockedMap,
								},
							),
						);

						setIsDragging(false);
						setActiveSnapPoint(null);
						setActiveDropTarget(null);
						setDragGhosts([]);
						setLocalTrackY(null);
						stopAutoScroll();
						return;
					}

					const movedChildren = new Map<
						string,
						{ start: number; end: number }
					>();

					if (autoAttach && deltaFrames !== 0) {
						for (const parentId of selectedSet) {
							const parentInitial = initialMap.get(parentId);
							if (!parentInitial) continue;
							const isLeavingMainTrack =
								parentInitial.trackIndex === 0 &&
								hasSignificantVerticalMove &&
								(resolvedDropTarget.type === "gap" ||
									finalTrackResult.trackIndex > 0);
							if (isLeavingMainTrack) continue;
							const childIds = attachments.get(parentId) ?? [];
							for (const childId of childIds) {
								if (selectedSet.has(childId)) continue;
								const childBase = baseElementMap.get(childId);
								if (!childBase) continue;
								const childTrackIndex = childBase.timeline.trackIndex ?? 0;
								if (trackLockedMap.get(childTrackIndex)) {
									continue;
								}
								const childNewStart = childBase.timeline.start + deltaFrames;
								const childNewEnd = childBase.timeline.end + deltaFrames;
								if (childNewStart >= 0) {
									movedChildren.set(childId, {
										start: childNewStart,
										end: childNewEnd,
									});
								}
							}
						}
					}

					if (forceMainTrackPlacement) {
						setElements((prev) => {
							const updated = prev.map((el) => {
								if (selectedSet.has(el.id)) {
									const initial = initialMap.get(el.id);
									if (!initial) return el;
									const nextStart = initial.start + deltaFrames;
									const nextEnd = initial.end + deltaFrames;
									return {
										...el,
										timeline: {
											...el.timeline,
											start: nextStart,
											end: nextEnd,
											trackIndex: 0,
										},
									};
								}

								const childMove = movedChildren.get(el.id);
								if (childMove) {
									return {
										...el,
										timeline: {
											...el.timeline,
											start: childMove.start,
											end: childMove.end,
										},
									};
								}

								return el;
							});

							const withChildrenTracks = resolveMovedChildrenTracks(
								updated,
								movedChildren,
							);
							return finalizeTimelineElements(withChildrenTracks, {
								rippleEditingEnabled,
								attachments,
								autoAttach,
								fps,
								trackLockedMap,
							});
						});

						setIsDragging(false);
						setActiveSnapPoint(null);
						setActiveDropTarget(null);
						setDragGhosts([]);
						setLocalTrackY(null);
						stopAutoScroll();
						return;
					}

					const nonSelectedElements = baseElements.filter(
						(el) => !selectedSet.has(el.id),
					);
					const selectedTrackMapping =
						buildSelectedTrackMapping(nonSelectedElements);
					const totalByTrack = new Map<number, number>();
					const selectedByTrack = new Map<number, number>();
					for (const el of baseElements) {
						const trackIndex = el.timeline.trackIndex ?? 0;
						totalByTrack.set(
							trackIndex,
							(totalByTrack.get(trackIndex) ?? 0) + 1,
						);
						if (selectedSet.has(el.id)) {
							selectedByTrack.set(
								trackIndex,
								(selectedByTrack.get(trackIndex) ?? 0) + 1,
							);
						}
					}
					const isTrackFullySelected = (trackIndex: number) =>
						(selectedByTrack.get(trackIndex) ?? 0) ===
						(totalByTrack.get(trackIndex) ?? 0);
					const newTrackIdByIndex = new Map<number, string>();
					const resolveMovedTrackId = (
						sourceTrackIndex: number,
						targetTrackIndex: number,
					) => {
						const existingTrackId = resolveExistingTrackId(targetTrackIndex);
						if (existingTrackId) return existingTrackId;
						if (!shouldInsertTrack) return undefined;
						// 保留原轨道仍有元素时，给新轨道分配新的 trackId
						if (isTrackFullySelected(sourceTrackIndex)) {
							return undefined;
						}
						let nextId = newTrackIdByIndex.get(targetTrackIndex);
						if (!nextId) {
							nextId = createTrackId();
							newTrackIdByIndex.set(targetTrackIndex, nextId);
						}
						return nextId;
					};

					setElements((prev) => {
						const updated = prev.map((el) => {
							const baseTrack = el.timeline.trackIndex ?? 0;
							const nextTrack = shiftForInsert(baseTrack);

							if (selectedSet.has(el.id)) {
								const initial = initialMap.get(el.id);
								if (!initial) return el;
								const selectedBase = shiftForInsert(initial.trackIndex);
								const mappedTrack = selectedTrackMapping.get(
									initial.trackIndex,
								);
								const nextTrackIndex = Math.max(
									0,
									mappedTrack ?? selectedBase + trackDelta,
								);
								const targetTrackId = resolveMovedTrackId(
									initial.trackIndex,
									nextTrackIndex,
								);
								return {
									...el,
									timeline: {
										...el.timeline,
										start: initial.start + deltaFrames,
										end: initial.end + deltaFrames,
										trackIndex: nextTrackIndex,
										...(targetTrackId ? { trackId: targetTrackId } : {}),
									},
								};
							}

							const childMove = movedChildren.get(el.id);
							if (childMove) {
								return {
									...el,
									timeline: {
										...el.timeline,
										start: childMove.start,
										end: childMove.end,
										trackIndex: nextTrack,
									},
								};
							}

							if (nextTrack !== baseTrack) {
								return {
									...el,
									timeline: {
										...el.timeline,
										trackIndex: nextTrack,
									},
								};
							}

							return el;
						});

						const withChildrenTracks = resolveMovedChildrenTracks(
							updated,
							movedChildren,
						);
						return finalizeTimelineElements(withChildrenTracks, {
							rippleEditingEnabled,
							attachments,
							autoAttach,
							fps,
							trackLockedMap,
						});
					});

					setIsDragging(false);
					setActiveSnapPoint(null);
					setActiveDropTarget(null);
					setDragGhosts([]);
					setLocalTrackY(null);
					stopAutoScroll();
				} else {
					if (shouldUseRippleEditingMulti) {
						const dropStartForRippleEditing = groupSpanStart;
						setActiveSnapPoint(null);
						setActiveDropTarget({
							type: "track",
							trackIndex: 0,
							elementId: element.id,
							start: dropStartForRippleEditing,
							end: dropStartForRippleEditing + groupCompactDuration,
							finalTrackIndex: 0,
						});
					} else if (forceMainTrackPlacement) {
						setActiveSnapPoint(snapPoint);
						setActiveDropTarget({
							type: "track",
							trackIndex: 0,
							elementId: element.id,
							start: groupSpanStart,
							end: groupSpanEnd,
							finalTrackIndex: 0,
						});
					} else {
						setActiveSnapPoint(snapPoint);
						setActiveDropTarget({
							type: finalTrackResult.displayType,
							trackIndex: finalTrackResult.trackIndex,
							elementId: element.id,
							start: groupSpanStart,
							end: groupSpanEnd,
							finalTrackIndex: finalTrackResult.trackIndex,
						});
					}

					const scrollArea = document.querySelector<HTMLElement>(
						"[data-timeline-scroll-area]",
					);
					if (scrollArea) {
						const scrollRect = scrollArea.getBoundingClientRect();
						updateAutoScrollFromPosition(
							xy[0],
							scrollRect.left,
							scrollRect.right,
						);
					}

					const verticalScrollArea = document.querySelector<HTMLElement>(
						"[data-vertical-scroll-area]",
					);
					if (verticalScrollArea) {
						const verticalRect = verticalScrollArea.getBoundingClientRect();
						updateAutoScrollYFromPosition(
							xy[1],
							verticalRect.top,
							verticalRect.bottom,
						);
					}
				}

				return;
			}

			const dragResult = calculateDragResult({
				deltaX: adjustedDeltaX,
				deltaY: my,
				ratio,
				initialStart: dragRefs.current.initialStart,
				initialEnd: dragRefs.current.initialEnd,
				initialTrackY: trackY,
				initialTrackIndex: dragRefs.current.initialTrack,
				trackHeight,
				trackCount,
				elementHeight,
			});

			const hasSignificantVerticalMove =
				Math.abs(my) > trackHeight * SIGNIFICANT_VERTICAL_MOVE_RATIO;
			const baseDropTarget = hasSignificantVerticalMove
				? findTimelineDropTargetFromScreenPosition(
						xy[0],
						xy[1],
						otherTrackCount,
						trackHeight,
					)
				: { trackIndex, type: "track" as const };
			const resolvedDropTarget = resolveDropTargetForRole(
				baseDropTarget,
				elementRole,
				elements,
				trackAssignments,
			);
			const shouldUseRippleEditing =
				rippleEditingEnabled &&
				resolvedDropTarget.type === "track" &&
				resolvedDropTarget.trackIndex === 0;

			let { newStart, newEnd } = dragResult;
			const { newY } = dragResult;
			const activeCopyId = isCopyDrag ? getCopyId(element.id) : undefined;

			let snapPoint = null;
			if (snapEnabled && !shouldUseRippleEditing) {
				const snapExcludeId = activeCopyId ?? element.id;
				const snapPoints = collectSnapPoints(
					elements,
					currentTime,
					snapExcludeId,
				);
				const snapped = applySnapForDrag(newStart, newEnd, snapPoints, ratio);
				newStart = snapped.start;
				newEnd = snapped.end;
				snapPoint = snapped.snapPoint;
			}

			const tempElements = !shouldUseRippleEditing
				? isCopyDrag
					? elements
					: elements.map((el) =>
							el.id === element.id
								? {
										...el,
										timeline: {
											...el.timeline,
											start: newStart,
											end: newEnd,
										},
									}
								: el,
						)
				: null;
			const finalTrackElements =
				tempElements && activeCopyId
					? [...tempElements, { ...element, id: activeCopyId }]
					: tempElements;
			const finalTrackResult =
				finalTrackElements && !shouldUseRippleEditing
					? calculateFinalTrack(
							resolvedDropTarget,
							{ start: newStart, end: newEnd },
							finalTrackElements,
							activeCopyId ?? element.id,
							element.timeline.trackIndex ?? 0,
						)
					: null;

			if (last) {
				setIsDragging(false);
				setActiveSnapPoint(null);
				setActiveDropTarget(null);
				setDragGhosts([]);
				setLocalTrackY(null);
				stopAutoScroll();

				if (isCopyDrag) {
					const hasMovement = Math.abs(mx) > 0 || Math.abs(my) > 0;
					if (hasMovement && activeCopyId) {
						if (shouldUseRippleEditing) {
							const dropStartForRippleEditing =
								getMainTrackDropStart(
									xy[0],
									xy[1],
									currentScrollLeft,
									initialMouseOffsetRef.current.x,
								) ?? newStart;
							const copy = createCopyElement(element, activeCopyId);
							setElements((prev) =>
								applyTrackAssignments(
									insertElementIntoMainTrack(
										prev,
										activeCopyId,
										dropStartForRippleEditing,
										{
											rippleEditingEnabled,
											attachments,
											autoAttach,
											fps,
											trackLockedMap,
										},
										copy,
									),
								),
							);
							setSelection([activeCopyId], activeCopyId);
						} else if (finalTrackResult) {
							const shouldInsertTrack = finalTrackResult.displayType === "gap";
							const insertTrackIndex = shouldInsertTrack
								? finalTrackResult.trackIndex
								: null;
							const copy = createCopyElement(element, activeCopyId);
							const timed = updateElementTime(copy, newStart, newEnd, fps);
							const copyWithTrack = {
								...timed,
								timeline: {
									...timed.timeline,
									trackIndex: finalTrackResult.trackIndex,
								},
							};
							setElements((prev) => {
								const shifted =
									insertTrackIndex !== null
										? prev.map((el) => {
												const baseTrack = el.timeline.trackIndex ?? 0;
												if (baseTrack >= insertTrackIndex) {
													return {
														...el,
														timeline: {
															...el.timeline,
															trackIndex: baseTrack + 1,
														},
													};
												}
												return el;
											})
										: prev;
								return finalizeWithTrackAssignments([
									...shifted,
									copyWithTrack,
								]);
							});
							setSelection([activeCopyId], activeCopyId);
						}
					}
					return;
				}

				if (shouldUseRippleEditing) {
					setLocalStartTime(null);
					setLocalEndTime(null);
					if (Math.abs(mx) > 0 || Math.abs(my) > 0) {
						const dropStartForRippleEditing =
							getMainTrackDropStart(
								xy[0],
								xy[1],
								currentScrollLeft,
								initialMouseOffsetRef.current.x,
							) ?? newStart;
						setElements((prev) =>
							insertElementIntoMainTrack(
								prev,
								element.id,
								dropStartForRippleEditing,
								{
									rippleEditingEnabled,
									attachments,
									autoAttach,
									fps,
									trackLockedMap,
								},
							),
						);
					}
					return;
				}

				if (Math.abs(mx) > 0 || Math.abs(my) > 0) {
					const actualDelta = newStart - dragRefs.current.initialStart;
					const originalTrackIndex = element.timeline.trackIndex ?? 0;
					const isLeavingMainTrack =
						originalTrackIndex === 0 &&
						hasSignificantVerticalMove &&
						(resolvedDropTarget.type === "gap" ||
							resolvedDropTarget.trackIndex > 0);

					const attachedChildren: { id: string; start: number; end: number }[] =
						[];
					if (autoAttach && actualDelta !== 0 && !isLeavingMainTrack) {
						const childIds = attachments.get(element.id) ?? [];
						for (const childId of childIds) {
							const child = elements.find((el) => el.id === childId);
							if (child) {
								const childTrackIndex = child.timeline.trackIndex ?? 0;
								if (trackLockedMap.get(childTrackIndex)) {
									continue;
								}
								const childNewStart = child.timeline.start + actualDelta;
								const childNewEnd = child.timeline.end + actualDelta;
								if (childNewStart >= 0) {
									attachedChildren.push({
										id: childId,
										start: childNewStart,
										end: childNewEnd,
									});
								}
							}
						}
					}

					moveWithAttachments(
						element.id,
						newStart,
						newEnd,
						resolvedDropTarget,
						attachedChildren,
					);
				}
			} else {
				if (!isCopyDrag) {
					setLocalStartTime(newStart);
					setLocalEndTime(newEnd);
					setLocalTrackY(newY);
				}
				setActiveSnapPoint(shouldUseRippleEditing ? null : snapPoint);

				const ghostWidth = isTransition
					? Math.max(6, transitionDuration * ratio)
					: (newEnd - newStart) * ratio;
				const ghostId = activeCopyId ?? element.id;
				setDragGhosts([
					{
						elementId: ghostId,
						element,
						screenX: xy[0] - initialMouseOffsetRef.current.x,
						screenY: xy[1] - initialMouseOffsetRef.current.y,
						width: ghostWidth,
						height: elementHeight,
						clonedNode: clonedNodeRef.current,
					},
				]);

				if (shouldUseRippleEditing) {
					const dropStartForRippleEditing =
						getMainTrackDropStart(
							xy[0],
							xy[1],
							currentScrollLeft,
							initialMouseOffsetRef.current.x,
						) ?? newStart;
					setActiveDropTarget({
						type: "track",
						trackIndex: 0,
						elementId: ghostId,
						start: dropStartForRippleEditing,
						end: dropStartForRippleEditing + (newEnd - newStart),
						finalTrackIndex: 0,
					});
				} else if (finalTrackResult) {
					setActiveDropTarget({
						type: finalTrackResult.displayType,
						trackIndex:
							finalTrackResult.displayType === "gap"
								? finalTrackResult.trackIndex
								: resolvedDropTarget.trackIndex,
						elementId: ghostId,
						start: newStart,
						end: newEnd,
						finalTrackIndex: finalTrackResult.trackIndex,
					});
				}

				const scrollArea = document.querySelector<HTMLElement>(
					"[data-timeline-scroll-area]",
				);
				if (scrollArea) {
					const scrollRect = scrollArea.getBoundingClientRect();
					updateAutoScrollFromPosition(
						xy[0],
						scrollRect.left,
						scrollRect.right,
					);
				}

				const verticalScrollArea = document.querySelector<HTMLElement>(
					"[data-vertical-scroll-area]",
				);
				if (verticalScrollArea) {
					const verticalRect = verticalScrollArea.getBoundingClientRect();
					updateAutoScrollYFromPosition(
						xy[1],
						verticalRect.top,
						verticalRect.bottom,
					);
				}
			}
		},
		{ filterTaps: true },
	);

	return { bindLeftDrag, bindRightDrag, bindBodyDrag };
};
