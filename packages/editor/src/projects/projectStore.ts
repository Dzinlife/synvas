import {
	loadTimelineFromObject,
	type TimelineData,
	type TimelineJSON,
} from "core/editor/timelineLoader";
import { selectTimelineForScope } from "core/studio/selectors";
import type { StudioProject } from "core/studio/types";
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
	currentProject: StudioProject | null;
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

const resolveTimelineData = (project: StudioProject): TimelineData => {
	const selectedTimeline = selectTimelineForScope(project, project.ui.activeScope);
	if (!selectedTimeline) {
		return loadTimelineFromObject(buildEmptyProject(project.id).timeline);
	}
	try {
		return loadTimelineFromObject(selectedTimeline);
	} catch (error) {
		console.error("Failed to load timeline data:", error);
		return loadTimelineFromObject(buildEmptyProject(project.id).timeline);
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
	currentProject: null,
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
				currentProject: currentRecord.data,
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
			const { currentProjectId, projects, currentProject } = get();
			const nextProjectId = currentProjectId ?? createProjectId();
			const baseProject =
				currentProject ?? buildEmptyProject(nextProjectId);
			const nextProject: StudioProject = {
				...baseProject,
				id: nextProjectId,
				revision: (baseProject.revision ?? 0) + 1,
				timeline: data,
				updatedAt: now,
			};
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
			await setCurrentProjectId(id);
			set({
				currentProjectId: id,
				currentProject: record.data,
				currentProjectData: resolveTimelineData(record.data),
				error: null,
			});
		} catch (error) {
			console.error("Failed to switch project:", error);
			set({ error: formatError(error) });
		}
	},
}));
