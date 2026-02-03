import { TimelineElement } from "@/dsl/types";

export const SNAP_THRESHOLD_PX = 10;

export type SnapPointType = "element-start" | "element-end" | "playhead";

export interface SnapPoint {
	time: number;
	type: SnapPointType;
	sourceId?: string;
}

/**
 * 收集所有可用的吸附点
 * @param elements 所有时间线元素
 * @param currentTime 当前播放头时间
 * @param excludeId 排除的元素ID（正在拖拽的元素）
 */
export function collectSnapPoints(
	elements: TimelineElement[],
	currentTime: number,
	excludeId: string,
): SnapPoint[] {
	const points: SnapPoint[] = [];

	// 收集所有元素的 start/end 边缘
	elements.forEach((el) => {
		if (el.type === "Transition") return;
		if (el.id !== excludeId) {
			points.push({
				time: el.timeline.start,
				type: "element-start",
				sourceId: el.id,
			});
			points.push({
				time: el.timeline.end,
				type: "element-end",
				sourceId: el.id,
			});
		}
	});

	// 添加播放头位置
	points.push({ time: currentTime, type: "playhead" });

	return points;
}

/**
 * 查找最近的吸附点
 * @param targetTime 目标时间
 * @param snapPoints 所有吸附点
 * @param thresholdTime 时间阈值（帧）
 * @returns 最近的吸附点，如果没有在阈值内则返回 null
 */
export function findNearestSnap(
	targetTime: number,
	snapPoints: SnapPoint[],
	thresholdTime: number,
): SnapPoint | null {
	let nearest: SnapPoint | null = null;
	let minDistance = Infinity;

	snapPoints.forEach((point) => {
		const distance = Math.abs(point.time - targetTime);
		if (distance < minDistance && distance <= thresholdTime) {
			minDistance = distance;
			nearest = point;
		}
	});

	return nearest;
}

/**
 * 计算吸附后的时间值
 * @param rawTime 原始时间值
 * @param snapPoints 吸附点列表
 * @param ratio 像素/帧比例
 * @returns { time: 吸附后的时间, snapPoint: 激活的吸附点 }
 */
export function applySnap(
	rawTime: number,
	snapPoints: SnapPoint[],
	ratio: number,
): { time: number; snapPoint: SnapPoint | null } {
	const thresholdFrames = Math.max(1, Math.round(SNAP_THRESHOLD_PX / ratio));
	const snapPoint = findNearestSnap(rawTime, snapPoints, thresholdFrames);

	if (snapPoint) {
		return { time: snapPoint.time, snapPoint };
	}

	return { time: rawTime, snapPoint: null };
}

/**
 * 计算整体拖动时的吸附（考虑 start 和 end 两个边缘）
 * @param rawStart 原始开始时间
 * @param rawEnd 原始结束时间
 * @param snapPoints 吸附点列表
 * @param ratio 像素/帧比例
 * @returns { start, end, snapPoint }
 */
export function applySnapForDrag(
	rawStart: number,
	rawEnd: number,
	snapPoints: SnapPoint[],
	ratio: number,
): { start: number; end: number; snapPoint: SnapPoint | null } {
	const thresholdFrames = Math.max(1, Math.round(SNAP_THRESHOLD_PX / ratio));
	const duration = rawEnd - rawStart;

	// 检查 start 边缘
	const startSnap = findNearestSnap(rawStart, snapPoints, thresholdFrames);
	// 检查 end 边缘
	const endSnap = findNearestSnap(rawEnd, snapPoints, thresholdFrames);

	// 选择距离更近的吸附点
	let activeSnap: SnapPoint | null = null;
	let newStart = rawStart;
	let newEnd = rawEnd;

	if (startSnap && endSnap) {
		const startDist = Math.abs(rawStart - startSnap.time);
		const endDist = Math.abs(rawEnd - endSnap.time);
		if (startDist <= endDist) {
			activeSnap = startSnap;
			newStart = startSnap.time;
			newEnd = newStart + duration;
		} else {
			activeSnap = endSnap;
			newEnd = endSnap.time;
			newStart = newEnd - duration;
		}
	} else if (startSnap) {
		activeSnap = startSnap;
		newStart = startSnap.time;
		newEnd = newStart + duration;
	} else if (endSnap) {
		activeSnap = endSnap;
		newEnd = endSnap.time;
		newStart = newEnd - duration;
	}

	// 确保 start 不小于 0
	if (newStart < 0) {
		newStart = 0;
		newEnd = duration;
		activeSnap = null;
	}

	return { start: newStart, end: newEnd, snapPoint: activeSnap };
}
