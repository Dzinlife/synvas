import type { CanvasNode } from "core/studio/types";

export const LAYER_ORDER_REBALANCE_STEP = 1024;
export const LAYER_ORDER_MIN_GAP = 1e-6;

export interface LayerOrderNodeLike {
	id: string;
	zIndex: number;
	parentId?: string | null;
}

export interface LayerOrderZIndexPatch {
	nodeId: string;
	zIndex: number;
}

interface ResolveInsertContext {
	prevZIndex: number | null;
	nextZIndex: number | null;
	insertCount: number;
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

export const compareLayerOrder = <
	T extends Pick<LayerOrderNodeLike, "id" | "zIndex">,
>(
	left: T,
	right: T,
): number => {
	if (left.zIndex !== right.zIndex) return left.zIndex - right.zIndex;
	return left.id.localeCompare(right.id);
};

export const compareLayerOrderDesc = <
	T extends Pick<LayerOrderNodeLike, "id" | "zIndex">,
>(
	left: T,
	right: T,
): number => {
	if (left.zIndex !== right.zIndex) return right.zIndex - left.zIndex;
	return right.id.localeCompare(left.id);
};

export const sortByLayerOrder = <
	T extends Pick<LayerOrderNodeLike, "id" | "zIndex">,
>(
	nodes: T[],
): T[] => {
	return [...nodes].sort(compareLayerOrder);
};

export const resolveSiblingNodesByLayerOrder = <T extends LayerOrderNodeLike>(
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
	return sortByLayerOrder(
		nodes.filter((node) => {
			if (excludeNodeIds?.has(node.id)) return false;
			return normalizeParentId(node.parentId) === parentId;
		}),
	);
};

const resolveInsertZIndices = (
	context: ResolveInsertContext,
): number[] | null => {
	const { prevZIndex, nextZIndex, insertCount } = context;
	if (insertCount <= 0) return [];
	if (prevZIndex === null && nextZIndex === null) {
		return Array.from({ length: insertCount }, (_, index) => {
			return index * LAYER_ORDER_REBALANCE_STEP;
		});
	}
	if (prevZIndex === null) {
		const start = nextZIndex - insertCount * LAYER_ORDER_REBALANCE_STEP;
		return Array.from({ length: insertCount }, (_, index) => {
			return start + index * LAYER_ORDER_REBALANCE_STEP;
		});
	}
	if (nextZIndex === null) {
		return Array.from({ length: insertCount }, (_, index) => {
			return prevZIndex + (index + 1) * LAYER_ORDER_REBALANCE_STEP;
		});
	}
	const gap = nextZIndex - prevZIndex;
	const step = gap / (insertCount + 1);
	if (step < LAYER_ORDER_MIN_GAP) return null;
	return Array.from({ length: insertCount }, (_, index) => {
		return prevZIndex + step * (index + 1);
	});
};

const resolvePatchedZIndex = (
	node: LayerOrderNodeLike,
	patchByNodeId: Map<string, number>,
): number => {
	return patchByNodeId.get(node.id) ?? node.zIndex;
};

const resolveSiblingNodesAfterRebalance = <T extends LayerOrderNodeLike>(
	nodes: T[],
	options: {
		parentId: string | null;
		excludeNodeIds?: Iterable<string>;
		patchByNodeId: Map<string, number>;
	},
): T[] => {
	const siblings = resolveSiblingNodesByLayerOrder(nodes, options);
	return siblings
		.map((node) => ({
			...node,
			zIndex: resolvePatchedZIndex(node, options.patchByNodeId),
		}))
		.sort(compareLayerOrder);
};

export const rebalanceSiblingZIndex = <T extends LayerOrderNodeLike>(
	nodes: T[],
	options: {
		parentId: string | null;
		excludeNodeIds?: Iterable<string>;
	},
): LayerOrderZIndexPatch[] => {
	const siblings = resolveSiblingNodesByLayerOrder(nodes, options);
	if (siblings.length <= 1) return [];
	const minZIndex = siblings[0]?.zIndex ?? 0;
	const start =
		Math.floor(minZIndex / LAYER_ORDER_REBALANCE_STEP) *
		LAYER_ORDER_REBALANCE_STEP;
	return siblings.reduce<LayerOrderZIndexPatch[]>((patches, sibling, index) => {
		const nextZIndex = start + index * LAYER_ORDER_REBALANCE_STEP;
		if (nextZIndex === sibling.zIndex) return patches;
		patches.push({
			nodeId: sibling.id,
			zIndex: nextZIndex,
		});
		return patches;
	}, []);
};

export const allocateInsertZIndex = <T extends LayerOrderNodeLike>(
	nodes: T[],
	options: {
		parentId: string | null;
		index: number;
		movingNodeIds?: Iterable<string>;
	},
): {
	zIndex: number;
	rebalancePatches: LayerOrderZIndexPatch[];
} => {
	const siblings = resolveSiblingNodesByLayerOrder(nodes, {
		parentId: options.parentId,
		excludeNodeIds: options.movingNodeIds,
	});
	const insertIndex = clampIndex(options.index, siblings.length);
	const prevZIndex = siblings[insertIndex - 1]?.zIndex ?? null;
	const nextZIndex = siblings[insertIndex]?.zIndex ?? null;
	const result = resolveInsertZIndices({
		prevZIndex,
		nextZIndex,
		insertCount: 1,
	});
	if (result) {
		return {
			zIndex: result[0] ?? 0,
			rebalancePatches: [],
		};
	}

	const rebalancePatches = rebalanceSiblingZIndex(nodes, {
		parentId: options.parentId,
		excludeNodeIds: options.movingNodeIds,
	});
	const patchByNodeId = new Map(
		rebalancePatches.map((patch) => [patch.nodeId, patch.zIndex]),
	);
	const rebalancedSiblings = resolveSiblingNodesAfterRebalance(nodes, {
		parentId: options.parentId,
		excludeNodeIds: options.movingNodeIds,
		patchByNodeId,
	});
	const rebalancedInsertIndex = clampIndex(
		options.index,
		rebalancedSiblings.length,
	);
	const finalPrev =
		rebalancedSiblings[rebalancedInsertIndex - 1]?.zIndex ?? null;
	const finalNext = rebalancedSiblings[rebalancedInsertIndex]?.zIndex ?? null;
	const finalResult = resolveInsertZIndices({
		prevZIndex: finalPrev,
		nextZIndex: finalNext,
		insertCount: 1,
	}) ?? [finalPrev === null ? 0 : finalPrev + LAYER_ORDER_REBALANCE_STEP];
	return {
		zIndex: finalResult[0] ?? 0,
		rebalancePatches,
	};
};

export const allocateBatchInsertZIndex = <T extends LayerOrderNodeLike>(
	nodes: T[],
	options: {
		parentId: string | null;
		index: number;
		nodeIds: string[];
		movingNodeIds?: Iterable<string>;
	},
): {
	assignments: Array<{ nodeId: string; zIndex: number }>;
	rebalancePatches: LayerOrderZIndexPatch[];
} => {
	const nodeIds = options.nodeIds.filter(Boolean);
	if (nodeIds.length === 0) {
		return {
			assignments: [],
			rebalancePatches: [],
		};
	}
	const siblings = resolveSiblingNodesByLayerOrder(nodes, {
		parentId: options.parentId,
		excludeNodeIds: options.movingNodeIds,
	});
	const insertIndex = clampIndex(options.index, siblings.length);
	const prevZIndex = siblings[insertIndex - 1]?.zIndex ?? null;
	const nextZIndex = siblings[insertIndex]?.zIndex ?? null;
	const result = resolveInsertZIndices({
		prevZIndex,
		nextZIndex,
		insertCount: nodeIds.length,
	});
	if (result) {
		return {
			assignments: nodeIds.map((nodeId, index) => ({
				nodeId,
				zIndex: result[index] ?? 0,
			})),
			rebalancePatches: [],
		};
	}

	const rebalancePatches = rebalanceSiblingZIndex(nodes, {
		parentId: options.parentId,
		excludeNodeIds: options.movingNodeIds,
	});
	const patchByNodeId = new Map(
		rebalancePatches.map((patch) => [patch.nodeId, patch.zIndex]),
	);
	const rebalancedSiblings = resolveSiblingNodesAfterRebalance(nodes, {
		parentId: options.parentId,
		excludeNodeIds: options.movingNodeIds,
		patchByNodeId,
	});
	const rebalancedInsertIndex = clampIndex(
		options.index,
		rebalancedSiblings.length,
	);
	const finalPrev =
		rebalancedSiblings[rebalancedInsertIndex - 1]?.zIndex ?? null;
	const finalNext = rebalancedSiblings[rebalancedInsertIndex]?.zIndex ?? null;
	const finalResult =
		resolveInsertZIndices({
			prevZIndex: finalPrev,
			nextZIndex: finalNext,
			insertCount: nodeIds.length,
		}) ??
		Array.from({ length: nodeIds.length }, (_, index) => {
			return (finalPrev ?? 0) + (index + 1) * LAYER_ORDER_REBALANCE_STEP;
		});
	return {
		assignments: nodeIds.map((nodeId, index) => ({
			nodeId,
			zIndex: finalResult[index] ?? 0,
		})),
		rebalancePatches,
	};
};

export const applyLayerOrderPatches = <T extends LayerOrderNodeLike>(
	nodes: T[],
	patches: LayerOrderZIndexPatch[],
): T[] => {
	if (patches.length === 0) return nodes;
	const patchByNodeId = new Map(
		patches.map((patch) => [patch.nodeId, patch.zIndex]),
	);
	return nodes.map((node) => {
		const nextZIndex = patchByNodeId.get(node.id);
		if (nextZIndex === undefined || nextZIndex === node.zIndex) return node;
		return {
			...node,
			zIndex: nextZIndex,
		};
	});
};

export const resolveLayerSiblingCount = (
	nodes: LayerOrderNodeLike[],
	parentId: string | null,
	excludeNodeIds?: Iterable<string>,
): number => {
	return resolveSiblingNodesByLayerOrder(nodes, {
		parentId,
		excludeNodeIds,
	}).length;
};

export type CanvasLayerOrderNodeLike = Pick<
	CanvasNode,
	"id" | "parentId" | "zIndex"
>;
