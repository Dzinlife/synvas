import {
	loadTimelineFromObject,
	type TimelineData,
	type TimelineJSON,
} from "core/editor/timelineLoader";
import type { TimelineAsset } from "core/dsl/types";
import { selectTimelineForActiveScene } from "core/studio/selectors";
import { parseStudioProject } from "core/studio/schema";
import type {
	CanvasNode,
	SceneDocument,
	SceneNode,
	StudioProject,
} from "core/studio/types";
import { create } from "zustand";
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
}

export interface CanvasNodeLayoutPatch {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	zIndex?: number;
	hidden?: boolean;
	locked?: boolean;
}

export interface SceneCreateInput {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	name?: string;
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
			assetId?: string;
			duration?: number;
			naturalWidth?: number;
			naturalHeight?: number;
			text?: string;
			fontSize?: number;
	  };

interface EnsureProjectAssetInput {
	uri: string;
	kind: TimelineAsset["kind"];
	name?: string;
}

interface CameraState {
	x: number;
	y: number;
	zoom: number;
}

interface ProjectStoreState {
	status: ProjectStatus;
	projects: ProjectSummary[];
	currentProjectId: string | null;
	currentProject: StudioProject | null;
	currentProjectData: TimelineData | null;
	focusedSceneDrafts: Record<string, TimelineJSON>;
	error: string | null;
	initialize: () => Promise<void>;
	createProject: () => Promise<void>;
	saveCurrentProject: () => Promise<void>;
	switchProject: (id: string) => Promise<void>;
	createCanvasNode: (input: CanvasNodeCreateInput) => string;
	updateCanvasNode: (nodeId: string, patch: CanvasNodePatch) => void;
	updateCanvasNodeLayout: (nodeId: string, patch: CanvasNodeLayoutPatch) => void;
	setActiveNode: (nodeId: string | null) => void;
	createSceneNode: (input?: SceneCreateInput) => string;
	updateSceneNodeLayout: (nodeId: string, patch: CanvasNodeLayoutPatch) => void;
	ensureProjectAssetByUri: (input: EnsureProjectAssetInput) => string;
	getProjectAssetById: (assetId: string) => TimelineAsset | null;
	findProjectAssetByUri: (uri: string) => TimelineAsset | null;
	updateProjectAssetMeta: (
		assetId: string,
		updater: (
			prev: TimelineAsset["meta"] | undefined,
		) => TimelineAsset["meta"] | undefined,
	) => void;
	setFocusedScene: (sceneId: string | null) => void;
	setActiveScene: (sceneId: string | null) => void;
	setCanvasCamera: (camera: CameraState) => void;
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

const DEFAULT_IMAGE_NODE_WIDTH = 640;
const DEFAULT_IMAGE_NODE_HEIGHT = 360;
const DEFAULT_VIDEO_NODE_WIDTH = 640;
const DEFAULT_VIDEO_NODE_HEIGHT = 360;
const DEFAULT_AUDIO_NODE_WIDTH = 640;
const DEFAULT_AUDIO_NODE_HEIGHT = 180;
const DEFAULT_TEXT_NODE_WIDTH = 500;
const DEFAULT_TEXT_NODE_HEIGHT = 160;
const DEFAULT_TEXT_FONT_SIZE = 48;

const getMaxCanvasNodeZIndex = (nodes: CanvasNode[]): number => {
	return nodes.reduce(
		(maxValue, node) => Math.max(maxValue, node.zIndex),
		-1,
	);
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

const cloneTimelineJson = (timeline: TimelineJSON): TimelineJSON => {
	return JSON.parse(JSON.stringify(timeline)) as TimelineJSON;
};

const buildProjectAssetIdSet = (
	project: Pick<StudioProject, "assets">,
): ReadonlySet<string> => {
	return new Set(project.assets.map((asset) => asset.id));
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

const loadTimelineData = (
	timeline: TimelineJSON,
	project: Pick<StudioProject, "assets">,
): TimelineData => {
	const assetIdSet = buildProjectAssetIdSet(project);
	try {
		return loadTimelineFromObject(timeline, assetIdSet);
	} catch (error) {
		console.error("Failed to load timeline data:", error);
		const fallbackProject = buildEmptyProject(createProjectId());
		const fallbackSceneId = fallbackProject.ui.activeSceneId;
		const fallbackTimeline =
			(fallbackSceneId ? fallbackProject.scenes[fallbackSceneId]?.timeline : null) ??
			Object.values(fallbackProject.scenes)[0]?.timeline;
		if (!fallbackTimeline) {
			throw new Error("Failed to build fallback timeline.");
		}
		return loadTimelineFromObject(
			fallbackTimeline,
			buildProjectAssetIdSet(fallbackProject),
		);
	}
};

const resolveTimelineData = (project: StudioProject): TimelineData | null => {
	const selectedTimeline = selectTimelineForActiveScene(project);
	if (!selectedTimeline) return null;
	return loadTimelineData(selectedTimeline, project);
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
	return {
		...project,
		revision: (project.revision ?? 0) + 1,
		updatedAt: now,
	};
};

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
	status: "idle",
	projects: [],
	currentProjectId: null,
	currentProject: null,
	currentProjectData: null,
	focusedSceneDrafts: {},
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
				const record: ProjectRecord = {
					id,
					name: buildAutoProjectName(),
					data: buildEmptyProject(id),
					createdAt: now,
					updatedAt: now,
				};
				await putProject(record);
				await setCurrentProjectId(record.id);
				set({
					status: "ready",
					projects: [toSummary(record)],
					currentProjectId: record.id,
					currentProject: record.data,
					currentProjectData: resolveTimelineData(record.data),
					focusedSceneDrafts: {},
					error: null,
				});
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
			set({
				status: "ready",
				projects: sortedRecords.map(toSummary),
				currentProjectId: currentId,
				currentProject: currentRecord.data,
				currentProjectData: resolveTimelineData(currentRecord.data),
				focusedSceneDrafts: {},
				error: null,
			});
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
			const record: ProjectRecord = {
				id,
				name: buildAutoProjectName(),
				data: buildEmptyProject(id),
				createdAt: now,
				updatedAt: now,
			};
			await putProject(record);
			await setCurrentProjectId(record.id);
			set({
				projects: sortProjectSummaries([...get().projects, toSummary(record)]),
				currentProjectId: record.id,
				currentProject: record.data,
				currentProjectData: resolveTimelineData(record.data),
				focusedSceneDrafts: {},
				error: null,
			});
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
			const nextProject = withProjectRevision({
				...baseProject,
				id: nextProjectId,
			});
			if (!currentProjectId) {
				const record: ProjectRecord = {
					id: nextProjectId,
					name: buildAutoProjectName(),
					data: nextProject,
					createdAt: now,
					updatedAt: now,
				};
				await putProject(record);
				await setCurrentProjectId(record.id);
				set({
					projects: sortProjectSummaries([...projects, toSummary(record)]),
					currentProjectId: record.id,
					currentProject: record.data,
					currentProjectData: resolveTimelineData(record.data),
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
				data: nextProject,
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
				currentProjectData: resolveTimelineData(nextProject),
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
			set({
				currentProjectId: id,
				currentProject: validRecord.data,
				currentProjectData: resolveTimelineData(validRecord.data),
				focusedSceneDrafts: {},
				error: null,
			});
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
			const maxZIndex = getMaxCanvasNodeZIndex(project.canvas.nodes);
			const sceneIndex = Object.keys(project.scenes).length + 1;

			let nextScenes = project.scenes;
			let nextActiveSceneId = project.ui.activeSceneId;
			let nextFocusedSceneId = project.ui.focusedSceneId;
			let node: CanvasNode;

			switch (input.type) {
				case "scene": {
					const sceneId = createEntityId("scene");
					const name = input.name?.trim() ? input.name.trim() : `Scene ${sceneIndex}`;
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
					if (!nextFocusedSceneId) {
						nextFocusedSceneId = sceneId;
					}
					node = {
						id: nodeId,
						type: "scene",
						sceneId,
						name,
						x: input.x ?? -width / 2,
						y: input.y ?? -height / 2,
						width,
						height,
						zIndex: maxZIndex + 1,
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
						x: input.x ?? -width / 2,
						y: input.y ?? -height / 2,
						width,
						height,
						zIndex: maxZIndex + 1,
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
						x: input.x ?? -width / 2,
						y: input.y ?? -height / 2,
						width,
						height,
						zIndex: maxZIndex + 1,
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
						naturalWidth: input.naturalWidth,
						naturalHeight: input.naturalHeight,
						x: input.x ?? -width / 2,
						y: input.y ?? -height / 2,
						width,
						height,
						zIndex: maxZIndex + 1,
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
						x: input.x ?? -width / 2,
						y: input.y ?? -height / 2,
						width,
						height,
						zIndex: maxZIndex + 1,
						locked: false,
						hidden: false,
						createdAt: now,
						updatedAt: now,
					};
					break;
				}
			}

			createdNodeId = node.id;
			const nextProject = withProjectRevision({
				...project,
				scenes: nextScenes,
				canvas: {
					nodes: [...project.canvas.nodes, node],
				},
				ui: {
					...project.ui,
					activeSceneId: nextActiveSceneId,
					focusedSceneId: nextFocusedSceneId,
					activeNodeId: node.id,
				},
			});
			return {
				currentProject: nextProject,
				currentProjectData: resolveTimelineData(nextProject),
				error: null,
			};
		});
		return createdNodeId;
	},
	updateCanvasNode: (nodeId, patch) => {
		set((state) => {
			if (!state.currentProject) return state;
			let didUpdate = false;
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
			const nextProject = withProjectRevision({
				...state.currentProject,
				canvas: {
					nodes: nextNodes,
				},
			});
			return {
				currentProject: nextProject,
				currentProjectData: resolveTimelineData(nextProject),
			};
		});
	},
	updateCanvasNodeLayout: (nodeId, patch) => {
		get().updateCanvasNode(nodeId, patch);
	},
	setActiveNode: (nodeId) => {
		set((state) => {
			if (!state.currentProject) return state;
			if (nodeId && !state.currentProject.canvas.nodes.some((node) => node.id === nodeId)) {
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
	ensureProjectAssetByUri: (input) => {
		const uri = input.uri.trim();
		if (!uri) {
			throw new Error("Asset uri is required.");
		}
		let resolvedId = "";
		set((state) => {
			if (!state.currentProject) return state;
			const existed = state.currentProject.assets.find(
				(asset) => asset.uri === uri && asset.kind === input.kind,
			);
			if (existed) {
				resolvedId = existed.id;
				return state;
			}
			const nextAsset: TimelineAsset = {
				id: createAssetId(),
				uri,
				kind: input.kind,
				...(input.name ? { name: input.name } : {}),
			};
			resolvedId = nextAsset.id;
			const nextProject = withProjectRevision({
				...state.currentProject,
				assets: [...state.currentProject.assets, nextAsset],
			});
			return {
				currentProject: nextProject,
				currentProjectData: resolveTimelineData(nextProject),
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
	findProjectAssetByUri: (uri) => {
		const project = get().currentProject;
		if (!project) return null;
		return project.assets.find((asset) => asset.uri === uri) ?? null;
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
				currentProjectData: resolveTimelineData(nextProject),
			};
		});
	},
	setFocusedScene: (sceneId) => {
		set((state) => {
			if (!state.currentProject) return state;
			if (sceneId && !state.currentProject.scenes[sceneId]) return state;
			const focusedNode = findSceneNodeBySceneId(state.currentProject, sceneId);
			const nextProject = {
				...state.currentProject,
				ui: {
					...state.currentProject.ui,
					focusedSceneId: sceneId,
					activeSceneId: sceneId ?? state.currentProject.ui.activeSceneId,
					activeNodeId:
						focusedNode?.id ??
						(sceneId ? state.currentProject.ui.activeNodeId : null),
				},
			};
			return {
				currentProject: nextProject,
				currentProjectData: resolveTimelineData(nextProject),
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
					activeNodeId:
						sceneNode?.id ?? state.currentProject.ui.activeNodeId,
				},
			};
			return {
				currentProject: nextProject,
				currentProjectData: resolveTimelineData(nextProject),
			};
		});
	},
	setCanvasCamera: (camera) => {
		set((state) => {
			if (!state.currentProject) return state;
			const nextProject = {
				...state.currentProject,
				ui: {
					...state.currentProject.ui,
					camera,
				},
			};
			return {
				currentProject: nextProject,
			};
		});
	},
	updateSceneTimeline: (sceneId, timeline, _options) => {
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
				currentProjectData: resolveTimelineData(nextProject),
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
				currentProjectData: resolveTimelineData(nextProject),
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
		const focusedSceneId = currentProject?.ui.focusedSceneId;
		if (!focusedSceneId) return;
		const draft = focusedSceneDrafts[focusedSceneId];
		if (!draft) return;
		get().updateSceneTimeline(focusedSceneId, draft, { recordHistory: false });
		set((state) => {
			const { [focusedSceneId]: _removed, ...rest } = state.focusedSceneDrafts;
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
			const nextProject = withProjectRevision({
				...currentProject,
				canvas: {
					nodes: currentProject.canvas.nodes.filter((node) => node.id !== nodeId),
				},
				ui: {
					...currentProject.ui,
					activeNodeId:
						currentProject.ui.activeNodeId === nodeId
							? null
							: currentProject.ui.activeNodeId,
				},
			});
			return {
				currentProject: nextProject,
				currentProjectData: resolveTimelineData(nextProject),
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
			const nextProject = withProjectRevision({
				...currentProject,
				canvas: {
					nodes: [...currentProject.canvas.nodes, node],
				},
				ui: {
					...currentProject.ui,
					activeNodeId: currentProject.ui.activeNodeId ?? node.id,
				},
			});
			return {
				currentProject: nextProject,
				currentProjectData: resolveTimelineData(nextProject),
			};
		});
	},
	removeSceneGraphForHistory: (sceneId, nodeId) => {
		set((state) => {
			if (!state.currentProject) return state;
			const currentProject = state.currentProject;
			if (!currentProject.scenes[sceneId]) return state;
			const nextScenes = { ...currentProject.scenes };
			delete nextScenes[sceneId];
			const nextNodes = currentProject.canvas.nodes.filter((node) => node.id !== nodeId);
			const fallbackSceneId = Object.keys(nextScenes)[0] ?? null;
			const nextProject = withProjectRevision({
				...currentProject,
				scenes: nextScenes,
				canvas: {
					nodes: nextNodes,
				},
				ui: {
					...currentProject.ui,
					activeSceneId:
						currentProject.ui.activeSceneId === sceneId
							? fallbackSceneId
							: currentProject.ui.activeSceneId,
					focusedSceneId:
						currentProject.ui.focusedSceneId === sceneId
							? null
							: currentProject.ui.focusedSceneId,
					activeNodeId:
						currentProject.ui.activeNodeId === nodeId
							? null
							: currentProject.ui.activeNodeId,
				},
			});
			return {
				currentProject: nextProject,
				currentProjectData: resolveTimelineData(nextProject),
			};
		});
	},
	restoreSceneGraphForHistory: (scene, node) => {
		set((state) => {
			if (!state.currentProject) return state;
			const currentProject = state.currentProject;
			if (currentProject.scenes[scene.id]) return state;
			const nextProject = withProjectRevision({
				...currentProject,
				scenes: {
					...currentProject.scenes,
					[scene.id]: scene,
				},
				canvas: {
					nodes: [...currentProject.canvas.nodes, node],
				},
				ui: {
					...currentProject.ui,
					activeSceneId: currentProject.ui.activeSceneId ?? scene.id,
					activeNodeId: currentProject.ui.activeNodeId ?? node.id,
				},
			});
			return {
				currentProject: nextProject,
				currentProjectData: resolveTimelineData(nextProject),
			};
		});
	},
}));
