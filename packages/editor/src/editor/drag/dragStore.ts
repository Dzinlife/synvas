/**
 * 全局拖拽状态管理
 * 用于支持从素材库拖拽到时间线等跨组件拖拽场景
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

// ============================================================================
// 类型定义
// ============================================================================

/** 拖拽来源类型 */
export type DragSourceType = "timeline" | "material-library" | "external-file";

/** 素材类型 */
export type MaterialType =
	| "image"
	| "video"
	| "audio"
	| "text"
	| "transition";

/** 拖拽数据：来自素材库 */
export interface MaterialDragData {
	type: MaterialType;
	/** 素材 URI */
	uri: string;
	/** 素材名称 */
	name: string;
	/** 预览图 URL（可选） */
	thumbnailUrl?: string;
	/** 素材宽度（可选） */
	width?: number;
	/** 素材高度（可选） */
	height?: number;
	/** 素材时长（视频/音频，帧） */
	duration?: number;
}

/** 拖拽数据：来自时间线 */
export interface TimelineDragData {
	elementId: string;
	originalStart: number;
	originalEnd: number;
	originalTrackIndex: number;
}

/** 拖拽数据联合类型 */
export type DragData = MaterialDragData | TimelineDragData;

/** Ghost 渲染信息 */
export interface DragGhostInfo {
	/** 屏幕 X 坐标 */
	screenX: number;
	/** 屏幕 Y 坐标 */
	screenY: number;
	/** Ghost 宽度 */
	width: number;
	/** Ghost 高度 */
	height: number;
	/** 克隆的 HTML（用于时间线元素拖拽） */
	clonedHtml?: string;
	/** 预览图 URL（用于素材库拖拽） */
	thumbnailUrl?: string;
	/** 显示文本 */
	label?: string;
}

/** 拖拽目标信息 */
export interface DropTargetInfo {
	/** 目标区域类型 */
	zone: "timeline" | "preview" | "none";
	/** 时间线目标类型（轨道或间隙） */
	type?: "track" | "gap";
	/** 轨道索引（时间线目标） */
	trackIndex?: number;
	/** 时间位置（时间线目标） */
	time?: number;
	/** 画布 X 坐标（预览画布目标） */
	canvasX?: number;
	/** 画布 Y 坐标（预览画布目标） */
	canvasY?: number;
	/** 是否可放置 */
	canDrop: boolean;
}

/** 自动滚动配置 */
export interface AutoScrollConfig {
	edgeThreshold: number;
	maxSpeed: number;
}

export const DEFAULT_AUTO_SCROLL_CONFIG: AutoScrollConfig = {
	edgeThreshold: 80,
	maxSpeed: 12,
};

// ============================================================================
// Store 定义
// ============================================================================

interface DragStore {
	// 拖拽状态
	isDragging: boolean;
	dragSource: DragSourceType | null;
	dragData: DragData | null;
	ghostInfo: DragGhostInfo | null;
	dropTarget: DropTargetInfo | null;

	// 自动滚动状态
	autoScrollSpeedX: number;
	autoScrollSpeedY: number;

	// 时间线滚动位置（共享状态）
	timelineScrollLeft: number;

	// Actions
	startDrag: (
		source: DragSourceType,
		data: DragData,
		ghost: DragGhostInfo,
	) => void;
	updateGhost: (ghost: Partial<DragGhostInfo>) => void;
	updateDropTarget: (target: DropTargetInfo | null) => void;
	endDrag: () => void;

	// 自动滚动
	setAutoScrollSpeedX: (speed: number) => void;
	setAutoScrollSpeedY: (speed: number) => void;
	stopAutoScroll: () => void;

	// 时间线滚动
	setTimelineScrollLeft: (scrollLeft: number) => void;
}

export const useDragStore = create<DragStore>()(
	subscribeWithSelector((set, get) => ({
		// 初始状态
		isDragging: false,
		dragSource: null,
		dragData: null,
		ghostInfo: null,
		dropTarget: null,
		autoScrollSpeedX: 0,
		autoScrollSpeedY: 0,
		timelineScrollLeft: 0,

		// 开始拖拽
		startDrag: (source, data, ghost) => {
			set({
				isDragging: true,
				dragSource: source,
				dragData: data,
				ghostInfo: ghost,
				dropTarget: null,
			});
		},

		// 更新 Ghost
		updateGhost: (ghost) => {
			const current = get().ghostInfo;
			if (current) {
				set({
					ghostInfo: { ...current, ...ghost },
				});
			}
		},

		// 更新拖拽目标
		updateDropTarget: (target) => {
			set({ dropTarget: target });
		},

		// 结束拖拽
		endDrag: () => {
			set({
				isDragging: false,
				dragSource: null,
				dragData: null,
				ghostInfo: null,
				dropTarget: null,
				autoScrollSpeedX: 0,
				autoScrollSpeedY: 0,
			});
		},

		// 自动滚动
		setAutoScrollSpeedX: (speed) => {
			set({ autoScrollSpeedX: speed });
		},

		setAutoScrollSpeedY: (speed) => {
			set({ autoScrollSpeedY: speed });
		},

		stopAutoScroll: () => {
			set({ autoScrollSpeedX: 0, autoScrollSpeedY: 0 });
		},

		// 时间线滚动
		setTimelineScrollLeft: (scrollLeft) => {
			set({ timelineScrollLeft: scrollLeft });
		},
	})),
);

// ============================================================================
// Hooks
// ============================================================================

/** 判断拖拽数据是否来自素材库 */
export function isMaterialDragData(data: DragData): data is MaterialDragData {
	return "uri" in data && "type" in data;
}

/** 判断拖拽数据是否来自时间线 */
export function isTimelineDragData(data: DragData): data is TimelineDragData {
	return "elementId" in data;
}

/** 自动滚动工具 */
export function calculateAutoScrollSpeed(
	position: number,
	containerStart: number,
	containerEnd: number,
	config: AutoScrollConfig = DEFAULT_AUTO_SCROLL_CONFIG,
): number {
	const { edgeThreshold, maxSpeed } = config;

	// 检查起始边缘
	const distanceFromStart = position - containerStart;
	if (distanceFromStart < edgeThreshold && distanceFromStart >= 0) {
		const intensity = 1 - distanceFromStart / edgeThreshold;
		return -intensity * maxSpeed;
	}

	// 检查结束边缘
	const distanceFromEnd = containerEnd - position;
	if (distanceFromEnd < edgeThreshold && distanceFromEnd >= 0) {
		const intensity = 1 - distanceFromEnd / edgeThreshold;
		return intensity * maxSpeed;
	}

	return 0;
}
