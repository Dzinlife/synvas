/**
 * 时间线元素组件
 * 负责单个元素的渲染和交互
 */

import { useDrag } from "@use-gesture/react";
import type { TimelineElement as TimelineElementType } from "core/element/types";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { componentRegistry } from "@/element/model/componentRegistry";
import { useModelExists } from "@/element/model/registry";
import { cn } from "@/lib/utils";
import { useModelRegistry } from "@/scene-editor/runtime/EditorRuntimeProvider";
import { framesToTimecode } from "@/utils/timecode";
import {
	useAttachments,
	useAutoScroll,
	useDragging,
	useElements,
	useFps,
	useMultiSelect,
	useRippleEditing,
	useSnap,
	useTimelineStore,
	useTrackAssignments,
} from "../contexts/TimelineContext";
import { getElementHeightForTrack } from "../timeline/index";
import { useTimelineElementDnd } from "../timeline/useTimelineElementDnd";
import {
	getTransitionDuration,
	getTransitionDurationParts,
	isTransitionElement,
} from "../utils/transitions";

// ============================================================================
// 类型定义
// ============================================================================

interface TimelineElementProps {
	element: TimelineElementType;
	trackIndex: number;
	trackY: number;
	ratio: number;
	trackHeight: number;
	trackCount: number;
	trackVisible?: boolean;
	trackLocked?: boolean;
	updateTimeRange: (
		elementId: string,
		start: number,
		end: number,
		options?: { offsetDelta?: number },
	) => void;
	onRequestContextMenu?: (
		event: React.MouseEvent<HTMLDivElement>,
		elementId: string,
	) => void;
}

// ============================================================================
// 子组件：拖拽手柄
// ============================================================================

interface DragHandleProps {
	position: "left" | "right";
	onDrag: ReturnType<typeof useDrag>;
}

const DragHandle: React.FC<DragHandleProps> = ({ position, onDrag }) => {
	const isLeft = position === "left";
	return (
		<div
			{...onDrag()}
			className={cn(
				isLeft
					? "left-0 rounded-l border-l-2"
					: "right-0 rounded-r border-r-2 touch-none",
				"pointer-events-auto touch-none top-0 bottom-0 max-w-2 w-full cursor-ew-resize z-10 hover:border-white border-transparent border-y-2",
			)}
		>
			{/* <div
				className={cn(
					"absolute",
					isLeft ? "left-0" : "right-0",
					"top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity",
				)}
			/> */}
		</div>
	);
};

// ============================================================================
// 子组件：元素内容
// ============================================================================

interface ElementContentProps {
	element: TimelineElementType;
	startTime: number;
	endTime: number;
	startTimecode: string;
	endTimecode: string;
	fps: number;
	offsetFrames?: number;
}

const ElementContent: React.FC<ElementContentProps> = ({
	element,
	startTime,
	endTime,
	startTimecode,
	endTimecode,
	fps,
	offsetFrames,
}) => {
	const { id, type, props, component } = element;
	const definition = componentRegistry.get(component);
	const hasModel = useModelExists(id);

	// 如果 model 还未创建，显示加载状态或基础信息
	if (definition?.Timeline && hasModel) {
		const TimelineComponent = definition.Timeline;
		return (
			<div className="size-full text-white">
				<TimelineComponent
					id={id}
					{...props}
					start={startTime}
					end={endTime}
					startTimecode={startTimecode}
					endTimecode={endTimecode}
					fps={fps}
					offsetFrames={offsetFrames}
				/>
			</div>
		);
	}

	return <div className="text-white">{element.name || type}</div>;
};

// ============================================================================
// Hooks：最大时长约束
// ============================================================================

function useMaxDurationConstraint(elementId: string) {
	const modelRegistry = useModelRegistry();
	const hasModel = useModelExists(elementId);
	const [maxDuration, setMaxDuration] = useState<number | undefined>(undefined);

	useEffect(() => {
		if (!hasModel) {
			setMaxDuration(undefined);
			return;
		}

		const store = modelRegistry.get(elementId);
		if (!store) {
			setMaxDuration(undefined);
			return;
		}

		setMaxDuration(store.getState().constraints.maxDuration);

		const unsubscribe = store.subscribe((state) => {
			setMaxDuration(state.constraints.maxDuration);
		});

		return unsubscribe;
	}, [elementId, hasModel, modelRegistry]);

	return maxDuration;
}

// ============================================================================
// Hooks：本地拖拽状态
// ============================================================================

interface LocalDragState {
	startTime: number | null;
	endTime: number | null;
	trackY: number | null;
	offsetFrames: number | null;
}

