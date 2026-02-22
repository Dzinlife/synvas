import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineJSON } from "core/editor/timelineLoader";
import type { StudioProject } from "core/studio/types";

vi.mock("./projectDb", async () => {
	const actual = await vi.importActual<typeof import("./projectDb")>("./projectDb");
	return {
		...actual,
		getAllProjects: vi.fn(async () => []),
		getCurrentProjectId: vi.fn(async () => null),
		getProject: vi.fn(async () => undefined),
		putProject: vi.fn(async () => {}),
		setCurrentProjectId: vi.fn(async () => {}),
	};
});

import { useProjectStore } from "./projectStore";

const createProject = (): StudioProject => ({
	id: "project-1",
	revision: 0,
	canvas: {
		nodes: [
			{
				id: "node-1",
				type: "scene",
				sceneId: "scene-1",
				name: "Scene 1",
				x: 0,
				y: 0,
				width: 960,
				height: 540,
				zIndex: 0,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
		],
	},
	scenes: {
		"scene-1": {
			id: "scene-1",
			name: "Scene 1",
			timeline: {
				fps: 30,
				canvas: { width: 1920, height: 1080 },
				settings: {
					snapEnabled: true,
					autoAttach: true,
					rippleEditingEnabled: false,
					previewAxisEnabled: true,
					audio: {
						exportSampleRate: 48000,
						exportBlockSize: 512,
						masterGainDb: 0,
						compressor: {
							enabled: true,
							thresholdDb: -12,
							ratio: 4,
							kneeDb: 6,
							attackMs: 10,
							releaseMs: 80,
							makeupGainDb: 0,
						},
					},
				},
				tracks: [],
				assets: [],
				elements: [],
			},
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
		},
	},
	ui: {
		activeSceneId: "scene-1",
		focusedSceneId: null,
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

beforeEach(() => {
	const project = createProject();
	useProjectStore.setState({
		status: "ready",
		projects: [],
		currentProjectId: project.id,
		currentProject: project,
		currentProjectData: null,
		focusedSceneDrafts: {},
		error: null,
	});
});

describe("projectStore", () => {
	it("createSceneNode 同时创建 scene 与 node", () => {
		const sceneId = useProjectStore.getState().createSceneNode({ name: "New Scene" });
		const project = useProjectStore.getState().currentProject;
		expect(sceneId).toBeTruthy();
		expect(project?.scenes[sceneId]?.name).toBe("New Scene");
		expect(project?.canvas.nodes.some((node) => node.sceneId === sceneId)).toBe(true);
	});

	it("setFocusedScene 更新 focusedSceneId", () => {
		useProjectStore.getState().setFocusedScene("scene-1");
		expect(useProjectStore.getState().currentProject?.ui.focusedSceneId).toBe("scene-1");
	});

	it("updateActiveSceneTimeline 回写 active scene", () => {
		const nextTimeline: TimelineJSON = {
			...createProject().scenes["scene-1"].timeline,
			elements: [
				{
					id: "element-1",
					type: "Image",
					component: "image",
					name: "Image",
					assetId: "asset-1",
					props: {},
					timeline: {
						start: 0,
						end: 30,
						startTimecode: "00:00:00:00",
						endTimecode: "00:00:01:00",
						trackIndex: 0,
						role: "clip",
					},
				},
			],
			assets: [
				{
					id: "asset-1",
					uri: "file:///asset-1.png",
					kind: "image",
					name: "asset-1",
				},
			],
		};
		useProjectStore.getState().updateActiveSceneTimeline(nextTimeline);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-1"].timeline
				.elements.length,
		).toBe(1);
	});

	it("saveCurrentProject 可持久化当前项目", async () => {
		await expect(useProjectStore.getState().saveCurrentProject()).resolves.toBeUndefined();
		expect(useProjectStore.getState().currentProject?.revision).toBeGreaterThan(0);
	});
});
