import type {
	CanvasNode,
	SceneDocument,
	StudioProject,
} from "core/studio/types";
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
	return [...entries].sort((left, right) => {
		if (left.node.zIndex !== right.node.zIndex) {
			return left.node.zIndex - right.node.zIndex;
		}
		return left.node.createdAt - right.node.createdAt;
	});
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
	const sourceNodes = project.canvas.nodes
		.filter((node) => nodeIdSet.has(node.id))
		.sort((left, right) => {
			if (left.zIndex !== right.zIndex) return left.zIndex - right.zIndex;
			return left.createdAt - right.createdAt;
		});
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
	existingMaxZIndex: number;
}): CanvasGraphHistoryEntry[] => {
	const orderedEntries = sortEntriesByNodeOrder(options.sourceEntries);
	if (orderedEntries.length === 0) return [];
	const sourceBounds = resolveClipboardBounds(orderedEntries);
	const deltaX = options.targetLeft - sourceBounds.left;
	const deltaY = options.targetTop - sourceBounds.top;
	const now = Date.now();

	return orderedEntries.reduce<CanvasGraphHistoryEntry[]>(
		(entries, item, index) => {
			const sourceNode = item.node;
			const createdAt = now + index;
			const copyName = sourceNode.name.trim()
				? `${sourceNode.name}副本`
				: "副本";
			const baseNode = {
				...sourceNode,
				id: createCanvasEntityId("node"),
				name: copyName,
				x: sourceNode.x + deltaX,
				y: sourceNode.y + deltaY,
				zIndex: options.existingMaxZIndex + index + 1,
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
};
