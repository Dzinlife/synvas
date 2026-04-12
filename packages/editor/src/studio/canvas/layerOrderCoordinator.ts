import type { CanvasNode } from "core/studio/types";

export const LAYER_ORDER_REBALANCE_STEP = 1;

export interface LayerOrderNodeLike {
	id: string;
	siblingOrder: number;
	parentId?: string | null;
}

export interface LayerOrderSiblingPatch {
	nodeId: string;
	siblingOrder: number;
}

const normalizeParentId = (
	parentId: string | null | undefined,
): string | null => {
	return parentId ?? null;
};

const clampIndex = (index: number, maxValue: number): number => {
	if (!Number.isFinite(index)) return maxValue;
	return Math.max(0, Math.min(maxValue, Math.trunc(index)));
};

export const compareSiblingOrder = <
	T extends Pick<LayerOrderNodeLike, "id" | "siblingOrder">,
>(
	left: T,
	right: T,
): number => {
	if (left.siblingOrder !== right.siblingOrder) {
		return left.siblingOrder - right.siblingOrder;
	}
	return left.id.localeCompare(right.id);
};

export const compareSiblingOrderDesc = <
	T extends Pick<LayerOrderNodeLike, "id" | "siblingOrder">,
>(
	left: T,
	right: T,
): number => {
	if (left.siblingOrder !== right.siblingOrder) {
		return right.siblingOrder - left.siblingOrder;
	}
	return right.id.localeCompare(left.id);
};

export const sortBySiblingOrder = <
	T extends Pick<LayerOrderNodeLike, "id" | "siblingOrder">,
>(
	nodes: T[],
): T[] => {
	return [...nodes].sort(compareSiblingOrder);
};

export const resolveSiblingNodesBySiblingOrder = <T extends LayerOrderNodeLike>(
	nodes: T[],
	options: {
		parentId: string | null;
		excludeNodeIds?: Iterable<string>;
	},
): T[] => {
	const parentId = normalizeParentId(options.parentId);
	const excludeNodeIds = options.excludeNodeIds
		? new Set(options.excludeNodeIds)
		: null;
	return sortBySiblingOrder(
		nodes.filter((node) => {
			if (excludeNodeIds?.has(node.id)) return false;
			return normalizeParentId(node.parentId) === parentId;
		}),
	);
};

const buildDenseSiblingPatches = <T extends LayerOrderNodeLike>(
	siblings: T[],
): LayerOrderSiblingPatch[] => {
	if (siblings.length <= 0) return [];
	return siblings.reduce<LayerOrderSiblingPatch[]>((patches, sibling, index) => {
		if (sibling.siblingOrder === index) return patches;
		patches.push({
			nodeId: sibling.id,
			siblingOrder: index,
		});
		return patches;
	}, []);
};

export const rebalanceSiblingOrder = <T extends LayerOrderNodeLike>(
	nodes: T[],
	options: {
		parentId: string | null;
		excludeNodeIds?: Iterable<string>;
	},
): LayerOrderSiblingPatch[] => {
	const siblings = resolveSiblingNodesBySiblingOrder(nodes, options);
	return buildDenseSiblingPatches(siblings);
};

const buildInsertPatches = <T extends LayerOrderNodeLike>(
	siblings: T[],
	insertIndex: number,
	insertCount: number,
): LayerOrderSiblingPatch[] => {
	if (insertCount <= 0) return [];
	return siblings.reduce<LayerOrderSiblingPatch[]>((patches, sibling, index) => {
		const nextOrder = index >= insertIndex ? index + insertCount : index;
		if (sibling.siblingOrder === nextOrder) return patches;
		patches.push({
			nodeId: sibling.id,
			siblingOrder: nextOrder,
		});
		return patches;
	}, []);
};

