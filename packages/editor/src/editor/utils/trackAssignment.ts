import type { TimelineElement, TrackRole } from "core/dsl/types";
import type { DropTarget } from "core/editor/timeline/types";
import {
	applyTrackAssignments as applyTrackAssignmentsCore,
	assignTracks as assignTracksCore,
	findAvailableStoredTrack,
	findAvailableTrack as findAvailableTrackCore,
	getElementRole as getElementRoleCore,
	getStoredTrackAssignments,
	getTrackCount,
	getTrackRoleMap as getTrackRoleMapCore,
	getTrackRoleMapFromTracks,
	hasOverlapOnStoredTrack,
	hasOverlapOnTrack,
	hasRoleConflictOnStoredTrack as hasRoleConflictOnStoredTrackCore,
	hasRoleConflictOnTrack as hasRoleConflictOnTrackCore,
	insertTrackAt,
	isRoleCompatibleWithTrack,
	isTimeOverlapping,
	MAIN_TRACK_INDEX,
	normalizeStoredTrackIndices,
	normalizeTrackAssignments,
} from "core/editor/utils/trackAssignment";
import { getTrackConfig } from "../timeline/trackConfig";
import type { TimelineTrack } from "../timeline/types";
import { resolveTimelineElementRole } from "./resolveRole";

const resolveRole = resolveTimelineElementRole;

/**
 * 主轨道索引（固定为 0，显示在最底部）
 */
export { MAIN_TRACK_INDEX };

export function getTrackHeightByRole(role: TrackRole): number {
	return getTrackConfig(role).height;
}

/**
 * 获取元素 role（缺省时按轨道索引兜底）
 */
export function getElementRole(element: TimelineElement): TrackRole {
	return getElementRoleCore(element, { resolveRole });
}

/**
 * 轨道是否允许该角色
 */
export { isRoleCompatibleWithTrack };

/**
 * 计算轨道角色映射（基于分配结果）
 */
export function getTrackRoleMap(
	elements: TimelineElement[],
	assignments: Map<string, number>,
): Map<number, TrackRole> {
	return getTrackRoleMapCore(elements, assignments, { resolveRole });
}

/**
 * 基于轨道列表生成角色映射
 */
export { getTrackRoleMapFromTracks };

/**
 * 计算每个轨道高度（基于角色映射）
 */
export function getTrackHeightsByIndex(
	elements: TimelineElement[],
	assignments: Map<string, number>,
): Map<number, number> {
	const heights = new Map<number, number>();
	const maxIndex = Math.max(0, ...assignments.values());
	const roleMap = getTrackRoleMap(elements, assignments);

	for (let i = 0; i <= maxIndex; i++) {
		const role =
			roleMap.get(i) ?? (i === MAIN_TRACK_INDEX ? "clip" : "overlay");
		heights.set(i, getTrackHeightByRole(role));
	}

	return heights;
}

export interface TrackLayoutItem {
	index: number;
	role: TrackRole;
	height: number;
	/** 轨道顶部相对 Y（从最高轨道开始计） */
	y: number;
}

/**
 * 构建轨道布局（从上到下）
 */
export function buildTrackLayout(tracks: TimelineTrack[]): TrackLayoutItem[] {
	const layout: TrackLayoutItem[] = [];
	let currentY = 0;

	for (let i = tracks.length - 1; i >= 0; i--) {
		const track = tracks[i];
		const role = track?.role ?? (i === MAIN_TRACK_INDEX ? "clip" : "overlay");
		const height = getTrackHeightByRole(role);
		layout.push({
			index: i,
			role,
			height,
			y: currentY,
		});
		currentY += height;
	}

	return layout;
}

/**
 * 检查轨道角色冲突（基于分配结果）
 */
export function hasRoleConflictOnTrack(
	role: TrackRole,
	trackIndex: number,
	elements: TimelineElement[],
	assignments: Map<string, number>,
	excludeId?: string,
): boolean {
	return hasRoleConflictOnTrackCore(
		role,
		trackIndex,
		elements,
		assignments,
		excludeId,
		{ resolveRole },
	);
}

/**
 * 检查轨道角色冲突（基于存储的 trackIndex）
 */
export function hasRoleConflictOnStoredTrack(
	role: TrackRole,
	trackIndex: number,
	elements: TimelineElement[],
	excludeId?: string,
): boolean {
	return hasRoleConflictOnStoredTrackCore(
		role,
		trackIndex,
		elements,
		excludeId,
		{ resolveRole },
	);
}

/**
 * 检查两个时间范围是否重叠
 */
export { isTimeOverlapping };

/**
 * 检查元素是否与轨道上的其他元素重叠
 */
export { hasOverlapOnTrack };

/**
 * 检查元素是否与轨道上的其他元素重叠（基于存储的 trackIndex）
 */
export { hasOverlapOnStoredTrack };

/**
 * 从指定轨道向上查找可用轨道（基于存储的 trackIndex）
 */
