import type React from "react";
import { useCallback } from "react";
import { ingestExternalFileAsset } from "@/projects/assetIngest";
import { useProjectStore } from "@/projects/projectStore";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import type { SceneDocument } from "@/studio/project/types";
import { canvasNodeDefinitionList } from "@/node-system/registry";
import {
	DROP_GRID_COLUMNS,
	DROP_GRID_OFFSET_X,
	DROP_GRID_OFFSET_Y,
	resolveDroppedFiles,
} from "./canvasWorkspaceUtils";

type UseCanvasExternalFileDropParams = {
	currentProjectId: string | null;
	scenes: Record<string, SceneDocument>;
	activeSceneId: string | null;
	resolveWorldPoint: (
		clientX: number,
		clientY: number,
	) => {
		x: number;
		y: number;
	};
};

export const useCanvasExternalFileDrop = ({
	currentProjectId,
	scenes,
	activeSceneId,
	resolveWorldPoint,
}: UseCanvasExternalFileDropParams) => {
	const createCanvasNode = useProjectStore((state) => state.createCanvasNode);
	const ensureProjectAsset = useProjectStore(
		(state) => state.ensureProjectAsset,
	);
	const updateProjectAssetMeta = useProjectStore(
		(state) => state.updateProjectAssetMeta,
	);
	const pushHistory = useStudioHistoryStore((state) => state.push);

	return useCallback(
		async (event: React.DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			if (!currentProjectId) return;
			const files = resolveDroppedFiles(event.dataTransfer);
			if (files.length === 0) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			const activeSceneTimeline =
				(activeSceneId ? scenes[activeSceneId]?.timeline : undefined) ??
				Object.values(scenes)[0]?.timeline;
			const fps = activeSceneTimeline?.fps ?? 30;

			const ingestExternalFile = (
				file: File,
				kind: "video" | "audio" | "image",
			) => {
				return ingestExternalFileAsset({
					file,
					kind,
					projectId: currentProjectId,
				});
			};

			const nodeInputs: Array<{
				input: Parameters<typeof createCanvasNode>[0];
				index: number;
			}> = [];

			for (const [index, file] of files.entries()) {
				let resolvedInput: Parameters<typeof createCanvasNode>[0] | null = null;
				for (const definition of canvasNodeDefinitionList) {
					if (!definition.fromExternalFile) continue;
					const matched = await definition.fromExternalFile(file, {
						projectId: currentProjectId,
						fps,
						ensureProjectAsset,
						updateProjectAssetMeta,
						ingestExternalFileAsset: ingestExternalFile,
					});
					if (!matched) continue;
					resolvedInput = matched;
					break;
				}
				if (!resolvedInput) continue;
				nodeInputs.push({ input: resolvedInput, index });
			}

			for (const item of nodeInputs) {
				const column = item.index % DROP_GRID_COLUMNS;
				const row = Math.floor(item.index / DROP_GRID_COLUMNS);
				const nodeId = createCanvasNode({
					...item.input,
					x: world.x + column * DROP_GRID_OFFSET_X,
					y: world.y + row * DROP_GRID_OFFSET_Y,
				});
				const latestProject = useProjectStore.getState().currentProject;
				if (!latestProject) continue;
				const node = latestProject.canvas.nodes.find(
					(candidate) => candidate.id === nodeId,
				);
				if (!node) continue;
				if (node.type === "scene") continue;
				pushHistory({
					kind: "canvas.node-create",
					node,
					focusNodeId: latestProject.ui.focusedNodeId,
				});
			}
		},
		[
			activeSceneId,
			createCanvasNode,
			currentProjectId,
			ensureProjectAsset,
			pushHistory,
			resolveWorldPoint,
			scenes,
			updateProjectAssetMeta,
		],
	);
};
