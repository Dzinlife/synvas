import type { TimelineContextMenuAction } from "@/scene-editor/components/TimelineContextMenu";
import type { DropTargetInfo } from "@/scene-editor/drag";
import { getAudioTrackControlState } from "@/scene-editor/utils/audioTrackState";
import type { CanvasNode } from "@/studio/project/types";
import type { CanvasNodeLayoutSnapshot } from "@/studio/history/studioHistoryStore";
import type {
	CanvasNodeDrawerProps,
	CanvasNodeDrawerTrigger,
} from "@/node-system/types";
import type React from "react";
import type { DrawerViewData } from "./CanvasWorkspaceOverlay";
import { expandCanvasNodeIdsWithDescendants } from "./canvasBoardUtils";
import {
	CANVAS_BOARD_AUTO_LAYOUT_GAP,
	type CanvasBoardAutoLayoutInsertion,
	deriveCanvasBoardAutoLayoutRows,
} from "./canvasBoardAutoLayout";
import type {
	CanvasSnapGuideValues,
	CanvasSnapGuidesWorld,
	CanvasSnapRect,
} from "./canvasSnapUtils";
import type { CanvasNodeResizeAnchor } from "./InfiniteSkiaCanvas";
import type { TileLodTransition } from "./tile";
import type { CanvasGraphHistoryEntry as ClipboardCanvasGraphHistoryEntry } from "@/studio/clipboard/canvasClipboard";
import {
	CAMERA_ZOOM_EPSILON,
	type CameraState,
	isLayoutEqual,
	isWorldPointInNode,
	pickLayout,
	type ResolvedCanvasDrawerOptions,
} from "./canvasWorkspaceUtils";

export type CanvasContextMenuState =
	| { open: false }
	| {
			open: true;
			scope: "canvas";
			x: number;
			y: number;
			worldX: number;
			worldY: number;
	  }
	| {
			open: true;
			scope: "node";
			x: number;
			y: number;
			actions: TimelineContextMenuAction[];
	  };

export interface NodeDragSession {
	origin: "node" | "selection";
	anchorNodeId: string | null;
	pendingSelectedNodeIds: string[];
	dragNodeIds: string[];
	initialBounds: CanvasSnapRect;
	snapshots: Record<
		string,
		{
			nodeId: string;
			startNodeX: number;
			startNodeY: number;
			before: CanvasNodeLayoutSnapshot;
		}
	>;
	layoutBeforeByNodeId: Record<string, CanvasNodeLayoutSnapshot>;
	copyEntries: CanvasGraphHistoryEntry[];
	activated: boolean;
	moved: boolean;
	axisLock: "x" | "y" | null;
	copyMode: boolean;
	timelineDropMode: boolean;
	timelineDropTarget: DropTargetInfo | null;
	autoLayoutInsertion: CanvasBoardAutoLayoutInsertion | null;
	autoLayoutRowsByBoardId: Map<string, string[][]>;
	globalDragStarted: boolean;
	guideValuesCache: {
		key: string;
		values: CanvasSnapGuideValues;
	} | null;
}

