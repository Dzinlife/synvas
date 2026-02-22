import {
	loadTimelineFromObject,
	type TimelineData,
	type TimelineJSON,
} from "core/editor/timelineLoader";
import { selectTimelineForActiveScene } from "core/studio/selectors";
import { parseStudioProject } from "core/studio/schema";
import type { SceneDocument, SceneNode, StudioProject } from "core/studio/types";
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

interface SceneNodeLayoutPatch {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	zIndex?: number;
	hidden?: boolean;
	locked?: boolean;
}

interface SceneCreateInput {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
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
	createSceneNode: (input?: SceneCreateInput) => string;
	updateSceneNodeLayout: (nodeId: string, patch: SceneNodeLayoutPatch) => void;
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

const loadTimelineData = (timeline: TimelineJSON): TimelineData => {
	try {
		return loadTimelineFromObject(timeline);
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
		return loadTimelineFromObject(fallbackTimeline);
	}
};

const resolveTimelineData = (project: StudioProject): TimelineData | null => {
	const selectedTimeline = selectTimelineForActiveScene(project);
	if (!selectedTimeline) return null;
	return loadTimelineData(selectedTimeline);
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
	createSceneNode: (input) => {
		let createdSceneId = "";
		set((state) => {
			if (!state.currentProject) return state;
			const now = Date.now();
			const project = state.currentProject;
			const sceneIndex = Object.keys(project.scenes).length + 1;
			const sceneId = createEntityId("scene");
			const nodeId = createEntityId("node");
			const name = input?.name?.trim() ? input.name.trim() : `Scene ${sceneIndex}`;
			const width = input?.width ?? DEFAULT_SCENE_NODE_WIDTH;
			const height = input?.height ?? DEFAULT_SCENE_NODE_HEIGHT;
			const maxZIndex = project.canvas.nodes.reduce(
				(maxValue, node) => Math.max(maxValue, node.zIndex),
				0,
			);
			createdSceneId = sceneId;
			const nextProject = withProjectRevision({
				...project,
				scenes: {
					...project.scenes,
					[sceneId]: {
						id: sceneId,
						name,
						timeline: createDefaultTimeline(),
						posterFrame: 0,
						createdAt: now,
						updatedAt: now,
					},
				},
				canvas: {
					nodes: [
						...project.canvas.nodes,
						{
							id: nodeId,
							type: "scene",
							sceneId,
							name,
							x: input?.x ?? -width / 2,
							y: input?.y ?? -height / 2,
							width,
							height,
							zIndex: maxZIndex + 1,
							locked: false,
							hidden: false,
							createdAt: now,
							updatedAt: now,
						},
					],
				},
				ui: {
					...project.ui,
					activeSceneId: sceneId,
				},
			});
			return {
				currentProject: nextProject,
				currentProjectData: resolveTimelineData(nextProject),
				error: null,
			};
		});
		return createdSceneId;
	},
	updateSceneNodeLayout: (nodeId, patch) => {
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
	setFocusedScene: (sceneId) => {
		set((state) => {
			if (!state.currentProject) return state;
			if (sceneId && !state.currentProject.scenes[sceneId]) return state;
			const nextProject = {
				...state.currentProject,
				ui: {
					...state.currentProject.ui,
					focusedSceneId: sceneId,
					activeSceneId: sceneId ?? state.currentProject.ui.activeSceneId,
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
			const nextProject = {
				...state.currentProject,
				ui: {
					...state.currentProject.ui,
					activeSceneId: sceneId,
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
				},
			});
			return {
				currentProject: nextProject,
				currentProjectData: resolveTimelineData(nextProject),
			};
		});
	},
}));
