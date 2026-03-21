import {
	DEFAULT_TIMELINE_SETTINGS,
	type TimelineJSON,
} from "core/editor/timelineLoader";
import { createEmptyStudioOt } from "core/studio/ot";
import type { StudioProject } from "core/studio/types";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";

export interface ProjectRecord {
	id: string;
	name: string;
	data: StudioProject;
	createdAt: number;
	updatedAt: number;
}

interface ProjectMetaRecord {
	key: string;
	value: string | null;
}

interface ProjectDbSchema extends DBSchema {
	projects: {
		key: string;
		value: ProjectRecord;
	};
	meta: {
		key: string;
		value: ProjectMetaRecord;
	};
}

const DB_NAME = "composa";
const DB_VERSION = 1;
const PROJECT_STORE = "projects";
const META_STORE = "meta";
const CURRENT_PROJECT_KEY = "currentProjectId";
const DEFAULT_SCENE_NODE_WIDTH = 960;
const DEFAULT_SCENE_NODE_HEIGHT = 540;

const createEntityId = (prefix: string): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const buildEmptyTimeline = (): TimelineJSON => ({
	fps: 30,
	canvas: {
		width: 1920,
		height: 1080,
	},
	settings: {
		snapEnabled: DEFAULT_TIMELINE_SETTINGS.snapEnabled,
		autoAttach: DEFAULT_TIMELINE_SETTINGS.autoAttach,
		rippleEditingEnabled: DEFAULT_TIMELINE_SETTINGS.rippleEditingEnabled,
		previewAxisEnabled: DEFAULT_TIMELINE_SETTINGS.previewAxisEnabled,
		audio: {
			...DEFAULT_TIMELINE_SETTINGS.audio,
			compressor: { ...DEFAULT_TIMELINE_SETTINGS.audio.compressor },
		},
	},
	tracks: [],
	elements: [],
});

export const buildEmptyProject = (projectId: string): StudioProject => {
	const now = Date.now();
	const sceneId = createEntityId("scene");
	const nodeId = createEntityId("node");
	return {
		id: projectId,
		revision: 0,
		canvas: {
			nodes: [
				{
					id: nodeId,
					type: "scene",
					sceneId,
					name: "Scene 1",
					x: -DEFAULT_SCENE_NODE_WIDTH / 2,
					y: -DEFAULT_SCENE_NODE_HEIGHT / 2,
					width: DEFAULT_SCENE_NODE_WIDTH,
					height: DEFAULT_SCENE_NODE_HEIGHT,
					zIndex: 0,
					locked: false,
					hidden: false,
					createdAt: now,
					updatedAt: now,
				},
			],
		},
		scenes: {
			[sceneId]: {
				id: sceneId,
				name: "Scene 1",
				timeline: buildEmptyTimeline(),
				posterFrame: 0,
				createdAt: now,
				updatedAt: now,
			},
		},
		assets: [],
		ot: createEmptyStudioOt({
			streamIds: ["canvas", `timeline:${sceneId}`],
		}),
		ui: {
			activeSceneId: sceneId,
			focusedNodeId: null,
			activeNodeId: nodeId,
			canvasSnapEnabled: true,
			camera: {
				x: 0,
				y: 0,
				zoom: 1,
			},
		},
		createdAt: now,
		updatedAt: now,
	};
};

export const buildAutoProjectName = (now: Date = new Date()): string => {
	const pad = (value: number) => value.toString().padStart(2, "0");
	const year = now.getFullYear();
	const month = pad(now.getMonth() + 1);
	const day = pad(now.getDate());
	const hour = pad(now.getHours());
	const minute = pad(now.getMinutes());
	return `未命名项目-${year}-${month}-${day} ${hour}:${minute}`;
};

export const openProjectDb = (): Promise<IDBPDatabase<ProjectDbSchema>> => {
	return openDB<ProjectDbSchema>(DB_NAME, DB_VERSION, {
		upgrade(db) {
			if (!db.objectStoreNames.contains(PROJECT_STORE)) {
				db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
			}
			if (!db.objectStoreNames.contains(META_STORE)) {
				db.createObjectStore(META_STORE, { keyPath: "key" });
			}
		},
	});
};

export const getAllProjects = async (): Promise<ProjectRecord[]> => {
	const db = await openProjectDb();
	return db.getAll(PROJECT_STORE);
};

export const getProject = async (
	id: string,
): Promise<ProjectRecord | undefined> => {
	const db = await openProjectDb();
	return db.get(PROJECT_STORE, id);
};

export const putProject = async (record: ProjectRecord): Promise<void> => {
	const db = await openProjectDb();
	await db.put(PROJECT_STORE, record);
};

export const getCurrentProjectId = async (): Promise<string | null> => {
	const db = await openProjectDb();
	const meta = await db.get(META_STORE, CURRENT_PROJECT_KEY);
	return meta?.value ?? null;
};

export const setCurrentProjectId = async (id: string | null): Promise<void> => {
	const db = await openProjectDb();
	await db.put(META_STORE, {
		key: CURRENT_PROJECT_KEY,
		value: id,
	});
};