export interface CanvasMarqueeRect {
	visible: boolean;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface CanvasMarqueeSession {
	additive: boolean;
	initialSelectedNodeIds: string[];
	startLocalX: number;
	startLocalY: number;
	activated: boolean;
}

export interface BoardCreateSession {
	startWorldX: number;
	startWorldY: number;
	startLocalX: number;
	startLocalY: number;
	activated: boolean;
	currentWorldX: number;
	currentWorldY: number;
	currentLocalX: number;
	currentLocalY: number;
}

export interface ResolvedCanvasNodeResizeConstraints {
	lockAspectRatio: boolean;
	aspectRatio: number | null;
	minWidth: number | null;
	minHeight: number | null;
	maxWidth: number | null;
	maxHeight: number | null;
}

export interface NodeResizeSession {
	nodeId: string;
	anchor: CanvasNodeResizeAnchor;
	startNodeX: number;
	startNodeY: number;
	startNodeWidth: number;
	startNodeHeight: number;
	fixedCornerX: number;
	fixedCornerY: number;
	before: CanvasNodeLayoutSnapshot;
	moved: boolean;
	constraints: ResolvedCanvasNodeResizeConstraints;
	guideValues: CanvasSnapGuideValues | null;
	autoLayoutRowsByBoardId: Map<string, string[][]>;
}

export interface SelectionResizeSnapshot {
	nodeId: string;
	startNodeX: number;
	startNodeY: number;
	startNodeWidth: number;
	startNodeHeight: number;
	before: CanvasNodeLayoutSnapshot;
	constraints: ResolvedCanvasNodeResizeConstraints;
}

export interface SelectionResizeSession {
	anchor: CanvasNodeResizeAnchor;
	startBoundsLeft: number;
	startBoundsTop: number;
	startBoundsWidth: number;
	startBoundsHeight: number;
	fixedCornerX: number;
	fixedCornerY: number;
	snapshots: Record<string, SelectionResizeSnapshot>;
	moved: boolean;
	guideValues: CanvasSnapGuideValues | null;
	autoLayoutRowsByBoardId: Map<string, string[][]>;
}

export interface PendingCanvasClickSuppression {
	suppressNode: boolean;
	suppressCanvas: boolean;
}

export interface CanvasBasePointerSession {
	pointerId: number;
	pointerType: string;
	gesture: "tap" | "node-drag" | "selection-drag" | "marquee" | "board-create";
	startClientX: number;
	startClientY: number;
	startNodeId: string | null;
	startTarget: EventTarget | null;
}

export interface CanvasTapRecord {
	nodeId: string;
	pointerType: string;
	clientX: number;
	clientY: number;
	timestampMs: number;
}

export interface CanvasPointerTapMeta {
	target: EventTarget | null;
	clientX: number;
	clientY: number;
	button: number;
	buttons: number;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	pointerType: string;
	timestampMs: number;
}

export type CanvasGraphHistoryEntry = ClipboardCanvasGraphHistoryEntry;
export type PendingCameraCullUpdateKind = "pan" | "immediate" | "smooth";
export type SmoothCameraApplyOptions = {
	tileLodTransition?: TileLodTransition | null;
	cameraStoreSync?: "frame" | "settle";
};

export interface CanvasViewportWorldRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface CanvasRenderCullState {
	mode: "live" | "locked";
	camera: CameraState;
	lockedViewportRect: CanvasViewportWorldRect | null;
	version: number;
}

export const CANVAS_MARQUEE_ACTIVATION_PX = 3;
export const CANVAS_ORTHOGONAL_DRAG_LOCK_THRESHOLD_PX = 6;
export const CANVAS_RENDER_CULL_OVERSCAN_SCREEN_PX = 160;
export const PAN_CULL_IDLE_FLUSH_MS = 160;
export const DOUBLE_TAP_MAX_DELAY_MS = 300;
export const DOUBLE_TAP_MAX_DISTANCE_PX = 24;
export const TAP_MOVE_THRESHOLD_PX = 3;
export const FOCUS_EXIT_MIN_ZOOM_RATIO = 0.5;
export const FOCUS_TILE_LOD_TRANSITION: TileLodTransition = { mode: "freeze" };
export const BOARD_CREATE_MIN_SIZE_PX = 6;
export const BOARD_AUTO_FIT_PADDING_WORLD = CANVAS_BOARD_AUTO_LAYOUT_GAP;
export const BOARD_AUTO_LAYOUT_ANIMATION_RESET_MS = 280;
export const SKIA_RESOURCE_TRACKER_LOG_TAG = "[skia-resource-tracker]";
export const EMPTY_STRING_ARRAY: string[] = [];
export const ENABLE_CANVAS_SPATIAL_INDEX_VALIDATION =
	import.meta.env.DEV &&
	(import.meta.env as Record<string, unknown>)
		.VITE_CANVAS_SPATIAL_INDEX_VALIDATE === "1";

export const isTileLodTransitionEqual = (
	left: TileLodTransition | null,
	right: TileLodTransition | null,
): boolean => {
	if (left === right) return true;
	if (!left || !right) return false;
	return left.mode === right.mode && left.zoom === right.zoom;
};

export const resolveCanvasAutoLayoutFrozenNodeIds = (
	nodes: CanvasNode[],
	boardIds: string[],
	options?: {
		excludeNodeIds?: Set<string>;
	},
): string[] => {
	if (boardIds.length === 0) return [];
	const boardIdSet = new Set(boardIds);
	const excludeNodeIds = options?.excludeNodeIds ?? new Set<string>();
	const visibleNodeIdSet = new Set(
		nodes.filter((node) => !node.hidden).map((node) => node.id),
	);
	const directChildNodeIds = nodes
		.filter((node) => {
			if (node.hidden) return false;
			const parentId = node.parentId ?? null;
			return parentId !== null && boardIdSet.has(parentId);
		})
		.map((node) => node.id);
	return expandCanvasNodeIdsWithDescendants(nodes, directChildNodeIds).filter(
		(nodeId) =>
			visibleNodeIdSet.has(nodeId) &&
			!boardIdSet.has(nodeId) &&
			!excludeNodeIds.has(nodeId),
	);
};

export const resolveCanvasAutoLayoutFrozenNodeIdsForResize = (
	nodes: CanvasNode[],
	boardIds: string[],
	resizedNodeIds: string[],
): string[] => {
	const resizedNodeIdSet = new Set(resizedNodeIds);
	return resolveCanvasAutoLayoutFrozenNodeIds(nodes, boardIds).filter(
		(nodeId) => !resizedNodeIdSet.has(nodeId),
	);
};

export const resolveCanvasSelectionResizeFrozenNodeIds = (
	nodes: CanvasNode[],
	resizedNodeIds: string[],
): string[] => {
	if (resizedNodeIds.length === 0) return [];
	const visibleNodeIdSet = new Set(
		nodes.filter((node) => !node.hidden).map((node) => node.id),
	);
	return expandCanvasNodeIdsWithDescendants(nodes, resizedNodeIds).filter(
		(nodeId) => visibleNodeIdSet.has(nodeId),
	);
};

export const resolveCanvasLayoutHistoryEntries = (
	beforeByNodeId: Map<string, CanvasNodeLayoutSnapshot>,
	afterNodes: CanvasNode[],
): Array<{
	nodeId: string;
	before: CanvasNodeLayoutSnapshot;
	after: CanvasNodeLayoutSnapshot;
}> => {
	const afterNodeById = new Map(afterNodes.map((node) => [node.id, node]));
	return [...beforeByNodeId.entries()]
		.map(([nodeId, before]) => {
			const afterNode = afterNodeById.get(nodeId) ?? null;
			if (!afterNode) return null;
			const after = pickLayout(afterNode);
			if (isLayoutEqual(before, after)) return null;
			return {
				nodeId,
				before,
				after,
			};
		})
		.filter(
			(
				entry,
			): entry is {
				nodeId: string;
				before: CanvasNodeLayoutSnapshot;
				after: CanvasNodeLayoutSnapshot;
			} => Boolean(entry),
		);
};

export const resolveCanvasAutoLayoutRowsByBoardId = (
	nodes: CanvasNode[],
	boardIds: string[],
): Map<string, string[][]> => {
	const rowsByBoardId = new Map<string, string[][]>();
	for (const boardId of [...new Set(boardIds)]) {
		rowsByBoardId.set(boardId, deriveCanvasBoardAutoLayoutRows(nodes, boardId));
	}
	return rowsByBoardId;
};

export const removeCanvasAutoLayoutRowNodeIds = (
	rows: string[][],
	nodeIds: Set<string>,
): string[][] => {
	return rows
		.map((row) => row.filter((nodeId) => !nodeIds.has(nodeId)))
		.filter((row) => row.length > 0);
};

export const appendCanvasAutoLayoutRowsByBoardId = (
	rowsByBoardId: Map<string, string[][]>,
	nodes: CanvasNode[],
	boardIds: string[],
): void => {
	for (const boardId of [...new Set(boardIds)]) {
		if (rowsByBoardId.has(boardId)) continue;
		rowsByBoardId.set(boardId, deriveCanvasBoardAutoLayoutRows(nodes, boardId));
	}
};

export const resolveCameraCenterWorld = (
	camera: CameraState,
	stageWidth: number,
	stageHeight: number,
): { x: number; y: number } => {
	const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
	return {
		x: stageWidth / safeZoom / 2 - camera.x,
		y: stageHeight / safeZoom / 2 - camera.y,
	};
};

export const buildCameraByWorldCenter = (
	worldCenter: { x: number; y: number },
	zoom: number,
	stageWidth: number,
	stageHeight: number,
): CameraState => {
	const safeZoom = Math.max(zoom, CAMERA_ZOOM_EPSILON);
	return {
		x: stageWidth / safeZoom / 2 - worldCenter.x,
		y: stageHeight / safeZoom / 2 - worldCenter.y,
		zoom,
	};
};

export const createCanvasEntityId = (prefix: string): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

export const buildCopyName = (name: string): string => {
	const trimmed = name.trim();
	return trimmed ? `${trimmed}副本` : "副本";
};

export const isPointInsideRect = (
	clientX: number,
	clientY: number,
	rect: DOMRect,
): boolean => {
	return (
		clientX >= rect.left &&
		clientX <= rect.right &&
		clientY >= rect.top &&
		clientY <= rect.bottom
	);
};

export const cloneTimelineJson = <T>(value: T): T => {
	return JSON.parse(JSON.stringify(value)) as T;
};

export const createTimelineClipboardElementId = (): string => {
	return createCanvasEntityId("element");
};

export const resolveTimelineTrackLockedMap = (
	tracks: Array<{ locked?: boolean }>,
	audioTrackStates: Parameters<typeof getAudioTrackControlState>[0],
): Map<number, boolean> => {
	const map = new Map<number, boolean>(
		tracks.map((track, index) => [index, track.locked ?? false]),
	);
	for (const trackIndexRaw of Object.keys(audioTrackStates)) {
		const trackIndex = Number(trackIndexRaw);
		if (!Number.isFinite(trackIndex)) continue;
		const audioState = getAudioTrackControlState(audioTrackStates, trackIndex);
		map.set(trackIndex, audioState.locked);
	}
	return map;
};

export const isEditableKeyboardTarget = (
	target: EventTarget | null,
): boolean => {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target as HTMLElement | null)?.isContentEditable === true
	);
};

