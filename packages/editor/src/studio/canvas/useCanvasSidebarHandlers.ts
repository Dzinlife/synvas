import { useCallback } from "react";
import { useProjectStore } from "@/projects/projectStore";
import {
	type CanvasNodeLayoutSnapshot,
	useStudioHistoryStore,
} from "@/studio/history/studioHistoryStore";
import type { CanvasNode } from "@/studio/project/types";
import type {
	CanvasSidebarNodeReorderRequest,
	CanvasSidebarNodeSelectOptions,
} from "@/studio/canvas/sidebar/CanvasSidebar";
import {
	buildNodePanCamera,
	type CameraState,
	isCameraAlmostEqual,
	isLayoutEqual,
	pickLayout,
	SIDEBAR_VIEW_PADDING_PX,
} from "./canvasWorkspaceUtils";
import { toggleSelectedNodeIds } from "./canvasWorkspaceModel";
import {
	allocateBatchInsertSiblingOrder,
	resolveLayerSiblingCount,
	sortBySiblingOrder,
	sortByTreePaintOrder,
} from "./layerOrderCoordinator";

type CanvasSafeInsets = {
	top: number;
	right: number;
	bottom: number;
	left: number;
};

type UseCanvasSidebarHandlersParams = {
	isSidebarFocusMode: boolean;
	isCanvasInteractionLocked: boolean;
	focusedNodeId: string | null;
	normalizedSelectedNodeIds: string[];
	stageSize: { width: number; height: number };
	cameraSafeInsets: CanvasSafeInsets;
	getCamera: () => CameraState;
	applySmoothCameraWithCullLock: (nextCamera: CameraState) => void;
	handleNodeActivate: (node: CanvasNode) => void;
	commitSelectedNodeIds: (nodeIds: string[]) => void;
	resolveRootNodeIdsFromMovedSet: (
		nodes: CanvasNode[],
		movedNodeIds: string[],
	) => string[];
};

