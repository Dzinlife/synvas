/**
 * 元素拖拽 Hook
 * 封装时间线元素拖拽的核心逻辑
 */

import { useDrag } from "@use-gesture/react";
import { useRef } from "react";
import { TimelineElement } from "@/dsl/types";
import { calculateDragResult, calculateFinalTrack } from "./dragCalculations";
import { getElementHeightForTrack } from "./trackConfig";
import { DropTarget, ExtendedDropTarget, SnapPoint } from "./types";

// ============================================================================
// 类型定义
// ============================================================================

export interface UseElementDragOptions {
	/** 元素数据 */
	element: TimelineElement;
	/** 当前轨道 Y 坐标 */
	trackY: number;
	/** 时间比例（像素/帧） */
	ratio: number;
	/** 轨道高度 */
	trackHeight: number;
	/** 轨道总数 */
	trackCount: number;
	/** 元素高度 */
	elementHeight?: number;
	/** 所有元素列表 */
	elements: TimelineElement[];
	/** 当前时间（用于吸附） */
	currentTime: number;
	/** 是否启用吸附 */
	snapEnabled: boolean;
	/** 是否启用自动关联 */
	autoAttach: boolean;
	/** 关联映射 */
	attachments: Map<string, string[]>;
	/** 吸附点收集函数 */
	collectSnapPoints: (
		elements: TimelineElement[],
		currentTime: number,
		excludeId: string,
	) => SnapPoint[];
	/** 应用吸附函数 */
	applySnapForDrag: (
		start: number,
		end: number,
		snapPoints: SnapPoint[],
		ratio: number,
	) => { start: number; end: number; snapPoint: SnapPoint | null };
	/** 回调函数 */
	callbacks: {
		onDragStart?: () => void;
		onDragMove?: (state: DragMoveState) => void;
		onDragEnd?: (result: DragEndResult) => void;
		setIsDragging: (isDragging: boolean) => void;
		setActiveSnapPoint: (point: SnapPoint | null) => void;
		setActiveDropTarget: (target: ExtendedDropTarget | null) => void;
	};
}

export interface DragMoveState {
	newStart: number;
	newEnd: number;
	newY: number;
	dropTarget: DropTarget;
	finalTrackIndex: number;
	displayType: "track" | "gap";
	snapPoint: SnapPoint | null;
}

export interface DragEndResult {
	newStart: number;
	newEnd: number;
	dropTarget: DropTarget;
	attachedChildren: Array<{ id: string; start: number; end: number }>;
	isLeavingMainTrack: boolean;
}

// ============================================================================
// 拖拽 Refs 管理
// ============================================================================

interface DragRefs {
	isDragging: boolean;
	initialStart: number;
	initialEnd: number;
	initialTrack: number;
	currentStart: number;
	currentEnd: number;
}

function useDragRefs() {
	const refs = useRef<DragRefs>({
		isDragging: false,
		initialStart: 0,
		initialEnd: 0,
		initialTrack: 0,
		currentStart: 0,
		currentEnd: 0,
	});
	return refs;
}

// ============================================================================
// 主 Hook
// ============================================================================

/**
 * 整体拖拽 Hook（移动元素位置和轨道）
 */
