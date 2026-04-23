import type { TimelineJSON } from "core/timeline-system/loader";
import type { TimelineAsset } from "core/timeline-system/types";
import {
	clearSceneTombstone,
	ensureStudioProjectOt,
	writeSceneTombstone,
} from "@/studio/project/ot";
import { parseStudioProject } from "@/studio/project/schema";
import type {
	CanvasNode,
	SceneDocument,
	SceneNode,
	StudioOtTombstoneScene,
	StudioProject,
} from "@/studio/project/types";
import { create } from "zustand";
import {
	getCanvasCamera,
	setCanvasCameraFromProject,
} from "@/studio/canvas/cameraStore";
import {
	allocateInsertSiblingOrder,
	resolveLayerSiblingCount,
} from "@/studio/canvas/layerOrderCoordinator";
import { resolveDeletedSceneIdsToRetain } from "@/studio/scene/sceneComposition";
import { isSameAssetLocator, normalizeAssetLocator } from "./assetLocator";
import {
	buildAutoProjectName,
	buildEmptyProject,
	getAllProjects,
	getCurrentProjectId,
	getProject,
	type ProjectRecord,
	putProject,
	setCurrentProjectId,
} from "./projectDb";

const DEFAULT_SCENE_NODE_WIDTH = 960;
const DEFAULT_SCENE_NODE_HEIGHT = 540;

export interface ProjectSummary {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
}

type ProjectStatus = "idle" | "loading" | "ready" | "error";

interface UpdateSceneTimelineOptions {
	recordHistory?: boolean;
	txnId?: string;
	historyOpId?: string;
}

export interface CanvasNodeLayoutPatch {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	siblingOrder?: number;
	hidden?: boolean;
	locked?: boolean;
	parentId?: string | null;
}

export interface CanvasNodeLayoutBatchEntry {
	nodeId: string;
	patch: CanvasNodeLayoutPatch;
}

export interface SceneCreateInput {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	name?: string;
	parentId?: string | null;
	insertIndex?: number;
}

type CanvasNodePatch = Partial<
	Omit<CanvasNode, "id" | "createdAt" | "type" | "sceneId">
>;

export type CanvasNodeCreateInput =
	| ({
			type: "scene";
	  } & SceneCreateInput)
	| {
			type: Exclude<CanvasNode["type"], "scene">;
			x?: number;
			y?: number;
			width?: number;
			height?: number;
			name?: string;
			parentId?: string | null;
			insertIndex?: number;
			assetId?: string;
			duration?: number;
			text?: string;
			fontSize?: number;
	  };

export interface EnsureProjectAssetInput {
	kind: TimelineAsset["kind"];
	name: string;
	locator: TimelineAsset["locator"];
	meta?: TimelineAsset["meta"];
}

export interface CanvasGraphBatchEntry {
	node: CanvasNode;
	scene?: SceneDocument;
}

interface RestoreDetachedSceneNodeOptions {
	layoutOverride?: CanvasNodeLayoutPatch;
}

interface ProjectStoreState {
	status: ProjectStatus;
	projects: ProjectSummary[];
	currentProjectId: string | null;
	currentProject: StudioProject | null;
	focusedSceneDrafts: Record<string, TimelineJSON>;
	sceneTimelineMutationOpIds: Record<string, string | undefined>;
	error: string | null;
	initialize: () => Promise<void>;
	createProject: () => Promise<void>;
	saveCurrentProject: () => Promise<void>;
	switchProject: (id: string) => Promise<void>;
	createCanvasNode: (input: CanvasNodeCreateInput) => string;
	updateCanvasNode: (nodeId: string, patch: CanvasNodePatch) => void;
	updateCanvasNodeLayout: (
		nodeId: string,
		patch: CanvasNodeLayoutPatch,
	) => void;
	updateCanvasNodeLayoutBatch: (entries: CanvasNodeLayoutBatchEntry[]) => void;
	setActiveNode: (nodeId: string | null) => void;
	createSceneNode: (input?: SceneCreateInput) => string;
	updateSceneNodeLayout: (nodeId: string, patch: CanvasNodeLayoutPatch) => void;
	ensureProjectAsset: (input: EnsureProjectAssetInput) => string;
	getProjectAssetById: (assetId: string) => TimelineAsset | null;
	updateProjectAssetMeta: (
		assetId: string,
		updater: (
			prev: TimelineAsset["meta"] | undefined,
		) => TimelineAsset["meta"] | undefined,
	) => void;
	setFocusedNode: (nodeId: string | null) => void;
	setActiveScene: (sceneId: string | null) => void;
	setCanvasSnapEnabled: (enabled: boolean) => void;
	updateSceneTimeline: (
		sceneId: string,
		timeline: TimelineJSON,
		options?: UpdateSceneTimelineOptions,
	) => void;
	updateScenePosterFrame: (sceneId: string, posterFrame: number) => void;
	updateActiveSceneTimeline: (
		timeline: TimelineJSON,
		options?: UpdateSceneTimelineOptions,
	) => void;
	setFocusedSceneDraft: (sceneId: string, timeline: TimelineJSON) => void;
	flushFocusedSceneDraft: () => void;
	removeCanvasNodeForHistory: (nodeId: string) => void;
	restoreCanvasNodeForHistory: (node: CanvasNode) => void;
	appendCanvasGraphBatch: (entries: CanvasGraphBatchEntry[]) => void;
	removeCanvasGraphBatch: (
		entriesOrNodeIds: CanvasGraphBatchEntry[] | string[],
	) => void;
	getSceneTombstone: (sceneId: string) => StudioOtTombstoneScene | null;
	removeSceneNodeForHistory: (sceneId: string, nodeId: string) => void;
	restoreDetachedSceneNodeForHistory: (
		node: SceneNode,
		options?: RestoreDetachedSceneNodeOptions,
	) => void;
	removeSceneGraphForHistory: (sceneId: string, nodeId: string) => void;
	restoreSceneGraphForHistory: (scene: SceneDocument, node: SceneNode) => void;
}

const sortProjectRecords = (records: ProjectRecord[]): ProjectRecord[] => {
	return [...records].sort((a, b) => {
		if (a.updatedAt !== b.updatedAt) {
			return b.updatedAt - a.updatedAt;
		}
		return b.createdAt - a.createdAt;
	});
};

const sortProjectSummaries = (projects: ProjectSummary[]): ProjectSummary[] => {
	return [...projects].sort((a, b) => {
		if (a.updatedAt !== b.updatedAt) {
			return b.updatedAt - a.updatedAt;
		}
		return b.createdAt - a.createdAt;
	});
};