const mergeSiblingPatches = (
	patches: LayerOrderSiblingPatch[],
): LayerOrderSiblingPatch[] => {
	if (patches.length <= 1) return patches;
	const patchByNodeId = new Map<string, number>();
	for (const patch of patches) {
		patchByNodeId.set(patch.nodeId, patch.siblingOrder);
	}
	return [...patchByNodeId.entries()].map(([nodeId, siblingOrder]) => ({
		nodeId,
		siblingOrder,
	}));
};

export const allocateInsertSiblingOrder = <T extends LayerOrderNodeLike>(
	nodes: T[],
	options: {
		parentId: string | null;
		index: number;
		movingNodeIds?: Iterable<string>;
	},
): {
	siblingOrder: number;
	rebalancePatches: LayerOrderSiblingPatch[];
} => {
	const siblings = resolveSiblingNodesBySiblingOrder(nodes, {
		parentId: options.parentId,
		excludeNodeIds: options.movingNodeIds,
	});
	const densePatches = buildDenseSiblingPatches(siblings);
	const denseSiblings =
		densePatches.length > 0
			? siblings.map((sibling, index) => ({
					...sibling,
					siblingOrder: index,
				}))
			: siblings;
	const insertIndex = clampIndex(options.index, denseSiblings.length);
	const insertPatches = buildInsertPatches(denseSiblings, insertIndex, 1);
	return {
		siblingOrder: insertIndex,
		rebalancePatches: mergeSiblingPatches([...densePatches, ...insertPatches]),
	};
};

export const allocateBatchInsertSiblingOrder = <T extends LayerOrderNodeLike>(
	nodes: T[],
	options: {
		parentId: string | null;
		index: number;
		nodeIds: string[];
		movingNodeIds?: Iterable<string>;
	},
): {
	assignments: Array<{ nodeId: string; siblingOrder: number }>;
	rebalancePatches: LayerOrderSiblingPatch[];
} => {
	const nodeIds = options.nodeIds.filter(Boolean);
	if (nodeIds.length === 0) {
		return {
			assignments: [],
			rebalancePatches: [],
		};
	}
	const siblings = resolveSiblingNodesBySiblingOrder(nodes, {
		parentId: options.parentId,
		excludeNodeIds: options.movingNodeIds,
	});
	const densePatches = buildDenseSiblingPatches(siblings);
	const denseSiblings =
		densePatches.length > 0
			? siblings.map((sibling, index) => ({
					...sibling,
					siblingOrder: index,
				}))
			: siblings;
	const insertIndex = clampIndex(options.index, denseSiblings.length);
	const insertPatches = buildInsertPatches(
		denseSiblings,
		insertIndex,
		nodeIds.length,
	);
	return {
		assignments: nodeIds.map((nodeId, index) => ({
			nodeId,
			siblingOrder: insertIndex + index,
		})),
		rebalancePatches: mergeSiblingPatches([...densePatches, ...insertPatches]),
	};
};

export const applyLayerOrderPatches = <T extends LayerOrderNodeLike>(
	nodes: T[],
	patches: LayerOrderSiblingPatch[],
): T[] => {
	if (patches.length === 0) return nodes;
	const patchByNodeId = new Map(
		patches.map((patch) => [patch.nodeId, patch.siblingOrder]),
	);
	return nodes.map((node) => {
		const nextSiblingOrder = patchByNodeId.get(node.id);
		if (
			nextSiblingOrder === undefined ||
			nextSiblingOrder === node.siblingOrder
		) {
			return node;
		}
		return {
			...node,
			siblingOrder: nextSiblingOrder,
		};
	});
};

export const resolveLayerSiblingCount = (
	nodes: LayerOrderNodeLike[],
	parentId: string | null,
	excludeNodeIds?: Iterable<string>,
): number => {
	return resolveSiblingNodesBySiblingOrder(nodes, {
		parentId,
		excludeNodeIds,
	}).length;
};

export interface LayerTreeOrder {
	paintNodeIds: string[];
	hitNodeIds: string[];
	paintOrderByNodeId: Map<string, number>;
	hitOrderByNodeId: Map<string, number>;
}

