import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { TimelineJSON } from "@/editor/timelineLoader";

export interface ProjectRecord {
	id: string;
	name: string;
	data: TimelineJSON;
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

const DB_NAME = "ai-nle";
const DB_VERSION = 1;
const PROJECT_STORE = "projects";
const META_STORE = "meta";
const CURRENT_PROJECT_KEY = "currentProjectId";

export const buildEmptyTimeline = (): TimelineJSON => ({
	version: "1.0",
	fps: 30,
	canvas: {
		width: 1920,
		height: 1080,
	},
	settings: {
		snapEnabled: true,
		autoAttach: true,
		rippleEditingEnabled: true,
		previewAxisEnabled: true,
	},
	tracks: [],
	transcripts: [],
	elements: [],
});

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

export const setCurrentProjectId = async (
	id: string | null,
): Promise<void> => {
	const db = await openProjectDb();
	await db.put(META_STORE, {
		key: CURRENT_PROJECT_KEY,
		value: id,
	});
};