function useLocalDragState(
	baseStartTime: number,
	baseEndTime: number,
	baseTrackY: number,
) {
	const isDraggingRef = useRef(false);
	const [localState, setLocalState] = useState<LocalDragState>({
		startTime: null,
		endTime: null,
		trackY: null,
		offsetFrames: null,
	});

	// 当基础值变化且不在拖拽时，重置本地状态
	useEffect(() => {
		if (!isDraggingRef.current) {
			setLocalState({
				startTime: null,
				endTime: null,
				trackY: null,
				offsetFrames: null,
			});
		}
	}, [baseStartTime, baseEndTime, baseTrackY]);

	const setLocalStartTime = useCallback((time: number | null) => {
		setLocalState((prev) => ({ ...prev, startTime: time }));
	}, []);

	const setLocalEndTime = useCallback((time: number | null) => {
		setLocalState((prev) => ({ ...prev, endTime: time }));
	}, []);

	const setLocalTrackY = useCallback((y: number | null) => {
		setLocalState((prev) => ({ ...prev, trackY: y }));
	}, []);

	const setLocalOffsetFrames = useCallback((offsetFrames: number | null) => {
		setLocalState((prev) => ({ ...prev, offsetFrames }));
	}, []);

	const resetLocalState = useCallback(() => {
		setLocalState({
			startTime: null,
			endTime: null,
			trackY: null,
			offsetFrames: null,
		});
	}, []);

	return {
		isDraggingRef,
		localStartTime: localState.startTime,
		localEndTime: localState.endTime,
		localTrackY: localState.trackY,
		localOffsetFrames: localState.offsetFrames,
		setLocalStartTime,
		setLocalEndTime,
		setLocalTrackY,
		setLocalOffsetFrames,
		resetLocalState,
	};
}

// ============================================================================
// 主组件
// ============================================================================

