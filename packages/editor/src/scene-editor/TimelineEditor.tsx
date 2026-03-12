import { useDrag } from "@use-gesture/react";
import type { TimelineElement as TimelineElementType } from "core/element/types";
import type React from "react";
import {
	startTransition,
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/projects/projectStore";
import { useProjectAssets } from "@/projects/useProjectAssets";
import { hasSceneAudibleLeafAudio } from "@/scene-editor/audio/sceneReferenceAudio";
import TimeIndicatorCanvas from "@/scene-editor/components/TimeIndicatorCanvas";
import {
	useModelRegistry,
	useStudioRuntimeManager,
	useTimelineStoreApi,
} from "@/scene-editor/runtime/EditorRuntimeProvider";
import { getCanvasNodeDefinition } from "@/studio/canvas/node-system/registry";
import { useStudioClipboardStore } from "@/studio/clipboard/studioClipboardStore";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { clampFrame } from "@/utils/timecode";
import TimelineContextMenu, {
	type TimelineContextMenuAction,
} from "./components/TimelineContextMenu";
import TimelineDragOverlay from "./components/TimelineDragOverlay";
import TimelineElement from "./components/TimelineElement";
import TimelineRuler from "./components/TimelineRuler";
import TimelineToolbar from "./components/TimelineToolbar";
import TimelineTrackSidebarItem from "./components/TimelineTrackSidebarItem";
import {
	useAttachments,
	useAutoScroll,
	useCurrentTime,
	useDragging,
	useElements,
	useFps,
	useMultiSelect,
	usePlaybackControl,
	usePreviewAxis,
	useRippleEditing,
	useSnap,
	useTimelineScale,
	useTimelineStore,
	useTrackAssignments,
	useTracks,
} from "./contexts/TimelineContext";
import { MaterialDragOverlay, useDragStore } from "./drag";
import {
	findTimelineDropTargetFromScreenPosition,
	getTimelineDropTimeFromScreenX,
} from "./drag/timelineDropTargets";
import { useExternalMaterialDnd } from "./hooks/useExternalMaterialDnd";
import {
	DEFAULT_TRACK_HEIGHT,
	TRACK_CONTENT_GAP,
} from "./timeline/trackConfig";
import { getAudioTrackControlState } from "./utils/audioTrackState";
import {
	detachCompositionAudio,
	isCompositionSourceAudioMuted,
	restoreCompositionAudio,
} from "./utils/compositionAudioSeparation";
import { finalizeTimelineElements } from "./utils/mainTrackMagnet";
import { resolveElementSourceUri } from "./utils/source";
import {
	buildTimelineClipboardPayload,
	pasteTimelineClipboardPayload,
	type TimelineClipboardPayload,
} from "./utils/timelineClipboard";
import { getPixelsPerFrame } from "./utils/timelineScale";
import { updateElementTime } from "./utils/timelineTime";
import { MAX_TIMELINE_SCALE, MIN_TIMELINE_SCALE } from "./utils/timelineZoom";
import {
	buildTrackLayout,
	getTrackHeightByRole,
} from "./utils/trackAssignment";
import { reconcileTransitions } from "./utils/transitions";
import {
	detachVideoClipAudio,
	isVideoSourceAudioMuted,
	restoreVideoClipAudio,
} from "./utils/videoClipAudioSeparation";

const normalizeOffsetFrames = (value: unknown): number => {
	if (!Number.isFinite(value as number)) return 0;
	return Math.max(0, Math.round(value as number));
};

const shouldUpdateOffset = (element: TimelineElementType): boolean => {
	return (
		element.type === "VideoClip" ||
		element.type === "AudioClip" ||
		element.type === "Composition" ||
		element.type === "CompositionAudioClip"
	);
};

const createTimelineClipboardElementId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `element-${crypto.randomUUID()}`;
	}
	return `element-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const getVideoClipHasSourceAudioTrack = (
	modelRegistry: ReturnType<typeof useModelRegistry>,
	element: TimelineElementType | undefined,
): boolean => {
	if (!element || element.type !== "VideoClip") return false;
	const model = modelRegistry.get(element.id);
	if (!model) {
		return true;
	}
	const internal = (
		model.getState() as {
			internal?: { hasSourceAudioTrack?: unknown };
		}
	).internal;
	return internal?.hasSourceAudioTrack !== false;
};

const getCompositionHasSourceAudioTrack = (
	runtimeManager: ReturnType<typeof useStudioRuntimeManager>,
	element: TimelineElementType | undefined,
): boolean => {
	if (!element || element.type !== "Composition") return false;
	const rawSceneId = (element.props as { sceneId?: unknown } | undefined)
		?.sceneId;
	if (typeof rawSceneId !== "string" || rawSceneId.trim().length === 0) {
		return false;
	}
	const sceneRef = toSceneTimelineRef(rawSceneId.trim());
	const sceneRuntime =
		runtimeManager.getTimelineRuntime(sceneRef) ??
		runtimeManager.ensureTimelineRuntime(sceneRef);
	return hasSceneAudibleLeafAudio({
		sceneRuntime,
		runtimeManager,
	});
};

const LOCKED_TRACK_OVERLAY_STYLE: React.CSSProperties = {
	backgroundImage:
		"linear-gradient(135deg, rgba(255, 255, 255, 0.16) 25%, rgba(255, 255, 255, 0) 25%, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.16) 50%, rgba(255, 255, 255, 0.16) 75%, rgba(255, 255, 255, 0) 75%, rgba(255, 255, 255, 0))",
	backgroundSize: "4px 4px",
};

const PLAYHEAD_FOLLOW_MANUAL_DEBOUNCE_MS = 300;
const AUTO_FOLLOW_SCROLL_MATCH_EPSILON = 0.5;

const applyOffsetDelta = (
	element: TimelineElementType,
	offsetDelta?: number,
): TimelineElementType => {
	if (!offsetDelta) return element;
	if (!shouldUpdateOffset(element)) return element;
	const currentOffset = normalizeOffsetFrames(element.timeline.offset);
	const nextOffset = Math.max(0, currentOffset + offsetDelta);
	if (nextOffset === currentOffset) return element;
	return {
		...element,
		timeline: {
			...element.timeline,
			offset: nextOffset,
		},
	};
};

interface TimelinePasteTarget {
	time: number;
	trackIndex: number;
	dropType: "track" | "gap";
}

type TimelineContextMenuState =
	| { open: false }
	| {
			open: true;
			x: number;
			y: number;
			scope: "element";
			targetIds: string[];
			primaryId: string | null;
	  }
	| {
			open: true;
			x: number;
			y: number;
			scope: "timeline";
			pasteTarget: TimelinePasteTarget;
	  };

const TimelineEditor = () => {
	const timelineStore = useTimelineStoreApi();
	const modelRegistry = useModelRegistry();
	const runtimeManager = useStudioRuntimeManager();
	const scrollLeft = useTimelineStore((state) => state.scrollLeft);
	const setScrollLeft = useTimelineStore((state) => state.setScrollLeft);
	const setTimelineMaxScrollLeft = useTimelineStore(
		(state) => state.setTimelineMaxScrollLeft,
	);
	const setTimelineViewportWidth = useTimelineStore(
		(state) => state.setTimelineViewportWidth,
	);
	const setPreviewTime = useTimelineStore((state) => state.setPreviewTime);
	const { previewAxisEnabled } = usePreviewAxis();
	const { isPlaying, pause } = usePlaybackControl();
	const { currentTime, setCurrentTime: seekTo } = useCurrentTime();
	const { fps } = useFps();
	const { assets } = useProjectAssets();
	const currentProject = useProjectStore((state) => state.currentProject);
	const { timelineScale, setTimelineScale } = useTimelineScale();
	const { elements, setElements } = useElements();
	const { selectedIds, primaryId, deselectAll, setSelection } =
		useMultiSelect();
	const clipboardPayload = useStudioClipboardStore((state) => state.payload);
	const setStudioClipboardPayload = useStudioClipboardStore(
		(state) => state.setPayload,
	);
	const setTimelineEditorMounted = useTimelineStore(
		(state) => state.setTimelineEditorMounted,
	);
	const setTimelineEditorHovered = useTimelineStore(
		(state) => state.setTimelineEditorHovered,
	);
	const { activeSnapPoint } = useSnap();
	const { trackAssignments, trackCount } = useTrackAssignments();
	const {
		tracks,
		audioTrackStates,
		toggleTrackHidden,
		toggleTrackLocked,
		toggleTrackMuted,
		toggleTrackSolo,
		toggleAudioTrackLocked,
		toggleAudioTrackMuted,
		toggleAudioTrackSolo,
	} = useTracks();
	const { activeDropTarget, dragGhosts, isDragging } = useDragging();
	const { autoScrollSpeed, autoScrollSpeedY } = useAutoScroll();
	const { attachments, autoAttach } = useAttachments();
	const { rippleEditingEnabled } = useRippleEditing();
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
	const [contextMenuState, setContextMenuState] =
		useState<TimelineContextMenuState>({ open: false });
	const postProcessOptions = useMemo(
		() => ({
			rippleEditingEnabled,
			attachments,
			autoAttach,
			fps,
			trackLockedMap,
		}),
		[rippleEditingEnabled, attachments, autoAttach, fps, trackLockedMap],
	);
	const closeContextMenu = useCallback(() => {
		setContextMenuState({ open: false });
	}, []);

	useEffect(() => {
		setTimelineEditorMounted(true);
		return () => {
			setTimelineEditorHovered(false);
			setTimelineEditorMounted(false);
		};
	}, [setTimelineEditorHovered, setTimelineEditorMounted]);
	const resolveTimelineSceneId = useCallback((): string | null => {
		for (const timelineRuntime of runtimeManager.listTimelineRuntimes()) {
			if (timelineRuntime.timelineStore === timelineStore) {
				return timelineRuntime.ref.sceneId;
			}
		}
		return runtimeManager.getActiveEditTimelineRef()?.sceneId ?? null;
	}, [runtimeManager, timelineStore]);
	const copyElementsByIds = useCallback(
		(targetIds: string[], targetPrimaryId: string | null) => {
			const timelineState = timelineStore.getState();
			const payload = buildTimelineClipboardPayload({
				elements,
				selectedIds: targetIds,
				primaryId: targetPrimaryId,
				source: {
					sceneId: resolveTimelineSceneId(),
					canvasSize: timelineState.canvasSize,
					fps: timelineState.fps,
				},
			});
			if (!payload) return null;
			setStudioClipboardPayload({
				kind: "timeline-elements",
				payload,
				source: payload.source,
			});
			return payload;
		},
		[
			elements,
			resolveTimelineSceneId,
			setStudioClipboardPayload,
			timelineStore,
		],
	);
	const buildTimelinePayloadFromCanvasClipboard =
		useCallback((): TimelineClipboardPayload | null => {
			if (!clipboardPayload || clipboardPayload.kind !== "canvas-nodes") {
				return null;
			}
			if (!currentProject) return null;
			const targetSceneId = resolveTimelineSceneId();
			const projectForConversion =
				targetSceneId && currentProject.scenes[targetSceneId]
					? {
							...currentProject,
							scenes: {
								...currentProject.scenes,
								[targetSceneId]: {
									...currentProject.scenes[targetSceneId],
									timeline: {
										...currentProject.scenes[targetSceneId].timeline,
										elements,
									},
								},
							},
						}
					: currentProject;
			const orderedEntries = [...clipboardPayload.entries].sort(
				(left, right) => {
					if (left.node.zIndex !== right.node.zIndex) {
						return left.node.zIndex - right.node.zIndex;
					}
					return left.node.createdAt - right.node.createdAt;
				},
			);
			let nextStartFrame = 0;
			const convertedElements: TimelineElementType[] = [];
			for (const entry of orderedEntries) {
				const definition = getCanvasNodeDefinition(entry.node.type);
				const scene =
					entry.node.type === "scene"
						? (entry.scene ??
							projectForConversion.scenes[entry.node.sceneId] ??
							null)
						: null;
				const assetId = "assetId" in entry.node ? entry.node.assetId : null;
				const asset = assetId
					? (currentProject.assets.find((item) => item.id === assetId) ?? null)
					: null;
				const converted = definition.toTimelineClipboardElement?.({
					node: entry.node,
					project: projectForConversion,
					targetSceneId,
					scene,
					asset,
					fps,
					startFrame: nextStartFrame,
					trackIndex: entry.node.type === "audio" ? -1 : 0,
					createElementId: createTimelineClipboardElementId,
				});
				if (!converted) continue;
				convertedElements.push(converted);
				nextStartFrame = Math.max(
					nextStartFrame,
					Math.round(converted.timeline.end),
				);
			}
			if (convertedElements.length === 0) return null;
			const anchorElement = convertedElements[0];
			return {
				elements: convertedElements,
				primaryId: anchorElement.id,
				anchor: {
					assetId: anchorElement.id,
					start: anchorElement.timeline.start,
					trackIndex: anchorElement.timeline.trackIndex ?? 0,
				},
			};
		}, [
			clipboardPayload,
			currentProject,
			elements,
			fps,
			resolveTimelineSceneId,
		]);
	const deleteElementsByIds = useCallback(
		(targetIds: string[]) => {
			if (targetIds.length === 0) return;
			const removedSet = new Set(targetIds);
			setElements((prev) => {
				const nextElements = prev.filter((el) => !removedSet.has(el.id));
				if (nextElements.length === prev.length) return prev;
				if (rippleEditingEnabled) {
					return finalizeTimelineElements(nextElements, postProcessOptions);
				}
				// 删除 clip 后需要清理失效的转场
				return reconcileTransitions(nextElements, fps);
			});
			deselectAll();
		},
		[deselectAll, fps, postProcessOptions, rippleEditingEnabled, setElements],
	);
	const deleteSelectedElements = useCallback(() => {
		if (selectedIds.length === 0) return;
		deleteElementsByIds(selectedIds);
	}, [deleteElementsByIds, selectedIds]);
	const cutElementsByIds = useCallback(
		(targetIds: string[], targetPrimaryId: string | null) => {
			const payload = copyElementsByIds(targetIds, targetPrimaryId);
			if (!payload) return;
			deleteElementsByIds(payload.elements.map((element) => element.id));
		},
		[copyElementsByIds, deleteElementsByIds],
	);
	const pasteFromClipboard = useCallback(
		(target: TimelinePasteTarget) => {
			if (!clipboardPayload) return false;
			const payload =
				clipboardPayload.kind === "timeline-elements"
					? clipboardPayload.payload
					: buildTimelinePayloadFromCanvasClipboard();
			if (!payload) return false;
			const pasteResult = pasteTimelineClipboardPayload({
				payload,
				elements,
				targetTime: target.time,
				targetTrackIndex: target.trackIndex,
				targetType: target.dropType,
				postProcessOptions,
			});
			if (pasteResult.insertedIds.length === 0) {
				return false;
			}
			setElements(pasteResult.elements);
			setSelection(pasteResult.insertedIds, pasteResult.primaryId);
			return true;
		},
		[
			buildTimelinePayloadFromCanvasClipboard,
			clipboardPayload,
			elements,
			postProcessOptions,
			setElements,
			setSelection,
		],
	);
	const handleElementContextMenu = useCallback(
		(event: React.MouseEvent<HTMLDivElement>, elementId: string) => {
			pause();
			const isSelectedElement = selectedIds.includes(elementId);
			const targetIds = isSelectedElement ? selectedIds : [elementId];
			const targetPrimaryId = isSelectedElement
				? primaryId && selectedIds.includes(primaryId)
					? primaryId
					: elementId
				: elementId;
			if (!isSelectedElement) {
				setSelection([elementId], elementId);
			}
			setContextMenuState({
				open: true,
				x: event.clientX,
				y: event.clientY,
				scope: "element",
				targetIds,
				primaryId: targetPrimaryId,
			});
		},
		[pause, primaryId, selectedIds, setSelection],
	);

	const rippleEditingRef = useRef(rippleEditingEnabled);

	// 滚动位置 refs
	const containerRef = useRef<HTMLDivElement>(null);
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	const verticalScrollRef = useRef<HTMLDivElement>(null);
	const scrollLeftRef = useRef(0);
	const touchStartXRef = useRef(0);
	const isSelectingRef = useRef(false);
	const selectionAdditiveRef = useRef(false);
	const initialSelectedIdsRef = useRef<string[]>([]);
	const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
	const selectionActivatedRef = useRef(false);
	const timeStampsRef = useRef<HTMLDivElement>(null);
	const isRulerDraggingRef = useRef(false);
	const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(
		null,
	);
	const lastHoverRef = useRef<{
		clientX: number;
		clientY: number;
		rectLeft: number;
		rectRight: number;
		rectTop: number;
		rectBottom: number;
	} | null>(null);
	const wasDraggingRef = useRef(false);
	const lastPreviewTimeRef = useRef<number | null>(null);
	const previewTimeRafRef = useRef<number | null>(null);
	const pendingPreviewTimeRef = useRef<number | null>(null);
	const currentTimeRafRef = useRef<number | null>(null);
	const pendingCurrentTimeRef = useRef<number | null>(null);
	const manualScrollSuppressUntilRef = useRef(0);
	const pendingAutoFollowScrollLeftRef = useRef<number | null>(null);
	const lastObservedScrollLeftRef = useRef<number | null>(null);

	// 左侧列宽度状态
	const [leftColumnWidth] = useState(172); // 默认 44 * 4 = 176px (w-44)

	// 时间刻度尺宽度
	const [rulerWidth, setRulerWidth] = useState(800);
	const observerRef = useRef<ResizeObserver | null>(null);
	const [selectionRect, setSelectionRect] = useState({
		visible: false,
		x1: 0,
		y1: 0,
		x2: 0,
		y2: 0,
	});
	const selectionRectRef = useRef(selectionRect);
	useEffect(() => {
		const handleWindowMouseMove = (event: MouseEvent) => {
			lastPointerRef.current = {
				clientX: event.clientX,
				clientY: event.clientY,
			};
		};
		window.addEventListener("mousemove", handleWindowMouseMove, {
			passive: true,
		});
		return () => {
			window.removeEventListener("mousemove", handleWindowMouseMove);
		};
	}, []);
	useEffect(() => {
		if (rippleEditingEnabled && !rippleEditingRef.current) {
			setElements(
				(prev) =>
					finalizeTimelineElements(prev, {
						rippleEditingEnabled: true,
						attachments,
						autoAttach,
						fps,
						trackLockedMap,
					}),
				{ history: false },
			);
		}
		rippleEditingRef.current = rippleEditingEnabled;
	}, [
		rippleEditingEnabled,
		setElements,
		attachments,
		autoAttach,
		fps,
		trackLockedMap,
	]);
	const resolveTimelinePasteTargetFromPointer =
		useCallback((): TimelinePasteTarget | null => {
			const pointer = lastPointerRef.current;
			if (!pointer) return null;
			const dropTarget = findTimelineDropTargetFromScreenPosition(
				pointer.clientX,
				pointer.clientY,
				Math.max(0, trackCount - 1),
				DEFAULT_TRACK_HEIGHT,
				false,
			);
			if (!dropTarget) return null;
			const timelineState = timelineStore.getState();
			const ratio = getPixelsPerFrame(
				timelineState.fps,
				timelineState.timelineScale,
			);
			if (!Number.isFinite(ratio) || ratio <= 0) return null;
			const dropTime = getTimelineDropTimeFromScreenX(
				pointer.clientX,
				dropTarget.trackIndex,
				ratio,
				timelineState.scrollLeft,
			);
			if (dropTime === null) return null;
			return {
				time: dropTime,
				trackIndex: dropTarget.trackIndex,
				dropType: dropTarget.type,
			};
		}, [timelineStore, trackCount]);

	const handleTimelineKeyDown = useEffectEvent((event: KeyboardEvent) => {
		if (
			event.target instanceof HTMLInputElement ||
			event.target instanceof HTMLTextAreaElement ||
			(event.target as HTMLElement | null)?.isContentEditable
		) {
			return;
		}
		if (event.defaultPrevented) return;

		const isModifier = event.metaKey || event.ctrlKey;
		if (isModifier) {
			const key = event.key.toLowerCase();
			if (key === "c") {
				if (selectedIds.length === 0) return;
				event.preventDefault();
				copyElementsByIds(selectedIds, primaryId ?? selectedIds[0] ?? null);
				closeContextMenu();
				return;
			}
			if (key === "x") {
				if (selectedIds.length === 0) return;
				event.preventDefault();
				cutElementsByIds(selectedIds, primaryId ?? selectedIds[0] ?? null);
				closeContextMenu();
				return;
			}
			if (key === "v") {
				const pasteTarget = resolveTimelinePasteTargetFromPointer();
				if (!pasteTarget) return;
				const didPaste = pasteFromClipboard(pasteTarget);
				if (!didPaste) return;
				event.preventDefault();
				closeContextMenu();
				return;
			}
		}

		if (event.key !== "Delete" && event.key !== "Backspace") return;
		if (event.repeat) return;
		if (selectedIds.length === 0) return;
		event.preventDefault();
		deleteSelectedElements();
		closeContextMenu();
	});

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			handleTimelineKeyDown(event);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleTimelineKeyDown]);

	useEffect(() => {
		const preventBrowserDrop = (event: DragEvent) => {
			if (!event.dataTransfer) return;
			if (event.dataTransfer.types?.includes("Files")) {
				event.preventDefault();
			}
		};

		const handleWindowDrop = (event: DragEvent) => {
			if (!event.dataTransfer) return;
			if (event.dataTransfer.files?.length) {
				event.preventDefault();
			}
		};

		window.addEventListener("dragover", preventBrowserDrop);
		window.addEventListener("drop", handleWindowDrop);
		return () => {
			window.removeEventListener("dragover", preventBrowserDrop);
			window.removeEventListener("drop", handleWindowDrop);
		};
	}, []);

	// 使用 callback ref 来监听容器宽度
	const rulerContainerRef = useCallback((node: HTMLDivElement | null) => {
		if (observerRef.current) {
			observerRef.current.disconnect();
			observerRef.current = null;
		}

		if (node) {
			const observer = new ResizeObserver((entries) => {
				for (const entry of entries) {
					setRulerWidth(entry.contentRect.width);
				}
			});
			observer.observe(node);
			observerRef.current = observer;
			setRulerWidth(node.clientWidth);
		}
	}, []);

	const ratio = getPixelsPerFrame(fps, timelineScale);
	const timelinePaddingLeft = 48;

	const timelineContentEndFrame = useMemo(() => {
		return elements.reduce((max, element) => {
			return Math.max(max, Math.round(element.timeline.end ?? 0));
		}, 0);
	}, [elements]);

	const timelineMaxScrollLeft = useMemo(() => {
		const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 0;
		const safeViewportWidth = Number.isFinite(rulerWidth)
			? Math.max(0, rulerWidth)
			: 0;
		if (safeRatio <= 0 || safeViewportWidth <= 0) return 0;
		const contentEndFrame = Math.max(1, timelineContentEndFrame);
		const visibleFrameCount = safeViewportWidth / safeRatio;
		// 专业 NLE 通常会在末尾保留一段可编辑缓冲，避免时间线“顶死”
		const tailPaddingFrame = Math.max(fps * 2, visibleFrameCount * 0.25);
		return Math.max(
			0,
			(contentEndFrame + tailPaddingFrame) * safeRatio +
				timelinePaddingLeft -
				safeViewportWidth,
		);
	}, [fps, ratio, rulerWidth, timelineContentEndFrame, timelinePaddingLeft]);

	useEffect(() => {
		setTimelineViewportWidth(rulerWidth);
	}, [rulerWidth, setTimelineViewportWidth]);

	useEffect(() => {
		setTimelineMaxScrollLeft(timelineMaxScrollLeft);
	}, [setTimelineMaxScrollLeft, timelineMaxScrollLeft]);

	// 同步 scrollLeft 到全局拖拽 store
	const setTimelineScrollLeft = useDragStore(
		(state) => state.setTimelineScrollLeft,
	);
	const isExternalDragActive = useDragStore(
		(state) => state.isDragging && state.dragSource === "external-file",
	);
	useEffect(() => {
		setTimelineScrollLeft(scrollLeft);
	}, [scrollLeft, setTimelineScrollLeft]);

	// 全局拖拽 store 的自动滚动
	const globalAutoScrollSpeedX = useDragStore(
		(state) => state.autoScrollSpeedX,
	);
	const globalAutoScrollSpeedY = useDragStore(
		(state) => state.autoScrollSpeedY,
	);

	// 更新元素的时间范围（start 和 end）
	const updateTimeRange = useCallback(
		(
			elementId: string,
			start: number,
			end: number,
			options?: { offsetDelta?: number },
		) => {
			setElements((prev) => {
				const updated = prev.map((el) => {
					if (el.id === elementId) {
						const timed = updateElementTime(el, start, end, fps);
						return applyOffsetDelta(timed, options?.offsetDelta);
					}
					return el;
				});
				return reconcileTransitions(updated, fps);
			});
		},
		[setElements, fps],
	);

	const updatePreviewTime = useCallback(
		(time: number | null) => {
			pendingPreviewTimeRef.current = time;
			if (previewTimeRafRef.current !== null) return;
			// 使用 rAF 合并高频预览更新，减少 Electron 下卡顿
			previewTimeRafRef.current = window.requestAnimationFrame(() => {
				previewTimeRafRef.current = null;
				const nextTime = pendingPreviewTimeRef.current ?? null;
				pendingPreviewTimeRef.current = null;
				if (lastPreviewTimeRef.current === nextTime) return;
				lastPreviewTimeRef.current = nextTime;
				setPreviewTime(nextTime);
			});
		},
		[setPreviewTime],
	);

	const scheduleCurrentTime = useCallback(
		(time: number) => {
			pendingCurrentTimeRef.current = time;
			if (currentTimeRafRef.current !== null) return;
			// 使用 rAF 合并拖拽更新，避免高频 seek 阻塞
			currentTimeRafRef.current = window.requestAnimationFrame(() => {
				currentTimeRafRef.current = null;
				const nextTime = pendingCurrentTimeRef.current;
				if (nextTime === null || nextTime === undefined) return;
				pendingCurrentTimeRef.current = null;
				seekTo(nextTime);
			});
		},
		[seekTo],
	);

	useEffect(() => {
		return () => {
			if (previewTimeRafRef.current !== null) {
				window.cancelAnimationFrame(previewTimeRafRef.current);
				previewTimeRafRef.current = null;
			}
			if (currentTimeRafRef.current !== null) {
				window.cancelAnimationFrame(currentTimeRafRef.current);
				currentTimeRafRef.current = null;
			}
		};
	}, []);

	// hover 时设置预览时间（临时）
	const handleMouseMove = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			const rect = e.currentTarget.getBoundingClientRect();
			lastHoverRef.current = {
				clientX: e.clientX,
				clientY: e.clientY,
				rectLeft: rect.left,
				rectRight: rect.right,
				rectTop: rect.top,
				rectBottom: rect.bottom,
			};
			if (isRulerDraggingRef.current) {
				updatePreviewTime(null);
				return;
			}
			const x = e.clientX - rect.left;
			if (x <= leftColumnWidth) {
				updatePreviewTime(null);
				return;
			}
			if (isPlaying || isDragging || isSelectingRef.current) return;
			if (!previewAxisEnabled) return;
			const time = clampFrame(
				(x - leftColumnWidth - timelinePaddingLeft + scrollLeft) / ratio,
			);
			startTransition(() => {
				updatePreviewTime(time);
			});
		},
		[
			previewAxisEnabled,
			ratio,
			scrollLeft,
			leftColumnWidth,
			isPlaying,
			isDragging,
			updatePreviewTime,
		],
	);

	const {
		handleExternalDragEnter,
		handleExternalDragOver,
		handleExternalDragLeave,
		handleExternalDrop,
	} = useExternalMaterialDnd({
		scrollAreaRef,
		verticalScrollRef,
	});

	// 点击时设置固定时间（可选清除选中状态）
	const handleClick = useCallback(
		(
			e: React.MouseEvent<HTMLDivElement>,
			options?: { keepSelection?: boolean },
		) => {
			if (
				selectionRect.visible &&
				selectionRect.x1 !== selectionRect.x2 &&
				selectionRect.y1 !== selectionRect.y2
			) {
				return;
			}
			const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
			const time = clampFrame(
				(x - leftColumnWidth - timelinePaddingLeft + scrollLeft) / ratio,
			);
			seekTo(time);
			updatePreviewTime(null); // 清除预览时间
			if (!options?.keepSelection) {
				deselectAll(); // 清除选中状态
			}
		},
		[
			ratio,
			scrollLeft,
			leftColumnWidth,
			timelinePaddingLeft,
			seekTo,
			updatePreviewTime,
			deselectAll,
			selectionRect,
		],
	);

	const updateCurrentTimeFromClientX = useCallback(
		(clientX: number) => {
			const rect = timeStampsRef.current?.getBoundingClientRect();
			if (!rect) return;
			const x = clientX - rect.left;
			const time = clampFrame(
				(x - leftColumnWidth - timelinePaddingLeft + scrollLeft) / ratio,
			);
			scheduleCurrentTime(time);
		},
		[
			leftColumnWidth,
			ratio,
			scrollLeft,
			timelinePaddingLeft,
			scheduleCurrentTime,
		],
	);

	// 时间尺点击只更新时间，不影响选中状态
	const handleRulerClick = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			handleClick(e, { keepSelection: true });
		},
		[handleClick],
	);

	// 鼠标离开时清除预览时间，回到固定时间
	const handleMouseLeave = useCallback(() => {
		lastHoverRef.current = null;
		updatePreviewTime(null);
	}, [updatePreviewTime]);

	const handleTimelineEditorMouseEnter = useCallback(() => {
		setTimelineEditorHovered(true);
	}, [setTimelineEditorHovered]);

	const handleTimelineEditorMouseMove = useCallback(() => {
		setTimelineEditorHovered(true);
	}, [setTimelineEditorHovered]);

	const handleTimelineEditorMouseLeave = useCallback(() => {
		setTimelineEditorHovered(false);
		handleMouseLeave();
	}, [handleMouseLeave, setTimelineEditorHovered]);
	const bindRulerDrag = useDrag(
		({ first, last, tap, xy, cancel }) => {
			if (tap) return;
			if (first) {
				const rect = timeStampsRef.current?.getBoundingClientRect();
				if (!rect) return;
				const x = xy[0] - rect.left;
				if (x <= leftColumnWidth) {
					cancel?.();
					return;
				}
				isRulerDraggingRef.current = true;
				updatePreviewTime(null);
			}
			updateCurrentTimeFromClientX(xy[0]);
			if (last) {
				isRulerDraggingRef.current = false;
			}
		},
		{
			filterTaps: true,
		},
	);

	useEffect(() => {
		if (selectionRect.visible) {
			updatePreviewTime(null);
		}
	}, [selectionRect.visible, updatePreviewTime]);

	useEffect(() => {
		if (wasDraggingRef.current && !isDragging && !isPlaying) {
			const lastHover = lastHoverRef.current;
			if (lastHover) {
				const isInside =
					lastHover.clientX >= lastHover.rectLeft &&
					lastHover.clientX <= lastHover.rectRight &&
					lastHover.clientY >= lastHover.rectTop &&
					lastHover.clientY <= lastHover.rectBottom;
				if (isInside && !isSelectingRef.current) {
					const x = lastHover.clientX - lastHover.rectLeft;
					if (!previewAxisEnabled || x <= leftColumnWidth) {
						updatePreviewTime(null);
						wasDraggingRef.current = isDragging;
						return;
					}
					const time = clampFrame(
						(x - leftColumnWidth - timelinePaddingLeft + scrollLeft) / ratio,
					);
					updatePreviewTime(time);
				}
			}
		}
		wasDraggingRef.current = isDragging;
	}, [
		isDragging,
		isPlaying,
		previewAxisEnabled,
		leftColumnWidth,
		ratio,
		scrollLeft,
		timelinePaddingLeft,
		updatePreviewTime,
	]);

	const computeSelectionInRect = useCallback(
		(rect: { x1: number; y1: number; x2: number; y2: number }) => {
			const container = scrollAreaRef.current;
			if (!container) return [];
			const containerRect = container.getBoundingClientRect();
			const selBox = {
				x: Math.min(rect.x1, rect.x2),
				y: Math.min(rect.y1, rect.y2),
				width: Math.abs(rect.x2 - rect.x1),
				height: Math.abs(rect.y2 - rect.y1),
			};

			const elementsInDom = Array.from(
				container.querySelectorAll<HTMLElement>("[data-timeline-element]"),
			);
			const selected: string[] = [];
			for (const el of elementsInDom) {
				const elRect = el.getBoundingClientRect();
				const elBox = {
					x: elRect.left - containerRect.left,
					y: elRect.top - containerRect.top,
					width: elRect.width,
					height: elRect.height,
				};

				if (
					selBox.x < elBox.x + elBox.width &&
					selBox.x + selBox.width > elBox.x &&
					selBox.y < elBox.y + elBox.height &&
					selBox.y + selBox.height > elBox.y
				) {
					const elementId = el.dataset.elementId;
					if (elementId) {
						const trackIndex = trackAssignments.get(elementId) ?? 0;
						const trackLocked =
							trackIndex >= 0
								? (tracks[trackIndex]?.locked ?? false)
								: getAudioTrackControlState(audioTrackStates, trackIndex)
										.locked;
						if (trackLocked) {
							continue;
						}
						selected.push(elementId);
					}
				}
			}

			return selected;
		},
		[trackAssignments, tracks, audioTrackStates],
	);

	const applyMarqueeSelection = useCallback(
		(nextRect: { x1: number; y1: number; x2: number; y2: number }) => {
			const selected = computeSelectionInRect(nextRect);
			if (selectionAdditiveRef.current) {
				const merged = Array.from(
					new Set([...initialSelectedIdsRef.current, ...selected]),
				);
				const primary =
					selected[selected.length - 1] ??
					initialSelectedIdsRef.current[0] ??
					null;
				setSelection(merged, primary);
			} else {
				setSelection(selected, selected[0] ?? null);
			}
		},
		[computeSelectionInRect, setSelection],
	);

	const handleSelectionMouseDown = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (e.button !== 0) return;
			const target = e.target as HTMLElement;
			if (target.closest("[data-timeline-element]")) {
				return;
			}

			const container = scrollAreaRef.current;
			if (!container) return;
			const rect = container.getBoundingClientRect();

			isSelectingRef.current = true;
			selectionActivatedRef.current = false;
			selectionStartRef.current = null;
			selectionAdditiveRef.current = e.shiftKey || e.ctrlKey || e.metaKey;
			initialSelectedIdsRef.current = selectedIds;

			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;
			selectionStartRef.current = { x, y };
			const nextRect = {
				visible: false,
				x1: x,
				y1: y,
				x2: x,
				y2: y,
			};
			selectionRectRef.current = nextRect;
			setSelectionRect(nextRect);
		},
		[selectedIds],
	);

	const handleSelectionMouseMove = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (!isSelectingRef.current) return;
			const container = scrollAreaRef.current;
			if (!container) return;
			const rect = container.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;
			const start = selectionStartRef.current ?? { x, y };
			const deltaX = x - start.x;
			const deltaY = y - start.y;
			if (
				!selectionActivatedRef.current &&
				Math.abs(deltaX) < 2 &&
				Math.abs(deltaY) < 2
			) {
				return;
			}
			if (!selectionActivatedRef.current) {
				selectionActivatedRef.current = true;
				updatePreviewTime(null); // 进入框选后暂停预览，避免画面闪烁
			}
			const nextRect = {
				visible: true,
				x1: start.x,
				y1: start.y,
				x2: x,
				y2: y,
			};
			selectionRectRef.current = nextRect;
			setSelectionRect(nextRect);
			applyMarqueeSelection(nextRect);
		},
		[applyMarqueeSelection, updatePreviewTime],
	);

	const handleSelectionMouseUp = useCallback(() => {
		if (!isSelectingRef.current) return;
		isSelectingRef.current = false;
		const wasActivated = selectionActivatedRef.current;
		selectionActivatedRef.current = false;
		selectionStartRef.current = null;

		if (!wasActivated) {
			setSelectionRect((prev) =>
				prev.visible ? { ...prev, visible: false } : prev,
			);
			return;
		}

		setTimeout(() => {
			setSelectionRect((prev) => ({ ...prev, visible: false }));
		}, 0);
		applyMarqueeSelection(selectionRectRef.current);
	}, [applyMarqueeSelection]);

	useEffect(() => {
		const handleWindowMouseUp = () => {
			handleSelectionMouseUp();
		};
		window.addEventListener("mouseup", handleWindowMouseUp);
		return () => {
			window.removeEventListener("mouseup", handleWindowMouseUp);
		};
	}, [handleSelectionMouseUp]);

	// 同步 scrollLeft 到 ref
	useEffect(() => {
		scrollLeftRef.current = scrollLeft;
	}, [scrollLeft]);

	// 播放停止时重置自动跟随状态，避免下一次播放继承抑制窗口
	useEffect(() => {
		if (isPlaying) return;
		manualScrollSuppressUntilRef.current = 0;
		pendingAutoFollowScrollLeftRef.current = null;
	}, [isPlaying]);

	// 识别滚动来源：命中自动跟随预期值则忽略，其余都视为手动滚动并触发 debounce
	useEffect(() => {
		const previousScrollLeft = lastObservedScrollLeftRef.current;
		lastObservedScrollLeftRef.current = scrollLeft;
		if (previousScrollLeft === null || previousScrollLeft === scrollLeft) {
			return;
		}
		if (!isPlaying) return;

		const pendingScrollLeft = pendingAutoFollowScrollLeftRef.current;
		if (
			pendingScrollLeft !== null &&
			Math.abs(scrollLeft - pendingScrollLeft) <=
				AUTO_FOLLOW_SCROLL_MATCH_EPSILON
		) {
			pendingAutoFollowScrollLeftRef.current = null;
			return;
		}

		manualScrollSuppressUntilRef.current =
			Date.now() + PLAYHEAD_FOLLOW_MANUAL_DEBOUNCE_MS;
	}, [isPlaying, scrollLeft]);

	// 播放时播放头不在可视范围内才跳转，让播放头回到内容区左侧
	useEffect(() => {
		if (!isPlaying) return;
		if (Date.now() < manualScrollSuppressUntilRef.current) return;

		const safeRatio = Number.isFinite(ratio) ? ratio : 0;
		const visibleWidth = Number.isFinite(rulerWidth)
			? Math.max(0, rulerWidth)
			: 0;
		if (safeRatio <= 0 || visibleWidth <= 0) return;

		const playheadX =
			timelinePaddingLeft + currentTime * safeRatio - scrollLeft;
		const isPlayheadOutOfView = playheadX < 0 || playheadX > visibleWidth;
		if (!Number.isFinite(playheadX) || !isPlayheadOutOfView) {
			return;
		}

		const maxScrollLeft = Number.isFinite(timelineMaxScrollLeft)
			? Math.max(0, timelineMaxScrollLeft)
			: 0;
		const targetScrollLeft = Math.min(
			Math.max(0, currentTime * safeRatio + timelinePaddingLeft),
			maxScrollLeft,
		);
		if (
			Math.abs(targetScrollLeft - scrollLeft) <=
			AUTO_FOLLOW_SCROLL_MATCH_EPSILON
		) {
			return;
		}

		pendingAutoFollowScrollLeftRef.current = targetScrollLeft;
		setScrollLeft(targetScrollLeft);
	}, [
		currentTime,
		isPlaying,
		ratio,
		rulerWidth,
		scrollLeft,
		setScrollLeft,
		timelineMaxScrollLeft,
		timelinePaddingLeft,
	]);

	// 使用原生事件监听器来正确处理滚动，防止触发窗口滚动
	useEffect(() => {
		const scrollArea = scrollAreaRef.current;
		if (!scrollArea) return;

		const handleWheel = (e: WheelEvent) => {
			if (e.ctrlKey) {
				e.preventDefault();
				e.stopPropagation();

				const currentScale = timelineStore.getState().timelineScale;
				const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
				const nextScale = Math.min(
					MAX_TIMELINE_SCALE,
					Math.max(MIN_TIMELINE_SCALE, currentScale * zoomFactor),
				);
				const rect = scrollArea.getBoundingClientRect();
				const viewportWidth = Math.max(
					0,
					timelineStore.getState().timelineViewportWidth,
				);
				const rawAnchorOffset = e.clientX - rect.left - leftColumnWidth;
				const anchorOffsetPx = Math.min(
					Math.max(rawAnchorOffset, 0),
					viewportWidth,
				);
				setTimelineScale(nextScale, {
					anchorOffsetPx,
					preserveOriginWhenAnchorAfterContentEnd: true,
				});
				return;
			}

			// 只在有水平滚动时才处理，垂直滚动不处理
			if (Math.abs(e.deltaX) > 0) {
				// 阻止水平滚动事件的默认行为，防止触发窗口滚动
				e.preventDefault();
				e.stopPropagation();

				// 修复方向：向右滚动（deltaX > 0）应该增加 scrollLeft
				const currentScrollLeft = timelineStore.getState().scrollLeft;
				const newScrollLeft = Math.max(0, currentScrollLeft + e.deltaX);
				setScrollLeft(newScrollLeft);
			}
			// 如果是纯垂直滚动（只有 deltaY），不阻止默认行为，让页面正常滚动
		};

		// 阻止触摸手势（防止后退）
		const handleTouchStart = (e: TouchEvent) => {
			if (e.touches.length === 1) {
				const touch = e.touches[0];
				const rect = scrollArea.getBoundingClientRect();
				// 如果触摸点在容器内，阻止默认行为（防止后退手势）
				if (
					touch.clientX >= rect.left &&
					touch.clientX <= rect.right &&
					touch.clientY >= rect.top &&
					touch.clientY <= rect.bottom
				) {
					e.preventDefault();
					e.stopPropagation();
					touchStartXRef.current = touch.clientX;
				}
			}
		};

		const handleTouchMove = (e: TouchEvent) => {
			if (e.touches.length === 1) {
				e.preventDefault();
				e.stopPropagation();
				const touch = e.touches[0];
				const deltaX = touchStartXRef.current - touch.clientX;
				setScrollLeft(Math.max(0, scrollLeftRef.current + deltaX));
			}
		};

		// 使用 { passive: false } 来确保可以调用 preventDefault
		scrollArea.addEventListener("wheel", handleWheel, { passive: false });
		scrollArea.addEventListener("touchstart", handleTouchStart, {
			passive: false,
		});
		scrollArea.addEventListener("touchmove", handleTouchMove, {
			passive: false,
		});

		return () => {
			scrollArea.removeEventListener("wheel", handleWheel);
			scrollArea.removeEventListener("touchstart", handleTouchStart);
			scrollArea.removeEventListener("touchmove", handleTouchMove);
		};
	}, [leftColumnWidth, setScrollLeft, setTimelineScale]);

	// 自动滚动效果（拖拽到边缘时触发）
	useEffect(() => {
		if (autoScrollSpeed === 0) return;

		let animationFrameId: number;

		const animate = () => {
			const currentScrollLeft = timelineStore.getState().scrollLeft;
			const newScrollLeft = Math.max(0, currentScrollLeft + autoScrollSpeed);
			setScrollLeft(newScrollLeft);
			animationFrameId = requestAnimationFrame(animate);
		};

		animationFrameId = requestAnimationFrame(animate);

		return () => {
			cancelAnimationFrame(animationFrameId);
		};
	}, [autoScrollSpeed, setScrollLeft]);

	// 垂直自动滚动效果（拖拽到上下边缘时触发）
	useEffect(() => {
		if (autoScrollSpeedY === 0) return;

		const scrollContainer = verticalScrollRef.current;
		if (!scrollContainer) return;

		let animationFrameId: number;

		const animate = () => {
			const currentScrollTop = scrollContainer.scrollTop;
			const maxScrollTop =
				scrollContainer.scrollHeight - scrollContainer.clientHeight;
			const newScrollTop = Math.max(
				0,
				Math.min(maxScrollTop, currentScrollTop + autoScrollSpeedY),
			);
			scrollContainer.scrollTop = newScrollTop;
			animationFrameId = requestAnimationFrame(animate);
		};

		animationFrameId = requestAnimationFrame(animate);

		return () => {
			cancelAnimationFrame(animationFrameId);
		};
	}, [autoScrollSpeedY]);

	// 素材库拖拽时的水平自动滚动
	useEffect(() => {
		if (globalAutoScrollSpeedX === 0) return;

		let animationFrameId: number;

		const animate = () => {
			const currentScrollLeft = timelineStore.getState().scrollLeft;
			const newScrollLeft = Math.max(
				0,
				currentScrollLeft + globalAutoScrollSpeedX,
			);
			setScrollLeft(newScrollLeft);
			animationFrameId = requestAnimationFrame(animate);
		};

		animationFrameId = requestAnimationFrame(animate);

		return () => {
			cancelAnimationFrame(animationFrameId);
		};
	}, [globalAutoScrollSpeedX, setScrollLeft]);

	// 素材库拖拽时的垂直自动滚动
	useEffect(() => {
		if (globalAutoScrollSpeedY === 0) return;

		const scrollContainer = verticalScrollRef.current;
		if (!scrollContainer) return;

		let animationFrameId: number;

		const animate = () => {
			const currentScrollTop = scrollContainer.scrollTop;
			const maxScrollTop =
				scrollContainer.scrollHeight - scrollContainer.clientHeight;
			const newScrollTop = Math.max(
				0,
				Math.min(maxScrollTop, currentScrollTop + globalAutoScrollSpeedY),
			);
			scrollContainer.scrollTop = newScrollTop;
			animationFrameId = requestAnimationFrame(animate);
		};

		animationFrameId = requestAnimationFrame(animate);

		return () => {
			cancelAnimationFrame(animationFrameId);
		};
	}, [globalAutoScrollSpeedY]);

	const trackLayout = useMemo(() => {
		return buildTrackLayout(tracks);
	}, [tracks]);

	const trackLayoutByIndex = useMemo(() => {
		const map = new Map<number, (typeof trackLayout)[number]>();
		for (const item of trackLayout) {
			map.set(item.index, item);
		}
		return map;
	}, [trackLayout]);

	const otherTrackLayout = useMemo(() => {
		return trackLayout.filter((item) => item.index > 0);
	}, [trackLayout]);

	const otherTrackHeights = useMemo(() => {
		return otherTrackLayout.map((item) => item.height);
	}, [otherTrackLayout]);

	const otherTracksHeight = useMemo(() => {
		return otherTrackLayout.reduce((sum, item) => sum + item.height, 0);
	}, [otherTrackLayout]);
	const mainTrackHeight = useMemo(() => {
		return trackLayoutByIndex.get(0)?.height ?? getTrackHeightByRole("clip");
	}, [trackLayoutByIndex]);
	const selectionBox = useMemo(() => {
		if (!selectionRect.visible) return null;
		const x = Math.min(selectionRect.x1, selectionRect.x2);
		const y = Math.min(selectionRect.y1, selectionRect.y2);
		const width = Math.abs(selectionRect.x2 - selectionRect.x1);
		const height = Math.abs(selectionRect.y2 - selectionRect.y1);
		return { x, y, width, height };
	}, [selectionRect]);

	const timeStamps = useMemo(() => {
		return (
			<div
				key="time-stamps"
				className="sticky top-0 left-0 z-60"
				ref={timeStampsRef}
				onMouseMove={handleMouseMove}
				onClick={handleRulerClick}
				onMouseLeave={handleMouseLeave}
				{...bindRulerDrag()}
			>
				<div className="flex overflow-hidden">
					<div
						// className="border-r border-white/10"
						className="relative"
						style={{ width: leftColumnWidth }}
					>
						<div className="absolute top-0 right-0 w-px h-full bg-linear-to-t from-white/10 to-transparent"></div>
						{/* <div className="h-full text-[11px] flex items-center justify-end pr-6 font-mono text-neutral-300">
							{formatTimecode(currentTime, fps)}
						</div> */}
					</div>
					<div ref={rulerContainerRef} className="overflow-hidden flex-1">
						<TimelineRuler
							scrollLeft={scrollLeft}
							ratio={ratio}
							width={rulerWidth}
							paddingLeft={timelinePaddingLeft}
							fps={fps}
						/>
					</div>
				</div>
				<div className="h-px w-full bg-neutral-200/10 backdrop-blur-2xl backdrop-saturate-150 backdrop-brightness-150"></div>
			</div>
		);
	}, [
		isExternalDragActive,
		handleMouseMove,
		handleClick,
		leftColumnWidth,
		currentTime,
		fps,
		scrollLeft,
		ratio,
		rulerWidth,
		timelinePaddingLeft,
	]);

	// 分离主轨道、其他轨道、音频轨道元素
	const { mainTrackElements, otherTrackElements, audioTrackElements } =
		useMemo(() => {
			const main: typeof elements = [];
			const other: typeof elements = [];
			const audio: typeof elements = [];
			for (const element of elements) {
				const trackIndex = trackAssignments.get(element.id) ?? 0;
				if (trackIndex === 0) {
					main.push(element);
					continue;
				}
				if (trackIndex < 0) {
					audio.push(element);
					continue;
				}
				other.push(element);
			}
			return {
				mainTrackElements: main,
				otherTrackElements: other,
				audioTrackElements: audio,
			};
		}, [elements, trackAssignments, tracks]);

	// 其他轨道数量（不包括主轨道）
	const otherTrackCount = Math.max(trackCount - 1, 0);
	const mainTrackVisible = !(tracks[0]?.hidden ?? false);
	const mainTrackLocked = tracks[0]?.locked ?? false;
	const handleTimelineContextMenu = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			pause();
			const target = event.target as HTMLElement;
			if (target.closest("[data-timeline-element]")) return;
			event.preventDefault();
			if (!target.closest("[data-track-drop-zone]")) {
				closeContextMenu();
				return;
			}
			const dropTarget = findTimelineDropTargetFromScreenPosition(
				event.clientX,
				event.clientY,
				otherTrackCount,
				DEFAULT_TRACK_HEIGHT,
				false,
			);
			if (!dropTarget) {
				closeContextMenu();
				return;
			}
			const dropTime = getTimelineDropTimeFromScreenX(
				event.clientX,
				dropTarget.trackIndex,
				ratio,
				scrollLeft,
			);
			if (dropTime === null) {
				closeContextMenu();
				return;
			}
			setContextMenuState({
				open: true,
				x: event.clientX,
				y: event.clientY,
				scope: "timeline",
				pasteTarget: {
					time: clampFrame(dropTime),
					trackIndex: dropTarget.trackIndex,
					dropType: dropTarget.type,
				},
			});
		},
		[closeContextMenu, otherTrackCount, pause, ratio, scrollLeft],
	);
	const contextMenuActions = useMemo<TimelineContextMenuAction[]>(() => {
		if (!contextMenuState.open) return [];
		if (contextMenuState.scope === "element") {
			const { targetIds, primaryId: targetPrimaryId } = contextMenuState;
			const actions: TimelineContextMenuAction[] = [
				{
					key: "copy",
					label: "复制",
					disabled: targetIds.length === 0,
					onSelect: () => {
						copyElementsByIds(targetIds, targetPrimaryId);
					},
				},
				{
					key: "cut",
					label: "剪切",
					disabled: targetIds.length === 0,
					onSelect: () => {
						cutElementsByIds(targetIds, targetPrimaryId);
					},
				},
				{
					key: "delete",
					label: "删除",
					danger: true,
					disabled: targetIds.length === 0,
					onSelect: () => {
						deleteElementsByIds(targetIds);
					},
				},
			];
			const targetElement =
				targetIds.length === 1
					? elements.find((element) => element.id === targetIds[0])
					: undefined;
			const isSingleVideo = targetElement?.type === "VideoClip";
			const isSingleComposition = targetElement?.type === "Composition";
			const isSourceMuted = isVideoSourceAudioMuted(targetElement);
			const hasSourceAudioTrack = getVideoClipHasSourceAudioTrack(
				modelRegistry,
				targetElement,
			);
			const isCompositionSourceMuted =
				isCompositionSourceAudioMuted(targetElement);
			const hasCompositionSourceAudioTrack = getCompositionHasSourceAudioTrack(
				runtimeManager,
				targetElement,
			);
			const videoUri = resolveElementSourceUri(targetElement, assets);
			if (isSingleVideo && hasSourceAudioTrack) {
				const isActionDisabled = !videoUri;
				actions.splice(2, 0, {
					key: isSourceMuted ? "restore-audio" : "detach-audio",
					label: isSourceMuted ? "还原音频" : "分离音频",
					disabled: isActionDisabled,
					onSelect: () => {
						if (isActionDisabled) return;
						setElements((prev) => {
							const updated = isSourceMuted
								? restoreVideoClipAudio({
										elements: prev,
										videoId: targetElement.id,
									})
								: detachVideoClipAudio({
										elements: prev,
										videoId: targetElement.id,
										fps,
										trackLockedMap,
										hasSourceAudioTrack,
									});
							if (updated === prev) return prev;
							return finalizeTimelineElements(updated, postProcessOptions);
						});
					},
				});
			}
			if (isSingleComposition) {
				actions.splice(2, 0, {
					key: isCompositionSourceMuted
						? "restore-composition-audio"
						: "detach-composition-audio",
					label: isCompositionSourceMuted ? "还原音频" : "分离音频",
					disabled: !hasCompositionSourceAudioTrack,
					onSelect: () => {
						if (!hasCompositionSourceAudioTrack) return;
						setElements((prev) => {
							const updated = isCompositionSourceMuted
								? restoreCompositionAudio({
										elements: prev,
										compositionId: targetElement.id,
									})
								: detachCompositionAudio({
										elements: prev,
										compositionId: targetElement.id,
										fps,
										trackLockedMap,
										hasSourceAudioTrack: hasCompositionSourceAudioTrack,
									});
							if (updated === prev) return prev;
							return finalizeTimelineElements(updated, postProcessOptions);
						});
					},
				});
			}
			return actions;
		}

		const trackLocked =
			contextMenuState.pasteTarget.dropType === "track" &&
			(trackLockedMap.get(contextMenuState.pasteTarget.trackIndex) ?? false);
		const canPaste =
			clipboardPayload?.kind === "timeline-elements"
				? clipboardPayload.payload.elements.length > 0
				: clipboardPayload?.kind === "canvas-nodes"
					? clipboardPayload.entries.some((entry) => {
							const definition = getCanvasNodeDefinition(entry.node.type);
							return Boolean(definition.toTimelineClipboardElement);
						})
					: false;
		const pasteDisabled = !canPaste || trackLocked;
		return [
			{
				key: "paste",
				label: "粘贴",
				disabled: pasteDisabled,
				onSelect: () => {
					if (pasteDisabled) return;
					pasteFromClipboard(contextMenuState.pasteTarget);
				},
			},
		];
	}, [
		clipboardPayload,
		contextMenuState,
		copyElementsByIds,
		cutElementsByIds,
		deleteElementsByIds,
		elements,
		fps,
		modelRegistry,
		runtimeManager,
		pasteFromClipboard,
		postProcessOptions,
		setElements,
		assets,
		trackLockedMap,
	]);

	const audioTrackIndices = useMemo(() => {
		if (audioTrackElements.length === 0) return [];
		const indices = new Set<number>();
		for (const element of audioTrackElements) {
			const trackIndex = trackAssignments.get(element.id) ?? -1;
			if (trackIndex < 0) {
				indices.add(trackIndex);
			}
		}
		return Array.from(indices).sort((a, b) => b - a);
	}, [audioTrackElements, trackAssignments]);

	const audioTrackIndicesForLayout = useMemo(() => {
		return audioTrackIndices.length > 0 ? audioTrackIndices : [-1];
	}, [audioTrackIndices]);

	const audioTrackHeights = useMemo(() => {
		return audioTrackIndicesForLayout.map(() => getTrackHeightByRole("audio"));
	}, [audioTrackIndicesForLayout]);

	const audioTracksHeight = useMemo(() => {
		return audioTrackHeights.reduce((sum, height) => sum + height, 0);
	}, [audioTrackHeights]);

	const audioTrackLayout = useMemo(() => {
		let currentY = 0;
		return audioTrackIndicesForLayout.map((index) => {
			const height = getTrackHeightByRole("audio");
			const item = { index, height, y: currentY };
			currentY += height;
			return item;
		});
	}, [audioTrackIndicesForLayout]);

	const audioTrackLayoutByIndex = useMemo(() => {
		const map = new Map<number, (typeof audioTrackLayout)[number]>();
		for (const item of audioTrackLayout) {
			map.set(item.index, item);
		}
		return map;
	}, [audioTrackLayout]);

	// 其他轨道的时间线项目
	const otherTimelineItems = useMemo(() => {
		if (otherTrackCount === 0) return null;

		const containerHeight = otherTracksHeight;

		return (
			<div
				className="relative"
				style={{
					transform: `translateX(-${scrollLeft}px)`,
					height: containerHeight,
				}}
			>
				{otherTrackElements.map((element) => {
					const trackIndex = trackAssignments.get(element.id) ?? 0;
					const layoutItem = trackLayoutByIndex.get(trackIndex);
					const y = (layoutItem?.y ?? 0) + TRACK_CONTENT_GAP / 2;
					const elementTrackHeight =
						layoutItem?.height ?? getTrackHeightByRole("overlay");
					const trackVisible = !(tracks[trackIndex]?.hidden ?? false);
					const trackLocked = tracks[trackIndex]?.locked ?? false;
					return (
						<TimelineElement
							key={element.id}
							element={element}
							trackIndex={trackIndex}
							trackY={y}
							ratio={ratio}
							trackHeight={elementTrackHeight}
							trackCount={trackCount}
							trackVisible={trackVisible}
							trackLocked={trackLocked}
							updateTimeRange={updateTimeRange}
							onRequestContextMenu={handleElementContextMenu}
						/>
					);
				})}
			</div>
		);
	}, [
		otherTrackElements,
		scrollLeft,
		ratio,
		updateTimeRange,
		handleElementContextMenu,
		trackAssignments,
		trackCount,
		otherTrackCount,
		otherTracksHeight,
		trackLayoutByIndex,
		tracks,
	]);

	// 锁定轨道的斜线纹理遮罩
	const otherTrackLockedOverlays = useMemo(() => {
		if (otherTrackCount === 0) return null;
		return otherTrackLayout.map((item) => {
			const trackLocked = tracks[item.index]?.locked ?? false;
			if (!trackLocked) return null;
			return (
				<div
					key={`track-locked-${tracks[item.index]?.id ?? item.index}`}
					className="absolute right-0 z-10 bg-black/10"
					style={{
						top: item.y,
						left: -timelinePaddingLeft,
						height: item.height,
						...LOCKED_TRACK_OVERLAY_STYLE,
					}}
				/>
			);
		});
	}, [otherTrackCount, otherTrackLayout, tracks, timelinePaddingLeft]);

	const mainTrackLockedOverlay = useMemo(() => {
		if (!mainTrackLocked) return null;
		return (
			<div
				className="absolute right-0 top-0 z-10 bg-black/10"
				style={{
					left: -timelinePaddingLeft,
					height: mainTrackHeight,
					...LOCKED_TRACK_OVERLAY_STYLE,
				}}
			/>
		);
	}, [mainTrackHeight, mainTrackLocked, timelinePaddingLeft]);

	// 主轨道的时间线项目
	const mainTimelineItems = useMemo(() => {
		// 主轨道在整体布局中的 Y 坐标（用于拖拽计算）
		const mainTrackYInGlobalLayout =
			trackLayoutByIndex.get(0)?.y ?? otherTracksHeight;

		return (
			<div
				className="relative"
				style={{
					transform: `translateX(-${scrollLeft}px)`,
					height: mainTrackHeight,
				}}
			>
				{mainTrackElements.map((element) => {
					return (
						<TimelineElement
							key={element.id}
							element={element}
							trackIndex={0}
							trackY={mainTrackYInGlobalLayout}
							ratio={ratio}
							trackHeight={mainTrackHeight}
							trackCount={trackCount}
							trackVisible={mainTrackVisible}
							trackLocked={mainTrackLocked}
							updateTimeRange={updateTimeRange}
							onRequestContextMenu={handleElementContextMenu}
						/>
					);
				})}
			</div>
		);
	}, [
		mainTrackElements,
		scrollLeft,
		ratio,
		updateTimeRange,
		handleElementContextMenu,
		trackCount,
		trackLayoutByIndex,
		otherTracksHeight,
		mainTrackHeight,
		mainTrackLocked,
		mainTrackVisible,
	]);

	const audioTimelineItems = useMemo(() => {
		if (audioTrackIndicesForLayout.length === 0) return null;

		return (
			<div
				className="relative"
				style={{
					transform: `translateX(-${scrollLeft}px)`,
					height: audioTracksHeight,
				}}
			>
				{audioTrackElements.map((element) => {
					const trackIndex = trackAssignments.get(element.id) ?? -1;
					const layoutItem = audioTrackLayoutByIndex.get(trackIndex);
					const y = (layoutItem?.y ?? 0) + TRACK_CONTENT_GAP / 2;
					const elementTrackHeight =
						layoutItem?.height ?? getTrackHeightByRole("audio");
					const audioTrackState = getAudioTrackControlState(
						audioTrackStates,
						trackIndex,
					);
					return (
						<TimelineElement
							key={element.id}
							element={element}
							trackIndex={trackIndex}
							trackY={y}
							ratio={ratio}
							trackHeight={elementTrackHeight}
							trackCount={trackCount}
							trackVisible
							trackLocked={audioTrackState.locked}
							updateTimeRange={updateTimeRange}
							onRequestContextMenu={handleElementContextMenu}
						/>
					);
				})}
			</div>
		);
	}, [
		audioTrackElements,
		audioTrackLayoutByIndex,
		audioTrackIndicesForLayout,
		audioTracksHeight,
		audioTrackStates,
		scrollLeft,
		ratio,
		updateTimeRange,
		handleElementContextMenu,
		trackAssignments,
		trackCount,
	]);

	// 其他轨道标签（不包括主轨道）
	const otherTrackLabels = useMemo(() => {
		if (otherTrackCount === 0) return null;
		return otherTrackLayout.map((item) => {
			const track = tracks[item.index];
			if (!track) return null;
			const trackVisible = !(track.hidden ?? false);
			return (
				<TimelineTrackSidebarItem
					key={track.id}
					track={track}
					label={`轨道 ${item.role}`}
					height={item.height}
					className={cn("text-neutral-400", {
						"bg-black/60": !trackVisible,
					})}
					labelClassName={trackVisible ? "" : "text-neutral-600"}
					onToggleVisible={() => toggleTrackHidden(track.id)}
					onToggleLocked={() => toggleTrackLocked(track.id)}
					onToggleMuted={() => toggleTrackMuted(track.id)}
					onToggleSolo={() => toggleTrackSolo(track.id)}
				/>
			);
		});
	}, [
		otherTrackCount,
		otherTrackLayout,
		tracks,
		toggleTrackHidden,
		toggleTrackLocked,
		toggleTrackMuted,
		toggleTrackSolo,
	]);

	const audioTrackLabels = useMemo(() => {
		return audioTrackLayout.map((item) => {
			const label = `音轨 ${Math.abs(item.index)}`;
			const audioTrackState = getAudioTrackControlState(
				audioTrackStates,
				item.index,
			);
			const track = {
				id: `audio-${Math.abs(item.index)}-${item.index}`,
				role: "audio" as const,
				hidden: false,
				locked: audioTrackState.locked,
				muted: audioTrackState.muted,
				solo: audioTrackState.solo,
			};
			return (
				<TimelineTrackSidebarItem
					key={track.id}
					track={track}
					label={label}
					height={item.height}
					className="text-emerald-300"
					labelClassName="text-emerald-300"
					onToggleLocked={() => toggleAudioTrackLocked(item.index)}
					onToggleMuted={() => toggleAudioTrackMuted(item.index)}
					onToggleSolo={() => toggleAudioTrackSolo(item.index)}
				/>
			);
		});
	}, [
		audioTrackLayout,
		audioTrackStates,
		toggleAudioTrackLocked,
		toggleAudioTrackMuted,
		toggleAudioTrackSolo,
	]);

	const otherTrackBackgrounds = useMemo(() => {
		if (otherTrackCount === 0) return null;
		return otherTrackLayout.map((item) => {
			const trackHidden = tracks[item.index]?.hidden ?? false;
			if (!trackHidden) return null;
			return (
				<div
					key={`track-bg-${tracks[item.index]?.id ?? item.index}`}
					className={cn("absolute left-0 right-0 pointer-events-none", {
						"bg-black/60": trackHidden,
					})}
					style={{
						top: item.y,
						left: -timelinePaddingLeft,
						height: item.height,
					}}
				/>
			);
		});
	}, [otherTrackCount, otherTrackLayout, tracks, timelinePaddingLeft]);

	const audioTrackLockedOverlays = useMemo(() => {
		if (audioTrackLayout.length === 0) return null;
		return audioTrackLayout.map((item) => {
			const trackLocked = getAudioTrackControlState(
				audioTrackStates,
				item.index,
			).locked;
			if (!trackLocked) return null;
			return (
				<div
					key={`audio-track-locked-${item.index}`}
					className="absolute right-0 z-10 bg-black/10"
					style={{
						top: item.y,
						left: -timelinePaddingLeft,
						height: item.height,
						...LOCKED_TRACK_OVERLAY_STYLE,
					}}
				/>
			);
		});
	}, [audioTrackLayout, audioTrackStates, timelinePaddingLeft]);

	// 主轨道标签
	const mainTrackLabel = useMemo(() => {
		const mainTrack = tracks[0];
		if (!mainTrack) return null;
		return (
			<TimelineTrackSidebarItem
				track={mainTrack}
				label="主轨道"
				height={mainTrackHeight}
				className="text-blue-400"
				labelClassName={mainTrackVisible ? "text-blue-400" : "text-neutral-600"}
				onToggleVisible={() => toggleTrackHidden(mainTrack.id)}
				onToggleLocked={() => toggleTrackLocked(mainTrack.id)}
				onToggleMuted={() => toggleTrackMuted(mainTrack.id)}
				onToggleSolo={() => toggleTrackSolo(mainTrack.id)}
			/>
		);
	}, [
		mainTrackHeight,
		mainTrackVisible,
		toggleTrackHidden,
		toggleTrackLocked,
		toggleTrackMuted,
		toggleTrackSolo,
		tracks,
	]);

	// 吸附指示线
	const snapIndicator = useMemo(() => {
		if (!activeSnapPoint) return null;
		const left = activeSnapPoint.time * ratio - scrollLeft;
		return (
			<div
				className="absolute top-12 bottom-0 border-l border-dashed border-white/50 pointer-events-none"
				style={{ left: left + timelinePaddingLeft - 1 }}
			/>
		);
	}, [activeSnapPoint, ratio, scrollLeft, timelinePaddingLeft]);

	return (
		<div
			data-testid="timeline-editor"
			className="relative bg-neutral-800 h-full flex flex-col min-h-0 w-full overflow-hidden"
			onMouseEnter={handleTimelineEditorMouseEnter}
			onMouseMove={handleTimelineEditorMouseMove}
			onMouseLeave={handleTimelineEditorMouseLeave}
		>
			<div className="pointer-events-none absolute top-0 left-0 w-full h-18 z-50 bg-linear-to-b from-neutral-800 to-neutral-800/80 backdrop-blur-2xl"></div>
			{/* <ProgressiveBlur
				position="top"
				className="absolute top-0 w-full h-20 z-60 "
				blurLevels={[0.5, 4, 16, 16, 16, 16, 16, 16]}
			/> */}
			<TimelineToolbar className="h-12 z-60" />
			{timeStamps}
			<div
				ref={scrollAreaRef}
				data-timeline-scroll-area
				className="relative w-full flex-1 min-h-0 flex flex-col -mt-19 overflow-hidden"
				onMouseMove={(e) => {
					handleMouseMove(e);
					handleSelectionMouseMove(e);
				}}
				onMouseDown={handleSelectionMouseDown}
				onMouseUp={handleSelectionMouseUp}
				onMouseLeave={handleMouseLeave}
				onDragEnter={handleExternalDragEnter}
				onDragOver={handleExternalDragOver}
				onDragLeave={handleExternalDragLeave}
				onDrop={handleExternalDrop}
				onContextMenu={handleTimelineContextMenu}
			>
				{selectionBox && selectionBox.width > 0 && selectionBox.height > 0 && (
					<div
						className="absolute border z-70 border-blue-500/80 bg-blue-500/10 pointer-events-none"
						style={{
							left: selectionBox.x,
							top: selectionBox.y,
							width: selectionBox.width,
							height: selectionBox.height,
						}}
					/>
				)}
				<div
					className="h-full w-full absolute top-0 left-0 pointer-events-none z-60"
					style={{ marginLeft: leftColumnWidth }}
				>
					<TimeIndicatorCanvas
						className="top-12 z-50"
						leftOffset={timelinePaddingLeft}
						ratio={ratio}
						scrollLeft={scrollLeft}
					/>
				</div>
				<div
					className="h-full w-full absolute top-0 left-0 pointer-events-none z-50"
					style={{ marginLeft: leftColumnWidth }}
				>
					{snapIndicator}
				</div>

				{/* 轨道区域（可滚动） */}
				<div
					ref={verticalScrollRef}
					data-vertical-scroll-area
					className="w-full flex-1 min-h-0 overflow-y-auto"
				>
					<div className="relative flex flex-col min-h-full">
						<div
							className="z-10 absolute left-0 top-0 h-full pointer-events-none bg-neutral-800/80 backdrop-blur-3xl backdrop-saturate-150 border-r border-white/10"
							style={{ width: leftColumnWidth }}
						/>
						{/* 其他轨道区域 */}
						<div className="flex flex-1 mt-18">
							{/* 左侧列，其他轨道标签 */}
							<div
								className="text-white z-10 pr-px flex flex-col"
								style={{ width: leftColumnWidth }}
							>
								<div className="flex-1 flex flex-col justify-end">
									{otherTrackLabels}
								</div>
							</div>
							{/* 右侧其他轨道时间线内容 */}
							<div
								onClick={handleClick}
								ref={containerRef}
								data-track-drop-zone="other"
								data-track-count={otherTrackCount}
								data-track-heights={otherTrackHeights.join(",")}
								className="relative flex-1 overflow-x-hidden pt-1.5 flex flex-col justify-end"
								style={{
									paddingLeft: leftColumnWidth,
									marginLeft: -leftColumnWidth,
								}}
							>
								<div style={{ paddingLeft: timelinePaddingLeft }}>
									<div
										className="relative"
										data-track-content-area="other"
										data-content-height={otherTracksHeight}
									>
										{otherTrackBackgrounds}
										{otherTrackLockedOverlays}
										{otherTimelineItems}
									</div>
								</div>
							</div>
						</div>
						{/* 主轨道区域（sticky 底部） */}
						<div className="z-10 flex items-start border-t border-b border-white/10 sticky bottom-0">
							{/* 左侧主轨道标签 */}
							<div
								className={`text-white z-10 pr-px flex flex-col ${
									mainTrackVisible ? "bg-neutral-900/90" : "bg-black/80"
								} backdrop-blur-2xl border-r border-white/10`}
								style={{ width: leftColumnWidth }}
							>
								{mainTrackLabel}
							</div>
							{/* 右侧主轨道时间线内容 */}
							<div
								data-track-drop-zone="main"
								data-track-index="0"
								className="relative flex-1 overflow-x-hidden backdrop-blur-2xl"
								onMouseMove={handleMouseMove}
								onMouseLeave={handleMouseLeave}
								onClick={handleClick}
								style={{
									paddingLeft: leftColumnWidth,
									marginLeft: -leftColumnWidth,
								}}
							>
								<div style={{ paddingLeft: timelinePaddingLeft }}>
									<div className="relative" data-track-content-area="main">
										{mainTrackLockedOverlay}
										{mainTimelineItems}
									</div>
								</div>
							</div>
						</div>
						{/* 音频轨道区域 */}
						<div className="flex flex-1">
							{/* 左侧音频轨道标签 */}
							<div
								className="text-white z-10 pr-px flex flex-col"
								style={{ width: leftColumnWidth }}
							>
								{audioTrackLabels}
							</div>
							{/* 右侧音频轨道时间线内容 */}
							<div
								onClick={handleClick}
								data-track-drop-zone="audio"
								data-track-count={audioTrackIndicesForLayout.length}
								data-track-heights={audioTrackHeights.join(",")}
								data-track-height={getTrackHeightByRole("audio")}
								className="relative flex-1 overflow-x-hidden flex flex-col"
								style={{
									paddingLeft: leftColumnWidth,
									marginLeft: -leftColumnWidth,
								}}
							>
								<div style={{ paddingLeft: timelinePaddingLeft }}>
									<div
										className="relative"
										data-track-content-area="audio"
										data-content-height={audioTracksHeight}
									>
										{audioTrackLockedOverlays}
										{audioTimelineItems}
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
				{/* 拖拽 Ghost 层 */}
				<TimelineDragOverlay
					activeDropTarget={activeDropTarget}
					dragGhosts={dragGhosts}
					ratio={ratio}
					scrollLeft={scrollLeft}
					otherTrackCount={otherTrackCount}
					otherTrackHeights={otherTrackHeights}
					audioTrackCount={audioTrackIndicesForLayout.length}
					audioTrackHeights={audioTrackHeights}
					mainTrackHeight={mainTrackHeight}
					timelinePaddingLeft={timelinePaddingLeft}
				/>
			</div>
			<MaterialDragOverlay />
			<TimelineContextMenu
				open={contextMenuState.open}
				x={contextMenuState.open ? contextMenuState.x : 0}
				y={contextMenuState.open ? contextMenuState.y : 0}
				actions={contextMenuActions}
				onClose={closeContextMenu}
			/>
		</div>
	);
};

export default TimelineEditor;
