import type { BoardCanvasNode, CanvasNode } from "@/studio/project/types";
import {
	collectCanvasAncestorBoardIds,
	collectCanvasDescendantNodeIds,
	resolveCanvasNodeWorldRect,
} from "./canvasBoardUtils";
import { sortBySiblingOrder } from "./layerOrderCoordinator";

export const CANVAS_BOARD_AUTO_LAYOUT_GAP = 64;

export type CanvasBoardAutoLayoutMode = "free" | "auto";

export interface CanvasBoardAutoLayoutPatch {
	nodeId: string;
	patch: {
		x?: number;
		y?: number;
		width?: number;
		height?: number;
		siblingOrder?: number;
	};
}

export interface CanvasBoardAutoLayoutIndicator {
	boardId: string;
	orientation: "vertical" | "horizontal";
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface CanvasBoardAutoLayoutInsertion {
	boardId: string;
	rows: string[][];
	indicator: CanvasBoardAutoLayoutIndicator;
}

interface RowBuildState {
	nodeIds: string[];
	top: number;
	bottom: number;
}

interface RowMetrics {
	nodeIds: string[];
	left: number;
	right: number;
	top: number;
	bottom: number;
	height: number;
}

const isBoardNode = (
	node: CanvasNode | null | undefined,
): node is BoardCanvasNode => node?.type === "board";

export const getCanvasBoardLayoutMode = (
	board: BoardCanvasNode,
): CanvasBoardAutoLayoutMode => {
	return board.layoutMode === "auto" ? "auto" : "free";
};

export const isCanvasBoardAutoLayoutNode = (
	node: CanvasNode | null | undefined,
): node is BoardCanvasNode => {
	return isBoardNode(node) && getCanvasBoardLayoutMode(node) === "auto";
};

const resolveNodeById = (nodes: CanvasNode[]): Map<string, CanvasNode> => {
	return new Map(nodes.map((node) => [node.id, node]));
};

const resolveDirectVisibleChildren = (
	nodes: CanvasNode[],
	boardId: string,
	excludeNodeIds?: Set<string>,
): CanvasNode[] => {
	return nodes.filter((node) => {
		if ((node.parentId ?? null) !== boardId) return false;
		if (node.hidden) return false;
		if (excludeNodeIds?.has(node.id)) return false;
		return true;
	});
};

const sortChildrenByPosition = (children: CanvasNode[]): CanvasNode[] => {
	return [...children].sort((left, right) => {
		const leftRect = resolveCanvasNodeWorldRect(left);
		const rightRect = resolveCanvasNodeWorldRect(right);
		if (leftRect.top !== rightRect.top) return leftRect.top - rightRect.top;
		if (leftRect.left !== rightRect.left) return leftRect.left - rightRect.left;
		if (left.siblingOrder !== right.siblingOrder) {
			return left.siblingOrder - right.siblingOrder;
		}
		return left.id.localeCompare(right.id);
	});
};

export const deriveCanvasBoardAutoLayoutRows = (
	nodes: CanvasNode[],
	boardId: string,
	options?: {
		excludeNodeIds?: Set<string>;
		gap?: number;
	},
): string[][] => {
	const gap = options?.gap ?? CANVAS_BOARD_AUTO_LAYOUT_GAP;
	const children = sortChildrenByPosition(
		resolveDirectVisibleChildren(nodes, boardId, options?.excludeNodeIds),
	);
	const rows: RowBuildState[] = [];
	for (const child of children) {
		const rect = resolveCanvasNodeWorldRect(child);
		const row = rows.find((candidate) => {
			return (
				rect.top <= candidate.bottom + gap / 2 &&
				rect.bottom >= candidate.top - gap / 2
			);
		});
		if (!row) {
			rows.push({
				nodeIds: [child.id],
				top: rect.top,
				bottom: rect.bottom,
			});
			continue;
		}
		row.nodeIds.push(child.id);
		row.top = Math.min(row.top, rect.top);
		row.bottom = Math.max(row.bottom, rect.bottom);
	}
	const nodeById = resolveNodeById(nodes);
	return rows
		.sort((left, right) => {
			if (left.top !== right.top) return left.top - right.top;
			return left.nodeIds[0]?.localeCompare(right.nodeIds[0] ?? "") ?? 0;
		})
		.map((row) => {
			return row.nodeIds
				.map((nodeId) => nodeById.get(nodeId))
				.filter((node): node is CanvasNode => Boolean(node))
				.sort((left, right) => {
					const leftRect = resolveCanvasNodeWorldRect(left);
					const rightRect = resolveCanvasNodeWorldRect(right);
					if (leftRect.left !== rightRect.left) {
						return leftRect.left - rightRect.left;
					}
					if (left.siblingOrder !== right.siblingOrder) {
						return left.siblingOrder - right.siblingOrder;
					}
					return left.id.localeCompare(right.id);
				})
				.map((node) => node.id);
		})
		.filter((row) => row.length > 0);
};

const normalizeCanvasBoardAutoLayoutRows = (
	nodes: CanvasNode[],
	boardId: string,
	rows: string[][],
): string[][] => {
	const nodeById = resolveNodeById(nodes);
	const visitedNodeIds = new Set<string>();
	return rows
		.map((row) => {
			return row.filter((nodeId) => {
				if (visitedNodeIds.has(nodeId)) return false;
				const node = nodeById.get(nodeId);
				if (!node || node.hidden) return false;
				if ((node.parentId ?? null) !== boardId) return false;
				visitedNodeIds.add(nodeId);
				return true;
			});
		})
		.filter((row) => row.length > 0);
};

const mergeAutoLayoutPatch = (
	patchByNodeId: Map<string, CanvasBoardAutoLayoutPatch["patch"]>,
	nodeId: string,
	patch: CanvasBoardAutoLayoutPatch["patch"],
): void => {
	const existing = patchByNodeId.get(nodeId) ?? {};
	patchByNodeId.set(nodeId, {
		...existing,
		...patch,
	});
};

const pushPatchIfChanged = (
	patchByNodeId: Map<string, CanvasBoardAutoLayoutPatch["patch"]>,
	node: CanvasNode,
	patch: CanvasBoardAutoLayoutPatch["patch"],
): void => {
	const nextPatch: CanvasBoardAutoLayoutPatch["patch"] = {};
	if (patch.x !== undefined && patch.x !== node.x) nextPatch.x = patch.x;
	if (patch.y !== undefined && patch.y !== node.y) nextPatch.y = patch.y;
	if (patch.width !== undefined && patch.width !== node.width) {
		nextPatch.width = patch.width;
	}
	if (patch.height !== undefined && patch.height !== node.height) {
		nextPatch.height = patch.height;
	}
	if (
		patch.siblingOrder !== undefined &&
		patch.siblingOrder !== node.siblingOrder
	) {
		nextPatch.siblingOrder = patch.siblingOrder;
	}
	if (Object.keys(nextPatch).length === 0) return;
	mergeAutoLayoutPatch(patchByNodeId, node.id, nextPatch);
};

export const resolveCanvasBoardAutoLayoutPatches = (
	nodes: CanvasNode[],
	boardId: string,
	options?: {
		rows?: string[][];
		gap?: number;
	},
): CanvasBoardAutoLayoutPatch[] => {
	const gap = options?.gap ?? CANVAS_BOARD_AUTO_LAYOUT_GAP;
	const nodeById = resolveNodeById(nodes);
	const board = nodeById.get(boardId);
	if (!isCanvasBoardAutoLayoutNode(board)) return [];
	const rows = normalizeCanvasBoardAutoLayoutRows(
		nodes,
		boardId,
		options?.rows ?? deriveCanvasBoardAutoLayoutRows(nodes, boardId, { gap }),
	);
	const patchByNodeId = new Map<string, CanvasBoardAutoLayoutPatch["patch"]>();
	let y = board.y + gap;
	let maxRowWidth = 0;
	let totalRowHeight = 0;
	let flattenedIndex = 0;

	for (const row of rows) {
		let x = board.x + gap;
		let rowWidth = 0;
		let rowHeight = 0;
		for (const nodeId of row) {
			const child = nodeById.get(nodeId);
			if (!child) continue;
			rowHeight = Math.max(rowHeight, child.height);
		}
		for (const nodeId of row) {
			const child = nodeById.get(nodeId);
			if (!child) continue;
			const nextX = x;
			const nextY = y;
			const deltaX = nextX - child.x;
			const deltaY = nextY - child.y;
			pushPatchIfChanged(patchByNodeId, child, {
				x: nextX,
				y: nextY,
				siblingOrder: flattenedIndex,
			});
			if (child.type === "board" && (deltaX !== 0 || deltaY !== 0)) {
				const descendantNodeIds = collectCanvasDescendantNodeIds(nodes, [
					child.id,
				]);
				for (const descendantNodeId of descendantNodeIds) {
					const descendant = nodeById.get(descendantNodeId);
					if (!descendant) continue;
					pushPatchIfChanged(patchByNodeId, descendant, {
						x: descendant.x + deltaX,
						y: descendant.y + deltaY,
					});
				}
			}
			rowWidth += child.width;
			x += child.width + gap;
			flattenedIndex += 1;
		}
		if (row.length > 1) {
			rowWidth += gap * (row.length - 1);
		}
		maxRowWidth = Math.max(maxRowWidth, rowWidth);
		totalRowHeight += rowHeight;
		y += rowHeight + gap;
	}

	const nextBoardWidth = gap + maxRowWidth + gap;
	const nextBoardHeight =
		rows.length === 0
			? gap * 2
			: gap + totalRowHeight + gap * (rows.length - 1) + gap;
	pushPatchIfChanged(patchByNodeId, board, {
		width: nextBoardWidth,
		height: nextBoardHeight,
	});

	return [...patchByNodeId.entries()].map(([nodeId, patch]) => ({
		nodeId,
		patch,
	}));
};

const applyCanvasBoardAutoLayoutPatches = (
	nodes: CanvasNode[],
	patches: CanvasBoardAutoLayoutPatch[],
): CanvasNode[] => {
	if (patches.length === 0) return nodes;
	const patchByNodeId = new Map(
		patches.map((entry) => [entry.nodeId, entry.patch]),
	);
	return nodes.map((node) => {
		const patch = patchByNodeId.get(node.id);
		if (!patch) return node;
		return {
			...node,
			...patch,
		};
	});
};

const resolveBoardDepth = (
	nodeById: Map<string, CanvasNode>,
	boardId: string,
): number => {
	let depth = 0;
	const visitedNodeIds = new Set<string>();
	let current = nodeById.get(boardId) ?? null;
	while (current?.parentId) {
		if (visitedNodeIds.has(current.id)) break;
		visitedNodeIds.add(current.id);
		const parent = nodeById.get(current.parentId) ?? null;
		if (!parent) break;
		depth += 1;
		current = parent;
	}
	return depth;
};

export const collectCanvasAutoLayoutAncestorBoardIds = (
	nodes: CanvasNode[],
	nodeIds: string[],
): string[] => {
	const nodeById = resolveNodeById(nodes);
	const boardIds: string[] = [];
	const visitedBoardIds = new Set<string>();
	for (const nodeId of nodeIds) {
		const node = nodeById.get(nodeId);
		for (const boardId of collectCanvasAncestorBoardIds(
			nodes,
			node?.parentId ?? null,
		)) {
			const board = nodeById.get(boardId);
			if (!isCanvasBoardAutoLayoutNode(board)) continue;
			if (visitedBoardIds.has(boardId)) continue;
			visitedBoardIds.add(boardId);
			boardIds.push(boardId);
		}
	}
	return boardIds;
};

export const resolveCanvasBoardAutoLayoutCascadePatches = (
	nodes: CanvasNode[],
	boardIds: string[],
	options?: {
		rowsByBoardId?: Map<string, string[][]>;
		gap?: number;
	},
): CanvasBoardAutoLayoutPatch[] => {
	let workingNodes = nodes;
	const patchByNodeId = new Map<string, CanvasBoardAutoLayoutPatch["patch"]>();
	const queuedBoardIds = new Set(boardIds.filter(Boolean));
	const processedBoardIds = new Set<string>();
	const queue = [...queuedBoardIds];
	const sortQueue = () => {
		const nodeById = resolveNodeById(workingNodes);
		queue.sort((left, right) => {
			return (
				resolveBoardDepth(nodeById, right) - resolveBoardDepth(nodeById, left)
			);
		});
	};
	sortQueue();
	while (queue.length > 0) {
		const boardId = queue.shift();
		if (!boardId || processedBoardIds.has(boardId)) continue;
		processedBoardIds.add(boardId);
		const patches = resolveCanvasBoardAutoLayoutPatches(workingNodes, boardId, {
			rows: options?.rowsByBoardId?.get(boardId),
			gap: options?.gap,
		});
		if (patches.length === 0) continue;
		for (const entry of patches) {
			mergeAutoLayoutPatch(patchByNodeId, entry.nodeId, entry.patch);
		}
		workingNodes = applyCanvasBoardAutoLayoutPatches(workingNodes, patches);
		const board = workingNodes.find((node) => node.id === boardId) ?? null;
		const parent = board?.parentId
			? (workingNodes.find((node) => node.id === board.parentId) ?? null)
			: null;
		if (
			isCanvasBoardAutoLayoutNode(parent) &&
			!processedBoardIds.has(parent.id)
		) {
			if (!queuedBoardIds.has(parent.id)) {
				queuedBoardIds.add(parent.id);
				queue.push(parent.id);
				sortQueue();
			}
		}
	}
	return [...patchByNodeId.entries()].map(([nodeId, patch]) => ({
		nodeId,
		patch,
	}));
};

const resolveRowMetrics = (
	nodes: CanvasNode[],
	rows: string[][],
): RowMetrics[] => {
	const nodeById = resolveNodeById(nodes);
	return rows
		.map((row) => {
			const rowNodes = row
				.map((nodeId) => nodeById.get(nodeId) ?? null)
				.filter((node): node is CanvasNode => Boolean(node));
			if (rowNodes.length === 0) return null;
			let left = Number.POSITIVE_INFINITY;
			let right = Number.NEGATIVE_INFINITY;
			let top = Number.POSITIVE_INFINITY;
			let bottom = Number.NEGATIVE_INFINITY;
			for (const node of rowNodes) {
				const rect = resolveCanvasNodeWorldRect(node);
				left = Math.min(left, rect.left);
				right = Math.max(right, rect.right);
				top = Math.min(top, rect.top);
				bottom = Math.max(bottom, rect.bottom);
			}
			return {
				nodeIds: rowNodes.map((node) => node.id),
				left,
				right,
				top,
				bottom,
				height: Math.max(1, bottom - top),
			};
		})
		.filter((row): row is RowMetrics => Boolean(row));
};

const insertNodeIdsIntoRows = (
	rows: string[][],
	rowIndex: number,
	insertIndex: number,
	insertedNodeIds: string[],
	mode: "same-row" | "new-row",
): string[][] => {
	const nextRows = rows.map((row) =>
		row.filter((nodeId) => !insertedNodeIds.includes(nodeId)),
	);
	if (mode === "new-row") {
		nextRows.splice(Math.max(0, Math.min(rowIndex, nextRows.length)), 0, [
			...insertedNodeIds,
		]);
		return nextRows.filter((row) => row.length > 0);
	}
	const safeRowIndex = Math.max(0, Math.min(rowIndex, nextRows.length - 1));
	const row = nextRows[safeRowIndex] ?? [];
	const safeInsertIndex = Math.max(0, Math.min(insertIndex, row.length));
	nextRows[safeRowIndex] = [
		...row.slice(0, safeInsertIndex),
		...insertedNodeIds,
		...row.slice(safeInsertIndex),
	];
	return nextRows.filter((item) => item.length > 0);
};

export const resolveCanvasBoardAutoLayoutInsertion = (
	nodes: CanvasNode[],
	boardId: string,
	movingNodeIds: string[],
	pointer: { x: number; y: number },
	options?: {
		gap?: number;
	},
): CanvasBoardAutoLayoutInsertion | null => {
	const gap = options?.gap ?? CANVAS_BOARD_AUTO_LAYOUT_GAP;
	const nodeById = resolveNodeById(nodes);
	const board = nodeById.get(boardId);
	if (!isCanvasBoardAutoLayoutNode(board)) return null;
	const movingNodeIdSet = new Set(movingNodeIds);
	const movingRootNodeIds = sortBySiblingOrder(
		movingNodeIds
			.map((nodeId) => nodeById.get(nodeId) ?? null)
			.filter((node): node is CanvasNode => {
				if (!node) return false;
				return (node.parentId ?? null) === boardId;
			}),
	).map((node) => node.id);
	if (movingRootNodeIds.length === 0) return null;
	const baseRows = deriveCanvasBoardAutoLayoutRows(nodes, boardId, {
		excludeNodeIds: movingNodeIdSet,
		gap,
	});
	const rowMetrics = resolveRowMetrics(nodes, baseRows);
	if (rowMetrics.length === 0) {
		const lineX = board.x + gap / 2;
		const lineTop = board.y + gap;
		return {
			boardId,
			rows: [[...movingRootNodeIds]],
			indicator: {
				boardId,
				orientation: "vertical",
				x1: lineX,
				y1: lineTop,
				x2: lineX,
				y2: lineTop + gap,
			},
		};
	}

	if (pointer.y < rowMetrics[0].top - gap / 2) {
		const y = rowMetrics[0].top - gap / 2;
		return {
			boardId,
			rows: insertNodeIdsIntoRows(baseRows, 0, 0, movingRootNodeIds, "new-row"),
			indicator: {
				boardId,
				orientation: "horizontal",
				x1: board.x + gap,
				y1: y,
				x2: board.x + Math.max(gap, board.width - gap),
				y2: y,
			},
		};
	}

	for (let index = 0; index < rowMetrics.length - 1; index += 1) {
		const current = rowMetrics[index];
		const next = rowMetrics[index + 1];
		if (!current || !next) continue;
		if (pointer.y >= current.bottom && pointer.y <= next.top) {
			const y = (current.bottom + next.top) / 2;
			return {
				boardId,
				rows: insertNodeIdsIntoRows(
					baseRows,
					index + 1,
					0,
					movingRootNodeIds,
					"new-row",
				),
				indicator: {
					boardId,
					orientation: "horizontal",
					x1: board.x + gap,
					y1: y,
					x2: board.x + Math.max(gap, board.width - gap),
					y2: y,
				},
			};
		}
	}

	const lastRow = rowMetrics[rowMetrics.length - 1];
	if (lastRow && pointer.y > lastRow.bottom + gap / 2) {
		const y = lastRow.bottom + gap / 2;
		return {
			boardId,
			rows: insertNodeIdsIntoRows(
				baseRows,
				baseRows.length,
				0,
				movingRootNodeIds,
				"new-row",
			),
			indicator: {
				boardId,
				orientation: "horizontal",
				x1: board.x + gap,
				y1: y,
				x2: board.x + Math.max(gap, board.width - gap),
				y2: y,
			},
		};
	}

	let targetRowIndex = rowMetrics.findIndex((row) => {
		return pointer.y >= row.top - gap / 2 && pointer.y <= row.bottom + gap / 2;
	});
	if (targetRowIndex < 0) {
		targetRowIndex = rowMetrics.reduce((bestIndex, row, index) => {
			const best = rowMetrics[bestIndex];
			const rowCenter = (row.top + row.bottom) / 2;
			const bestCenter = best ? (best.top + best.bottom) / 2 : rowCenter;
			return Math.abs(pointer.y - rowCenter) < Math.abs(pointer.y - bestCenter)
				? index
				: bestIndex;
		}, 0);
	}
	const targetRow = rowMetrics[targetRowIndex];
	if (!targetRow) return null;
	const targetNodes = targetRow.nodeIds
		.map((nodeId) => nodeById.get(nodeId) ?? null)
		.filter((node): node is CanvasNode => Boolean(node));
	let insertIndex = targetNodes.length;
	for (let index = 0; index < targetNodes.length; index += 1) {
		const node = targetNodes[index];
		if (!node) continue;
		const rect = resolveCanvasNodeWorldRect(node);
		if (pointer.x < rect.left + rect.width / 2) {
			insertIndex = index;
			break;
		}
	}
	const lineX = (() => {
		if (targetNodes.length === 0) return board.x + gap / 2;
		if (insertIndex <= 0) {
			const first = targetNodes[0];
			return first
				? resolveCanvasNodeWorldRect(first).left - gap / 2
				: board.x + gap / 2;
		}
		if (insertIndex >= targetNodes.length) {
			const last = targetNodes[targetNodes.length - 1];
			return last
				? resolveCanvasNodeWorldRect(last).right + gap / 2
				: board.x + gap / 2;
		}
		const prev = targetNodes[insertIndex - 1];
		const next = targetNodes[insertIndex];
		if (!prev || !next) return board.x + gap / 2;
		return (
			(resolveCanvasNodeWorldRect(prev).right +
				resolveCanvasNodeWorldRect(next).left) /
			2
		);
	})();
	return {
		boardId,
		rows: insertNodeIdsIntoRows(
			baseRows,
			targetRowIndex,
			insertIndex,
			movingRootNodeIds,
			"same-row",
		),
		indicator: {
			boardId,
			orientation: "vertical",
			x1: lineX,
			y1: targetRow.top,
			x2: lineX,
			y2: targetRow.top + targetRow.height,
		},
	};
};
