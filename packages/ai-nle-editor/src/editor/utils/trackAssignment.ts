import { TimelineElement, TrackRole } from "@nle/dsl/types";
import { TimelineTrack } from "../timeline/types";
import {
	getElementRoleFromComponent,
	getTrackConfig,
} from "../timeline/trackConfig";

/**
 * 主轨道索引（固定为 0，显示在最底部）
 */
export const MAIN_TRACK_INDEX = 0;

export function getTrackHeightByRole(role: TrackRole): number {
	return getTrackConfig(role).height;
}

/**
 * 获取元素 role（缺省时按轨道索引兜底）
 */
export function getElementRole(element: TimelineElement): TrackRole {
	if (element.timeline.role) {
		return element.timeline.role;
	}
	return getElementRoleFromComponent(element.component, "clip");
}

/**
 * 轨道是否允许该角色
 */
export function isRoleCompatibleWithTrack(
	role: TrackRole,
	trackIndex: number,
): boolean {
	return trackIndex !== MAIN_TRACK_INDEX || role === "clip";
}

/**
 * 计算轨道角色映射（基于分配结果）
 */
export function getTrackRoleMap(
	elements: TimelineElement[],
	assignments: Map<string, number>,
): Map<number, TrackRole> {
	const roleMap = new Map<number, TrackRole>();

	for (const el of elements) {
		const trackIndex = assignments.get(el.id) ?? el.timeline.trackIndex ?? 0;
		if (trackIndex === MAIN_TRACK_INDEX) {
			roleMap.set(MAIN_TRACK_INDEX, "clip");
			continue;
		}
		if (!roleMap.has(trackIndex)) {
			roleMap.set(trackIndex, getElementRole(el));
		}
	}

	if (!roleMap.has(MAIN_TRACK_INDEX)) {
		roleMap.set(MAIN_TRACK_INDEX, "clip");
	}

	return roleMap;
}

/**
 * 基于轨道列表生成角色映射
 */
export function getTrackRoleMapFromTracks(
	tracks: TimelineTrack[],
): Map<number, TrackRole> {
	const roleMap = new Map<number, TrackRole>();
	for (let index = 0; index < tracks.length; index += 1) {
		const track = tracks[index];
		roleMap.set(index, track.role);
	}
	return roleMap;
}

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
		const role =
			track?.role ?? (i === MAIN_TRACK_INDEX ? "clip" : "overlay");
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
	if (!isRoleCompatibleWithTrack(role, trackIndex)) {
		return true;
	}
	for (const el of elements) {
		if (el.id === excludeId) continue;
		const elTrack = assignments.get(el.id);
		if (elTrack !== trackIndex) continue;
		if (el.type === "Transition") continue;
		const elRole = getElementRole(el);
		if (elRole !== role) return true;
	}
	return false;
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
	if (!isRoleCompatibleWithTrack(role, trackIndex)) {
		return true;
	}
	for (const el of elements) {
		if (el.id === excludeId) continue;
		const elTrack = el.timeline.trackIndex ?? 0;
		if (elTrack !== trackIndex) continue;
		const elRole = getElementRole(el);
		if (elRole !== role) return true;
	}
	return false;
}

/**
 * 检查两个时间范围是否重叠
 */
export function isTimeOverlapping(
	start1: number,
	end1: number,
	start2: number,
	end2: number,
): boolean {
	return start1 < end2 && end1 > start2;
}

/**
 * 检查元素是否与轨道上的其他元素重叠
 * @param element 要检查的元素
 * @param trackIndex 目标轨道
 * @param elements 所有元素
 * @param assignments 当前轨道分配
 * @param excludeId 排除的元素ID（通常是正在移动的元素自身）
 */
export function hasOverlapOnTrack(
	start: number,
	end: number,
	trackIndex: number,
	elements: TimelineElement[],
	assignments: Map<string, number>,
	excludeId?: string,
): boolean {
	for (const el of elements) {
		if (el.id === excludeId) continue;
		const elTrack = assignments.get(el.id);
		if (elTrack !== trackIndex) continue;

		if (isTimeOverlapping(start, end, el.timeline.start, el.timeline.end)) {
			return true;
		}
	}
	return false;
}