export const getPrimarySelectedNodeId = (
	selectedNodeIds: string[],
): string | null => {
	return selectedNodeIds.at(-1) ?? null;
};

export const normalizeSelectedNodeIds = (
	selectedNodeIds: string[],
	nodeIdSet: Set<string>,
): string[] => {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const nodeId of selectedNodeIds) {
		if (!nodeIdSet.has(nodeId) || seen.has(nodeId)) continue;
		seen.add(nodeId);
		result.push(nodeId);
	}
	return result;
};

export const toggleSelectedNodeIds = (
	selectedNodeIds: string[],
	nodeId: string,
): string[] => {
	if (selectedNodeIds.includes(nodeId)) {
		return selectedNodeIds.filter((selectedId) => selectedId !== nodeId);
	}
	return [...selectedNodeIds, nodeId];
};

export const isNodeIntersectRect = (
	node: CanvasNode,
	rect: { left: number; right: number; top: number; bottom: number },
): boolean => {
	const nodeLeft = Math.min(node.x, node.x + node.width);
	const nodeRight = Math.max(node.x, node.x + node.width);
	const nodeTop = Math.min(node.y, node.y + node.height);
	const nodeBottom = Math.max(node.y, node.y + node.height);
	return (
		rect.left < nodeRight &&
		rect.right > nodeLeft &&
		rect.top < nodeBottom &&
		rect.bottom > nodeTop
	);
};

