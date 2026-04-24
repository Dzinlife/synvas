import type { CanvasNode } from "@/studio/project/types";
import { buildLayerTreeOrder } from "./layerOrderCoordinator";

export interface CanvasWorldRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
}

export interface CanvasBoardFitPatch {
	nodeId: string;
	patch: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
}

const resolveNodeArea = (node: CanvasNode): number => {
	return Math.max(0, Math.abs(node.width) * Math.abs(node.height));
};

const compareInnermostBoard = (left: CanvasNode, right: CanvasNode): number => {
	const areaDelta = resolveNodeArea(left) - resolveNodeArea(right);
	if (areaDelta !== 0) return areaDelta;
	if (left.siblingOrder !== right.siblingOrder)
		return right.siblingOrder - left.siblingOrder;
	return right.id.localeCompare(left.id);
};

export const resolveCanvasWorldRectFromPoints = (
	startX: number,
	startY: number,
	endX: number,
	endY: number,
): CanvasWorldRect => {
	const left = Math.min(startX, endX);
	const right = Math.max(startX, endX);
	const top = Math.min(startY, endY);
	const bottom = Math.max(startY, endY);
	return {
		left,
		right,
		top,
		bottom,
		width: Math.max(0, right - left),
		height: Math.max(0, bottom - top),
	};
};

export const resolveCanvasNodeWorldRect = (
	node: CanvasNode,
): CanvasWorldRect => {
	return resolveCanvasWorldRectFromPoints(
		node.x,
		node.y,
		node.x + node.width,
		node.y + node.height,
	);
};

export const isCanvasWorldRectFullyContained = (
	inner: CanvasWorldRect,
	outer: CanvasWorldRect,
): boolean => {
	return (
		inner.left >= outer.left &&
		inner.right <= outer.right &&
		inner.top >= outer.top &&
		inner.bottom <= outer.bottom
	);
};

export const isCanvasWorldPointInsideRect = (
	worldX: number,
	worldY: number,
	rect: CanvasWorldRect,
): boolean => {
	return (
		worldX >= rect.left &&
		worldX <= rect.right &&
		worldY >= rect.top &&
		worldY <= rect.bottom
	);
};

export const buildCanvasChildNodeIdsByParentId = (
	nodes: CanvasNode[],
): Map<string, string[]> => {
	const nodeIdSet = new Set(nodes.map((node) => node.id));
	const childNodeIdsByParentId = new Map<string, string[]>();
	for (const node of nodes) {
		const parentId = node.parentId ?? null;
		if (!parentId || !nodeIdSet.has(parentId)) continue;
		const existing = childNodeIdsByParentId.get(parentId) ?? [];
		existing.push(node.id);
		childNodeIdsByParentId.set(parentId, existing);
	}
	return childNodeIdsByParentId;
};

export const collectCanvasDescendantNodeIds = (
	nodes: CanvasNode[],
	rootNodeIds: string[],
): Set<string> => {
	const childNodeIdsByParentId = buildCanvasChildNodeIdsByParentId(nodes);
	const descendants = new Set<string>();
	const stack = [...new Set(rootNodeIds)];
	while (stack.length > 0) {
		const currentNodeId = stack.pop();
		if (!currentNodeId) continue;
		const childNodeIds = childNodeIdsByParentId.get(currentNodeId) ?? [];
		for (const childNodeId of childNodeIds) {
			if (descendants.has(childNodeId)) continue;
			descendants.add(childNodeId);
			stack.push(childNodeId);
		}
	}
	return descendants;
};

export const expandCanvasNodeIdsWithDescendants = (
	nodes: CanvasNode[],
	nodeIds: string[],
): string[] => {
	const expanded = new Set(nodeIds);
	const descendants = collectCanvasDescendantNodeIds(nodes, nodeIds);
	for (const nodeId of descendants) {
		expanded.add(nodeId);
	}
	return [...expanded];
};

export const resolveInnermostContainingBoardId = (
	nodes: CanvasNode[],
	targetRect: CanvasWorldRect,
	options?: {
		excludeNodeIds?: Set<string>;
	},
): string | null => {
	const excludeNodeIds = options?.excludeNodeIds;
	const candidates = nodes
		.filter((node) => node.type === "board")
		.filter((node) => !excludeNodeIds?.has(node.id))
		.filter((node) => {
			return isCanvasWorldRectFullyContained(
				targetRect,
				resolveCanvasNodeWorldRect(node),
			);
		})
		.sort(compareInnermostBoard);
	return candidates[0]?.id ?? null;
};

