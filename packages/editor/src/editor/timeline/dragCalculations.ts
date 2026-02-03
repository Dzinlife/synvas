/**
 * 拖拽计算工具
 * 提取拖拽过程中的核心计算逻辑
 */

import { TimelineElement } from "@/dsl/types";
import {
	DropTarget,
	DropTargetType,
	TimeRange,
	isTimeOverlapping,
} from "./types";
import {
	GAP_THRESHOLD,
	SIGNIFICANT_VERTICAL_MOVE_RATIO,
	DEFAULT_ELEMENT_HEIGHT,
} from "./trackConfig";
import {
	getElementRole,
	hasRoleConflictOnStoredTrack,
} from "../utils/trackAssignment";

// ============================================================================
// 拖拽目标计算
// ============================================================================

/**
 * 根据 Y 坐标判断拖拽目标（轨道或间隙）
 */
export function calculateDropTarget(
	y: number,
	trackHeight: number,
	totalTracks: number
): DropTarget {
	const trackFromTop = Math.floor(y / trackHeight);
	const positionInTrack = y % trackHeight;

	// 检测是否在轨道边缘（间隙区域）
	const isInUpperGap = positionInTrack < GAP_THRESHOLD;
	const isInLowerGap = positionInTrack > trackHeight - GAP_THRESHOLD;

	// 转换为轨道索引（从底部开始计数）
	const trackIndex = Math.max(0, totalTracks - 1 - trackFromTop);

	if (isInUpperGap) {
		return {
			type: "gap",
			trackIndex: trackIndex + 1,
		};
	}

	if (isInLowerGap && trackIndex > 0) {
		return {
			type: "gap",
			trackIndex: trackIndex,
		};
	}

	return {
		type: "track",
		trackIndex,
	};
}

/**
 * 检查是否有显著的垂直移动
 */
export function hasSignificantVerticalMove(
	deltaY: number,
	trackHeight: number
): boolean {
	return Math.abs(deltaY) > trackHeight * SIGNIFICANT_VERTICAL_MOVE_RATIO;
}

/**
 * 计算元素中心点的 Y 坐标
 */
export function calculateCenterY(
	topY: number,
	elementHeight: number = DEFAULT_ELEMENT_HEIGHT
): number {
	return topY + elementHeight / 2;
}

// ============================================================================
// 时间重叠检测
// ============================================================================

/**
 * 检查时间范围是否与轨道上的其他元素重叠（基于存储的 trackIndex）
 */
export function hasOverlapOnTrack(
	timeRange: TimeRange,
	trackIndex: number,
	elements: TimelineElement[],
	excludeId?: string
): boolean {
	for (const el of elements) {
		if (el.id === excludeId) continue;
		if (el.type === "Transition") continue;
		const elTrack = el.timeline.trackIndex ?? 0;
		if (elTrack !== trackIndex) continue;

		if (
			isTimeOverlapping(timeRange, {
				start: el.timeline.start,
				end: el.timeline.end,
			})
		) {
			return true;
		}
	}
	return false;
}

/**
 * 在指定轨道范围内查找可用轨道
 */
export function findAvailableTrack(
	timeRange: TimeRange,
	startTrack: number,
	elements: TimelineElement[],
	excludeId: string,
	maxTrack: number
): number {
	const currentElement = elements.find((el) => el.id === excludeId);
	if (currentElement?.type === "Transition") {
		return startTrack;
	}
	for (let track = startTrack; track <= maxTrack; track++) {
		if (!hasOverlapOnTrack(timeRange, track, elements, excludeId)) {
			return track;
		}
	}
	return maxTrack + 1;
}

// ============================================================================
// 最终轨道位置计算
// ============================================================================

export interface FinalTrackResult {
	trackIndex: number;
	displayType: DropTargetType;
	/** 是否需要插入新轨道 */
	needsInsert: boolean;
}

/**
 * 计算最终的轨道位置
 * 考虑重叠检测和轨道可用性
 */