export type CanvasBoardBodyHitMode = "include" | "exclude" | "selected-only";

export const canBoardBodyReceivePointHit = (
	boardNodeId: string,
	boardBodyHitMode: CanvasBoardBodyHitMode,
	selectedNodeIds: string[],
): boolean => {
	if (boardBodyHitMode === "include") return true;
	if (boardBodyHitMode === "exclude") return false;
	return selectedNodeIds.includes(boardNodeId);
};

export const resolveTopHitNodeByLinearScan = (
	nodes: CanvasNode[],
	worldX: number,
	worldY: number,
	isCanvasInteractionLocked: boolean,
	focusedNodeId: string | null,
	boardBodyHitMode: CanvasBoardBodyHitMode,
	selectedNodeIds: string[],
): CanvasNode | null => {
	for (let index = nodes.length - 1; index >= 0; index -= 1) {
		const node = nodes[index];
		if (!node) continue;
		const canInteractNode =
			!isCanvasInteractionLocked || node.id === focusedNodeId;
		if (!canInteractNode) continue;
		if (
			node.type === "board" &&
			!canBoardBodyReceivePointHit(node.id, boardBodyHitMode, selectedNodeIds)
		) {
			continue;
		}
		if (!isWorldPointInNode(node, worldX, worldY)) continue;
		return node;
	}
	return null;
};