const TimelineElement: React.FC<TimelineElementProps> = ({
	element,
	trackIndex,
	trackY,
	ratio,
	trackHeight,
	trackCount,
	trackVisible = true,
	trackLocked = false,
	updateTimeRange,
	onRequestContextMenu,
}) => {
	const { id, timeline } = element;
	const isTransition = isTransitionElement(element);
	const transitionBaseDuration = isTransition
		? getTransitionDuration(element)
		: 0;

	// Context hooks
	const { setIsDragging, setActiveDropTarget, setDragGhosts, dragGhosts } =
		useDragging();
	const { selectedIds, select, toggleSelect, setSelection } = useMultiSelect();
	const { snapEnabled, setActiveSnapPoint } = useSnap();
	const { elements, setElements } = useElements();
	const currentTime = useTimelineStore((state) => state.currentTime);
	const { fps } = useFps();
	const { attachments, autoAttach } = useAttachments();
	const { rippleEditingEnabled } = useRippleEditing();
	const { moveWithAttachments, trackAssignments } = useTrackAssignments();
	const {
		updateAutoScrollFromPosition,
		updateAutoScrollYFromPosition,
		stopAutoScroll,
	} = useAutoScroll();

	// 约束
	const maxDuration = useMaxDurationConstraint(id);

	// 本地拖拽状态
	const {
		localStartTime,
		localEndTime,
		localTrackY,
		localOffsetFrames,
		setLocalStartTime,
		setLocalEndTime,
		setLocalTrackY,
		setLocalOffsetFrames,
	} = useLocalDragState(timeline.start, timeline.end, trackY);
	const [localTransitionDuration, setLocalTransitionDuration] = useState<
		number | null
	>(null);

	useEffect(() => {
		if (!isTransition) {
			setLocalTransitionDuration(null);
			return;
		}
		setLocalTransitionDuration(null);
	}, [isTransition, transitionBaseDuration]);

	// Ref for DOM element (用于 clone)
	const elementRef = useRef<HTMLDivElement>(null);

	// 计算显示值
	const transitionDuration = localTransitionDuration ?? transitionBaseDuration;
	const { head: transitionHead, tail: transitionTail } =
		getTransitionDurationParts(transitionDuration);
	const transitionBoundary = isTransition
		? (element.transition?.boundry ?? timeline.start + transitionHead)
		: 0;
	const transitionStart = transitionBoundary - transitionHead;
	const transitionEnd = transitionBoundary + transitionTail;
	const startTime = isTransition
		? transitionStart
		: (localStartTime ?? timeline.start);
	const endTime = isTransition ? transitionEnd : (localEndTime ?? timeline.end);
	const startTimecode = framesToTimecode(startTime, fps);
	const endTimecode = framesToTimecode(endTime, fps);
	// 显示 Y：主轨道元素在容器内固定为 0，其他轨道使用 trackY
	// localTrackY 在拖拽时会被设置，用于显示拖拽效果（ghost 处理）
	// 由于主轨道元素在拖拽时会被隐藏（显示 ghost），这里不需要特殊处理 localTrackY
	const displayY = trackIndex === 0 ? 3 : (localTrackY ?? trackY);

	// 计算位置和尺寸
	const transitionWidth = transitionDuration * ratio;
	const transitionDisplayWidth = Math.max(6, transitionWidth - 2);
	const transitionDisplayOffset =
		(transitionWidth - transitionDisplayWidth) / 2;
	const left = isTransition
		? transitionStart * ratio + transitionDisplayOffset
		: startTime * ratio;
	const width = isTransition ? transitionWidth : (endTime - startTime) * ratio;
	const displayWidth = isTransition ? transitionDisplayWidth : width - 1;

	// 样式计算
	const isSelected = selectedIds.includes(id);
	const currentDuration = endTime - startTime;
	const isAtMaxDuration =
		maxDuration !== undefined && currentDuration === maxDuration;
	const elementHeight = getElementHeightForTrack(trackHeight);

	const { bindLeftDrag, bindRightDrag, bindBodyDrag } = useTimelineElementDnd({
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
		setLocalOffsetFrames,
		setLocalTransitionDuration,
		stopAutoScroll,
		updateAutoScrollFromPosition,
		updateAutoScrollYFromPosition,
		elementRef,
		transitionDuration,
	});

	// 点击选中
	const handleClick = useCallback(
		(e: React.MouseEvent) => {
			if (trackLocked) return;
			e.stopPropagation();
			const metaPressed = e.shiftKey || e.ctrlKey || e.metaKey;
			if (metaPressed) {
				toggleSelect(id);
				return;
			}
			select(id);
		},
		[id, select, toggleSelect, trackLocked],
	);
	const handleContextMenu = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (trackLocked) return;
			e.preventDefault();
			e.stopPropagation();
			onRequestContextMenu?.(e, id);
		},
		[id, onRequestContextMenu, trackLocked],
	);

	// 判断当前元素是否正在被拖拽
	const isBeingDragged = dragGhosts.some((ghost) => ghost.elementId === id);
	const isMultiDragging = dragGhosts.length > 1;
	const trackOpacity = trackVisible ? 1 : 0.35;
	const dragOpacity = isBeingDragged ? (isMultiDragging ? 0.5 : 0) : 1;

	// 容器样式
	const containerClassName = useMemo(() => {
		return cn("absolute flex rounded group overflow-hidden", {
			"bg-neutral-700": !isTransition,
			"bg-white/30 z-10 backdrop-blur-sm": isTransition,
			// "bg-amber-700 ring-1 ring-amber-500": isAtMaxDuration,
		});
	}, [isSelected, isAtMaxDuration, isTransition]);
	const emptyDragBind = useCallback(
		(() => ({})) as ReturnType<typeof useDrag>,
		[],
	);
	const bodyDragBind =
		isTransition || trackLocked ? emptyDragBind : bindBodyDrag;
	const leftDragBind = trackLocked ? emptyDragBind : bindLeftDrag;
	const rightDragBind = trackLocked ? emptyDragBind : bindRightDrag;

	return (
		<div
			ref={elementRef}
			data-timeline-element
			data-element-id={id}
			className={containerClassName}
			style={{
				left,
				width: displayWidth,
				top: displayY + (isTransition ? elementHeight / 2 - 14 : 0),
				height: isTransition ? 28 : elementHeight,
				// 拖拽时降低透明度，但保持在 DOM 中以维持拖拽手势
				opacity: trackOpacity * dragOpacity,
				pointerEvents: trackLocked ? "none" : "auto",
			}}
			onClick={handleClick}
			onContextMenu={handleContextMenu}
		>
			{isTransition ? null : (
				<div
					{...bodyDragBind()}
					className={cn(
						"relative p-1 size-full flex flex-col text-xs",
						// isTransition ? "cursor-default" : "cursor-move",
					)}
					style={{ touchAction: "none" }}
				>
					<ElementContent
						element={element}
						startTime={startTime}
						endTime={endTime}
						startTimecode={startTimecode}
						endTimecode={endTimecode}
						fps={fps}
						offsetFrames={localOffsetFrames ?? undefined}
					/>
				</div>
			)}

			<div
				className={cn(
					"absolute pointer-events-none inset-0 flex justify-between shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)] rounded group",
					isSelected && "shadow-[inset_0_0_0_1px_white]!",
				)}
			>
				<DragHandle position="left" onDrag={leftDragBind} />

				<DragHandle position="right" onDrag={rightDragBind} />
			</div>
		</div>
	);
};

export default TimelineElement;
