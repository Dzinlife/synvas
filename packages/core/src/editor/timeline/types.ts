/**
 * 时间线拖拽系统类型定义
 */

import { TimelineElement, TrackRole } from "../../element/types";

// ============================================================================
// 轨道系统类型
// ============================================================================

/**
 * 轨道配置
 */
export interface TrackConfig {
	role: TrackRole;
	height: number;
	/** 可以与哪些角色的元素共存于同一轨道 */
	compatibleWith: TrackRole[];
	/** 是否可以创建新轨道 */
	canCreateNew: boolean;
	/** 最小轨道数（0 表示可以没有） */
	minTracks: number;
	/** 最大轨道数（-1 表示无限） */
	maxTracks: number;
}

/**
 * 轨道实例（运行时）
 */
export interface TrackInstance {
	id: string;
	index: number;
	role: TrackRole;
	config: TrackConfig;
	/** 计算出的 Y 坐标（从顶部开始） */
	y: number;
}

/**
 * 轨道状态（时间线编辑器）
 */
export interface TimelineTrack {
	id: string;
	role: TrackRole;
	hidden: boolean;
	locked: boolean;
	muted: boolean;
	solo: boolean;
}

// ============================================================================
// 拖拽系统类型
// ============================================================================

/**
 * 拖拽目标类型
 */
export type DropTargetType = "track" | "gap";

/**
 * 拖拽目标
 */
export interface DropTarget {
	type: DropTargetType;
	trackIndex: number;
	/** 对于 gap 类型，表示新轨道将插入到此位置 */
}

/**
 * 扩展的拖拽目标（包含更多计算信息）
 */
export interface ExtendedDropTarget extends DropTarget {
	elementId: string;
	start: number;
	end: number;
	/** 考虑重叠后的最终轨道位置 */
	finalTrackIndex: number;
	/** 主轨预览模式：空白区域为 box，相邻 clip 边界为 insert-line */
	mainTrackPreviewMode?: "box" | "insert-line";
	/** 主轨插入判定使用的鼠标时间（帧） */
	mainTrackInsertTime?: number;
}

/**
 * 拖拽状态
 */
export interface DragState {
	/** 是否正在拖拽 */
	isDragging: boolean;
	/** 拖拽的元素 ID 列表（支持多选） */
	draggedElementIds: string[];
	/** 拖拽开始时的初始状态 */
	initialState: DragInitialState | null;
	/** 当前拖拽目标 */
	dropTarget: ExtendedDropTarget | null;
}

/**
 * 拖拽开始时的初始状态
 */
export interface DragInitialState {
	/** 各元素的初始时间和轨道 */
	elements: Map<
		string,
		{
			start: number;
			end: number;
			trackIndex: number;
		}
	>;
	/** 鼠标/触摸点的初始位置 */
	pointerX: number;
	pointerY: number;
}

/**
 * 拖拽移动参数
 */
export interface DragMoveParams {
	/** 水平移动像素 */
	deltaX: number;
	/** 垂直移动像素 */
	deltaY: number;
	/** 时间比例（像素/帧） */
	ratio: number;
	/** 轨道高度 */
	trackHeight: number;
	/** 轨道总数 */
	trackCount: number;
}

/**
 * 拖拽结果
 */
export interface DragResult {
	/** 元素的新时间范围 */
	timeRange: {
		start: number;
		end: number;
	};
	/** 目标轨道 */
	dropTarget: DropTarget;
	/** 是否有显著的垂直移动 */
	hasSignificantVerticalMove: boolean;
}

// ============================================================================
// 关联系统类型
// ============================================================================

/**
 * 元素关联关系
 * 父元素移动时，子元素跟随移动
 */
export interface AttachmentRelation {
	parentId: string;
	childIds: string[];
}

/**
 * 关联移动参数
 */
export interface AttachmentMoveParams {
	/** 主元素 ID */
	elementId: string;
	/** 新的开始时间 */
	start: number;
	/** 新的结束时间 */
	end: number;
	/** 拖拽目标 */
	dropTarget: DropTarget;
	/** 需要一起移动的子元素 */
	attachedChildren: Array<{
		id: string;
		start: number;
		end: number;
	}>;
}

// ============================================================================
// 多选系统类型
// ============================================================================

/**
 * 选择状态
 */
export interface SelectionState {
	/** 选中的元素 ID 列表 */
	selectedIds: string[];
	/** 主选中元素（用于显示属性面板等） */
	primaryId: string | null;
	/** 是否处于框选模式 */
	isMarqueeSelecting: boolean;
	/** 框选区域 */
	marqueeRect: {
		startX: number;
		startY: number;
		endX: number;
		endY: number;
	} | null;
}

/**
 * 选择操作
 */
export type SelectionAction =
	| { type: "select"; id: string; additive?: boolean }
	| { type: "deselect"; id: string }
	| { type: "selectAll" }
	| { type: "deselectAll" }
	| { type: "toggleSelect"; id: string }
	| { type: "selectRange"; ids: string[] }
	| { type: "startMarquee"; x: number; y: number }
	| { type: "updateMarquee"; x: number; y: number }
	| { type: "endMarquee"; elements: TimelineElement[] };

// ============================================================================
// 工具类型
// ============================================================================

/**
 * 时间范围
 */
export interface TimeRange {
	start: number;
	end: number;
}

/**
 * 检查两个时间范围是否重叠
 */
export function isTimeOverlapping(a: TimeRange, b: TimeRange): boolean {
	return a.start < b.end && a.end > b.start;
}

/**
 * 元素位置信息（用于渲染）
 */
export interface ElementPosition {
	left: number;
	width: number;
	top: number;
	height: number;
	trackIndex: number;
}