export const useCanvasSidebarHandlers = ({
	isSidebarFocusMode,
	isCanvasInteractionLocked,
	focusedNodeId,
	normalizedSelectedNodeIds,
	stageSize,
	cameraSafeInsets,
	getCamera,
	applySmoothCameraWithCullLock,
	handleNodeActivate,
	commitSelectedNodeIds,
	resolveRootNodeIdsFromMovedSet,
}: UseCanvasSidebarHandlersParams) => {
	const updateCanvasNodeLayoutBatch = useProjectStore(
		(state) => state.updateCanvasNodeLayoutBatch,
	);
	const pushHistory = useStudioHistoryStore((state) => state.push);

	const handleSidebarNodeSelect = useCallback(
		(node: CanvasNode, options?: CanvasSidebarNodeSelectOptions) => {
			const toggle = options?.toggle ?? false;
			if (toggle && !isSidebarFocusMode) {
				const canInteractNode =
					!isCanvasInteractionLocked || node.id === focusedNodeId;
				if (!canInteractNode) return;
				commitSelectedNodeIds(
					toggleSelectedNodeIds(normalizedSelectedNodeIds, node.id),
				);
				return;
			}
			handleNodeActivate(node);
			if (isSidebarFocusMode) return;
			if (stageSize.width <= 0 || stageSize.height <= 0) return;
			const currentCamera = getCamera();
			const nextCamera = buildNodePanCamera({
				node,
				camera: currentCamera,
				stageWidth: stageSize.width,
				stageHeight: stageSize.height,
				safeInsets: cameraSafeInsets,
				paddingPx: SIDEBAR_VIEW_PADDING_PX,
			});
			if (isCameraAlmostEqual(currentCamera, nextCamera)) return;
			applySmoothCameraWithCullLock(nextCamera);
		},
		[
			applySmoothCameraWithCullLock,
			cameraSafeInsets,
			commitSelectedNodeIds,
			focusedNodeId,
			getCamera,
			handleNodeActivate,
			isCanvasInteractionLocked,
			isSidebarFocusMode,
			normalizedSelectedNodeIds,
			stageSize.height,
			stageSize.width,
		],
	);

	const handleSidebarNodeReorder = useCallback(
		(request: CanvasSidebarNodeReorderRequest) => {
			if (isSidebarFocusMode) return;
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const allNodes = latestProject.canvas.nodes;
			const nodeById = new Map(allNodes.map((node) => [node.id, node]));
			const dragRootNodeIds = resolveRootNodeIdsFromMovedSet(
				allNodes,
				request.dragNodeIds,
			);
			if (dragRootNodeIds.length === 0) return;
			const movingNodeIdSet = new Set(dragRootNodeIds);
			const orderedDragNodeIds = sortByTreePaintOrder(
				dragRootNodeIds
					.map((nodeId) => nodeById.get(nodeId) ?? null)
					.filter((node): node is CanvasNode => Boolean(node)),
			).map((node) => node.id);
			if (orderedDragNodeIds.length === 0) return;
			const targetNode = request.targetNodeId
				? (nodeById.get(request.targetNodeId) ?? null)
				: null;
			let destinationParentId: string | null = null;
			let destinationIndex = 0;
			if (!targetNode) {
				destinationParentId = null;
				destinationIndex =
					request.position === "before"
						? resolveLayerSiblingCount(allNodes, null, movingNodeIdSet)
						: 0;
			} else if (request.position === "inside") {
				if (targetNode.type !== "board") return;
				destinationParentId = targetNode.id;
				destinationIndex = resolveLayerSiblingCount(
					allNodes,
					destinationParentId,
					movingNodeIdSet,
				);
			} else {
				destinationParentId = targetNode.parentId ?? null;
				const siblingNodes = sortBySiblingOrder(
					allNodes.filter((node) => {
						if (movingNodeIdSet.has(node.id)) return false;
						return (node.parentId ?? null) === destinationParentId;
					}),
				);
				const targetIndex = siblingNodes.findIndex(
					(sibling) => sibling.id === targetNode.id,
				);
				if (targetIndex < 0) return;
				destinationIndex =
					request.position === "before" ? targetIndex + 1 : targetIndex;
			}
			let ancestorId = destinationParentId;
			while (ancestorId) {
				if (movingNodeIdSet.has(ancestorId)) return;
				ancestorId = nodeById.get(ancestorId)?.parentId ?? null;
			}
			const { assignments, rebalancePatches } = allocateBatchInsertSiblingOrder(
				allNodes,
				{
					parentId: destinationParentId,
					index: destinationIndex,
					nodeIds: orderedDragNodeIds,
					movingNodeIds: movingNodeIdSet,
				},
			);
			const assignedZIndexByNodeId = new Map(
				assignments.map((assignment) => [
					assignment.nodeId,
					assignment.siblingOrder,
				]),
			);
			const rebalancedZIndexByNodeId = new Map(
				rebalancePatches.map((patch) => [patch.nodeId, patch.siblingOrder]),
			);
			const patchEntries = allNodes.reduce<
				Array<{
					nodeId: string;
					patch: {
						parentId?: string | null;
						siblingOrder?: number;
					};
				}>
			>((entries, node) => {
				const nextParentId = movingNodeIdSet.has(node.id)
					? destinationParentId
					: (node.parentId ?? null);
				const nextZIndex =
					assignedZIndexByNodeId.get(node.id) ??
					rebalancedZIndexByNodeId.get(node.id) ??
					node.siblingOrder;
				const patch: {
					parentId?: string | null;
					siblingOrder?: number;
				} = {};
				if ((node.parentId ?? null) !== nextParentId) {
					patch.parentId = nextParentId;
				}
				if (node.siblingOrder !== nextZIndex) {
					patch.siblingOrder = nextZIndex;
				}
				if (Object.keys(patch).length === 0) return entries;
				entries.push({
					nodeId: node.id,
					patch,
				});
				return entries;
			}, []);
			if (patchEntries.length === 0) return;
			const beforeByNodeId = new Map(
				patchEntries.map((entry) => {
					const node = nodeById.get(entry.nodeId);
					return [entry.nodeId, node ? pickLayout(node) : null] as const;
				}),
			);
			updateCanvasNodeLayoutBatch(patchEntries);
			const projectAfterReorder = useProjectStore.getState().currentProject;
			if (!projectAfterReorder) return;
			const historyEntries = patchEntries
				.map((entry) => {
					const before = beforeByNodeId.get(entry.nodeId);
					const afterNode = projectAfterReorder.canvas.nodes.find(
						(node) => node.id === entry.nodeId,
					);
					if (!before || !afterNode) return null;
					const after = pickLayout(afterNode);
					if (isLayoutEqual(before, after)) return null;
					return {
						nodeId: entry.nodeId,
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
			if (historyEntries.length > 0) {
				pushHistory({
					kind: "canvas.node-layout.batch",
					entries: historyEntries,
					focusNodeId: projectAfterReorder.ui.focusedNodeId,
				});
			}
			commitSelectedNodeIds(orderedDragNodeIds);
		},
		[
			commitSelectedNodeIds,
			isSidebarFocusMode,
			pushHistory,
			resolveRootNodeIdsFromMovedSet,
			updateCanvasNodeLayoutBatch,
		],
	);

	return {
		handleSidebarNodeReorder,
		handleSidebarNodeSelect,
	};
};