export function calculateFinalTrack(
	dropTarget: DropTarget,
	timeRange: TimeRange,
	elements: TimelineElement[],
	elementId: string,
	originalTrackIndex: number
): FinalTrackResult {
	const element = elements.find((el) => el.id === elementId);
	const elementRole = element ? getElementRole(element) : "overlay";
	const maxStoredTrack = Math.max(
		0,
		...elements.map((el) => el.timeline.trackIndex ?? 0)
	);

	if (dropTarget.type === "gap") {
		return calculateFinalTrackForGap(
			dropTarget,
			timeRange,
			elements,
			elementId,
			originalTrackIndex,
			maxStoredTrack,
			elementRole
		);
	}

	return calculateFinalTrackForTrack(
		dropTarget,
		timeRange,
		elements,
		elementId,
		maxStoredTrack,
		elementRole
	);
}

/**
 * Gap 模式下的最终轨道计算
 */
function calculateFinalTrackForGap(
	dropTarget: DropTarget,
	timeRange: TimeRange,
	elements: TimelineElement[],
	elementId: string,
	originalTrackIndex: number,
	maxStoredTrack: number,
	elementRole: ReturnType<typeof getElementRole>
): FinalTrackResult {
	const gapTrackIndex = dropTarget.trackIndex;
	const belowTrack = gapTrackIndex - 1;
	const aboveTrack = gapTrackIndex;

	// Gap preview should not snap back to the original track; this keeps insert intent.
	// 检查下方轨道是否有空位
	const belowHasSpace =
		belowTrack >= 0 &&
		belowTrack !== originalTrackIndex &&
		!hasRoleConflictOnStoredTrack(elementRole, belowTrack, elements, elementId) &&
		!hasOverlapOnTrack(timeRange, belowTrack, elements, elementId);

	// 检查上方轨道是否有空位
	const aboveHasSpace =
		aboveTrack <= maxStoredTrack &&
		aboveTrack !== originalTrackIndex &&
		!hasRoleConflictOnStoredTrack(elementRole, aboveTrack, elements, elementId) &&
		!hasOverlapOnTrack(timeRange, aboveTrack, elements, elementId);

	if (belowHasSpace) {
		return {
			trackIndex: belowTrack,
			displayType: "track",
			needsInsert: false,
		};
	}

	if (aboveHasSpace) {
		return {
			trackIndex: aboveTrack,
			displayType: "track",
			needsInsert: false,
		};
	}

	// 两边都没有空位，保持 gap 模式
	return {
		trackIndex: gapTrackIndex,
		displayType: "gap",
		needsInsert: true,
	};
}

/**
 * Track 模式下的最终轨道计算
 */
function calculateFinalTrackForTrack(
	dropTarget: DropTarget,
	timeRange: TimeRange,
	elements: TimelineElement[],
	elementId: string,
	maxStoredTrack: number,
	elementRole: ReturnType<typeof getElementRole>
): FinalTrackResult {
	const targetTrack = dropTarget.trackIndex;

	// 检查目标轨道是否有重叠
	const targetHasOverlap =
		hasRoleConflictOnStoredTrack(elementRole, targetTrack, elements, elementId) ||
		hasOverlapOnTrack(timeRange, targetTrack, elements, elementId);

	if (!targetHasOverlap) {
		return {
			trackIndex: targetTrack,
			displayType: "track",
			needsInsert: false,
		};
	}

	// 目标轨道有重叠，检查上方一级
	const aboveTrack = targetTrack + 1;
	const aboveHasOverlap =
		aboveTrack <= maxStoredTrack &&
		(hasRoleConflictOnStoredTrack(elementRole, aboveTrack, elements, elementId) ||
			hasOverlapOnTrack(timeRange, aboveTrack, elements, elementId));

	if (!aboveHasOverlap && aboveTrack <= maxStoredTrack) {
		return {
			trackIndex: aboveTrack,
			displayType: "track",
			needsInsert: false,
		};
	}

	// 需要创建新轨道
	return {
		trackIndex: targetTrack + 1,
		displayType: "gap",
		needsInsert: true,
	};
}

// ============================================================================
// 拖拽结果计算
// ============================================================================

