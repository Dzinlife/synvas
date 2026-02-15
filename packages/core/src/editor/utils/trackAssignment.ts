import type { TimelineElement, TrackRole } from "../../dsl/types";
import type { DropTarget, TimelineTrack } from "../timeline/types";

/**
 * 主轨道索引（固定为 0，显示在最底部）
 */
export const MAIN_TRACK_INDEX = 0;

export type ResolveRole = (element: TimelineElement) => TrackRole;

export type TrackRoleOptions = {
	resolveRole?: ResolveRole;
};

/**
 * 获取元素 role（缺省时按 timeline.role -> resolveRole -> clip）
 */
export function getElementRole(
	element: TimelineElement,
	options?: TrackRoleOptions,
): TrackRole {
	if (element.timeline.role) {
		return element.timeline.role;
	}
	if (options?.resolveRole) {
		return options.resolveRole(element);
	}
	return "clip";
}

/**
 * 轨道是否允许该角色
 */
export function isRoleCompatibleWithTrack(
	role: TrackRole,
	trackIndex: number,
): boolean {
	if (role === "audio") {
		return trackIndex < MAIN_TRACK_INDEX;
	}
	if (trackIndex < MAIN_TRACK_INDEX) {
		return false;
	}
	return trackIndex !== MAIN_TRACK_INDEX || role === "clip";
}

/**
 * 计算轨道角色映射（基于分配结果）
 */
