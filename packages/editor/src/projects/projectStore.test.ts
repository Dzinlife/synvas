import type { TimelineJSON } from "core/editor/timelineLoader";
import type { StudioProject } from "core/studio/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAllProjects,
	getCurrentProjectId,
	getProject,
	type ProjectRecord,
} from "./projectDb";

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
	assets: [
		{
			id: "asset-1",
			uri: "file:///asset-1.png",
			kind: "image",
			name: "asset-1",
		},
	],
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
				elements: [],
			},
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
		},
	},
	ui: {
		activeSceneId: "scene-1",
		focusedNodeId: null,
		activeNodeId: "node-1",
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

const createProjectWithFocusedVideo = (): StudioProject => {
	const project = createProject();
	const videoId = "node-video-1";
	project.canvas.nodes.push({
		id: videoId,
		type: "video",
		assetId: "asset-1",
		name: "Video 1",
		x: 320,
		y: 180,
		width: 640,
		height: 360,
		zIndex: 1,
		locked: false,
		hidden: false,
		createdAt: 2,
		updatedAt: 2,
	});
	project.ui.focusedNodeId = videoId;
	project.ui.activeNodeId = videoId;
	return project;
};

beforeEach(() => {
	vi.mocked(getAllProjects).mockResolvedValue([]);
	vi.mocked(getCurrentProjectId).mockResolvedValue(null);
	vi.mocked(getProject).mockResolvedValue(undefined);
	const project = createProject();
	useProjectStore.setState({
		status: "ready",
		projects: [],
		currentProjectId: project.id,
		currentProject: project,
		focusedSceneDrafts: {},
		error: null,
	});
});

describe("projectStore", () => {
	it("createCanvasNode(scene) 同时创建 scene 与 node", () => {
		const nodeId = useProjectStore.getState().createCanvasNode({
			type: "scene",
			name: "New Scene",
		});
		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find((item) => item.id === nodeId);
		expect(node?.type).toBe("scene");
		if (!node || node.type !== "scene") return;
		expect(project?.scenes[node.sceneId]?.name).toBe("New Scene");
		expect(project?.ui.focusedNodeId).toBeNull();
	});

	it("ensureProjectAssetByUri 会按 uri+kind 去重", () => {
		const firstId = useProjectStore.getState().ensureProjectAssetByUri({
			uri: "file:///same.wav",
			kind: "audio",
			name: "same.wav",
		});
		const secondId = useProjectStore.getState().ensureProjectAssetByUri({
			uri: "file:///same.wav",
			kind: "audio",
			name: "same.wav",
		});
		expect(firstId).toBe(secondId);
		expect(
			useProjectStore
				.getState()
				.currentProject?.assets.filter((asset) => asset.uri === "file:///same.wav")
				.length,
		).toBe(1);
	});

	it("updateProjectAssetMeta 可写入 asr 元数据", () => {
		useProjectStore.getState().updateProjectAssetMeta("asset-1", (prev) => ({
			...(prev ?? {}),
			asr: {
				id: "asr-1",
				source: {
					type: "asset",
					assetId: "asset-1",
					kind: "video",
					uri: "file:///asset-1.png",
					fileName: "asset-1.png",
					duration: 1,
				},
				language: "zh",
				model: "tiny",
				createdAt: 1,
				updatedAt: 1,
				segments: [],
			},
		}));
		const asset = useProjectStore.getState().getProjectAssetById("asset-1");
		expect(asset?.meta?.asr?.id).toBe("asr-1");
	});

	it("createCanvasNode 支持 video/audio/image/text 四种类型", () => {
		const activeSceneBefore =
			useProjectStore.getState().currentProject?.ui.activeSceneId ?? null;
		const videoId = useProjectStore.getState().createCanvasNode({
			type: "video",
			assetId: "asset-1",
			name: "video",
		});
		const audioId = useProjectStore.getState().createCanvasNode({
			type: "audio",
			assetId: "asset-1",
			name: "audio",
		});
		const imageId = useProjectStore.getState().createCanvasNode({
			type: "image",
			assetId: "asset-1",
			name: "image",
		});
		const textId = useProjectStore.getState().createCanvasNode({
			type: "text",
			text: "hello",
			name: "text",
		});
		const project = useProjectStore.getState().currentProject;
		expect(project?.canvas.nodes.find((node) => node.id === videoId)?.type).toBe(
			"video",
		);
		expect(project?.canvas.nodes.find((node) => node.id === audioId)?.type).toBe(
			"audio",
		);
		expect(project?.canvas.nodes.find((node) => node.id === imageId)?.type).toBe(
			"image",
		);
		expect(project?.canvas.nodes.find((node) => node.id === textId)?.type).toBe(
			"text",
		);
		expect(project?.ui.activeSceneId).toBe(activeSceneBefore);
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
		};
		useProjectStore.getState().updateActiveSceneTimeline(nextTimeline);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-1"].timeline
				.elements.length,
		).toBe(1);
	});

	it("setFocusedNode(scene) 会同步 activeNode 与 activeScene", () => {
		useProjectStore.getState().setFocusedNode("node-1");
		const ui = useProjectStore.getState().currentProject?.ui;
		expect(ui?.focusedNodeId).toBe("node-1");
		expect(ui?.activeNodeId).toBe("node-1");
		expect(ui?.activeSceneId).toBe("scene-1");
	});

	it("setFocusedNode(non-focusable) 会忽略 focus 写入", () => {
		const videoId = useProjectStore.getState().createCanvasNode({
			type: "video",
			assetId: "asset-1",
		});
		useProjectStore.getState().setActiveNode("node-1");
		useProjectStore.getState().setFocusedNode(videoId);
		const ui = useProjectStore.getState().currentProject?.ui;
		expect(ui?.focusedNodeId).toBeNull();
		expect(ui?.activeNodeId).toBe("node-1");
		expect(ui?.activeSceneId).toBe("scene-1");
	});

	it("删除 focused 节点时会清理 focusedNodeId", () => {
		useProjectStore.getState().setFocusedNode("node-1");
		useProjectStore.getState().removeCanvasNodeForHistory("node-1");
		expect(useProjectStore.getState().currentProject?.ui.focusedNodeId).toBeNull();
	});

	it("initialize 会清理 non-focusable 节点的 focusedNodeId", async () => {
		const project = createProjectWithFocusedVideo();
		const record: ProjectRecord = {
			id: project.id,
			name: "project",
			data: project,
			createdAt: 1,
			updatedAt: 2,
		};
		vi.mocked(getAllProjects).mockResolvedValue([record]);
		vi.mocked(getCurrentProjectId).mockResolvedValue(project.id);
		useProjectStore.setState({
			status: "idle",
			projects: [],
			currentProjectId: null,
			currentProject: null,
			focusedSceneDrafts: {},
			error: null,
		});

		await useProjectStore.getState().initialize();

		expect(useProjectStore.getState().currentProject?.ui.focusedNodeId).toBeNull();
	});

	it("switchProject 会清理 non-focusable 节点的 focusedNodeId", async () => {
		const project = createProjectWithFocusedVideo();
		const record: ProjectRecord = {
			id: "project-2",
			name: "project-2",
			data: {
				...project,
				id: "project-2",
			},
			createdAt: 1,
			updatedAt: 2,
		};
		vi.mocked(getProject).mockResolvedValue(record);

		await useProjectStore.getState().switchProject("project-2");

		expect(useProjectStore.getState().currentProject?.ui.focusedNodeId).toBeNull();
	});

	it("saveCurrentProject 可持久化当前项目", async () => {
		await expect(
			useProjectStore.getState().saveCurrentProject(),
		).resolves.toBeUndefined();
		expect(useProjectStore.getState().currentProject?.revision).toBeGreaterThan(0);
	});
});
