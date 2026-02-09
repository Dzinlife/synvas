import {
	loadTimelineFromObject,
	type TimelineData,
	type TimelineJSON,
} from "core/editor/timelineLoader";
import { create } from "zustand";
import {
	buildAutoProjectName,
	buildEmptyTimeline,
	getAllProjects,
	getCurrentProjectId,
	getProject,
	type ProjectRecord,
	putProject,
	setCurrentProjectId,
} from "./projectDb";

export interface ProjectSummary {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
}

type ProjectStatus = "idle" | "loading" | "ready" | "error";

interface ProjectStoreState {
	status: ProjectStatus;
	projects: ProjectSummary[];
	currentProjectId: string | null;
	currentProjectData: TimelineData | null;
	error: string | null;
	initialize: () => Promise<void>;
	createProject: () => Promise<void>;
	saveCurrentProject: (data: TimelineJSON) => Promise<void>;
	switchProject: (id: string) => Promise<void>;
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

const resolveTimelineData = (data: TimelineJSON): TimelineData => {
	if (data.version !== "1.0") {
		console.warn(
			`Unsupported timeline version "${data.version}", reset to empty timeline.`,
		);
		return loadTimelineFromObject(buildEmptyTimeline());
	}

	try {
		return loadTimelineFromObject(data);
	} catch (error) {
		console.error("Failed to load timeline data:", error);
		return loadTimelineFromObject(buildEmptyTimeline());
	}
};

const formatError = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
	status: "idle",
	projects: [],
	currentProjectId: null,
	currentProjectData: null,
	error: null,
	initialize: async () => {
		const { status } = get();
		if (status === "loading" || status === "ready") return;
		set({ status: "loading", error: null });
		try {
			const records = await getAllProjects();
			if (records.length === 0) {
				const now = Date.now();
				const record: ProjectRecord = {
					id: createProjectId(),
					name: buildAutoProjectName(),
					data: buildEmptyTimeline(),
					createdAt: now,
					updatedAt: now,
				};
				await putProject(record);
				await setCurrentProjectId(record.id);
				set({
					status: "ready",
					projects: [toSummary(record)],
					currentProjectId: record.id,
					currentProjectData: resolveTimelineData(record.data),
					error: null,
				});
				return;
			}
			const sortedRecords = sortProjectRecords(records);
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
				currentProjectData: resolveTimelineData(currentRecord.data),
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
			const record: ProjectRecord = {
				id: createProjectId(),
				name: buildAutoProjectName(),
				data: buildEmptyTimeline(),
				createdAt: now,
				updatedAt: now,
			};
			await putProject(record);
			await setCurrentProjectId(record.id);
			set({
				projects: sortProjectSummaries([...get().projects, toSummary(record)]),
				currentProjectId: record.id,
				currentProjectData: resolveTimelineData(record.data),
				error: null,
			});
		} catch (error) {
			console.error("Failed to create project:", error);
			set({ error: formatError(error) });
		}
	},
	saveCurrentProject: async (data: TimelineJSON) => {
		try {
			const now = Date.now();
			const { currentProjectId, projects } = get();
			if (!currentProjectId) {
				const record: ProjectRecord = {
					id: createProjectId(),
					name: buildAutoProjectName(),
					data,
					createdAt: now,
					updatedAt: now,
				};
				await putProject(record);
				await setCurrentProjectId(record.id);
				set({
					projects: sortProjectSummaries([...projects, toSummary(record)]),
					currentProjectId: record.id,
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
				data,
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
			await setCurrentProjectId(id);
			set({
				currentProjectId: id,
				currentProjectData: resolveTimelineData(record.data),
				error: null,
			});
		} catch (error) {
			console.error("Failed to switch project:", error);
			set({ error: formatError(error) });
		}
	},
}));