const toSummary = (record: ProjectRecord): ProjectSummary => ({
	id: record.id,
	name: record.name,
	createdAt: record.createdAt,
	updatedAt: record.updatedAt,
});

const createProjectId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `project-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const createEntityId = (prefix: string): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const createAssetId = (): string => createEntityId("asset");

const normalizeAssetName = (name: string): string => {
	const trimmed = name.trim();
	if (!trimmed) {
		throw new Error("Asset name is required.");
	}
	return trimmed;
};

const normalizeAssetHash = (hash: unknown): string | null => {
	if (typeof hash !== "string") return null;
	const trimmed = hash.trim().toLowerCase();
	return trimmed.length > 0 ? trimmed : null;
};

const normalizeAssetMeta = (
	meta: TimelineAsset["meta"] | undefined,
): TimelineAsset["meta"] | undefined => {
	if (!meta) return undefined;
	const normalized: TimelineAsset["meta"] = { ...meta };
	const hash = normalizeAssetHash(normalized.hash);
	if (hash) {
		normalized.hash = hash;
	} else {
		delete normalized.hash;
	}
	if (typeof normalized.fileName === "string") {
		const trimmed = normalized.fileName.trim();
		if (trimmed) {
			normalized.fileName = trimmed;
		} else {
			delete normalized.fileName;
		}
	}
	return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const mergeAssetMeta = (
	existed: TimelineAsset["meta"] | undefined,
	input: TimelineAsset["meta"] | undefined,
): TimelineAsset["meta"] | undefined => {
	if (!input) return existed;
	if (!existed) return input;
	return {
		...existed,
		...input,
	};
};

const isSameAssetMeta = (
	left: TimelineAsset["meta"] | undefined,
	right: TimelineAsset["meta"] | undefined,
): boolean => {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
};

const DEFAULT_IMAGE_NODE_WIDTH = 640;
const DEFAULT_IMAGE_NODE_HEIGHT = 360;
const DEFAULT_VIDEO_NODE_WIDTH = 640;
const DEFAULT_VIDEO_NODE_HEIGHT = 360;
const DEFAULT_AUDIO_NODE_WIDTH = 640;
const DEFAULT_AUDIO_NODE_HEIGHT = 180;
const DEFAULT_TEXT_NODE_WIDTH = 500;
const DEFAULT_TEXT_NODE_HEIGHT = 160;
const DEFAULT_TEXT_FONT_SIZE = 48;
const DEFAULT_FRAME_NODE_WIDTH = 960;
const DEFAULT_FRAME_NODE_HEIGHT = 540;

const repairCanvasNodeParentRelations = (nodes: CanvasNode[]): CanvasNode[] => {
	if (nodes.length === 0) return nodes;
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const parentById = new Map<string, string | null>();
	for (const node of nodes) {
		const rawParentId = node.parentId ?? null;
		if (!rawParentId || rawParentId === node.id) {
			parentById.set(node.id, null);
			continue;
		}
		const parentNode = nodeById.get(rawParentId);
		if (!parentNode || parentNode.type !== "frame") {
			parentById.set(node.id, null);
			continue;
		}
		parentById.set(node.id, rawParentId);
	}
	const cycleNodeIds = new Set<string>();
	for (const node of nodes) {
		let currentNodeId: string | null = node.id;
		const chain: string[] = [];
		const indexByNodeId = new Map<string, number>();
		while (currentNodeId) {
			if (cycleNodeIds.has(currentNodeId)) break;
			const existingIndex = indexByNodeId.get(currentNodeId);
			if (existingIndex !== undefined) {
				for (let index = existingIndex; index < chain.length; index += 1) {
					const cycleNodeId = chain[index];
					if (cycleNodeId) {
						cycleNodeIds.add(cycleNodeId);
					}
				}
				break;
			}
			indexByNodeId.set(currentNodeId, chain.length);
			chain.push(currentNodeId);
			currentNodeId = parentById.get(currentNodeId) ?? null;
		}
	}
	for (const cycleNodeId of cycleNodeIds) {
		parentById.set(cycleNodeId, null);
	}
	let hasChanged = false;
	const nextNodes = nodes.map((node) => {
		const nextParentId = parentById.get(node.id) ?? null;
		const currentParentId = node.parentId ?? null;
		if (nextParentId === currentParentId) {
			return node;
		}
		hasChanged = true;
		return {
			...node,
			parentId: nextParentId,
		};
	});
	return hasChanged ? nextNodes : nodes;
};

const normalizeCanvasNodeSiblingOrder = (nodes: CanvasNode[]): CanvasNode[] => {
	if (nodes.length === 0) return nodes;
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const siblingsByParentId = new Map<string | null, CanvasNode[]>();
	for (const node of nodes) {
		const rawParentId = node.parentId ?? null;
		const parentId =
			rawParentId && nodeById.has(rawParentId) ? rawParentId : null;
		const siblings = siblingsByParentId.get(parentId) ?? [];
		siblings.push(node);
		siblingsByParentId.set(parentId, siblings);
	}
	const siblingOrderByNodeId = new Map<string, number>();
	for (const siblings of siblingsByParentId.values()) {
		// 保留历史小数层级，只对纯整数分组做致密化。
		if (siblings.some((node) => !Number.isInteger(node.siblingOrder))) {
			continue;
		}
		[...siblings]
			.sort((left, right) => {
				if (left.siblingOrder !== right.siblingOrder) {
					return left.siblingOrder - right.siblingOrder;
				}
				return left.id.localeCompare(right.id);
			})
			.forEach((node, index) => {
				siblingOrderByNodeId.set(node.id, index);
			});
	}
	let hasChanged = false;
	const nextNodes = nodes.map((node) => {
		const nextSiblingOrder = siblingOrderByNodeId.get(node.id);
		if (nextSiblingOrder === undefined || node.siblingOrder === nextSiblingOrder) {
			return node;
		}
		hasChanged = true;
		return {
			...node,
			siblingOrder: nextSiblingOrder,
		};
	});
	return hasChanged ? nextNodes : nodes;
};

const findSceneNodeBySceneId = (
	project: StudioProject,
	sceneId: string | null | undefined,
): SceneNode | null => {
	if (!sceneId) return null;
	const found = project.canvas.nodes.find(
		(node): node is SceneNode =>
			node.type === "scene" && node.sceneId === sceneId,
	);
	return found ?? null;
};

const getSceneTombstoneFromProject = (
	project: StudioProject,
	sceneId: string | null | undefined,
): StudioOtTombstoneScene | null => {
	if (!sceneId) return null;
	return project.ot?.tombstones.scenes[sceneId] ?? null;
};

const cloneTimelineJson = (timeline: TimelineJSON): TimelineJSON => {
	return JSON.parse(JSON.stringify(timeline)) as TimelineJSON;
};

const createDefaultTimeline = (): TimelineJSON => {
	const project = buildEmptyProject(createProjectId());
	const activeSceneId = project.ui.activeSceneId;
	const timeline =
		(activeSceneId ? project.scenes[activeSceneId]?.timeline : null) ??
		Object.values(project.scenes)[0]?.timeline;
	if (!timeline) {
		throw new Error("Failed to create default timeline.");
	}
	return cloneTimelineJson(timeline);
};

const formatError = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

const parseRecordIfValid = (record: ProjectRecord): ProjectRecord | null => {
	try {
		return {
			...record,
			data: parseStudioProject(record.data),
		};
	} catch (error) {
		console.warn(`[projectStore] Ignore invalid project: ${record.id}`, error);
		return null;
	}
};

const withProjectRevision = (project: StudioProject): StudioProject => {
	const now = Date.now();
	const ot = ensureStudioProjectOt(project);
	return {
		...project,
		ot,
		revision: (project.revision ?? 0) + 1,
		updatedAt: now,
	};
};

const stripProjectOtForPersistence = (
	project: StudioProject,
): StudioProject => {
	// 当前阶段 OT 仅用于本地调试，不持久化到项目数据。
	const { ot: _ot, ...rest } = project;
	// focus 属于编辑期瞬时状态，不持久化到项目数据。
	if (!rest.ui.focusedNodeId) {
		return rest;
	}
	return {
		...rest,
		ui: {
			...rest.ui,
			focusedNodeId: null,
		},
	};
};

const normalizeProjectRuntimeState = (
	project: StudioProject,
): StudioProject => {
	const repairedNodes = normalizeCanvasNodeSiblingOrder(
		repairCanvasNodeParentRelations(project.canvas.nodes),
	);
	const projectWithParents =
		repairedNodes === project.canvas.nodes
			? project
			: {
					...project,
					canvas: {
						...project.canvas,
						nodes: repairedNodes,
					},
				};
	const projectWithOt = projectWithParents.ot
		? projectWithParents
		: { ...projectWithParents, ot: ensureStudioProjectOt(projectWithParents) };
	if (!projectWithOt.ui.focusedNodeId) return projectWithOt;
	return {
		...projectWithOt,
		ui: {
			...projectWithOt.ui,
			focusedNodeId: null,
		},
	};
};

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
	status: "idle",
	projects: [],
	currentProjectId: null,
	currentProject: null,
	focusedSceneDrafts: {},
	sceneTimelineMutationOpIds: {},
	error: null,
	initialize: async () => {
		const { status } = get();
		if (status === "loading" || status === "ready") return;
		set({ status: "loading", error: null });
		try {
			const records = await getAllProjects();
			const validRecords = records
				.map(parseRecordIfValid)
				.filter((record): record is ProjectRecord => record !== null);
			if (validRecords.length === 0) {
				const now = Date.now();
				const id = createProjectId();
				const project = buildEmptyProject(id);
				const record: ProjectRecord = {
					id,
					name: buildAutoProjectName(),
					data: stripProjectOtForPersistence(project),
					createdAt: now,
					updatedAt: now,
				};
				await putProject(record);
				await setCurrentProjectId(record.id);
				set({
					status: "ready",
					projects: [toSummary(record)],
					currentProjectId: record.id,
					currentProject: project,
					focusedSceneDrafts: {},
					sceneTimelineMutationOpIds: {},
					error: null,
				});
				setCanvasCameraFromProject(project.ui.camera);
				return;
			}
			const sortedRecords = sortProjectRecords(validRecords);
			let currentId = await getCurrentProjectId();
			const currentRecord =
				sortedRecords.find((record) => record.id === currentId) ??
				sortedRecords[0];
			if (!currentRecord) {
				throw new Error("No available project to load.");
			}
			if (currentId !== currentRecord.id) {
				currentId = currentRecord.id;
				await setCurrentProjectId(currentId);
			}
			const currentProject = normalizeProjectRuntimeState(currentRecord.data);
			set({
				status: "ready",
				projects: sortedRecords.map(toSummary),
				currentProjectId: currentId,
				currentProject,
				focusedSceneDrafts: {},
				sceneTimelineMutationOpIds: {},
				error: null,
			});
			setCanvasCameraFromProject(currentProject.ui.camera);
		} catch (error) {
			console.error("Failed to initialize projects:", error);
			set({
				status: "error",
				error: formatError(error),
			});
		}
	},
	createProject: async () => {
		try {
			const now = Date.now();
			const id = createProjectId();
			const project = buildEmptyProject(id);
			const record: ProjectRecord = {
				id,
				name: buildAutoProjectName(),
				data: stripProjectOtForPersistence(project),
				createdAt: now,
				updatedAt: now,
			};
			await putProject(record);
			await setCurrentProjectId(record.id);
			set({
				projects: sortProjectSummaries([...get().projects, toSummary(record)]),
				currentProjectId: record.id,
				currentProject: project,
				focusedSceneDrafts: {},
				sceneTimelineMutationOpIds: {},
				error: null,
			});
			setCanvasCameraFromProject(project.ui.camera);
		} catch (error) {
			console.error("Failed to create project:", error);
			set({ error: formatError(error) });
		}
	},
	saveCurrentProject: async () => {
		try {
			get().flushFocusedSceneDraft();
			const now = Date.now();
			const { currentProjectId, projects, currentProject } = get();
			const nextProjectId = currentProjectId ?? createProjectId();
			const baseProject = currentProject ?? buildEmptyProject(nextProjectId);
			const camera = getCanvasCamera();
			const nextProject = withProjectRevision({
				...baseProject,
				id: nextProjectId,
				ui: {
					...baseProject.ui,
					camera,
				},
			});
			const persistedProject = stripProjectOtForPersistence(nextProject);
			if (!currentProjectId) {
				const record: ProjectRecord = {
					id: nextProjectId,
					name: buildAutoProjectName(),
					data: persistedProject,
					createdAt: now,
					updatedAt: now,
				};
				await putProject(record);
				await setCurrentProjectId(record.id);
				set({
					projects: sortProjectSummaries([...projects, toSummary(record)]),
					currentProjectId: record.id,
					currentProject: nextProject,
					error: null,
				});
				return;
			}
			const currentSummary = projects.find(
				(project) => project.id === currentProjectId,
			);
			const record: ProjectRecord = {
				id: currentProjectId,
				name: currentSummary?.name ?? buildAutoProjectName(),
				data: persistedProject,
				createdAt: currentSummary?.createdAt ?? now,
				updatedAt: now,
			};
			await putProject(record);
			await setCurrentProjectId(currentProjectId);
			const nextProjects = sortProjectSummaries(
				projects.map((project) =>
					project.id === currentProjectId
						? {
								...project,
								name: record.name,
								createdAt: record.createdAt,
								updatedAt: record.updatedAt,
							}
						: project,
				),
			);
			set({
				projects: nextProjects,
				currentProject: nextProject,
				error: null,
			});
		} catch (error) {
			console.error("Failed to save project:", error);
			set({ error: formatError(error) });
		}
	},
	switchProject: async (id: string) => {
		const { currentProjectId } = get();
		if (id === currentProjectId) return;
		try {
			const record = await getProject(id);
			if (!record) {
				throw new Error("Project not found.");
			}
			const validRecord = parseRecordIfValid(record);
			if (!validRecord) {
				throw new Error("Project is invalid with current schema.");
			}
			await setCurrentProjectId(id);
			const currentProject = normalizeProjectRuntimeState(validRecord.data);
			set({
				currentProjectId: id,
				currentProject,
				focusedSceneDrafts: {},
				sceneTimelineMutationOpIds: {},
				error: null,
			});
			setCanvasCameraFromProject(currentProject.ui.camera);
		} catch (error) {
			console.error("Failed to switch project:", error);
			set({ error: formatError(error) });
		}
	},
	createCanvasNode: (input) => {
		let createdNodeId = "";
		set((state) => {
			if (!state.currentProject) return state;
			const project = state.currentProject;
			const now = Date.now();
			const nodeId = createEntityId("node");
			const sceneIndex = Object.keys(project.scenes).length + 1;

			let nextScenes = project.scenes;
			let nextActiveSceneId = project.ui.activeSceneId;
			const nextFocusedNodeId = project.ui.focusedNodeId;
			let node: CanvasNode;

			switch (input.type) {
				case "scene": {
					const sceneId = createEntityId("scene");
					const name = input.name?.trim()
						? input.name.trim()
						: `Scene ${sceneIndex}`;
					const width = input.width ?? DEFAULT_SCENE_NODE_WIDTH;
					const height = input.height ?? DEFAULT_SCENE_NODE_HEIGHT;
					nextScenes = {
						...project.scenes,
						[sceneId]: {
							id: sceneId,
							name,
							timeline: createDefaultTimeline(),
							posterFrame: 0,
							createdAt: now,
							updatedAt: now,
						},
					};
					nextActiveSceneId = sceneId;
					node = {
						id: nodeId,
						type: "scene",
						sceneId,
						name,
						parentId: input.parentId ?? null,
						x: input.x ?? -width / 2,
						y: input.y ?? -height / 2,
						width,
						height,
						siblingOrder: 0,
						locked: false,
						hidden: false,
						createdAt: now,
						updatedAt: now,
					};
					break;
				}
				case "video": {
					const width = input.width ?? DEFAULT_VIDEO_NODE_WIDTH;
					const height = input.height ?? DEFAULT_VIDEO_NODE_HEIGHT;
					node = {
						id: nodeId,
						type: "video",
						assetId: input.assetId ?? "",
						duration: input.duration,
						name: input.name?.trim() ? input.name.trim() : "Video",
						parentId: input.parentId ?? null,
						x: input.x ?? -width / 2,
						y: input.y ?? -height / 2,
						width,
						height,
						siblingOrder: 0,
						locked: false,
						hidden: false,
						createdAt: now,
						updatedAt: now,
					};
					break;
				}
				case "audio": {
					const width = input.width ?? DEFAULT_AUDIO_NODE_WIDTH;
					const height = input.height ?? DEFAULT_AUDIO_NODE_HEIGHT;
					node = {
						id: nodeId,
						type: "audio",
						assetId: input.assetId ?? "",
						duration: input.duration,
						name: input.name?.trim() ? input.name.trim() : "Audio",
						parentId: input.parentId ?? null,
						x: input.x ?? -width / 2,
						y: input.y ?? -height / 2,
						width,
						height,
						siblingOrder: 0,
						locked: false,
						hidden: false,
						createdAt: now,
						updatedAt: now,
					};
					break;
				}
				case "image": {
					const width = input.width ?? DEFAULT_IMAGE_NODE_WIDTH;
					const height = input.height ?? DEFAULT_IMAGE_NODE_HEIGHT;
					node = {
						id: nodeId,
						type: "image",
						assetId: input.assetId ?? "",
						name: input.name?.trim() ? input.name.trim() : "Image",
						parentId: input.parentId ?? null,
						x: input.x ?? -width / 2,
						y: input.y ?? -height / 2,
						width,
						height,
						siblingOrder: 0,
						locked: false,
						hidden: false,
						createdAt: now,
						updatedAt: now,
					};
					break;
				}
				case "text": {
					const width = input.width ?? DEFAULT_TEXT_NODE_WIDTH;
					const height = input.height ?? DEFAULT_TEXT_NODE_HEIGHT;
					node = {
						id: nodeId,
						type: "text",
						text: input.text ?? "New Text",
						fontSize: input.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
						name: input.name?.trim() ? input.name.trim() : "Text",
						parentId: input.parentId ?? null,
						x: input.x ?? -width / 2,
						y: input.y ?? -height / 2,
						width,
						height,
						siblingOrder: 0,
						locked: false,
						hidden: false,
						createdAt: now,
						updatedAt: now,
					};
					break;
				}
				case "frame": {
					const width = input.width ?? DEFAULT_FRAME_NODE_WIDTH;
					const height = input.height ?? DEFAULT_FRAME_NODE_HEIGHT;
					node = {
						id: nodeId,
						type: "frame",
						name: input.name?.trim() ? input.name.trim() : "Frame",
						parentId: input.parentId ?? null,
						x: input.x ?? -width / 2,
						y: input.y ?? -height / 2,
						width,
						height,
						siblingOrder: 0,
						locked: false,
						hidden: false,
						createdAt: now,
						updatedAt: now,
					};
					break;
				}
			}

			const parentId = node.parentId ?? null;
			const insertIndex =
				input.insertIndex ??
				resolveLayerSiblingCount(project.canvas.nodes, parentId);
			const { siblingOrder, rebalancePatches } = allocateInsertSiblingOrder(
				project.canvas.nodes,
				{
					parentId,
					index: insertIndex,
				},
			);
			const patchByNodeId = new Map(
				rebalancePatches.map((patch) => [patch.nodeId, patch.siblingOrder]),
			);
			const nextCanvasNodes = project.canvas.nodes.map((existingNode) => {
				const rebalancedZIndex = patchByNodeId.get(existingNode.id);
				if (
					rebalancedZIndex === undefined ||
					rebalancedZIndex === existingNode.siblingOrder
				) {
					return existingNode;
				}
				return {
					...existingNode,
					siblingOrder: rebalancedZIndex,
					updatedAt: now,
				};
			});
			node = {
				...node,
				siblingOrder,
			};

			createdNodeId = node.id;
			const nextProject = withProjectRevision({
				...project,
				scenes: nextScenes,
				canvas: {
					nodes: [...nextCanvasNodes, node],
				},
				ui: {
					...project.ui,
					activeSceneId: nextActiveSceneId,
					focusedNodeId: nextFocusedNodeId,
					activeNodeId: node.id,
				},
			});
			return {
				currentProject: nextProject,
				error: null,
			};
		});
		return createdNodeId;
	},
	updateCanvasNode: (nodeId, patch) => {
		set((state) => {
			if (!state.currentProject) return state;
			let didUpdate = false;
			const didPatchParentId = Object.hasOwn(patch, "parentId");
			const now = Date.now();
			const nextNodes = state.currentProject.canvas.nodes.map((node) => {
				if (node.id !== nodeId) return node;
				didUpdate = true;
				return {
					...node,
					...patch,
					id: node.id,
					createdAt: node.createdAt,
					updatedAt: now,
				};
			});
			if (!didUpdate) return state;
			const repairedNodes = didPatchParentId
				? normalizeCanvasNodeSiblingOrder(
						repairCanvasNodeParentRelations(nextNodes),
					)
				: nextNodes;
			const nextProject = withProjectRevision({
				...state.currentProject,
				canvas: {
					nodes: repairedNodes,
				},
			});
			return {
				currentProject: nextProject,
			};
		});
	},
	updateCanvasNodeLayout: (nodeId, patch) => {
		get().updateCanvasNode(nodeId, patch);
	},
	updateCanvasNodeLayoutBatch: (entries) => {
		set((state) => {
			if (!state.currentProject) return state;
			if (entries.length === 0) return state;
			const mergedPatches = new Map<string, CanvasNodeLayoutPatch>();
			for (const entry of entries) {
				if (!entry.nodeId) continue;
				const prevPatch = mergedPatches.get(entry.nodeId) ?? {};
				mergedPatches.set(entry.nodeId, {
					...prevPatch,
					...entry.patch,
				});
			}
			if (mergedPatches.size === 0) return state;
			const didPatchParentId = [...mergedPatches.values()].some((patch) =>
				Object.hasOwn(patch, "parentId"),
			);
			let didUpdate = false;
			const now = Date.now();
			const nextNodes = state.currentProject.canvas.nodes.map((node) => {
				const patch = mergedPatches.get(node.id);
				if (!patch) return node;
				const nextNode = {
					...node,
					...patch,
					id: node.id,
					createdAt: node.createdAt,
					updatedAt: now,
				};
				const didLayoutChange =
					nextNode.x !== node.x ||
					nextNode.y !== node.y ||
					nextNode.width !== node.width ||
					nextNode.height !== node.height ||
					nextNode.siblingOrder !== node.siblingOrder ||
					nextNode.hidden !== node.hidden ||
					nextNode.locked !== node.locked ||
					nextNode.parentId !== node.parentId;
				if (!didLayoutChange) return node;
				didUpdate = true;
				return nextNode;
			});
			if (!didUpdate) return state;
			const repairedNodes = didPatchParentId
				? normalizeCanvasNodeSiblingOrder(
						repairCanvasNodeParentRelations(nextNodes),
					)
				: nextNodes;
			const nextProject = withProjectRevision({
				...state.currentProject,
				canvas: {
					nodes: repairedNodes,
				},
			});
			return {
				currentProject: nextProject,
			};
		});
	},
	setActiveNode: (nodeId) => {
		set((state) => {
			if (!state.currentProject) return state;
			if (
				nodeId &&
				!state.currentProject.canvas.nodes.some((node) => node.id === nodeId)
			) {
				return state;
			}
			const nextProject = {
				...state.currentProject,
				ui: {
					...state.currentProject.ui,
					activeNodeId: nodeId,
				},
			};
			return {
				currentProject: nextProject,
			};
		});
	},
	createSceneNode: (input) => {
		const nodeId = get().createCanvasNode({
			type: "scene",
			...input,
		});
		const currentProject = get().currentProject;
		if (!currentProject) return "";
		const node = currentProject.canvas.nodes.find((item) => item.id === nodeId);
		if (!node || node.type !== "scene") return "";
		return node.sceneId;
	},
	updateSceneNodeLayout: (nodeId, patch) => {
		get().updateCanvasNodeLayout(nodeId, patch);
	},
	ensureProjectAsset: (input) => {
		const name = normalizeAssetName(input.name);
		const locator = normalizeAssetLocator(input.locator);
		const meta = normalizeAssetMeta(input.meta);
		const hash = normalizeAssetHash(meta?.hash);
		let resolvedId = "";
		set((state) => {
			if (!state.currentProject) return state;
			const existedByHash = hash
				? state.currentProject.assets.find(
						(asset) =>
							asset.kind === input.kind &&
							normalizeAssetHash(asset.meta?.hash) === hash,
					)
				: undefined;
			const existedByLocator = state.currentProject.assets.find(
				(asset) =>
					asset.kind === input.kind &&
					isSameAssetLocator(asset.locator, locator),
			);
			const existed = existedByHash ?? existedByLocator;
			if (existed) {
				resolvedId = existed.id;
				const mergedMeta = mergeAssetMeta(existed.meta, meta);
				if (isSameAssetMeta(existed.meta, mergedMeta)) {
					return state;
				}
				const nextProject = withProjectRevision({
					...state.currentProject,
					assets: state.currentProject.assets.map((asset) => {
						if (asset.id !== existed.id) return asset;
						return {
							...asset,
							meta: mergedMeta,
						};
					}),
				});
				return {
					currentProject: nextProject,
				};
			}
			const nextAsset: TimelineAsset = {
				id: createAssetId(),
				kind: input.kind,
				name,
				locator,
				...(meta ? { meta } : {}),
			};
			resolvedId = nextAsset.id;
			const nextProject = withProjectRevision({
				...state.currentProject,
				assets: [...state.currentProject.assets, nextAsset],
			});
			return {
				currentProject: nextProject,
			};
		});
		if (!resolvedId) {
			throw new Error("Failed to ensure project asset.");
		}
		return resolvedId;
	},
	getProjectAssetById: (assetId) => {
		const project = get().currentProject;
		if (!project) return null;
		return project.assets.find((asset) => asset.id === assetId) ?? null;
	},
	updateProjectAssetMeta: (assetId, updater) => {
		set((state) => {
			if (!state.currentProject) return state;
			let didUpdate = false;
			const nextAssets = state.currentProject.assets.map((asset) => {
				if (asset.id !== assetId) return asset;
				const nextMeta = updater(asset.meta);
				if (nextMeta === asset.meta) return asset;
				didUpdate = true;
				return {
					...asset,
					meta: nextMeta,
				};
			});
			if (!didUpdate) return state;
			const nextProject = withProjectRevision({
				...state.currentProject,
				assets: nextAssets,
			});
			return {
				currentProject: nextProject,
			};
		});
	},
	setFocusedNode: (nodeId) => {
		set((state) => {
			if (!state.currentProject) return state;
			if (!nodeId) {
				const nextProject = {
					...state.currentProject,
					ui: {
						...state.currentProject.ui,
						focusedNodeId: null,
					},
				};
				return {
					currentProject: nextProject,
				};
			}
			const focusedNode = state.currentProject.canvas.nodes.find(
				(node) => node.id === nodeId,
			);
			if (!focusedNode) return state;
			const nextProject = {
				...state.currentProject,
				ui: {
					...state.currentProject.ui,
					focusedNodeId: nodeId,
					activeNodeId: nodeId,
					activeSceneId:
						focusedNode.type === "scene"
							? focusedNode.sceneId
							: state.currentProject.ui.activeSceneId,
				},
			};
			return {
				currentProject: nextProject,
			};
		});
	},
	setActiveScene: (sceneId) => {
		set((state) => {
			if (!state.currentProject) return state;
			if (sceneId && !state.currentProject.scenes[sceneId]) return state;
			const sceneNode = findSceneNodeBySceneId(state.currentProject, sceneId);
			const nextProject = {
				...state.currentProject,
				ui: {
					...state.currentProject.ui,
					activeSceneId: sceneId,
					activeNodeId: sceneNode?.id ?? state.currentProject.ui.activeNodeId,
				},
			};
			return {
				currentProject: nextProject,
			};
		});
	},
	setCanvasSnapEnabled: (enabled) => {
		set((state) => {
			if (!state.currentProject) return state;
			if (state.currentProject.ui.canvasSnapEnabled === enabled) {
				return state;
			}
			const nextProject = {
				...state.currentProject,
				ui: {
					...state.currentProject.ui,
					canvasSnapEnabled: enabled,
				},
			};
			return {
				currentProject: nextProject,
			};
		});
	},
	updateSceneTimeline: (sceneId, timeline, options) => {
		set((state) => {
			if (!state.currentProject) return state;
			const currentScene = state.currentProject.scenes[sceneId];
			if (!currentScene) return state;
			const now = Date.now();
			const nextProject = withProjectRevision({
				...state.currentProject,
				scenes: {
					...state.currentProject.scenes,
					[sceneId]: {
						...currentScene,
						timeline,
						updatedAt: now,
					},
				},
			});
			return {
				currentProject: nextProject,
				sceneTimelineMutationOpIds: {
					...state.sceneTimelineMutationOpIds,
					[sceneId]: options?.txnId ?? options?.historyOpId,
				},
			};
		});
	},
	updateScenePosterFrame: (sceneId, posterFrame) => {
		set((state) => {
			if (!state.currentProject) return state;
			const currentScene = state.currentProject.scenes[sceneId];
			if (!currentScene) return state;
			const nextProject = withProjectRevision({
				...state.currentProject,
				scenes: {
					...state.currentProject.scenes,
					[sceneId]: {
						...currentScene,
						posterFrame: Math.max(0, Math.round(posterFrame)),
						updatedAt: Date.now(),
					},
				},
			});
			return {
				currentProject: nextProject,
			};
		});
	},
	updateActiveSceneTimeline: (timeline, options) => {
		const activeSceneId = get().currentProject?.ui.activeSceneId;
		if (!activeSceneId) return;
		get().updateSceneTimeline(activeSceneId, timeline, options);
	},
	setFocusedSceneDraft: (sceneId, timeline) => {
		set((state) => ({
			focusedSceneDrafts: {
				...state.focusedSceneDrafts,
				[sceneId]: timeline,
			},
		}));
	},
	flushFocusedSceneDraft: () => {
		const { currentProject, focusedSceneDrafts } = get();
		const focusedNodeId = currentProject?.ui.focusedNodeId;
		if (!focusedNodeId) return;
		const focusedNode = currentProject?.canvas.nodes.find(
			(node) => node.id === focusedNodeId,
		);
		if (!focusedNode || focusedNode.type !== "scene") return;
		const sceneId = focusedNode.sceneId;
		const draft = focusedSceneDrafts[sceneId];
		if (!draft) return;
		get().updateSceneTimeline(sceneId, draft, { recordHistory: false });
		set((state) => {
			const { [sceneId]: _removed, ...rest } = state.focusedSceneDrafts;
			return { focusedSceneDrafts: rest };
		});
	},
	removeCanvasNodeForHistory: (nodeId) => {
		set((state) => {
			if (!state.currentProject) return state;
			const currentProject = state.currentProject;
			const existed = currentProject.canvas.nodes.some(
				(node) => node.id === nodeId,
			);
			if (!existed) return state;
			const filteredNodes = currentProject.canvas.nodes.filter(
				(node) => node.id !== nodeId,
			);
			const nextNodes = filteredNodes.map((node) => {
				if ((node.parentId ?? null) !== nodeId) return node;
				return {
					...node,
					parentId: null,
				};
			});
			const nextProject = withProjectRevision({
				...currentProject,
				canvas: {
					nodes: normalizeCanvasNodeSiblingOrder(
						repairCanvasNodeParentRelations(nextNodes),
					),
				},
				ui: {
					...currentProject.ui,
					activeNodeId:
						currentProject.ui.activeNodeId === nodeId
							? null
							: currentProject.ui.activeNodeId,
					focusedNodeId:
						currentProject.ui.focusedNodeId === nodeId
							? null
							: currentProject.ui.focusedNodeId,
				},
			});
			return {
				currentProject: nextProject,
			};
		});
	},
	restoreCanvasNodeForHistory: (node) => {
		set((state) => {
			if (!state.currentProject) return state;
			const currentProject = state.currentProject;
			const existed = currentProject.canvas.nodes.some(
				(item) => item.id === node.id,
			);
			if (existed) return state;
			const nextNodes = normalizeCanvasNodeSiblingOrder(
				repairCanvasNodeParentRelations([...currentProject.canvas.nodes, node]),
			);
			const nextProject = withProjectRevision({
				...currentProject,
				canvas: {
					nodes: nextNodes,
				},
				ui: {
					...currentProject.ui,
					activeNodeId: currentProject.ui.activeNodeId ?? node.id,
				},
			});
			return {
				currentProject: nextProject,
			};
		});
	},
	appendCanvasGraphBatch: (entries) => {
		set((state) => {
			if (!state.currentProject) return state;
			if (entries.length === 0) return state;
			const currentProject = state.currentProject;
			const nodeIdSet = new Set(
				currentProject.canvas.nodes.map((node) => node.id),
			);
			const nextScenes = { ...currentProject.scenes };
			const nextNodes = [...currentProject.canvas.nodes];
			let nextOt = ensureStudioProjectOt(currentProject);
			let didMutate = false;
			let firstRestoredNodeId: string | null = null;

			for (const entry of entries) {
				if (entry.node.type === "scene") {
					if (entry.scene) {
						if (nextScenes[entry.scene.id] !== entry.scene) {
							nextScenes[entry.scene.id] = entry.scene;
							didMutate = true;
						}
					} else if (!nextScenes[entry.node.sceneId]) {
						continue;
					}
					if (nextOt.tombstones.scenes[entry.node.sceneId]) {
						nextOt = clearSceneTombstone(
							{ ...currentProject, ot: nextOt },
							entry.node.sceneId,
						);
						didMutate = true;
					}
				}
				if (nodeIdSet.has(entry.node.id)) continue;
				nextNodes.push(entry.node);
				nodeIdSet.add(entry.node.id);
				firstRestoredNodeId ??= entry.node.id;
				didMutate = true;
			}
			if (!didMutate) return state;

			const nextProject = withProjectRevision({
				...currentProject,
				ot: nextOt,
				scenes: nextScenes,
				canvas: {
					nodes: normalizeCanvasNodeSiblingOrder(
						repairCanvasNodeParentRelations(nextNodes),
					),
				},
				ui: {
					...currentProject.ui,
					activeNodeId: currentProject.ui.activeNodeId ?? firstRestoredNodeId,
				},
			});
			return {
				currentProject: nextProject,
			};
		});
	},
	removeCanvasGraphBatch: (entriesOrNodeIds) => {
		set((state) => {
			if (!state.currentProject) return state;
			if (entriesOrNodeIds.length === 0) return state;
			const currentProject = state.currentProject;
			const normalizedEntries =
				typeof entriesOrNodeIds[0] === "string"
					? (entriesOrNodeIds as string[]).reduce<CanvasGraphBatchEntry[]>(
							(entries, nodeId) => {
								const node =
									currentProject.canvas.nodes.find(
										(candidate) => candidate.id === nodeId,
									) ?? null;
								if (!node) return entries;
								entries.push({
									node,
									scene:
										node.type === "scene"
											? (currentProject.scenes[node.sceneId] ?? undefined)
											: undefined,
								});
								return entries;
							},
							[],
						)
					: (entriesOrNodeIds as CanvasGraphBatchEntry[]);
			if (normalizedEntries.length === 0) return state;
			const nodeIdSet = new Set(
				normalizedEntries.map((entry) => entry.node.id),
			);
			const removedNodes = currentProject.canvas.nodes.filter((node) =>
				nodeIdSet.has(node.id),
			);
			if (removedNodes.length === 0) return state;

			const removedSceneNodes = removedNodes.filter(
				(node): node is SceneNode => node.type === "scene",
			);
			const removedSceneIdSet = new Set(
				removedSceneNodes.map((node) => node.sceneId),
			);
			const retainedSceneIdSet =
				typeof entriesOrNodeIds[0] === "string"
					? resolveDeletedSceneIdsToRetain(currentProject, removedSceneIdSet)
					: new Set(
							normalizedEntries.flatMap((entry) =>
								entry.node.type === "scene" && entry.scene === undefined
									? [entry.node.sceneId]
									: [],
							),
						);
			const fullyDeletedSceneIdSet = new Set(
				removedSceneNodes
					.map((node) => node.sceneId)
					.filter((sceneId) => !retainedSceneIdSet.has(sceneId)),
			);
			let nextOt = ensureStudioProjectOt(currentProject);
			const deletedAt = Date.now();
			for (const sceneNode of removedSceneNodes) {
				nextOt = writeSceneTombstone(
					{ ...currentProject, ot: nextOt },
					sceneNode.sceneId,
					sceneNode,
					deletedAt,
				);
			}

			const nextScenes = { ...currentProject.scenes };
			for (const sceneId of fullyDeletedSceneIdSet) {
				delete nextScenes[sceneId];
			}
			const filteredNodes = currentProject.canvas.nodes.filter(
				(node) => !nodeIdSet.has(node.id),
			);
			const nextNodes = filteredNodes.map((node) => {
				const parentId = node.parentId ?? null;
				if (!parentId || !nodeIdSet.has(parentId)) return node;
				return {
					...node,
					parentId: null,
				};
			});
			const fallbackSceneId = Object.keys(nextScenes)[0] ?? null;
			const activeSceneRemoved =
				currentProject.ui.activeSceneId !== null &&
				fullyDeletedSceneIdSet.has(currentProject.ui.activeSceneId);
			const nextMutationOpIds = { ...state.sceneTimelineMutationOpIds };
			for (const sceneId of fullyDeletedSceneIdSet) {
				delete nextMutationOpIds[sceneId];
			}

			const nextProject = withProjectRevision({
				...currentProject,
				ot: nextOt,
				scenes: nextScenes,
				canvas: {
					nodes: normalizeCanvasNodeSiblingOrder(
						repairCanvasNodeParentRelations(nextNodes),
					),
				},
				ui: {
					...currentProject.ui,
					activeSceneId: activeSceneRemoved
						? fallbackSceneId
						: currentProject.ui.activeSceneId,
					focusedNodeId:
						currentProject.ui.focusedNodeId &&
						nodeIdSet.has(currentProject.ui.focusedNodeId)
							? null
							: currentProject.ui.focusedNodeId,
					activeNodeId:
						currentProject.ui.activeNodeId &&
						nodeIdSet.has(currentProject.ui.activeNodeId)
							? null
							: currentProject.ui.activeNodeId,
				},
			});
			return {
				currentProject: nextProject,
				sceneTimelineMutationOpIds: nextMutationOpIds,
			};
		});
	},
	getSceneTombstone: (sceneId) => {
		const currentProject = get().currentProject;
		if (!currentProject) return null;
		return getSceneTombstoneFromProject(currentProject, sceneId);
	},
	removeSceneNodeForHistory: (sceneId, nodeId) => {
		set((state) => {
			if (!state.currentProject) return state;
			const currentProject = state.currentProject;
			if (!currentProject.scenes[sceneId]) return state;
			const sceneNode =
				currentProject.canvas.nodes.find(
					(node): node is SceneNode =>
						node.type === "scene" &&
						node.id === nodeId &&
						node.sceneId === sceneId,
				) ?? findSceneNodeBySceneId(currentProject, sceneId);
			if (!sceneNode) return state;

			const filteredNodes = currentProject.canvas.nodes.filter(
				(node) => node.id !== sceneNode.id,
			);
			const nextNodes = filteredNodes.map((node) => {
				if ((node.parentId ?? null) !== sceneNode.id) return node;
				return {
					...node,
					parentId: null,
				};
			});
			const nextProject = withProjectRevision({
				...currentProject,
				ot: writeSceneTombstone(currentProject, sceneId, sceneNode, Date.now()),
				canvas: {
					nodes: normalizeCanvasNodeSiblingOrder(
						repairCanvasNodeParentRelations(nextNodes),
					),
				},
				ui: {
					...currentProject.ui,
					focusedNodeId:
						currentProject.ui.focusedNodeId === sceneNode.id
							? null
							: currentProject.ui.focusedNodeId,
					activeNodeId:
						currentProject.ui.activeNodeId === sceneNode.id
							? null
							: currentProject.ui.activeNodeId,
				},
			});
			return {
				currentProject: nextProject,
			};
		});
	},
	restoreDetachedSceneNodeForHistory: (node, options) => {
		set((state) => {
			if (!state.currentProject) return state;
			const currentProject = state.currentProject;
			if (!currentProject.scenes[node.sceneId]) return state;
			const existed = currentProject.canvas.nodes.some(
				(item) => item.id === node.id,
			);
			const nextNode = options?.layoutOverride
				? {
						...node,
						...options.layoutOverride,
					}
				: node;
			const hasTombstone = Boolean(
				getSceneTombstoneFromProject(currentProject, node.sceneId),
			);
			if (existed && !hasTombstone) return state;
			const nextOt = hasTombstone
				? clearSceneTombstone(currentProject, node.sceneId)
				: ensureStudioProjectOt(currentProject);
			const nextProject = withProjectRevision({
				...currentProject,
				ot: nextOt,
				canvas: existed
					? currentProject.canvas
					: {
							nodes: normalizeCanvasNodeSiblingOrder(
								repairCanvasNodeParentRelations([
									...currentProject.canvas.nodes,
									nextNode,
								]),
							),
						},
				ui: {
					...currentProject.ui,
					activeNodeId: currentProject.ui.activeNodeId ?? nextNode.id,
				},
			});
			return {
				currentProject: nextProject,
			};
		});
	},
	removeSceneGraphForHistory: (sceneId, nodeId) => {
		set((state) => {
			if (!state.currentProject) return state;
			const currentProject = state.currentProject;
			if (!currentProject.scenes[sceneId]) return state;
			const sceneNode =
				currentProject.canvas.nodes.find(
					(node): node is SceneNode =>
						node.type === "scene" &&
						node.id === nodeId &&
						node.sceneId === sceneId,
				) ??
				currentProject.canvas.nodes.find(
					(node): node is SceneNode =>
						node.type === "scene" && node.sceneId === sceneId,
				) ??
				null;
			const targetNodeId = sceneNode?.id ?? nodeId;
			let nextOt = ensureStudioProjectOt(currentProject);
			if (sceneNode) {
				nextOt = writeSceneTombstone(
					{ ...currentProject, ot: nextOt },
					sceneId,
					sceneNode,
					Date.now(),
				);
			}
			const nextScenes = { ...currentProject.scenes };
			delete nextScenes[sceneId];
			const filteredNodes = currentProject.canvas.nodes.filter(
				(node) => node.id !== targetNodeId,
			);
			const nextNodes = filteredNodes.map((node) => {
				if ((node.parentId ?? null) !== targetNodeId) return node;
				return {
					...node,
					parentId: null,
				};
			});
			const fallbackSceneId = Object.keys(nextScenes)[0] ?? null;
			const nextProject = withProjectRevision({
				...currentProject,
				ot: nextOt,
				scenes: nextScenes,
				canvas: {
					nodes: normalizeCanvasNodeSiblingOrder(
						repairCanvasNodeParentRelations(nextNodes),
					),
				},
				ui: {
					...currentProject.ui,
					activeSceneId:
						currentProject.ui.activeSceneId === sceneId
							? fallbackSceneId
							: currentProject.ui.activeSceneId,
					focusedNodeId:
						currentProject.ui.focusedNodeId === targetNodeId
							? null
							: currentProject.ui.focusedNodeId,
					activeNodeId:
						currentProject.ui.activeNodeId === targetNodeId
							? null
							: currentProject.ui.activeNodeId,
				},
			});
			const { [sceneId]: _removedMutationOpId, ...restMutationOpIds } =
				state.sceneTimelineMutationOpIds;
			return {
				currentProject: nextProject,
				sceneTimelineMutationOpIds: restMutationOpIds,
			};
		});
	},
	restoreSceneGraphForHistory: (scene, node) => {
		set((state) => {
			if (!state.currentProject) return state;
			const currentProject = state.currentProject;
			const nodeExists = currentProject.canvas.nodes.some(
				(item) => item.id === node.id,
			);
			const hasScene = Boolean(currentProject.scenes[scene.id]);
			const hasTombstone = Boolean(
				getSceneTombstoneFromProject(currentProject, scene.id),
			);
			if (hasScene && nodeExists && !hasTombstone) return state;
			const nextOt = hasTombstone
				? clearSceneTombstone(currentProject, scene.id)
				: ensureStudioProjectOt(currentProject);
			const nextProject = withProjectRevision({
				...currentProject,
				ot: nextOt,
				scenes: {
					...currentProject.scenes,
					[scene.id]: scene,
				},
				canvas: nodeExists
					? currentProject.canvas
					: {
							nodes: normalizeCanvasNodeSiblingOrder(
								repairCanvasNodeParentRelations([
									...currentProject.canvas.nodes,
									node,
								]),
							),
						},
				ui: {
					...currentProject.ui,
					activeSceneId: currentProject.ui.activeSceneId ?? scene.id,
					activeNodeId: currentProject.ui.activeNodeId ?? node.id,
				},
			});
			return {
				currentProject: nextProject,
			};
		});
	},
}));