/**
 * 检查元素是否与轨道上的其他元素重叠（基于存储的 trackIndex）
 * 此函数直接使用元素的 timeline.trackIndex，避免 assignTracks 的级联重新分配问题
 *
 * @param start 开始时间
 * @param end 结束时间
 * @param trackIndex 目标轨道
 * @param elements 所有元素
 * @param excludeId 排除的元素ID
 */
export function hasOverlapOnStoredTrack(
	start: number,
	end: number,
	trackIndex: number,
	elements: TimelineElement[],
	excludeId?: string,
): boolean {
	for (const el of elements) {
		if (el.id === excludeId) continue;
		const elStoredTrack = el.timeline.trackIndex ?? 0;
		if (elStoredTrack !== trackIndex) continue;
		if (el.type === "Transition") continue;

		if (isTimeOverlapping(start, end, el.timeline.start, el.timeline.end)) {
			return true;
		}
	}
	return false;
}

/**
 * 从指定轨道向上查找可用轨道（基于存储的 trackIndex）
 *
 * @param start 开始时间
 * @param end 结束时间
 * @param targetTrack 目标轨道
 * @param elements 所有元素
 * @param excludeId 排除的元素ID
 * @param maxTrack 最大轨道索引
 * @returns 可用的轨道索引，如果没有则返回 maxTrack + 1
 */
export function findAvailableStoredTrack(
	start: number,
	end: number,
	targetTrack: number,
	elements: TimelineElement[],
	excludeId: string,
	maxTrack: number,
): number {
	for (let track = targetTrack; track <= maxTrack; track++) {
		if (!hasOverlapOnStoredTrack(start, end, track, elements, excludeId)) {
			return track;
		}
	}
	// 所有现有轨道都有重叠
	return maxTrack + 1;
}

/**
 * 为元素找到合适的轨道位置
 * 如果目标轨道有重叠，向上寻找直到找到空闲位置或创建新轨道
 *
 * @param start 元素开始时间
 * @param end 元素结束时间
 * @param targetTrack 目标轨道（用户拖拽到的位置）
 * @param elements 所有元素
 * @param assignments 当前轨道分配
 * @param excludeId 排除的元素ID
 * @param trackCount 当前轨道总数
 * @returns 最终放置的轨道索引
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
	const currentElement = elements.find((el) => el.id === excludeId);
	if (currentElement?.type === "Transition") {
		return targetTrack;
	}
	// 从目标轨道开始向上寻找
	for (let track = targetTrack; track < trackCount + 1; track++) {
		if (hasRoleConflictOnTrack(role, track, elements, assignments, excludeId)) {
			continue;
		}
		if (
			!hasOverlapOnTrack(start, end, track, elements, assignments, excludeId)
		) {
			return track;
		}
	}
	// 如果所有现有轨道都有重叠，创建新轨道
	return trackCount;
}

/**
 * 基于元素的 timeline.trackIndex 进行轨道分配
 * 如果没有指定 trackIndex，默认放到主轨道（如果有重叠则向上）
 *
 * @param elements 所有时间线元素
 * @returns Map<elementId, trackIndex>
 */
export function assignTracks(elements: TimelineElement[]): Map<string, number> {
	if (elements.length === 0) {
		return new Map();
	}

	const assignments = new Map<string, number>();

	// 按 trackIndex 排序处理（有明确轨道的优先）
	// 没有 trackIndex 的元素放到后面处理
	const sorted = [...elements].sort((a, b) => {
		const aTrack = a.timeline.trackIndex ?? -1;
		const bTrack = b.timeline.trackIndex ?? -1;
		if (aTrack === -1 && bTrack === -1) {
			// 都没有指定轨道，按 start 时间排序
			return a.timeline.start - b.timeline.start;
		}
		if (aTrack === -1) return 1; // a 没有指定，放后面
		if (bTrack === -1) return -1; // b 没有指定，放后面
		return aTrack - bTrack;
	});

	// 当前最大轨道索引
	let maxTrack = MAIN_TRACK_INDEX;

	for (const element of sorted) {
		const { start, end, trackIndex } = element.timeline;
		const role = getElementRole(element);
		const targetTrack = trackIndex ?? MAIN_TRACK_INDEX;

		// 找到合适的轨道（如果目标轨道有重叠则向上寻找）
		const finalTrack = findAvailableTrack(
			start,
			end,
			targetTrack,
			role,
			elements,
			assignments,
			element.id,
			maxTrack + 1,
		);

		assignments.set(element.id, finalTrack);
		maxTrack = Math.max(maxTrack, finalTrack);
	}

	return assignments;
}

