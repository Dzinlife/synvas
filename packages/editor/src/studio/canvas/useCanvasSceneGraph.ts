import { useCallback, useMemo, useRef } from "react";
import type { CanvasNode, StudioProject } from "@/studio/project/types";
import type { CanvasNodeLabelHitTester } from "./CanvasNodeLabelLayer";
import {
	CANVAS_RENDER_CULL_OVERSCAN_SCREEN_PX,
	type CanvasRenderCullState,
	ENABLE_CANVAS_SPATIAL_INDEX_VALIDATION,
	isNodeIntersectRect,
	normalizeSelectedNodeIds,
	resolveCameraViewportWorldRect,
	warnCanvasSpatialIndexMismatch,
} from "./canvasWorkspaceModel";
import {
	CanvasSpatialIndex,
	compareCanvasSpatialPaintOrder,
} from "./canvasSpatialIndex";
import { buildLayerTreeOrder } from "./layerOrderCoordinator";

interface CanvasStageSize {
	width: number;
	height: number;
}

interface UseCanvasSceneGraphInput {
	project: StudioProject | null;
	selectedNodeIds: string[];
	activeNodeId: string | null;
	focusedNodeId: string | null;
	renderCullState: CanvasRenderCullState;
	stageSize: CanvasStageSize;
}