export { findAvailableStoredTrack };

/**
 * 为元素找到合适的轨道位置
 */
export function findAvailableTrack(
	start: number,
	end: number,
	targetTrack: number,
	role: TrackRole,
	elements: TimelineElement[],
	assignments: Map<string, number>,
	excludeId: string,
	trackCount: number,
): number {
	return findAvailableTrackCore(
		start,
		end,
		targetTrack,
		role,
		elements,
		assignments,
		excludeId,
		trackCount,
		{ resolveRole },
	);
}

/**
 * 基于元素的 timeline.trackIndex 进行轨道分配
 */
export function assignTracks(elements: TimelineElement[]): Map<string, number> {
	return assignTracksCore(elements, { resolveRole });
}

/**
 * 计算需要的轨道总数（至少1个主轨道）
 */
export { getTrackCount };

/**
 * 直接基于存储的 trackIndex 生成轨道分配
 */
export { getStoredTrackAssignments };

/**
 * 规范化轨道分配，移除空轨道（主轨道除外）
 */
export { normalizeTrackAssignments };

/**
 * 将规范化后的轨道分配写回元素
 */
export function applyTrackAssignments(
	elements: TimelineElement[],
): TimelineElement[] {
	return applyTrackAssignmentsCore(elements, { resolveRole });
}

/**
 * 基于存储的 trackIndex 压缩空轨道（不重新分配）
 */
export { normalizeStoredTrackIndices };

/**
 * 根据 Y 坐标计算目标轨道索引
 */
export function getTrackFromY(
	y: number,
	trackHeight: number,
	totalTracks: number,
): number {
	const trackFromTop = Math.floor(y / trackHeight);
	const track = Math.max(0, totalTracks - 1 - trackFromTop);
	return track;
}

/**
 * 根据轨道索引计算 Y 坐标（用于渲染）
 */
export function getYFromTrack(
	trackIndex: number,
	trackHeight: number,
	totalTracks: number,
): number {
	return (totalTracks - 1 - trackIndex) * trackHeight;
}

/**
 * 间隙检测阈值（像素）- 轨道边缘多少像素范围内视为间隙
 */
export const GAP_THRESHOLD = 12;

export type { DropTarget, DropTargetType } from "core/editor/timeline/types";

export interface TrackHitResult {
	trackIndex: number;
	trackTop: number;
	trackHeight: number;
	positionInTrack: number;
	trackFromTop: number;
	totalHeight: number;
}

/**
 * 根据可变轨道高度计算命中的轨道信息（用于其他轨道区域）
 */
export function getTrackHitFromHeights(
	y: number,
	trackHeights: number[],
	maxTrackIndex: number,
): TrackHitResult | null {
	if (maxTrackIndex <= 0) return null;
	if (trackHeights.length === 0) return null;

	const heights = [...trackHeights];
	if (heights.length < maxTrackIndex) {
		const missing = maxTrackIndex - heights.length;
		for (let i = 0; i < missing; i++) {
			heights.push(getTrackHeightByRole("overlay"));
		}
	}
	if (heights.length > maxTrackIndex) {
		heights.length = maxTrackIndex;
	}

	const totalHeight = heights.reduce((sum, height) => sum + height, 0);
	if (y <= 0) {
		return {
			trackIndex: maxTrackIndex,
			trackTop: 0,
			trackHeight: heights[0],
			positionInTrack: 0,
			trackFromTop: 0,
			totalHeight,
		};
	}

	let cumulative = 0;
	for (let i = 0; i < heights.length; i++) {
		const height = heights[i];
		if (y < cumulative + height) {
			return {
				trackIndex: maxTrackIndex - i,
				trackTop: cumulative,
				trackHeight: height,
				positionInTrack: Math.max(0, y - cumulative),
				trackFromTop: i,
				totalHeight,
			};
		}
		cumulative += height;
	}

	const lastIndex = heights.length - 1;
	const lastHeight = heights[lastIndex];
	return {
		trackIndex: Math.max(1, maxTrackIndex - lastIndex),
		trackTop: Math.max(0, totalHeight - lastHeight),
		trackHeight: lastHeight,
		positionInTrack: lastHeight,
		trackFromTop: lastIndex,
		totalHeight,
	};
}

/**
 * 通过可变高度获取轨道顶部 Y（用于其他轨道区域）
 */
export function getTrackYFromHeights(
	trackIndex: number,
	trackHeights: number[],
	maxTrackIndex: number,
): number {
	const hit = getTrackHitFromHeights(0, trackHeights, maxTrackIndex);
	if (!hit) return 0;

	const normalizedIndex = Math.min(Math.max(trackIndex, 0), maxTrackIndex);
	if (normalizedIndex === 0) {
		return hit.totalHeight;
	}
	const trackFromTop = maxTrackIndex - normalizedIndex;
	const heights = [...trackHeights];
	if (heights.length < maxTrackIndex) {
		const missing = maxTrackIndex - heights.length;
		for (let i = 0; i < missing; i++) {
			heights.push(getTrackHeightByRole("overlay"));
		}
	}
	if (heights.length > maxTrackIndex) {
		heights.length = maxTrackIndex;
	}

	let offset = 0;
	for (let i = 0; i < trackFromTop && i < heights.length; i++) {
		offset += heights[i];
	}
	return offset;
}

