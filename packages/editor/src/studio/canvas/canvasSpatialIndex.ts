import type { CanvasNode } from "@/studio/project/types";
import RBush from "rbush";
import { buildLayerTreeOrder } from "./layerOrderCoordinator";

const CANVAS_SPATIAL_INDEX_REBUILD_RATIO = 0.3;

export interface CanvasSpatialRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface CanvasSpatialItem {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	nodeId: string;
	paintOrder: number;
	hitOrder: number;
}

interface CanvasSpatialNodeSnapshot extends CanvasSpatialItem {
	visible: boolean;
}

const resolveNodeSpatialSnapshot = (
	node: CanvasNode,
	order: {
		paintOrderByNodeId: Map<string, number>;
		hitOrderByNodeId: Map<string, number>;
	},
): CanvasSpatialNodeSnapshot => {
	const minX = Math.min(node.x, node.x + node.width);
	const maxX = Math.max(node.x, node.x + node.width);
	const minY = Math.min(node.y, node.y + node.height);
	const maxY = Math.max(node.y, node.y + node.height);
	return {
		minX,
		minY,
		maxX,
		maxY,
		nodeId: node.id,
		paintOrder: order.paintOrderByNodeId.get(node.id) ?? Number.MAX_SAFE_INTEGER,
		hitOrder: order.hitOrderByNodeId.get(node.id) ?? Number.MAX_SAFE_INTEGER,
		visible: !node.hidden,
	};
};

const toSpatialItem = (
	snapshot: CanvasSpatialNodeSnapshot,
): CanvasSpatialItem => {
	return {
		minX: snapshot.minX,
		minY: snapshot.minY,
		maxX: snapshot.maxX,
		maxY: snapshot.maxY,
		nodeId: snapshot.nodeId,
		paintOrder: snapshot.paintOrder,
		hitOrder: snapshot.hitOrder,
	};
};

const isSpatialSnapshotEqual = (
	left: CanvasSpatialNodeSnapshot,
	right: CanvasSpatialNodeSnapshot,
): boolean => {
	return (
		left.visible === right.visible &&
		left.minX === right.minX &&
		left.minY === right.minY &&
		left.maxX === right.maxX &&
		left.maxY === right.maxY &&
		left.paintOrder === right.paintOrder &&
		left.hitOrder === right.hitOrder
	);
};

const normalizeRect = (rect: CanvasSpatialRect): CanvasSpatialRect => {
	return {
		left: Math.min(rect.left, rect.right),
		right: Math.max(rect.left, rect.right),
		top: Math.min(rect.top, rect.bottom),
		bottom: Math.max(rect.top, rect.bottom),
	};
};

export const compareCanvasSpatialPaintOrder = (
	left: CanvasSpatialItem,
	right: CanvasSpatialItem,
): number => {
	if (left.paintOrder !== right.paintOrder) {
		return left.paintOrder - right.paintOrder;
	}
	return left.nodeId.localeCompare(right.nodeId);
};

export const compareCanvasSpatialHitPriority = (
	left: CanvasSpatialItem,
	right: CanvasSpatialItem,
): number => {
	if (left.hitOrder !== right.hitOrder) {
		return left.hitOrder - right.hitOrder;
	}
	return right.nodeId.localeCompare(left.nodeId);
};

export class CanvasSpatialIndex {
	private tree = new RBush<CanvasSpatialItem>();

	private snapshotById = new Map<string, CanvasSpatialNodeSnapshot>();

	private itemById = new Map<string, CanvasSpatialItem>();

