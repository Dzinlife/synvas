import type {
	CanvasNode,
	SceneDocument,
	StudioProject,
} from "core/studio/types";
import {
	allocateInsertZIndex,
	compareLayerOrder,
	resolveLayerSiblingCount,
	sortByLayerOrder,
} from "@/studio/canvas/layerOrderCoordinator";
import type { StudioCanvasClipboardEntry } from "./studioClipboardStore";

export type CanvasGraphHistoryEntry = {
	node: CanvasNode;
	scene: SceneDocument | undefined;
};

const cloneValue = <T>(value: T): T => {
	return JSON.parse(JSON.stringify(value)) as T;
};

const createCanvasEntityId = (prefix: string): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const sortEntriesByNodeOrder = (
	entries: StudioCanvasClipboardEntry[],
): StudioCanvasClipboardEntry[] => {
	return [...entries].sort((left, right) =>
		compareLayerOrder(left.node, right.node),
	);
};

const resolveClipboardBounds = (
	entries: StudioCanvasClipboardEntry[],
): { left: number; top: number } => {
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	for (const entry of entries) {
		left = Math.min(left, entry.node.x);
		top = Math.min(top, entry.node.y);
	}
	return {
		left: Number.isFinite(left) ? left : 0,
		top: Number.isFinite(top) ? top : 0,
	};
};

export const buildCanvasClipboardEntries = (
	project: StudioProject,
	nodeIds: string[],
): StudioCanvasClipboardEntry[] => {
	if (nodeIds.length === 0) return [];
	const nodeIdSet = new Set(nodeIds);
	const sourceNodes = sortByLayerOrder(
		project.canvas.nodes.filter((node) => nodeIdSet.has(node.id)),
	);
	if (sourceNodes.length === 0) return [];
	return sourceNodes.reduce<StudioCanvasClipboardEntry[]>((entries, node) => {
		if (node.type === "scene") {
			const sourceScene = project.scenes[node.sceneId];
			if (!sourceScene) return entries;
			entries.push({
				node: cloneValue(node),
				scene: cloneValue(sourceScene),
			});
			return entries;
		}
		entries.push({
			node: cloneValue(node),
			scene: undefined,
		});
		return entries;
	}, []);
};

export const instantiateCanvasClipboardEntries = (options: {
	sourceEntries: StudioCanvasClipboardEntry[];
	targetLeft: number;
	targetTop: number;
	existingNodes: CanvasNode[];
}): CanvasGraphHistoryEntry[] => {
	const orderedEntries = sortEntriesByNodeOrder(options.sourceEntries);
	if (orderedEntries.length === 0) return [];
	const sourceBounds = resolveClipboardBounds(orderedEntries);
	const deltaX = options.targetLeft - sourceBounds.left;
	const deltaY = options.targetTop - sourceBounds.top;
	const now = Date.now();
	const targetNodeIdBySourceNodeId = new Map<string, string>();
	for (const item of orderedEntries) {
		targetNodeIdBySourceNodeId.set(item.node.id, createCanvasEntityId("node"));
	}

	const entries = orderedEntries.reduce<CanvasGraphHistoryEntry[]>(
		(entries, item, index) => {
			const sourceNode = item.node;
			const createdAt = now + index;
			const copyName = sourceNode.name.trim()
				? `${sourceNode.name}副本`
				: "副本";
			const mappedParentId = sourceNode.parentId
				? (targetNodeIdBySourceNodeId.get(sourceNode.parentId) ?? null)
				: null;
			const baseNode = {
				...sourceNode,
				id: targetNodeIdBySourceNodeId.get(sourceNode.id) ?? sourceNode.id,
				name: copyName,
				parentId: mappedParentId,
				x: sourceNode.x + deltaX,
				y: sourceNode.y + deltaY,
				zIndex: sourceNode.zIndex,
				createdAt,
				updatedAt: createdAt,
			};

			if (sourceNode.type === "scene") {
				if (!item.scene) return entries;
				const sceneId = createCanvasEntityId("scene");
				const scene: SceneDocument = {
					...cloneValue(item.scene),
					id: sceneId,
					name: copyName,
					createdAt,
					updatedAt: createdAt,
				};
				entries.push({
					node: {
						...baseNode,
						type: "scene",
						sceneId,
					},
					scene,
				});
				return entries;
			}

			entries.push({
				node: baseNode as CanvasNode,
				scene: undefined,
			});
			return entries;
		},
		[],
	);
	if (entries.length === 0) return entries;
	const entryByNodeId = new Map(entries.map((entry) => [entry.node.id, entry]));
	const depthByNodeId = new Map<string, number>();
	const resolveDepth = (nodeId: string): number => {
		const cached = depthByNodeId.get(nodeId);
		if (cached !== undefined) return cached;
		const entry = entryByNodeId.get(nodeId);
		if (!entry) return 0;
		const parentId = entry.node.parentId ?? null;
		if (!parentId || !entryByNodeId.has(parentId)) {
			depthByNodeId.set(nodeId, 0);
			return 0;
		}
		const depth = resolveDepth(parentId) + 1;
		depthByNodeId.set(nodeId, depth);
		return depth;
	};
	let workingNodes = [...options.existingNodes];
	entries
		.map((entry, sourceIndex) => ({
			entry,
			sourceIndex,
			depth: resolveDepth(entry.node.id),
		}))
		.sort((left, right) => {
			if (left.depth !== right.depth) return left.depth - right.depth;
			return left.sourceIndex - right.sourceIndex;
		})
		.forEach(({ entry }) => {
			const parentId = entry.node.parentId ?? null;
			const insertIndex = resolveLayerSiblingCount(workingNodes, parentId);
			const { zIndex } = allocateInsertZIndex(workingNodes, {
				parentId,
				index: insertIndex,
			});
			entry.node = {
				...entry.node,
				zIndex,
			};
			workingNodes = [...workingNodes, entry.node];
		});
	return entries;
};