export const buildLayerTreeOrder = <T extends LayerOrderNodeLike>(
	nodes: T[],
): LayerTreeOrder => {
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const childrenByParentId = new Map<string | null, T[]>();
	for (const node of nodes) {
		const rawParentId = normalizeParentId(node.parentId);
		const parentId = rawParentId && nodeById.has(rawParentId) ? rawParentId : null;
		const siblings = childrenByParentId.get(parentId) ?? [];
		siblings.push(node);
		childrenByParentId.set(parentId, siblings);
	}
	for (const [parentId, children] of childrenByParentId) {
		childrenByParentId.set(parentId, sortBySiblingOrder(children));
	}

	const visited = new Set<string>();
	const paintNodeIds: string[] = [];
	const visiting = new Set<string>();

	const visit = (node: T) => {
		if (visited.has(node.id)) return;
		if (visiting.has(node.id)) return;
		visiting.add(node.id);
		visited.add(node.id);
		paintNodeIds.push(node.id);
		const children = childrenByParentId.get(node.id) ?? [];
		for (const child of children) {
			visit(child);
		}
		visiting.delete(node.id);
	};

	for (const root of childrenByParentId.get(null) ?? []) {
		visit(root);
	}

	const remaining = sortBySiblingOrder(
		nodes.filter((node) => !visited.has(node.id)),
	);
	for (const node of remaining) {
		visit(node);
	}

	const hitNodeIds = [...paintNodeIds].reverse();
	const paintOrderByNodeId = new Map<string, number>();
	for (const [index, nodeId] of paintNodeIds.entries()) {
		paintOrderByNodeId.set(nodeId, index);
	}
	const hitOrderByNodeId = new Map<string, number>();
	for (const [index, nodeId] of hitNodeIds.entries()) {
		hitOrderByNodeId.set(nodeId, index);
	}
	return {
		paintNodeIds,
		hitNodeIds,
		paintOrderByNodeId,
		hitOrderByNodeId,
	};
};

export const sortByTreePaintOrder = <T extends LayerOrderNodeLike>(
	nodes: T[],
): T[] => {
	if (nodes.length <= 1) return nodes;
	const order = buildLayerTreeOrder(nodes);
	return [...nodes].sort((left, right) => {
		const leftIndex = order.paintOrderByNodeId.get(left.id) ?? Number.MAX_SAFE_INTEGER;
		const rightIndex =
			order.paintOrderByNodeId.get(right.id) ?? Number.MAX_SAFE_INTEGER;
		if (leftIndex !== rightIndex) return leftIndex - rightIndex;
		return left.id.localeCompare(right.id);
	});
};

export const sortByTreeHitOrder = <T extends LayerOrderNodeLike>(
	nodes: T[],
): T[] => {
	if (nodes.length <= 1) return nodes;
	const order = buildLayerTreeOrder(nodes);
	return [...nodes].sort((left, right) => {
		const leftIndex = order.hitOrderByNodeId.get(left.id) ?? Number.MAX_SAFE_INTEGER;
		const rightIndex =
			order.hitOrderByNodeId.get(right.id) ?? Number.MAX_SAFE_INTEGER;
		if (leftIndex !== rightIndex) return leftIndex - rightIndex;
		return right.id.localeCompare(left.id);
	});
};

// 兼容旧命名
export const compareLayerOrder = compareSiblingOrder;
export const compareLayerOrderDesc = compareSiblingOrderDesc;
export const sortByLayerOrder = sortBySiblingOrder;
export const resolveSiblingNodesByLayerOrder = resolveSiblingNodesBySiblingOrder;
export const rebalanceSiblingZIndex = rebalanceSiblingOrder;
export const allocateInsertZIndex = allocateInsertSiblingOrder;
export const allocateBatchInsertZIndex = allocateBatchInsertSiblingOrder;

export type CanvasLayerOrderNodeLike = Pick<
	CanvasNode,
	"id" | "parentId" | "siblingOrder"
>;