export const areNodeIdsEqual = (left: string[], right: string[]): boolean => {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
};

export const warnCanvasSpatialIndexMismatch = (
	scope: "render-cull" | "point-hit" | "marquee",
	legacyNodeIds: string[],
	indexedNodeIds: string[],
) => {
	if (areNodeIdsEqual(legacyNodeIds, indexedNodeIds)) return;
	// 仅在调试开关打开时提示差异，便于索引替换阶段校验一致性。
	console.warn(`[CanvasSpatialIndex] ${scope} mismatch`, {
		legacyNodeIds,
		indexedNodeIds,
	});
};

export const resolveCameraViewportWorldRect = (
	camera: CameraState,
	stageWidth: number,
	stageHeight: number,
	overscanScreenPx: number,
): CanvasViewportWorldRect | null => {
	if (stageWidth <= 0 || stageHeight <= 0) return null;
	const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
	const overscanWorld = Math.max(0, overscanScreenPx) / safeZoom;
	return {
		left: -camera.x - overscanWorld,
		right: stageWidth / safeZoom - camera.x + overscanWorld,
		top: -camera.y - overscanWorld,
		bottom: stageHeight / safeZoom - camera.y + overscanWorld,
	};
};

export const isCameraStateEqual = (
	left: CameraState,
	right: CameraState,
): boolean => {
	return left.x === right.x && left.y === right.y && left.zoom === right.zoom;
};

export const isViewportWorldRectEqual = (
	left: CanvasViewportWorldRect | null,
	right: CanvasViewportWorldRect | null,
): boolean => {
	if (!left && !right) return true;
	if (!left || !right) return false;
	return (
		left.left === right.left &&
		left.right === right.right &&
		left.top === right.top &&
		left.bottom === right.bottom
	);
};

export const resolveViewportUnionRect = (
	left: CanvasViewportWorldRect | null,
	right: CanvasViewportWorldRect | null,
): CanvasViewportWorldRect | null => {
	if (!left && !right) return null;
	if (!left) return right;
	if (!right) return left;
	return {
		left: Math.min(left.left, right.left),
		right: Math.max(left.right, right.right),
		top: Math.min(left.top, right.top),
		bottom: Math.max(left.bottom, right.bottom),
	};
};

export const resolvePositiveNumber = (value: unknown): number | null => {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	if (value <= 0) return null;
	return value;
};

export const clampSize = (
	value: number,
	minValue: number,
	maxValue?: number,
): number => {
	if (!Number.isFinite(value)) return minValue;
	if (!Number.isFinite(minValue)) return value;
	if (maxValue !== undefined && Number.isFinite(maxValue)) {
		if (maxValue < minValue) return minValue;
		return Math.min(Math.max(value, minValue), maxValue);
	}
	return Math.max(value, minValue);
};

export const isRightResizeAnchor = (
	anchor: CanvasNodeResizeAnchor,
): boolean => {
	return anchor === "top-right" || anchor === "bottom-right";
};

export const isBottomResizeAnchor = (
	anchor: CanvasNodeResizeAnchor,
): boolean => {
	return anchor === "bottom-left" || anchor === "bottom-right";
};

export const resolveCanvasResizeCursor = (
	anchor: CanvasNodeResizeAnchor,
): "nwse-resize" | "nesw-resize" => {
	return anchor === "top-left" || anchor === "bottom-right"
		? "nwse-resize"
		: "nesw-resize";
};

export const applyResizeSnapDeltaToBox = (
	box: CanvasSnapRect,
	anchor: CanvasNodeResizeAnchor,
	deltaX: number,
	deltaY: number,
): CanvasSnapRect => {
	let nextX = box.x;
	let nextY = box.y;
	let nextWidth = box.width;
	let nextHeight = box.height;
	if (deltaX !== 0) {
		if (isRightResizeAnchor(anchor)) {
			nextWidth += deltaX;
		} else {
			nextX += deltaX;
			nextWidth -= deltaX;
		}
	}
	if (deltaY !== 0) {
		if (isBottomResizeAnchor(anchor)) {
			nextHeight += deltaY;
		} else {
			nextY += deltaY;
			nextHeight -= deltaY;
		}
	}
	return {
		x: nextX,
		y: nextY,
		width: Math.max(CAMERA_ZOOM_EPSILON, nextWidth),
		height: Math.max(CAMERA_ZOOM_EPSILON, nextHeight),
	};
};

