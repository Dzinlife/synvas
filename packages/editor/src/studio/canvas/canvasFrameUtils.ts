import type { CanvasNode } from "core/studio/types";

export interface CanvasWorldRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
}

const resolveNodeArea = (node: CanvasNode): number => {
	return Math.max(0, Math.abs(node.width) * Math.abs(node.height));
};

const compareInnermostFrame = (left: CanvasNode, right: CanvasNode): number => {
	const areaDelta = resolveNodeArea(left) - resolveNodeArea(right);
	if (areaDelta !== 0) return areaDelta;
	if (left.siblingOrder !== right.siblingOrder) return right.siblingOrder - left.siblingOrder;
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

export const resolveCanvasNodeWorldRect = (node: CanvasNode): CanvasWorldRect => {
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

export const resolveInnermostContainingFrameId = (
	nodes: CanvasNode[],
	targetRect: CanvasWorldRect,
	options?: {
		excludeNodeIds?: Set<string>;
	},
): string | null => {
	const excludeNodeIds = options?.excludeNodeIds;
	const candidates = nodes
		.filter((node) => node.type === "frame")
		.filter((node) => !excludeNodeIds?.has(node.id))
		.filter((node) => {
			return isCanvasWorldRectFullyContained(
				targetRect,
				resolveCanvasNodeWorldRect(node),
			);
		})
		.sort(compareInnermostFrame);
	return candidates[0]?.id ?? null;
};