/**
 * 计算需要的轨道总数（至少1个主轨道）
 * @param assignments 轨道分配结果
 * @returns 轨道数量
 */
export function getTrackCount(assignments: Map<string, number>): number {
	if (assignments.size === 0) {
		return 1; // 至少有主轨道
	}
	return Math.max(...assignments.values()) + 1;
}

/**
 * 直接基于存储的 trackIndex 生成轨道分配
 */
export function getStoredTrackAssignments(
	elements: TimelineElement[],
): Map<string, number> {
	const assignments = new Map<string, number>();
	for (const el of elements) {
		assignments.set(el.id, el.timeline.trackIndex ?? MAIN_TRACK_INDEX);
	}
	return assignments;
}

/**
 * 规范化轨道分配，移除空轨道（主轨道除外）
 * 当某个轨道没有元素时，将上方轨道的元素下移
 *
 * @param assignments 当前轨道分配
 * @returns 规范化后的轨道分配
 */
export function normalizeTrackAssignments(
	assignments: Map<string, number>,
): Map<string, number> {
	if (assignments.size === 0) {
		return new Map();
	}

	// 收集所有使用中的轨道索引
	const usedTracks = new Set<number>();
	for (const track of assignments.values()) {
		usedTracks.add(track);
	}

	// 主轨道始终存在
	usedTracks.add(MAIN_TRACK_INDEX);

	// 排序轨道索引
	const sortedTracks = [...usedTracks].sort((a, b) => a - b);

	// 创建旧轨道到新轨道的映射
	const trackMapping = new Map<number, number>();
	sortedTracks.forEach((oldTrack, newTrack) => {
		trackMapping.set(oldTrack, newTrack);
	});

	// 应用映射
	const normalized = new Map<string, number>();
	for (const [elementId, oldTrack] of assignments.entries()) {
		const newTrack = trackMapping.get(oldTrack) ?? oldTrack;
		normalized.set(elementId, newTrack);
	}

	return normalized;
}

/**
 * 将规范化后的轨道分配写回元素
 */
export function applyTrackAssignments(
	elements: TimelineElement[],
): TimelineElement[] {
	if (elements.length === 0) {
		return elements;
	}

	const normalized = normalizeTrackAssignments(assignTracks(elements));
	let didChange = false;
	const updated = elements.map((el) => {
		const nextTrack = normalized.get(el.id);
		const currentTrack = el.timeline.trackIndex ?? MAIN_TRACK_INDEX;
		if (nextTrack === undefined || nextTrack === currentTrack) {
			return el;
		}
		didChange = true;
		return { ...el, timeline: { ...el.timeline, trackIndex: nextTrack } };
	});

	return didChange ? updated : elements;
}

/**
 * 基于存储的 trackIndex 压缩空轨道（不重新分配）
 * 返回更新后的元素数组（无变化则返回原数组引用）
 */
export function normalizeStoredTrackIndices(
	elements: TimelineElement[],
): TimelineElement[] {
	if (elements.length === 0) {
		return elements;
	}

	const usedTracks = new Set<number>();
	for (const el of elements) {
		usedTracks.add(el.timeline.trackIndex ?? MAIN_TRACK_INDEX);
	}
	usedTracks.add(MAIN_TRACK_INDEX);

	const sortedTracks = [...usedTracks].sort((a, b) => a - b);
	const trackMapping = new Map<number, number>();
	sortedTracks.forEach((oldTrack, newIndex) => {
		trackMapping.set(oldTrack, newIndex);
	});

	let didChange = false;
	const normalized = elements.map((el) => {
		const oldTrack = el.timeline.trackIndex ?? MAIN_TRACK_INDEX;
		const newTrack = trackMapping.get(oldTrack) ?? oldTrack;
		if (newTrack === oldTrack) {
			return el;
		}
		didChange = true;
		return {
			...el,
			timeline: {
				...el.timeline,
				trackIndex: newTrack,
			},
		};
	});

	return didChange ? normalized : elements;
}

