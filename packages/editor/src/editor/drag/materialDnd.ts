import { useDrag } from "@use-gesture/react";
import type { TimelineElement, TrackRole } from "core/dsl/types";
import { useMemo, useRef } from "react";
import { toast } from "@/lib/toast";
import { clampFrame, secondsToFrames } from "@/utils/timecode";
import {
	useFps,
	useTimelineScale,
	useTimelineStore,
	useTracks,
} from "../contexts/TimelineContext";
import { DEFAULT_TRACK_HEIGHT } from "../timeline/trackConfig";
import { getAudioTrackControlState } from "../utils/audioTrackState";
import { getPixelsPerFrame } from "../utils/timelineScale";
import {
	getElementRole,
	getStoredTrackAssignments,
	getTrackRoleMapFromTracks,
	hasOverlapOnTrack,
	isRoleCompatibleWithTrack,
	MAIN_TRACK_INDEX,
} from "../utils/trackAssignment";
import { isTransitionElement } from "../utils/transitions";
import {
	calculateAutoScrollSpeed,
	type DragGhostInfo,
	type DropTargetInfo,
	type MaterialDragData,
	useDragStore,
} from "./dragStore";
import {
	findTimelineDropTargetFromScreenPosition,
	getPreviewDropTargetFromScreenPosition,
	getTimelineDropTimeFromScreenX,
} from "./timelineDropTargets";

export interface MaterialDndItem {
	id: string;
	type: MaterialDragData["type"];
	name: string;
	uri: string;
	thumbnailUrl?: string;
	width?: number;
	height?: number;
	duration?: number;
}

export interface MaterialDndContext {
	fps: number;
	ratio: number;
	defaultDurationFrames: number;
	elements: TimelineElement[];
	trackAssignments: Map<string, number>;
	trackRoleMap: Map<number, TrackRole>;
	trackLockedMap: Map<number, boolean>;
	trackCount: number;
	rippleEditingEnabled: boolean;
}

export function useMaterialDndContext(): MaterialDndContext {
	const { fps } = useFps();
	const { timelineScale } = useTimelineScale();
	const ratio = getPixelsPerFrame(fps, timelineScale);
	const elements = useTimelineStore((state) => state.elements);
	const rippleEditingEnabled = useTimelineStore(
		(state) => state.rippleEditingEnabled,
	);
	const { tracks, audioTrackStates } = useTracks();
	const trackAssignments = useMemo(
		() => getStoredTrackAssignments(elements),
		[elements],
	);
	const trackRoleMap = useMemo(
		() => getTrackRoleMapFromTracks(tracks),
		[tracks],
	);
	const trackLockedMap = useMemo(() => {
		const map = new Map<number, boolean>(
			tracks.map((track, index) => [index, track.locked ?? false]),
		);
		for (const trackIndexRaw of Object.keys(audioTrackStates)) {
			const trackIndex = Number(trackIndexRaw);
			if (!Number.isFinite(trackIndex)) continue;
			const state = getAudioTrackControlState(audioTrackStates, trackIndex);
			map.set(trackIndex, state.locked);
		}
		return map;
	}, [tracks, audioTrackStates]);
	const trackCount = tracks.length || 1;
	const defaultDurationFrames = useMemo(() => secondsToFrames(5, fps), [fps]);

	return {
		fps,
		ratio,
		defaultDurationFrames,
		elements,
		trackAssignments,
		trackRoleMap,
		trackLockedMap,
		trackCount,
		rippleEditingEnabled,
	};
}

const defaultMaterialRole = (item: MaterialDndItem): TrackRole => {
	switch (item.type) {
		case "audio":
			return "audio";
		case "text":
			return "overlay";
		case "transition":
			return "clip";
		default:
			return "clip";
	}
};

const defaultMaterialDurationFrames = (
	item: MaterialDndItem,
	defaultDurationFrames: number,
): number => {
	if (Number.isFinite(item.duration) && (item.duration ?? 0) > 0) {
		return item.duration as number;
	}
	return defaultDurationFrames;
};

const defaultGhostInfo = (
	item: MaterialDndItem,
	position: { screenX: number; screenY: number },
	size: { width: number; height: number },
): DragGhostInfo => ({
	screenX: position.screenX,
	screenY: position.screenY,
	width: size.width,
	height: size.height,
	thumbnailUrl: item.thumbnailUrl,
	label: item.name,
});