export interface DragCalculationParams {
	/** 水平移动像素 */
	deltaX: number;
	/** 垂直移动像素 */
	deltaY: number;
	/** 时间比例（像素/帧） */
	ratio: number;
	/** 初始开始时间 */
	initialStart: number;
	/** 初始结束时间 */
	initialEnd: number;
	/** 初始轨道 Y 坐标 */
	initialTrackY: number;
	/** 初始轨道索引 */
	initialTrackIndex: number;
	/** 轨道高度 */
	trackHeight: number;
	/** 轨道总数 */
	trackCount: number;
	/** 元素高度 */
	elementHeight?: number;
}

export interface DragCalculationResult {
	/** 新的开始时间 */
	newStart: number;
	/** 新的结束时间 */
	newEnd: number;
	/** 新的 Y 坐标（用于显示） */
	newY: number;
	/** 中心 Y 坐标（用于轨道判定） */
	centerY: number;
	/** 拖拽目标 */
	dropTarget: DropTarget;
	/** 是否有显著垂直移动 */
	hasSignificantVerticalMove: boolean;
}

/**
 * 计算拖拽结果
 */
export function calculateDragResult(
	params: DragCalculationParams
): DragCalculationResult {
	const {
		deltaX,
		deltaY,
		ratio,
		initialStart,
		initialEnd,
		initialTrackY,
		initialTrackIndex,
		trackHeight,
		trackCount,
		elementHeight = DEFAULT_ELEMENT_HEIGHT,
	} = params;

	// 计算新的时间范围
	const deltaFrames = Math.round(deltaX / ratio);
	const duration = initialEnd - initialStart;
	const newStart = Math.max(0, initialStart + deltaFrames);
	const newEnd = newStart + duration;

	// 计算新的 Y 坐标
	const newY = initialTrackY + deltaY;
	const centerY = calculateCenterY(newY, elementHeight);

	// 检查是否有显著垂直移动
	const significantMove = hasSignificantVerticalMove(deltaY, trackHeight);

	// 计算拖拽目标
	let dropTarget: DropTarget;
	if (significantMove) {
		dropTarget = calculateDropTarget(
			Math.max(0, centerY),
			trackHeight,
			trackCount
		);
	} else {
		// 垂直移动不显著，保持原轨道
		dropTarget = { type: "track", trackIndex: initialTrackIndex };
	}

	return {
		newStart,
		newEnd,
		newY,
		centerY,
		dropTarget,
		hasSignificantVerticalMove: significantMove,
	};
}

// ============================================================================
// 轨道规范化
// ============================================================================

/**
 * 压缩轨道索引，移除空轨道
 * 直接基于存储的 trackIndex 压缩，不重新分配
 */
export function normalizeTrackIndices(
	elements: TimelineElement[]
): Map<string, number> {
	// 收集所有使用中的轨道索引
	const usedTracks = new Set<number>();
	for (const el of elements) {
		usedTracks.add(el.timeline.trackIndex ?? 0);
	}
	usedTracks.add(0); // 主轨道始终存在

	// 创建映射
	const sortedTracks = [...usedTracks].sort((a, b) => a - b);
	const trackMapping = new Map<number, number>();
	sortedTracks.forEach((oldTrack, newIndex) => {
		trackMapping.set(oldTrack, newIndex);
	});

	// 应用映射
	const result = new Map<string, number>();
	for (const el of elements) {
		const oldTrack = el.timeline.trackIndex ?? 0;
		const newTrack = trackMapping.get(oldTrack) ?? oldTrack;
		result.set(el.id, newTrack);
	}

	return result;
}

/**
 * 插入新轨道：将指定位置及以上的所有轨道向上移动
 */
export function insertTrackAt(
	insertAt: number,
	elements: TimelineElement[]
): Map<string, number> {
	const result = new Map<string, number>();

	for (const el of elements) {
		const track = el.timeline.trackIndex ?? 0;
		if (track >= insertAt) {
			result.set(el.id, track + 1);
		} else {
			result.set(el.id, track);
		}
	}

	return result;
}