export function getTrackRoleMap(
	elements: TimelineElement[],
	assignments: Map<string, number>,
	options?: TrackRoleOptions,
): Map<number, TrackRole> {
	const roleMap = new Map<number, TrackRole>();

	for (const el of elements) {
		const trackIndex = assignments.get(el.id) ?? el.timeline.trackIndex ?? 0;
		if (trackIndex === MAIN_TRACK_INDEX) {
			roleMap.set(MAIN_TRACK_INDEX, "clip");
			continue;
		}
		if (!roleMap.has(trackIndex)) {
			roleMap.set(trackIndex, getElementRole(el, options));
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
 * 检查轨道角色冲突（基于分配结果）
 */
export function hasRoleConflictOnTrack(
	role: TrackRole,
	trackIndex: number,
	elements: TimelineElement[],
	assignments: Map<string, number>,
	excludeId?: string,
	options?: TrackRoleOptions,
): boolean {
	if (!isRoleCompatibleWithTrack(role, trackIndex)) {
		return true;
	}
	for (const el of elements) {
		if (el.id === excludeId) continue;
		const elTrack = assignments.get(el.id);
		if (elTrack !== trackIndex) continue;
		if (el.type === "Transition") continue;
		const elRole = getElementRole(el, options);
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
	options?: TrackRoleOptions,
): boolean {
	if (!isRoleCompatibleWithTrack(role, trackIndex)) {
		return true;
	}
	for (const el of elements) {
		if (el.id === excludeId) continue;
		const elTrack = el.timeline.trackIndex ?? 0;
		if (elTrack !== trackIndex) continue;
		const elRole = getElementRole(el, options);
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
 */
export function findAvailableStoredTrack(
	start: number,
	end: number,
	targetTrack: number,
	elements: TimelineElement[],
	excludeId: string,
	maxTrack: number,
): number {
	if (targetTrack < MAIN_TRACK_INDEX) {
		let minTrack = targetTrack;
		for (const el of elements) {
			const track = el.timeline.trackIndex ?? MAIN_TRACK_INDEX;
			if (track < minTrack) {
				minTrack = track;
			}
		}
		for (let track = targetTrack; track >= minTrack; track--) {
			if (!hasOverlapOnStoredTrack(start, end, track, elements, excludeId)) {
				return track;
			}
		}
		return minTrack - 1;
	}

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
	options?: TrackRoleOptions,
): number {
	const currentElement = elements.find((el) => el.id === excludeId);
	if (currentElement?.type === "Transition") {
		return targetTrack;
	}
	if (role === "audio") {
		const safeTarget = targetTrack < MAIN_TRACK_INDEX ? targetTrack : -1;
		let minTrack = safeTarget;
		for (const el of elements) {
			const track = assignments.get(el.id) ?? el.timeline.trackIndex ?? MAIN_TRACK_INDEX;
			if (track < minTrack) {
				minTrack = track;
			}
		}
		for (let track = safeTarget; track >= minTrack; track--) {
			if (
				hasRoleConflictOnTrack(
					role,
					track,
					elements,
					assignments,
					excludeId,
					options,
				)
			) {
				continue;
			}
			if (
				!hasOverlapOnTrack(start, end, track, elements, assignments, excludeId)
			) {
				return track;
			}
		}
		return minTrack - 1;
	}

	const safeTarget = targetTrack < MAIN_TRACK_INDEX ? MAIN_TRACK_INDEX : targetTrack;
	for (let track = safeTarget; track < trackCount + 1; track++) {
		if (
			hasRoleConflictOnTrack(
				role,
				track,
				elements,
				assignments,
				excludeId,
				options,
			)
		) {
			continue;
		}
		if (!hasOverlapOnTrack(start, end, track, elements, assignments, excludeId)) {
			return track;
		}
	}
	return Math.max(MAIN_TRACK_INDEX, trackCount);
}

/**
 * 基于元素的 timeline.trackIndex 进行轨道分配
 */
export function assignTracks(
	elements: TimelineElement[],
	options?: TrackRoleOptions,
): Map<string, number> {
	if (elements.length === 0) {
		return new Map();
	}

	const assignments = new Map<string, number>();

	const sorted = [...elements].sort((a, b) => {
		const aTrack = a.timeline.trackIndex;
		const bTrack = b.timeline.trackIndex;
		const aHasTrack = Number.isFinite(aTrack);
		const bHasTrack = Number.isFinite(bTrack);
		if (!aHasTrack && !bHasTrack) {
			return a.timeline.start - b.timeline.start;
		}
		if (!aHasTrack) return 1;
		if (!bHasTrack) return -1;
		return (aTrack as number) - (bTrack as number);
	});

	let maxTrack = MAIN_TRACK_INDEX;

	for (const element of sorted) {
		const { start, end, trackIndex } = element.timeline;
		const role = getElementRole(element, options);
		const targetTrack = trackIndex ?? MAIN_TRACK_INDEX;

		const finalTrack = findAvailableTrack(
			start,
			end,
			targetTrack,
			role,
			elements,
			assignments,
			element.id,
			maxTrack + 1,
			options,
		);

		assignments.set(element.id, finalTrack);
		maxTrack = Math.max(maxTrack, finalTrack);
	}

	return assignments;
}

/**
 * 计算需要的轨道总数（至少1个主轨道）
 */
export function getTrackCount(assignments: Map<string, number>): number {
	if (assignments.size === 0) {
		return 1;
	}
	const nonNegative = Array.from(assignments.values()).filter(
		(track) => track >= MAIN_TRACK_INDEX,
	);
	if (nonNegative.length === 0) {
		return 1;
	}
	return Math.max(...nonNegative) + 1;
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
 */
export function normalizeTrackAssignments(
	assignments: Map<string, number>,
): Map<string, number> {
	if (assignments.size === 0) {
		return new Map();
	}

	const positiveTracks = new Set<number>();
	const negativeTracks = new Set<number>();
	for (const track of assignments.values()) {
		if (track < MAIN_TRACK_INDEX) {
			negativeTracks.add(track);
		} else {
			positiveTracks.add(track);
		}
	}
	positiveTracks.add(MAIN_TRACK_INDEX);

	const sortedPositive = [...positiveTracks].sort((a, b) => a - b);
	const sortedNegative = [...negativeTracks].sort((a, b) => b - a);

	const trackMapping = new Map<number, number>();
	sortedPositive.forEach((oldTrack, newIndex) => {
		trackMapping.set(oldTrack, newIndex);
	});
	sortedNegative.forEach((oldTrack, newIndex) => {
		trackMapping.set(oldTrack, -(newIndex + 1));
	});

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
	options?: TrackRoleOptions,
): TimelineElement[] {
	if (elements.length === 0) {
		return elements;
	}

	const normalized = normalizeTrackAssignments(assignTracks(elements, options));
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
 */
export function normalizeStoredTrackIndices(
	elements: TimelineElement[],
): TimelineElement[] {
	if (elements.length === 0) {
		return elements;
	}

	const positiveTracks = new Set<number>();
	const negativeTracks = new Set<number>();
	for (const el of elements) {
		const trackIndex = el.timeline.trackIndex ?? MAIN_TRACK_INDEX;
		if (trackIndex < MAIN_TRACK_INDEX) {
			negativeTracks.add(trackIndex);
		} else {
			positiveTracks.add(trackIndex);
		}
	}
	positiveTracks.add(MAIN_TRACK_INDEX);

	const sortedPositive = [...positiveTracks].sort((a, b) => a - b);
	const sortedNegative = [...negativeTracks].sort((a, b) => b - a);
	const trackMapping = new Map<number, number>();
	sortedPositive.forEach((oldTrack, newIndex) => {
		trackMapping.set(oldTrack, newIndex);
	});
	sortedNegative.forEach((oldTrack, newIndex) => {
		trackMapping.set(oldTrack, -(newIndex + 1));
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

const pickNearestTrackIndex = (
	targetIndex: number,
	candidates: number[],
): number | null => {
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
};

/**
 * 根据 role 调整拖拽目标（同角色优先，其次空轨道，否则插入新轨道）
 */
export function resolveDropTargetForRole(
	dropTarget: DropTarget,
	role: TrackRole,
	elements: TimelineElement[],
	assignments: Map<string, number>,
	options?: TrackRoleOptions,
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
	const roleMap = getTrackRoleMap(elements, assignments, options);
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
 * 插入新轨道：将指定位置及以上的所有轨道向上移动
 */
export function insertTrackAt(
	insertAt: number,
	assignments: Map<string, number>,
): Map<string, number> {
	const result = new Map<string, number>();

	if (insertAt < MAIN_TRACK_INDEX) {
		for (const [elementId, track] of assignments.entries()) {
			if (track <= insertAt) {
				result.set(elementId, track - 1);
			} else {
				result.set(elementId, track);
			}
		}
		return result;
	}

	for (const [elementId, track] of assignments.entries()) {
		if (track >= insertAt) {
			result.set(elementId, track + 1);
		} else {
			result.set(elementId, track);
		}
	}

	return result;
}