export interface MaterialDropTargetState {
	materialRole: TrackRole;
	materialDurationFrames: number;
	isTransitionMaterial: boolean;
}

export function resolveMaterialDropTarget(
	context: MaterialDndContext,
	state: MaterialDropTargetState,
	screenX: number,
	screenY: number,
): DropTargetInfo | null {
	const previewTarget = getPreviewDropTargetFromScreenPosition(
		screenX,
		screenY,
	);
	if (previewTarget) {
		if (state.isTransitionMaterial || state.materialRole === "audio") {
			return { ...previewTarget, canDrop: false };
		}
		return previewTarget;
	}

	const otherTrackCountFallback = Math.max(context.trackCount - 1, 0);
	const baseDropTarget = findTimelineDropTargetFromScreenPosition(
		screenX,
		screenY,
		otherTrackCountFallback,
		DEFAULT_TRACK_HEIGHT,
		false,
	);
	if (!baseDropTarget) return null;

	const scrollLeft = useDragStore.getState().timelineScrollLeft;
	const rawTime = getTimelineDropTimeFromScreenX(
		screenX,
		baseDropTarget.trackIndex,
		context.ratio,
		scrollLeft,
	);
	if (rawTime === null) return null;

	const time = clampFrame(rawTime);
	const dropEnd = time + state.materialDurationFrames;

	const isTrackLocked = (trackIndex: number): boolean =>
		context.trackLockedMap.get(trackIndex) ?? false;

	const resolveTrackRole = (trackIndex: number): TrackRole => {
		if (trackIndex < MAIN_TRACK_INDEX) return "audio";
		if (trackIndex === MAIN_TRACK_INDEX) return "clip";
		return context.trackRoleMap.get(trackIndex) ?? "overlay";
	};

	const shouldForceGapInsert = (
		trackIndex: number,
		start: number,
		end: number,
	): boolean => {
		if (!isRoleCompatibleWithTrack(state.materialRole, trackIndex)) return true;
		if (resolveTrackRole(trackIndex) !== state.materialRole) return true;
		if (trackIndex === MAIN_TRACK_INDEX && context.rippleEditingEnabled) {
			return false;
		}
		return hasOverlapOnTrack(
			start,
			end,
			trackIndex,
			context.elements,
			context.trackAssignments,
		);
	};

	const normalizeGapIndex = (trackIndex: number): number =>
		Math.max(MAIN_TRACK_INDEX + 1, trackIndex);

	const isClipTrack = (trackIndex: number): boolean => {
		if (trackIndex === MAIN_TRACK_INDEX) return true;
		if (trackIndex < MAIN_TRACK_INDEX) return false;
		return context.trackRoleMap.get(trackIndex) === "clip";
	};

	const resolveTransitionBoundary = (timeValue: number, trackIndex: number) => {
		const thresholdFrames = Math.max(1, Math.round(8 / context.ratio));
		const clips = context.elements
			.filter(
				(el) =>
					(el.timeline.trackIndex ?? MAIN_TRACK_INDEX) === trackIndex &&
					getElementRole(el) === "clip" &&
					!isTransitionElement(el),
			)
			.sort((a, b) => {
				if (a.timeline.start !== b.timeline.start) {
					return a.timeline.start - b.timeline.start;
				}
				if (a.timeline.end !== b.timeline.end) {
					return a.timeline.end - b.timeline.end;
				}
				return a.id.localeCompare(b.id);
			});

		let best: {
			boundary: number;
			fromId: string;
			toId: string;
			distance: number;
		} | null = null;
		for (let i = 0; i < clips.length - 1; i += 1) {
			const prev = clips[i];
			const next = clips[i + 1];
			if (prev.timeline.end !== next.timeline.start) continue;
			const boundary = prev.timeline.end;
			const distance = Math.abs(boundary - timeValue);
			if (distance > thresholdFrames) continue;
			if (!best || distance < best.distance) {
				best = {
					boundary,
					fromId: prev.id,
					toId: next.id,
					distance,
				};
			}
		}

		if (!best) return null;

		const hasExisting = context.elements.some(
			(el) =>
				isTransitionElement(el) &&
				(el.timeline.trackIndex ?? MAIN_TRACK_INDEX) === trackIndex &&
				(el.transition?.boundry === best.boundary ||
					(el.transition?.fromId === best.fromId &&
						el.transition?.toId === best.toId)),
		);
		if (hasExisting) return null;

		return { boundary: best.boundary, fromId: best.fromId, toId: best.toId };
	};

	if (state.isTransitionMaterial) {
		if (
			baseDropTarget.type === "track" &&
			isTrackLocked(baseDropTarget.trackIndex)
		) {
			return {
				zone: "timeline",
				type: baseDropTarget.type,
				trackIndex: baseDropTarget.trackIndex,
				time,
				canDrop: false,
			};
		}
		if (
			baseDropTarget.type === "gap" ||
			!isClipTrack(baseDropTarget.trackIndex)
		) {
			return {
				zone: "timeline",
				type: baseDropTarget.type,
				trackIndex: baseDropTarget.trackIndex,
				time,
				canDrop: false,
			};
		}

		const target = resolveTransitionBoundary(time, baseDropTarget.trackIndex);
		if (!target) {
			return {
				zone: "timeline",
				type: "track",
				trackIndex: baseDropTarget.trackIndex,
				time,
				canDrop: false,
			};
		}

		return {
			zone: "timeline",
			type: "track",
			trackIndex: baseDropTarget.trackIndex,
			time: target.boundary,
			canDrop: true,
		};
	}

	if (
		baseDropTarget.trackIndex < MAIN_TRACK_INDEX &&
		state.materialRole !== "audio"
	) {
		return {
			zone: "timeline",
			type: baseDropTarget.type,
			trackIndex: baseDropTarget.trackIndex,
			time,
			canDrop: false,
		};
	}

	if (state.materialRole === "audio") {
		if (baseDropTarget.trackIndex >= MAIN_TRACK_INDEX) {
			return {
				zone: "timeline",
				type: "track",
				trackIndex: -1,
				time,
				canDrop: true,
			};
		}

		let resolvedDropTarget = baseDropTarget;
		if (resolvedDropTarget.type === "gap") {
			const gapIndex =
				resolvedDropTarget.trackIndex < MAIN_TRACK_INDEX
					? resolvedDropTarget.trackIndex
					: -1;
			resolvedDropTarget = { type: "gap", trackIndex: gapIndex };
		}

		if (
			resolvedDropTarget.type === "track" &&
			shouldForceGapInsert(resolvedDropTarget.trackIndex, time, dropEnd)
		) {
			resolvedDropTarget = {
				type: "gap",
				trackIndex: resolvedDropTarget.trackIndex,
			};
		}

		return {
			zone: "timeline",
			type: resolvedDropTarget.type,
			trackIndex: resolvedDropTarget.trackIndex,
			time,
			canDrop:
				resolvedDropTarget.type === "gap" ||
				!isTrackLocked(resolvedDropTarget.trackIndex),
		};
	}

	let resolvedDropTarget =
		baseDropTarget.type === "gap"
			? {
					...baseDropTarget,
					trackIndex: normalizeGapIndex(baseDropTarget.trackIndex),
				}
			: baseDropTarget;

	if (
		resolvedDropTarget.type === "track" &&
		shouldForceGapInsert(resolvedDropTarget.trackIndex, time, dropEnd)
	) {
		resolvedDropTarget = {
			type: "gap",
			trackIndex: normalizeGapIndex(resolvedDropTarget.trackIndex),
		};
	}

	return {
		zone: "timeline",
		type: resolvedDropTarget.type,
		trackIndex: resolvedDropTarget.trackIndex,
		time,
		canDrop:
			resolvedDropTarget.type === "gap" ||
			!isTrackLocked(resolvedDropTarget.trackIndex),
	};
}

