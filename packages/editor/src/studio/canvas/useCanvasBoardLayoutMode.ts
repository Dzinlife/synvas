import { useCallback } from "react";
import { useProjectStore } from "@/projects/projectStore";
import {
	type CanvasNodeLayoutSnapshot,
	useStudioHistoryStore,
} from "@/studio/history/studioHistoryStore";
import type { BoardCanvasNode, CanvasNode } from "@/studio/project/types";
import {
	type CanvasBoardAutoLayoutPatch,
	deriveCanvasBoardAutoLayoutRows,
} from "./canvasBoardAutoLayout";
import { isLayoutEqual, pickLayout } from "./canvasWorkspaceUtils";

type ResolveAutoLayoutEntriesForChangedNodes = (
	nodes: CanvasNode[],
	changedNodeIds: string[],
	options?: {
		rowsByBoardId?: Map<string, string[][]>;
		extraBoardIds?: string[];
	},
) => CanvasBoardAutoLayoutPatch[];

type UseCanvasBoardLayoutModeParams = {
	commitCanvasAutoLayoutEntries: (
		entries: CanvasBoardAutoLayoutPatch[],
		options?: { frozenNodeIds?: string[] },
	) => void;
	resolveAutoLayoutEntriesForChangedNodes: ResolveAutoLayoutEntriesForChangedNodes;
};

export const useCanvasBoardLayoutMode = ({
	commitCanvasAutoLayoutEntries,
	resolveAutoLayoutEntriesForChangedNodes,
}: UseCanvasBoardLayoutModeParams) => {
	const updateCanvasNode = useProjectStore((state) => state.updateCanvasNode);
	const pushHistory = useStudioHistoryStore((state) => state.push);

	return useCallback(
		(nodeId: string, mode: "free" | "auto") => {
			const latestProject = useProjectStore.getState().currentProject;
			const board =
				latestProject?.canvas.nodes.find(
					(node): node is BoardCanvasNode =>
						node.id === nodeId && node.type === "board",
				) ?? null;
			if (!latestProject || !board) return;
			const currentMode = board.layoutMode === "auto" ? "auto" : "free";
			if (currentMode === mode) return;
			const beforeBoard = board;
			const afterBoard = {
				...board,
				layoutMode: mode,
			};
			updateCanvasNode(nodeId, { layoutMode: mode } as never);
			pushHistory({
				kind: "canvas.node-update",
				nodeId,
				before: beforeBoard,
				after: afterBoard,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
			if (mode !== "auto") return;
			const projectBeforeLayout = useProjectStore.getState().currentProject;
			if (!projectBeforeLayout) return;
			const rows = deriveCanvasBoardAutoLayoutRows(
				projectBeforeLayout.canvas.nodes,
				nodeId,
			);
			const autoLayoutEntries = resolveAutoLayoutEntriesForChangedNodes(
				projectBeforeLayout.canvas.nodes,
				[],
				{
					rowsByBoardId: new Map([[nodeId, rows]]),
					extraBoardIds: [nodeId],
				},
			);
			if (autoLayoutEntries.length === 0) return;
			const beforeByNodeId = new Map(
				autoLayoutEntries.map((entry) => {
					const node =
						projectBeforeLayout.canvas.nodes.find(
							(candidate) => candidate.id === entry.nodeId,
						) ?? null;
					return [entry.nodeId, node ? pickLayout(node) : null] as const;
				}),
			);
			commitCanvasAutoLayoutEntries(autoLayoutEntries);
			const projectAfterLayout = useProjectStore.getState().currentProject;
			if (!projectAfterLayout) return;
			const historyEntries = autoLayoutEntries
				.map((entry) => {
					const before = beforeByNodeId.get(entry.nodeId);
					const afterNode =
						projectAfterLayout.canvas.nodes.find(
							(candidate) => candidate.id === entry.nodeId,
						) ?? null;
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
			if (historyEntries.length === 0) return;
			pushHistory({
				kind: "canvas.node-layout.batch",
				entries: historyEntries,
				focusNodeId: projectAfterLayout.ui.focusedNodeId,
			});
		},
		[
			commitCanvasAutoLayoutEntries,
			pushHistory,
			resolveAutoLayoutEntriesForChangedNodes,
			updateCanvasNode,
		],
	);
};