/**
 * 根据可变轨道高度判断拖拽目标（轨道或间隙）
 */
export function getDropTargetFromHeights(
	y: number,
	trackHeights: number[],
	maxTrackIndex: number,
): DropTarget | null {
	const hit = getTrackHitFromHeights(y, trackHeights, maxTrackIndex);
	if (!hit) return null;

	const { trackIndex, positionInTrack, trackHeight } = hit;
	const isInUpperGap = positionInTrack < GAP_THRESHOLD;
	const isInLowerGap = positionInTrack > trackHeight - GAP_THRESHOLD;

	if (isInUpperGap) {
		return { type: "gap", trackIndex: trackIndex + 1 };
	}

	if (isInLowerGap && trackIndex > 0) {
		return { type: "gap", trackIndex };
	}

	return { type: "track", trackIndex };
}

function pickNearestTrackIndex(
	targetIndex: number,
	candidates: number[],
): number | null {
	if (candidates.length === 0) return null;
	let best: number | null = null;
	let bestDistance = Infinity;
	for (const candidate of candidates) {
		const distance = Math.abs(candidate - targetIndex);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = candidate;
		} else if (distance === bestDistance && best !== null) {
			best = Math.min(best, candidate);
		}
	}
	return best;
}

/**
 * 根据 role 调整拖拽目标（同角色优先，其次空轨道，否则插入新轨道）
 */
export function resolveDropTargetForRole(
	dropTarget: DropTarget,
	role: TrackRole,
	elements: TimelineElement[],
	assignments: Map<string, number>,
): DropTarget {
	if (role === "audio") {
		const targetTrack =
			dropTarget.trackIndex < MAIN_TRACK_INDEX ? dropTarget.trackIndex : -1;
		if (dropTarget.type === "gap") {
			return { type: "gap", trackIndex: targetTrack };
		}
		return { type: "track", trackIndex: targetTrack };
	}

	if (dropTarget.trackIndex < MAIN_TRACK_INDEX) {
		return {
			type: "track",
			trackIndex: role === "clip" ? MAIN_TRACK_INDEX : MAIN_TRACK_INDEX + 1,
		};
	}

	if (dropTarget.type === "gap") {
		if (role !== "clip" && dropTarget.trackIndex <= MAIN_TRACK_INDEX) {
			return { type: "gap", trackIndex: MAIN_TRACK_INDEX + 1 };
		}
		return dropTarget;
	}

	const maxIndex = Math.max(0, ...assignments.values());
	const roleMap = getTrackRoleMap(elements, assignments);
	const isCompatible = (index: number) =>
		isRoleCompatibleWithTrack(role, index) &&
		(!roleMap.has(index) || roleMap.get(index) === role);

	if (isCompatible(dropTarget.trackIndex)) {
		return dropTarget;
	}

	const indices = Array.from({ length: maxIndex + 1 }, (_, i) => i).filter(
		(index) => role === "clip" || index !== MAIN_TRACK_INDEX,
	);
	const sameRoleCandidates = indices.filter(
		(index) => roleMap.get(index) === role,
	);
	const nearestSameRole = pickNearestTrackIndex(
		dropTarget.trackIndex,
		sameRoleCandidates,
	);
	if (nearestSameRole !== null) {
		return { type: "track", trackIndex: nearestSameRole };
	}

	const emptyCandidates = indices.filter((index) => !roleMap.has(index));
	const nearestEmpty = pickNearestTrackIndex(
		dropTarget.trackIndex,
		emptyCandidates,
	);
	if (nearestEmpty !== null) {
		return { type: "track", trackIndex: nearestEmpty };
	}

	const insertIndex =
		role === "clip"
			? dropTarget.trackIndex
			: Math.max(MAIN_TRACK_INDEX + 1, dropTarget.trackIndex);
	return { type: "gap", trackIndex: insertIndex };
}

/**
 * 根据 Y 坐标判断拖拽目标（轨道或间隙）
 */
export function getDropTarget(
	y: number,
	trackHeight: number,
	totalTracks: number,
): DropTarget {
	const trackFromTop = Math.floor(y / trackHeight);
	const positionInTrack = y % trackHeight;

	const isInUpperGap = positionInTrack < GAP_THRESHOLD;
	const isInLowerGap = positionInTrack > trackHeight - GAP_THRESHOLD;

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
 * 插入新轨道：将指定位置及以上的所有轨道向上移动
 */
export { insertTrackAt };