	sync(nodes: CanvasNode[]): void {
		const nextSnapshotById = new Map<string, CanvasSpatialNodeSnapshot>();
		const nextVisibleItemById = new Map<string, CanvasSpatialItem>();
		const layerTreeOrder = buildLayerTreeOrder(nodes);

		for (const node of nodes) {
			const snapshot = resolveNodeSpatialSnapshot(node, layerTreeOrder);
			nextSnapshotById.set(node.id, snapshot);
			if (!snapshot.visible) continue;
			nextVisibleItemById.set(node.id, toSpatialItem(snapshot));
		}

		const removeIds = new Set<string>();
		const insertIds = new Set<string>();
		const changedNodeIds = new Set<string>();

		for (const [nodeId, prevSnapshot] of this.snapshotById) {
			const nextSnapshot = nextSnapshotById.get(nodeId);
			if (!nextSnapshot) {
				if (prevSnapshot.visible) {
					removeIds.add(nodeId);
					changedNodeIds.add(nodeId);
				}
				continue;
			}
			if (!isSpatialSnapshotEqual(prevSnapshot, nextSnapshot)) {
				changedNodeIds.add(nodeId);
			}
			if (prevSnapshot.visible && !nextSnapshot.visible) {
				removeIds.add(nodeId);
				continue;
			}
			if (!prevSnapshot.visible && nextSnapshot.visible) {
				insertIds.add(nodeId);
				continue;
			}
			if (prevSnapshot.visible && nextSnapshot.visible) {
				const geometryChanged =
					prevSnapshot.minX !== nextSnapshot.minX ||
					prevSnapshot.minY !== nextSnapshot.minY ||
					prevSnapshot.maxX !== nextSnapshot.maxX ||
					prevSnapshot.maxY !== nextSnapshot.maxY;
				const orderChanged =
					prevSnapshot.paintOrder !== nextSnapshot.paintOrder ||
					prevSnapshot.hitOrder !== nextSnapshot.hitOrder;
				if (geometryChanged || orderChanged) {
					removeIds.add(nodeId);
					insertIds.add(nodeId);
				}
			}
		}

		for (const [nodeId, nextSnapshot] of nextSnapshotById) {
			if (this.snapshotById.has(nodeId)) continue;
			changedNodeIds.add(nodeId);
			if (nextSnapshot.visible) {
				insertIds.add(nodeId);
			}
		}

		const visibleCount = nextVisibleItemById.size;
		const shouldRebuild =
			visibleCount > 0 &&
			changedNodeIds.size / visibleCount >= CANVAS_SPATIAL_INDEX_REBUILD_RATIO;

		if (visibleCount === 0) {
			if (this.itemById.size > 0) {
				this.tree.clear();
				this.itemById.clear();
			}
			this.snapshotById = nextSnapshotById;
			return;
		}

		if (shouldRebuild) {
			this.tree.clear();
			const nextItems = [...nextVisibleItemById.values()];
			if (nextItems.length > 0) {
				this.tree.load(nextItems);
			}
			this.itemById = nextVisibleItemById;
			this.snapshotById = nextSnapshotById;
			return;
		}

		if (removeIds.size > 0) {
			for (const nodeId of removeIds) {
				const item = this.itemById.get(nodeId);
				if (!item) continue;
				this.tree.remove(item);
				this.itemById.delete(nodeId);
			}
		}

		if (insertIds.size > 0) {
			const insertItems: CanvasSpatialItem[] = [];
			for (const nodeId of insertIds) {
				const item = nextVisibleItemById.get(nodeId);
				if (!item) continue;
				insertItems.push(item);
				this.itemById.set(nodeId, item);
			}
			if (insertItems.length > 0) {
				this.tree.load(insertItems);
			}
		}

		this.snapshotById = nextSnapshotById;
	}

	queryRect(rect: CanvasSpatialRect): CanvasSpatialItem[] {
		if (
			!Number.isFinite(rect.left) ||
			!Number.isFinite(rect.right) ||
			!Number.isFinite(rect.top) ||
			!Number.isFinite(rect.bottom)
		) {
			return [];
		}
		const normalized = normalizeRect(rect);
		return this.tree.search({
			minX: normalized.left,
			minY: normalized.top,
			maxX: normalized.right,
			maxY: normalized.bottom,
		});
	}

	queryPoint(x: number, y: number): CanvasSpatialItem[] {
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			return [];
		}
		return this.tree.search({
			minX: x,
			minY: y,
			maxX: x,
			maxY: y,
		});
	}
}