export const selectCornerResizeSnap = ({
	deltaX,
	deltaY,
	guidesWorld,
	preferSingleAxis,
}: {
	deltaX: number;
	deltaY: number;
	guidesWorld: CanvasSnapGuidesWorld;
	preferSingleAxis: boolean;
}) => {
	if (preferSingleAxis && deltaX !== 0 && deltaY !== 0) {
		if (Math.abs(deltaX) <= Math.abs(deltaY)) {
			return {
				deltaX,
				deltaY: 0,
				guidesWorld: {
					vertical: guidesWorld.vertical,
					horizontal: [],
				},
			};
		}
		return {
			deltaX: 0,
			deltaY,
			guidesWorld: {
				vertical: [],
				horizontal: guidesWorld.horizontal,
			},
		};
	}
	return {
		deltaX,
		deltaY,
		guidesWorld,
	};
};

export const resolveConstrainedResizeLayout = ({
	anchor,
	fixedCornerX,
	fixedCornerY,
	startWidth,
	startHeight,
	draftWidth,
	draftHeight,
	constraints,
	globalMinSize,
	preferredAxis = null,
}: {
	anchor: CanvasNodeResizeAnchor;
	fixedCornerX: number;
	fixedCornerY: number;
	startWidth: number;
	startHeight: number;
	draftWidth: number;
	draftHeight: number;
	constraints: ResolvedCanvasNodeResizeConstraints;
	globalMinSize: number;
	preferredAxis?: "x" | "y" | null;
}): { x: number; y: number; width: number; height: number } => {
	const isRightAnchor = isRightResizeAnchor(anchor);
	const isBottomAnchor = isBottomResizeAnchor(anchor);
	const minWidth = Math.max(globalMinSize, constraints.minWidth ?? 0);
	const minHeight = Math.max(globalMinSize, constraints.minHeight ?? 0);
	const maxWidth = constraints.maxWidth ?? undefined;
	const maxHeight = constraints.maxHeight ?? undefined;

	let nextWidth: number;
	let nextHeight: number;
	if (constraints.lockAspectRatio && constraints.aspectRatio) {
		const aspectRatio = constraints.aspectRatio;
		const scaleX = draftWidth / Math.max(startWidth, CAMERA_ZOOM_EPSILON);
		const scaleY = draftHeight / Math.max(startHeight, CAMERA_ZOOM_EPSILON);
		let scale =
			preferredAxis === "x"
				? scaleX
				: preferredAxis === "y"
					? scaleY
					: (scaleX + scaleY) / 2;
		if (!Number.isFinite(scale) || scale <= 0) {
			scale = minWidth / Math.max(startWidth, CAMERA_ZOOM_EPSILON);
		}
		const minWidthByHeight = minHeight * aspectRatio;
		const minWidthWithAspect = Math.max(minWidth, minWidthByHeight);
		const maxWidthByHeight =
			maxHeight !== undefined ? maxHeight * aspectRatio : undefined;
		const maxWidthWithAspect =
			maxWidthByHeight !== undefined
				? maxWidth !== undefined
					? Math.min(maxWidth, maxWidthByHeight)
					: maxWidthByHeight
				: maxWidth;
		nextWidth = clampSize(
			startWidth * scale,
			minWidthWithAspect,
			maxWidthWithAspect,
		);
		nextHeight = nextWidth / aspectRatio;
	} else {
		nextWidth = clampSize(draftWidth, minWidth, maxWidth);
		nextHeight = clampSize(draftHeight, minHeight, maxHeight);
	}

	return {
		x: isRightAnchor ? fixedCornerX : fixedCornerX - nextWidth,
		y: isBottomAnchor ? fixedCornerY : fixedCornerY - nextHeight,
		width: nextWidth,
		height: nextHeight,
	};
};

export type AnyCanvasDrawer = React.FC<CanvasNodeDrawerProps<CanvasNode>>;

export interface ResolvedNodeDrawer extends DrawerViewData {
	trigger: CanvasNodeDrawerTrigger;
}

export interface ResolvedNodeDrawerTarget {
	Drawer: AnyCanvasDrawer;
	node: CanvasNode;
	trigger: CanvasNodeDrawerTrigger;
	options: ResolvedCanvasDrawerOptions;
}