export const resolvePointerContainingBoardId = (
	nodes: CanvasNode[],
	worldX: number,
	worldY: number,
	options?: {
		excludeNodeIds?: Set<string>;
	},
): string | null => {
	const excludeNodeIds = options?.excludeNodeIds;
	const layerTreeOrder = buildLayerTreeOrder(nodes);
	const candidates = nodes
		.filter((node) => node.type === "board")
		.filter((node) => !node.hidden)
		.filter((node) => !excludeNodeIds?.has(node.id))
		.filter((node) =>
			isCanvasWorldPointInsideRect(
				worldX,
				worldY,
				resolveCanvasNodeWorldRect(node),
			),
		)
		.sort((left, right) => {
			const leftHitOrder =
				layerTreeOrder.hitOrderByNodeId.get(left.id) ?? Number.MAX_SAFE_INTEGER;
			const rightHitOrder =
				layerTreeOrder.hitOrderByNodeId.get(right.id) ??
				Number.MAX_SAFE_INTEGER;
			if (leftHitOrder !== rightHitOrder) return leftHitOrder - rightHitOrder;
			const areaDelta = resolveNodeArea(left) - resolveNodeArea(right);
			if (areaDelta !== 0) return areaDelta;
			if (left.siblingOrder !== right.siblingOrder) {
				return right.siblingOrder - left.siblingOrder;
			}
			return right.id.localeCompare(left.id);
		});
	return candidates[0]?.id ?? null;
};

export const collectCanvasAncestorBoardIds = (
	nodes: CanvasNode[],
	nodeId: string | null,
): string[] => {
	if (!nodeId) return [];
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const ancestorBoardIds: string[] = [];
	const visitedNodeIds = new Set<string>();
	let currentNodeId: string | null = nodeId;
	while (currentNodeId) {
		if (visitedNodeIds.has(currentNodeId)) break;
		visitedNodeIds.add(currentNodeId);
		const node = nodeById.get(currentNodeId);
		if (!node) break;
		if (node.type === "board") {
			ancestorBoardIds.push(node.id);
		}
		currentNodeId = node.parentId ?? null;
	}
	return ancestorBoardIds;
};

const mergeCanvasWorldRects = (
	left: CanvasWorldRect | null,
	right: CanvasWorldRect,
): CanvasWorldRect => {
	if (!left) return right;
	const nextLeft = Math.min(left.left, right.left);
	const nextRight = Math.max(left.right, right.right);
	const nextTop = Math.min(left.top, right.top);
	const nextBottom = Math.max(left.bottom, right.bottom);
	return {
		left: nextLeft,
		right: nextRight,
		top: nextTop,
		bottom: nextBottom,
		width: Math.max(0, nextRight - nextLeft),
		height: Math.max(0, nextBottom - nextTop),
	};
};

export const resolveCanvasBoardDescendantBounds = (
	nodes: CanvasNode[],
	boardId: string,
): CanvasWorldRect | null => {
	const descendants = collectCanvasDescendantNodeIds(nodes, [boardId]);
	let bounds: CanvasWorldRect | null = null;
	for (const node of nodes) {
		if (!descendants.has(node.id)) continue;
		if (node.hidden) continue;
		bounds = mergeCanvasWorldRects(bounds, resolveCanvasNodeWorldRect(node));
	}
	return bounds;
};

export const resolveCanvasBoardExpandToFitPatches = (
	nodes: CanvasNode[],
	boardIds: string[],
	padding: number,
): CanvasBoardFitPatch[] => {
	if (boardIds.length === 0) return [];
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	let workingNodes = [...nodes];
	const patchByBoardId = new Map<string, CanvasBoardFitPatch["patch"]>();
	const uniqueBoardIds = [...new Set(boardIds.filter(Boolean))];
	for (const boardId of uniqueBoardIds) {
		const board = workingNodes.find(
			(node) => node.id === boardId && node.type === "board",
		);
		if (!board) continue;
		const descendantBounds = resolveCanvasBoardDescendantBounds(
			workingNodes,
			boardId,
		);
		if (!descendantBounds) continue;
		const boardRect = resolveCanvasNodeWorldRect(board);
		const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
		const targetLeft = descendantBounds.left - safePadding;
		const targetRight = descendantBounds.right + safePadding;
		const targetTop = descendantBounds.top - safePadding;
		const targetBottom = descendantBounds.bottom + safePadding;
		const nextLeft = Math.min(boardRect.left, targetLeft);
		const nextRight = Math.max(boardRect.right, targetRight);
		const nextTop = Math.min(boardRect.top, targetTop);
		const nextBottom = Math.max(boardRect.bottom, targetBottom);
		if (
			nextLeft === boardRect.left &&
			nextRight === boardRect.right &&
			nextTop === boardRect.top &&
			nextBottom === boardRect.bottom
		) {
			continue;
		}
		const patch = {
			x: nextLeft,
			y: nextTop,
			width: nextRight - nextLeft,
			height: nextBottom - nextTop,
		};
		patchByBoardId.set(boardId, patch);
		workingNodes = workingNodes.map((node) => {
			if (node.id !== boardId) return node;
			return {
				...node,
				...patch,
			};
		});
	}
	return uniqueBoardIds
		.map((boardId) => {
			const patch = patchByBoardId.get(boardId);
			if (!patch || !nodeById.has(boardId)) return null;
			return {
				nodeId: boardId,
				patch,
			};
		})
		.filter((patch): patch is CanvasBoardFitPatch => Boolean(patch));
};