export function useElementBodyDrag(options: UseElementDragOptions) {
	const {
		element,
		trackY,
		ratio,
		trackHeight,
		trackCount,
		elementHeight,
		elements,
		currentTime,
		snapEnabled,
		autoAttach,
		attachments,
		collectSnapPoints,
		applySnapForDrag,
		callbacks,
	} = options;
	const resolvedElementHeight =
		elementHeight ?? getElementHeightForTrack(trackHeight);

	const dragRefs = useDragRefs();

	// 同步当前时间到 refs
	dragRefs.current.currentStart = element.timeline.start;
	dragRefs.current.currentEnd = element.timeline.end;

	const bindDrag = useDrag(
		({ movement: [mx, my], first, last, event, tap }) => {
			if (tap) return;

			const { id, timeline } = element;

			if (first) {
				event?.stopPropagation();
				dragRefs.current.isDragging = true;
				dragRefs.current.initialStart = dragRefs.current.currentStart;
				dragRefs.current.initialEnd = dragRefs.current.currentEnd;
				dragRefs.current.initialTrack = timeline.trackIndex ?? 0;
				callbacks.setIsDragging(true);
				callbacks.onDragStart?.();
			}

			// 计算基础拖拽结果
			const dragResult = calculateDragResult({
				deltaX: mx,
				deltaY: my,
				ratio,
				initialStart: dragRefs.current.initialStart,
				initialEnd: dragRefs.current.initialEnd,
				initialTrackY: trackY,
				initialTrackIndex: dragRefs.current.initialTrack,
				trackHeight,
				trackCount,
				elementHeight: resolvedElementHeight,
			});

			let { newStart, newEnd } = dragResult;
			const { newY, dropTarget, hasSignificantVerticalMove } = dragResult;

			// 应用吸附
			let snapPoint: SnapPoint | null = null;
			if (snapEnabled) {
				const snapPoints = collectSnapPoints(elements, currentTime, id);
				const snapped = applySnapForDrag(newStart, newEnd, snapPoints, ratio);
				newStart = snapped.start;
				newEnd = snapped.end;
				snapPoint = snapped.snapPoint;
			}

			if (last) {
				// 拖拽结束
				dragRefs.current.isDragging = false;
				callbacks.setIsDragging(false);
				callbacks.setActiveSnapPoint(null);
				callbacks.setActiveDropTarget(null);

				if (Math.abs(mx) > 0 || Math.abs(my) > 0) {
					const actualDelta = newStart - dragRefs.current.initialStart;
					const originalTrackIndex = timeline.trackIndex ?? 0;

					// 检查是否离开主轨道
					const isLeavingMainTrack =
						originalTrackIndex === 0 &&
						hasSignificantVerticalMove &&
						(dropTarget.type === "gap" || dropTarget.trackIndex > 0);

					// 收集关联子元素
					const attachedChildren: Array<{
						id: string;
						start: number;
						end: number;
					}> = [];
					if (autoAttach && actualDelta !== 0 && !isLeavingMainTrack) {
						const childIds = attachments.get(id) ?? [];
						for (const childId of childIds) {
							const child = elements.find((el) => el.id === childId);
							if (child) {
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

					callbacks.onDragEnd?.({
						newStart,
						newEnd,
						dropTarget,
						attachedChildren,
						isLeavingMainTrack,
					});
				}
			} else {
				// 拖拽过程中
				// 计算最终轨道位置
				const tempElements = elements.map((el) =>
					el.id === id
						? {
								...el,
								timeline: { ...el.timeline, start: newStart, end: newEnd },
							}
						: el,
				);

				const finalTrackResult = calculateFinalTrack(
					dropTarget,
					{ start: newStart, end: newEnd },
					tempElements,
					id,
					timeline.trackIndex ?? 0,
				);

				const moveState: DragMoveState = {
					newStart,
					newEnd,
					newY,
					dropTarget,
					finalTrackIndex: finalTrackResult.trackIndex,
					displayType: finalTrackResult.displayType,
					snapPoint,
				};

				callbacks.setActiveSnapPoint(snapPoint);
				callbacks.setActiveDropTarget({
					type: finalTrackResult.displayType,
					trackIndex:
						finalTrackResult.displayType === "gap"
							? finalTrackResult.trackIndex
							: dropTarget.trackIndex,
					elementId: id,
					start: newStart,
					end: newEnd,
					finalTrackIndex: finalTrackResult.trackIndex,
				});

				callbacks.onDragMove?.(moveState);
			}
		},
		{ filterTaps: true },
	);

	return bindDrag;
}

// ============================================================================
// 边缘拖拽 Hooks（调整时长）
// ============================================================================

export interface UseEdgeDragOptions {
	/** 元素数据 */
	element: TimelineElement;
	/** 时间比例（像素/帧） */
	ratio: number;
	/** 最大时长约束 */
	maxDuration?: number;
	/** 所有元素列表 */
	elements: TimelineElement[];
	/** 当前时间（用于吸附） */
	currentTime: number;
	/** 是否启用吸附 */
	snapEnabled: boolean;
	/** 吸附点收集函数 */
	collectSnapPoints: (
		elements: TimelineElement[],
		currentTime: number,
		excludeId: string,
	) => SnapPoint[];
	/** 应用吸附函数 */
	applySnap: (
		time: number,
		snapPoints: SnapPoint[],
		ratio: number,
	) => { time: number; snapPoint: SnapPoint | null };
	/** 回调函数 */
	callbacks: {
		onDragStart?: () => void;
		onDragEnd?: (start: number, end: number) => void;
		setIsDragging: (isDragging: boolean) => void;
		setActiveSnapPoint: (point: SnapPoint | null) => void;
		setLocalStartTime?: (time: number | null) => void;
		setLocalEndTime?: (time: number | null) => void;
	};
}

/**
 * 左边缘拖拽 Hook（调整开始时间）
 */
export function useLeftEdgeDrag(options: UseEdgeDragOptions) {
	const {
		element,
		ratio,
		maxDuration,
		elements,
		currentTime,
		snapEnabled,
		collectSnapPoints,
		applySnap,
		callbacks,
	} = options;

	const dragRefs = useDragRefs();

	// 同步当前时间到 refs
	dragRefs.current.currentStart = element.timeline.start;
	dragRefs.current.currentEnd = element.timeline.end;

	const bindDrag = useDrag(
		({ movement: [mx], first, last, event, tap }) => {
			if (tap) return;

			const { id } = element;

			if (first) {
				event?.stopPropagation();
				dragRefs.current.isDragging = true;
				dragRefs.current.initialStart = dragRefs.current.currentStart;
				dragRefs.current.initialEnd = dragRefs.current.currentEnd;
				callbacks.setIsDragging(true);
				callbacks.onDragStart?.();
			}

			const deltaFrames = Math.round(mx / ratio);
			let newStart = Math.max(
				0,
				Math.min(
					dragRefs.current.initialStart + deltaFrames,
					dragRefs.current.initialEnd - 1,
				),
			);

			// 最大时长约束
			if (maxDuration !== undefined) {
				const minStart = dragRefs.current.initialEnd - maxDuration;
				newStart = Math.max(newStart, minStart);
			}

			// 吸附处理
			let snapPoint: SnapPoint | null = null;
			if (snapEnabled) {
				const snapPoints = collectSnapPoints(elements, currentTime, id);
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

			if (last) {
				dragRefs.current.isDragging = false;
				callbacks.setIsDragging(false);
				callbacks.setActiveSnapPoint(null);
				if (Math.abs(mx) > 0) {
					callbacks.onDragEnd?.(newStart, dragRefs.current.initialEnd);
				}
			} else {
				callbacks.setLocalStartTime?.(newStart);
				callbacks.setActiveSnapPoint(snapPoint);
			}
		},
		{ axis: "x", filterTaps: true },
	);

	return bindDrag;
}

/**
 * 右边缘拖拽 Hook（调整结束时间）
 */
export function useRightEdgeDrag(options: UseEdgeDragOptions) {
	const {
		element,
		ratio,
		maxDuration,
		elements,
		currentTime,
		snapEnabled,
		collectSnapPoints,
		applySnap,
		callbacks,
	} = options;

	const dragRefs = useDragRefs();

	// 同步当前时间到 refs
	dragRefs.current.currentStart = element.timeline.start;
	dragRefs.current.currentEnd = element.timeline.end;

	const bindDrag = useDrag(
		({ movement: [mx], first, last, event, tap }) => {
			if (tap) return;

			const { id } = element;

			if (first) {
				event?.stopPropagation();
				dragRefs.current.isDragging = true;
				dragRefs.current.initialStart = dragRefs.current.currentStart;
				dragRefs.current.initialEnd = dragRefs.current.currentEnd;
				callbacks.setIsDragging(true);
				callbacks.onDragStart?.();
			}

			const deltaFrames = Math.round(mx / ratio);
			let newEnd = Math.max(
				dragRefs.current.initialStart + 1,
				dragRefs.current.initialEnd + deltaFrames,
			);

			// 最大时长约束
			if (maxDuration !== undefined) {
				const maxEnd = dragRefs.current.initialStart + maxDuration;
				newEnd = Math.min(newEnd, maxEnd);
			}

			// 吸附处理
			let snapPoint: SnapPoint | null = null;
			if (snapEnabled) {
				const snapPoints = collectSnapPoints(elements, currentTime, id);
				const snapped = applySnap(newEnd, snapPoints, ratio);
				if (
					snapped.snapPoint &&
					snapped.time > dragRefs.current.initialStart + 1
				) {
					newEnd = snapped.time;
					snapPoint = snapped.snapPoint;
				}
			}

			if (last) {
				dragRefs.current.isDragging = false;
				callbacks.setIsDragging(false);
				callbacks.setActiveSnapPoint(null);
				if (Math.abs(mx) > 0) {
					callbacks.onDragEnd?.(dragRefs.current.initialStart, newEnd);
				}
			} else {
				callbacks.setLocalEndTime?.(newEnd);
				callbacks.setActiveSnapPoint(snapPoint);
			}
		},
		{ axis: "x", filterTaps: true },
	);

	return bindDrag;
}