/**
 * 根据 Y 坐标计算目标轨道索引
 * 注意：轨道 0（主轨道）在底部，轨道号越大位置越靠上
 *
 * @param y 拖拽位置 Y 坐标
 * @param trackHeight 每个轨道高度
 * @param totalTracks 轨道总数
 * @returns 目标轨道索引
 */
export function getTrackFromY(
	y: number,
	trackHeight: number,
	totalTracks: number,
): number {
	// Y 坐标从上到下增加
	// 轨道从上到下是：最高轨道 -> ... -> 轨道1 -> 主轨道(0)
	// 所以需要反转：y=0 对应最高轨道，y=max 对应主轨道
	const trackFromTop = Math.floor(y / trackHeight);
	const track = Math.max(0, totalTracks - 1 - trackFromTop);
	return track;
}

/**
 * 根据轨道索引计算 Y 坐标（用于渲染）
 * 注意：轨道 0（主轨道）在底部
 *
 * @param trackIndex 轨道索引
 * @param trackHeight 每个轨道高度
 * @param totalTracks 轨道总数
 * @returns Y 坐标
 */
export function getYFromTrack(
	trackIndex: number,
	trackHeight: number,
	totalTracks: number,
): number {
	// 轨道 0 在底部，轨道号越大位置越靠上
	return (totalTracks - 1 - trackIndex) * trackHeight;
}

/**
 * 间隙检测阈值（像素）- 轨道边缘多少像素范围内视为间隙
 */
export const GAP_THRESHOLD = 12;

/**
 * 拖拽目标类型
 */
export type DropTargetType = "track" | "gap";

export interface DropTarget {
	type: DropTargetType;
	trackIndex: number; // 对于 track 类型：目标轨道；对于 gap 类型：间隙上方的轨道
}

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
 *
 * @param y 拖拽位置 Y 坐标（相对于时间线容器顶部）
 * @param trackHeight 每个轨道高度
 * @param totalTracks 轨道总数
 * @returns 拖拽目标信息
 */
export function getDropTarget(
	y: number,
	trackHeight: number,
	totalTracks: number,
): DropTarget {
	// Y 坐标从上到下增加
	// 轨道从上到下是：最高轨道(n-1) -> ... -> 轨道1 -> 主轨道(0)

	// 计算在哪个轨道区域内
	const trackFromTop = Math.floor(y / trackHeight);
	const positionInTrack = y % trackHeight;

	// 检测是否在轨道的上边缘（间隙区域）
	const isInUpperGap = positionInTrack < GAP_THRESHOLD;
	// 检测是否在轨道的下边缘（间隙区域）
	const isInLowerGap = positionInTrack > trackHeight - GAP_THRESHOLD;

	// 转换为轨道索引（从底部开始计数）
	const trackIndex = Math.max(0, totalTracks - 1 - trackFromTop);

	if (isInUpperGap) {
		// 在轨道上边缘 - 这是当前轨道和上方轨道之间的间隙
		// 顶部轨道也允许插入到最上方
		return {
			type: "gap",
			trackIndex: trackIndex + 1, // 新轨道将插入到这个位置
		};
	}

	if (isInLowerGap && trackIndex > 0) {
		// 在轨道下边缘 - 这是当前轨道和下方轨道之间的间隙
		// 间隙位于 trackIndex - 1 和 trackIndex 之间
		return {
			type: "gap",
			trackIndex: trackIndex, // 新轨道将插入到这个位置
		};
	}

	// 在轨道中间区域
	return {
		type: "track",
		trackIndex,
	};
}

/**
 * 插入新轨道：将指定位置及以上的所有轨道向上移动
 *
 * @param insertAt 插入位置（新轨道的索引）
 * @param assignments 当前轨道分配
 * @returns 更新后的轨道分配
 */
export function insertTrackAt(
	insertAt: number,
	assignments: Map<string, number>,
): Map<string, number> {
	const result = new Map<string, number>();

	for (const [elementId, track] of assignments.entries()) {
		if (track >= insertAt) {
			// 在插入位置或以上的轨道向上移动一位
			result.set(elementId, track + 1);
		} else {
			result.set(elementId, track);
		}
	}

	return result;
}
