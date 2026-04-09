import type { TimelineAsset } from "core/element/types";
import type {
	CanvasNode,
	SceneDocument,
	StudioProject,
} from "core/studio/types";
import { useEffect, useEffectEvent, useRef } from "react";
import { writeProjectFileToOpfsAtPath } from "@/lib/projectOpfsStorage";
import { useProjectStore } from "@/projects/projectStore";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import { getCanvasNodeDefinition } from "./node-system/registry";
import {
	NODE_THUMBNAIL_FRAME,
	NODE_THUMBNAIL_VERSION,
} from "./node-system/thumbnail/utils";
import type { CanvasNodeThumbnailCapabilityContext } from "./node-system/types";

interface UseNodeThumbnailGenerationOptions {
	project: StudioProject | null;
	projectId: string | null;
	runtimeManager: StudioRuntimeManager | null;
}

interface ThumbnailTask {
	key: string;
	nodeId: string;
	nodeType: CanvasNode["type"];
	sourceSignature: string;
}

type ScheduledDrainHandle =
	| {
			kind: "idle";
			id: number;
	  }
	| {
			kind: "timeout";
			id: number;
	  }
	| null;

const resolveNodeScene = (
	project: StudioProject,
	node: CanvasNode,
): SceneDocument | null => {
	if (node.type !== "scene") return null;
	return project.scenes[node.sceneId] ?? null;
};

const resolveNodeAsset = (
	project: StudioProject,
	node: CanvasNode,
): TimelineAsset | null => {
	if (!("assetId" in node)) return null;
	if (!node.assetId) return null;
	return project.assets.find((asset) => asset.id === node.assetId) ?? null;
};

const buildThumbnailCapabilityContext = (
	project: StudioProject,
	node: CanvasNode,
	runtimeManager: StudioRuntimeManager | null,
): CanvasNodeThumbnailCapabilityContext<CanvasNode> => {
	return {
		node,
		project,
		scene: resolveNodeScene(project, node),
		asset: resolveNodeAsset(project, node),
		runtimeManager,
	};
};

const isThumbnailFresh = (
	project: StudioProject,
	node: CanvasNode,
	sourceSignature: string,
): boolean => {
	const thumbnail = node.thumbnail;
	if (!thumbnail) return false;
	if (thumbnail.version !== NODE_THUMBNAIL_VERSION) return false;
	if (thumbnail.frame !== NODE_THUMBNAIL_FRAME) return false;
	if (thumbnail.sourceSignature !== sourceSignature) return false;
	return project.assets.some((asset) => asset.id === thumbnail.assetId);
};

const buildTaskKey = (nodeId: string, sourceSignature: string): string => {
	return `${nodeId}:${sourceSignature}`;
};

const resolveThumbnailPath = (nodeId: string): string => {
	return `.thumbs/node-${nodeId}.webp`;
};