export const useCanvasSceneGraph = ({
	project,
	selectedNodeIds,
	activeNodeId,
	focusedNodeId,
	renderCullState,
	stageSize,
}: UseCanvasSceneGraphInput) => {
	const allCanvasNodes = useMemo(() => {
		return project?.canvas.nodes ?? [];
	}, [project]);
	const layerTreeOrder = useMemo(() => {
		return buildLayerTreeOrder(allCanvasNodes);
	}, [allCanvasNodes]);
	const compareCanvasNodePaintOrder = useCallback(
		(left: CanvasNode, right: CanvasNode): number => {
			const leftIndex =
				layerTreeOrder.paintOrderByNodeId.get(left.id) ??
				Number.MAX_SAFE_INTEGER;
			const rightIndex =
				layerTreeOrder.paintOrderByNodeId.get(right.id) ??
				Number.MAX_SAFE_INTEGER;
			if (leftIndex !== rightIndex) return leftIndex - rightIndex;
			return left.id.localeCompare(right.id);
		},
		[layerTreeOrder],
	);
	const compareCanvasNodeHitPriority = useCallback(
		(left: CanvasNode, right: CanvasNode): number => {
			const leftIsBoard = left.type === "board";
			const rightIsBoard = right.type === "board";
			if (leftIsBoard !== rightIsBoard) {
				return leftIsBoard ? 1 : -1;
			}
			const leftIndex =
				layerTreeOrder.hitOrderByNodeId.get(left.id) ?? Number.MAX_SAFE_INTEGER;
			const rightIndex =
				layerTreeOrder.hitOrderByNodeId.get(right.id) ??
				Number.MAX_SAFE_INTEGER;
			if (leftIndex !== rightIndex) return leftIndex - rightIndex;
			return right.id.localeCompare(left.id);
		},
		[layerTreeOrder],
	);
	const sortedNodes = useMemo(() => {
		return [...allCanvasNodes]
			.filter((node) => !node.hidden)
			.sort(compareCanvasNodePaintOrder);
	}, [allCanvasNodes, compareCanvasNodePaintOrder]);
	const nodeById = useMemo(() => {
		return new Map(allCanvasNodes.map((node) => [node.id, node]));
	}, [allCanvasNodes]);
	const spatialIndexRef = useRef<CanvasSpatialIndex | null>(null);
	const labelHitTesterRef = useRef<CanvasNodeLabelHitTester | null>(null);
	const spatialIndex = useMemo(() => {
		if (!spatialIndexRef.current) {
			spatialIndexRef.current = new CanvasSpatialIndex();
		}
		spatialIndexRef.current.sync(allCanvasNodes);
		return spatialIndexRef.current;
	}, [allCanvasNodes]);
	const handleLabelHitTesterChange = useCallback(
		(tester: CanvasNodeLabelHitTester | null) => {
			labelHitTesterRef.current = tester;
		},
		[],
	);
	const currentNodeIdSet = useMemo(() => {
		return new Set(allCanvasNodes.map((node) => node.id));
	}, [allCanvasNodes]);
	const normalizedSelectedNodeIds = useMemo(() => {
		return normalizeSelectedNodeIds(selectedNodeIds, currentNodeIdSet);
	}, [currentNodeIdSet, selectedNodeIds]);

	const focusedNode = useMemo(() => {
		if (!focusedNodeId) return null;
		return (
			project?.canvas.nodes.find((node) => node.id === focusedNodeId) ?? null
		);
	}, [project, focusedNodeId]);

	const activeNode = useMemo(() => {
		if (!activeNodeId) return null;
		return (
			project?.canvas.nodes.find((node) => node.id === activeNodeId) ?? null
		);
	}, [activeNodeId, project]);

	const {
		camera: renderCullCamera,
		lockedViewportRect,
		mode: renderCullMode,
	} = renderCullState;
	const renderNodes = useMemo(() => {
		if (sortedNodes.length === 0) return [];
		const viewportRect =
			renderCullMode === "locked"
				? lockedViewportRect
				: resolveCameraViewportWorldRect(
						renderCullCamera,
						stageSize.width,
						stageSize.height,
						CANVAS_RENDER_CULL_OVERSCAN_SCREEN_PX,
					);
		if (!viewportRect) return sortedNodes;
		const forcedNodeIds = new Set(normalizedSelectedNodeIds);
		if (activeNodeId) {
			forcedNodeIds.add(activeNodeId);
		}
		if (focusedNodeId) {
			forcedNodeIds.add(focusedNodeId);
		}
		const indexedVisibleNodeById = new Map<string, CanvasNode>();
		const indexedItems = [...spatialIndex.queryRect(viewportRect)].sort(
			compareCanvasSpatialPaintOrder,
		);
		for (const item of indexedItems) {
			const node = nodeById.get(item.nodeId);
			if (!node || node.hidden) continue;
			if (!isNodeIntersectRect(node, viewportRect)) continue;
			indexedVisibleNodeById.set(node.id, node);
		}
		for (const forcedNodeId of forcedNodeIds) {
			const node = nodeById.get(forcedNodeId);
			if (!node || node.hidden) continue;
			indexedVisibleNodeById.set(node.id, node);
		}
		const nextRenderNodes = [...indexedVisibleNodeById.values()].sort(
			compareCanvasNodePaintOrder,
		);
		if (ENABLE_CANVAS_SPATIAL_INDEX_VALIDATION) {
			const legacyRenderNodeIds = sortedNodes
				.filter((node) => {
					if (forcedNodeIds.has(node.id)) return true;
					return isNodeIntersectRect(node, viewportRect);
				})
				.map((node) => node.id);
			warnCanvasSpatialIndexMismatch(
				"render-cull",
				legacyRenderNodeIds,
				nextRenderNodes.map((node) => node.id),
			);
		}
		return nextRenderNodes;
	}, [
		activeNodeId,
		focusedNodeId,
		nodeById,
		normalizedSelectedNodeIds,
		renderCullCamera,
		lockedViewportRect,
		renderCullMode,
		spatialIndex,
		sortedNodes,
		stageSize.height,
		stageSize.width,
		compareCanvasNodePaintOrder,
	]);

	return {
		allCanvasNodes,
		compareCanvasNodeHitPriority,
		currentNodeIdSet,
		focusedNode,
		activeNode,
		handleLabelHitTesterChange,
		labelHitTesterRef,
		nodeById,
		normalizedSelectedNodeIds,
		renderNodes,
		sortedNodes,
		spatialIndex,
	};
};