export interface UseMaterialDndOptions<T extends MaterialDndItem> {
	item: T;
	context: MaterialDndContext;
	onTimelineDrop?: (
		item: T,
		trackIndex: number,
		time: number,
		dropTargetType?: "track" | "gap",
	) => void;
	onPreviewDrop?: (item: T, positionX: number, positionY: number) => void;
	getRole?: (item: T) => TrackRole;
	getDurationFrames?: (item: T, defaultDurationFrames: number) => number;
	getDragData?: (item: T) => MaterialDragData;
	getGhostInfo?: (
		item: T,
		position: { screenX: number; screenY: number },
		size: { width: number; height: number },
	) => DragGhostInfo;
	ghostSize?: { width: number; height: number };
}

export function useMaterialDnd<T extends MaterialDndItem>({
	item,
	context,
	onTimelineDrop,
	onPreviewDrop,
	getRole = defaultMaterialRole,
	getDurationFrames = defaultMaterialDurationFrames,
	getDragData = (target) => ({
		type: target.type,
		uri: target.uri,
		name: target.name,
		thumbnailUrl: target.thumbnailUrl,
		width: target.width,
		height: target.height,
		duration: target.duration,
	}),
	getGhostInfo = defaultGhostInfo,
	ghostSize = { width: 120, height: 80 },
}: UseMaterialDndOptions<T>) {
	const {
		startDrag,
		updateGhost,
		updateDropTarget,
		endDrag,
		isDragging,
		ghostInfo,
		dragSource,
		setAutoScrollSpeedX,
		setAutoScrollSpeedY,
		stopAutoScroll,
	} = useDragStore();
	const dragRef = useRef<HTMLElement | null>(null);
	const initialOffsetRef = useRef({ x: 0, y: 0 });
	const materialRole = getRole(item);
	const materialDurationFrames = getDurationFrames(
		item,
		context.defaultDurationFrames,
	);
	const isTransitionMaterial = item.type === "transition";

	const bindDrag = useDrag(
		({ xy, first, last, event }) => {
			if (first) {
				event?.preventDefault();
				event?.stopPropagation();
				initialOffsetRef.current = {
					x: ghostSize.width / 2,
					y: ghostSize.height / 2,
				};

				const dragData = getDragData(item);
				const ghost = getGhostInfo(
					item,
					{
						screenX: xy[0] - initialOffsetRef.current.x,
						screenY: xy[1] - initialOffsetRef.current.y,
					},
					ghostSize,
				);

				startDrag("material-library", dragData, ghost);
				return;
			}

			if (last) {
				stopAutoScroll();
				const currentDropTarget = useDragStore.getState().dropTarget;
				if (
					item.type === "transition" &&
					(!currentDropTarget ||
						currentDropTarget.zone !== "timeline" ||
						!currentDropTarget.canDrop)
				) {
					toast.error("Drop the transition between adjacent clips.");
				}
				if (currentDropTarget?.canDrop) {
					if (
						currentDropTarget.zone === "timeline" &&
						currentDropTarget.time !== undefined &&
						currentDropTarget.trackIndex !== undefined
					) {
						onTimelineDrop?.(
							item,
							currentDropTarget.trackIndex,
							currentDropTarget.time,
							currentDropTarget.type ?? "track",
						);
					} else if (
						currentDropTarget.zone === "preview" &&
						currentDropTarget.positionX !== undefined &&
						currentDropTarget.positionY !== undefined
					) {
						onPreviewDrop?.(
							item,
							currentDropTarget.positionX,
							currentDropTarget.positionY,
						);
					}
				}
				endDrag();
				return;
			}

			updateGhost({
				screenX: xy[0] - initialOffsetRef.current.x,
				screenY: xy[1] - initialOffsetRef.current.y,
			});

			const dropTarget = resolveMaterialDropTarget(
				context,
				{
					materialRole,
					materialDurationFrames,
					isTransitionMaterial,
				},
				xy[0],
				xy[1],
			);
			updateDropTarget(dropTarget);

			const scrollArea = document.querySelector<HTMLElement>(
				"[data-timeline-scroll-area]",
			);
			if (scrollArea) {
				const scrollRect = scrollArea.getBoundingClientRect();
				const speedX = calculateAutoScrollSpeed(
					xy[0],
					scrollRect.left,
					scrollRect.right,
				);
				setAutoScrollSpeedX(speedX);
			}

			const verticalScrollArea = document.querySelector<HTMLElement>(
				"[data-vertical-scroll-area]",
			);
			if (verticalScrollArea) {
				const verticalRect = verticalScrollArea.getBoundingClientRect();
				const speedY = calculateAutoScrollSpeed(
					xy[1],
					verticalRect.top,
					verticalRect.bottom,
				);
				setAutoScrollSpeedY(speedY);
			}
		},
		{ filterTaps: true },
	);

	const isBeingDragged =
		isDragging && dragSource === "material-library" && ghostInfo !== null;

	return { bindDrag, dragRef, isBeingDragged };
}