export const useNodeThumbnailGeneration = (
	options: UseNodeThumbnailGenerationOptions,
): void => {
	const { project, projectId, runtimeManager } = options;
	const ensureProjectAsset = useProjectStore(
		(state) => state.ensureProjectAsset,
	);
	const updateCanvasNode = useProjectStore((state) => state.updateCanvasNode);
	const queueRef = useRef<ThumbnailTask[]>([]);
	const queuedTaskKeySetRef = useRef(new Set<string>());
	const activeTaskKeySetRef = useRef(new Set<string>());
	const runningRef = useRef(false);
	const scheduledDrainRef = useRef<ScheduledDrainHandle>(null);
	const scheduleDrainRef = useRef<() => void>(() => {});
	const disposedRef = useRef(false);

	const clearScheduledDrain = useEffectEvent(() => {
		const scheduled = scheduledDrainRef.current;
		if (!scheduled) return;
		if (scheduled.kind === "idle") {
			window.cancelIdleCallback?.(scheduled.id);
		} else {
			window.clearTimeout(scheduled.id);
		}
		scheduledDrainRef.current = null;
	});

	useEffect(() => {
		disposedRef.current = false;
		return () => {
			disposedRef.current = true;
			clearScheduledDrain();
			queueRef.current = [];
			queuedTaskKeySetRef.current.clear();
			activeTaskKeySetRef.current.clear();
		};
	}, [clearScheduledDrain]);

	const processTask = useEffectEvent(async (task: ThumbnailTask) => {
		const storeState = useProjectStore.getState();
		const latestProject = storeState.currentProject;
		const latestProjectId = storeState.currentProjectId;
		if (!latestProject || latestProjectId !== projectId) return;
		const node = latestProject.canvas.nodes.find(
			(item) => item.id === task.nodeId && item.type === task.nodeType,
		);
		if (!node) return;
		const definition = getCanvasNodeDefinition(node.type);
		const capability = definition.thumbnail;
		if (!capability) return;
		const context = buildThumbnailCapabilityContext(
			latestProject,
			node,
			runtimeManager,
		);
		const sourceSignature = capability.getSourceSignature(context);
		if (!sourceSignature || sourceSignature !== task.sourceSignature) return;
		if (isThumbnailFresh(latestProject, node, sourceSignature)) return;

		let generated:
			| Awaited<ReturnType<typeof capability.generate>>
			| null
			| undefined = null;
		try {
			generated = await capability.generate(context);
		} catch {
			return;
		}
		if (!generated || generated.sourceSignature !== sourceSignature) return;

		const projectAfterGenerate = useProjectStore.getState().currentProject;
		if (!projectAfterGenerate || projectAfterGenerate.id !== latestProject.id) {
			return;
		}
		const nodeAfterGenerate = projectAfterGenerate.canvas.nodes.find(
			(item) => item.id === node.id && item.type === node.type,
		);
		if (!nodeAfterGenerate) return;
		const contextAfterGenerate = buildThumbnailCapabilityContext(
			projectAfterGenerate,
			nodeAfterGenerate,
			runtimeManager,
		);
		const latestSourceSignature =
			capability.getSourceSignature(contextAfterGenerate);
		if (!latestSourceSignature || latestSourceSignature !== sourceSignature) {
			return;
		}
		if (
			isThumbnailFresh(projectAfterGenerate, nodeAfterGenerate, sourceSignature)
		) {
			return;
		}

		try {
			const relativePath = resolveThumbnailPath(node.id);
			const file = new File(
				[generated.blob],
				relativePath.split("/").at(-1) ?? "thumbnail.webp",
				{
					type: generated.blob.type || "image/webp",
				},
			);
			const writeResult = await writeProjectFileToOpfsAtPath(
				file,
				projectAfterGenerate.id,
				"images",
				relativePath,
			);
			const assetId = ensureProjectAsset({
				kind: "image",
				name: `${nodeAfterGenerate.name} Thumbnail`,
				locator: {
					type: "managed",
					fileName: writeResult.fileName,
				},
				meta: {
					hash: writeResult.hash,
					fileName: writeResult.fileName,
					...(generated.sourceSize
						? {
								sourceSize: generated.sourceSize,
							}
						: {}),
					thumbnail: {
						nodeId: nodeAfterGenerate.id,
						nodeType: nodeAfterGenerate.type,
						sourceSignature,
					},
				},
			});
			updateCanvasNode(nodeAfterGenerate.id, {
				thumbnail: {
					assetId,
					sourceSignature,
					frame: generated.frame,
					generatedAt: Date.now(),
					version: NODE_THUMBNAIL_VERSION,
				},
			});
		} catch {
			return;
		}
	});

	const drainQueue = useEffectEvent(async () => {
		clearScheduledDrain();
		if (runningRef.current || disposedRef.current) return;
		runningRef.current = true;
		try {
			while (!disposedRef.current) {
				const task = queueRef.current.shift();
				if (!task) break;
				queuedTaskKeySetRef.current.delete(task.key);
				activeTaskKeySetRef.current.add(task.key);
				try {
					await processTask(task);
				} finally {
					activeTaskKeySetRef.current.delete(task.key);
				}
			}
		} finally {
			runningRef.current = false;
			if (queueRef.current.length > 0) {
				scheduleDrainRef.current();
			}
		}
	});

	const scheduleDrain = useEffectEvent(() => {
		if (disposedRef.current) return;
		if (runningRef.current) return;
		if (queueRef.current.length === 0) return;
		if (scheduledDrainRef.current) return;
		if (typeof window.requestIdleCallback === "function") {
			const id = window.requestIdleCallback(
				() => {
					scheduledDrainRef.current = null;
					void drainQueue();
				},
				{ timeout: 1000 },
			);
			scheduledDrainRef.current = {
				kind: "idle",
				id,
			};
			return;
		}
		const id = window.setTimeout(() => {
			scheduledDrainRef.current = null;
			void drainQueue();
		}, 16);
		scheduledDrainRef.current = {
			kind: "timeout",
			id,
		};
	});
	scheduleDrainRef.current = scheduleDrain;

	useEffect(() => {
		if (!project || !projectId) return;
		for (const node of project.canvas.nodes) {
			const definition = getCanvasNodeDefinition(node.type);
			const capability = definition.thumbnail;
			if (!capability) continue;
			const context = buildThumbnailCapabilityContext(
				project,
				node,
				runtimeManager,
			);
			const sourceSignature = capability.getSourceSignature(context);
			if (!sourceSignature) continue;
			if (isThumbnailFresh(project, node, sourceSignature)) continue;
			const taskKey = buildTaskKey(node.id, sourceSignature);
			if (
				queuedTaskKeySetRef.current.has(taskKey) ||
				activeTaskKeySetRef.current.has(taskKey)
			) {
				continue;
			}
			queuedTaskKeySetRef.current.add(taskKey);
			queueRef.current.push({
				key: taskKey,
				nodeId: node.id,
				nodeType: node.type,
				sourceSignature,
			});
		}
		scheduleDrain();
	}, [project, projectId, runtimeManager, scheduleDrain]);
};
