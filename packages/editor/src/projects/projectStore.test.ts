import type { TimelineJSON } from "core/timeline-system/loader";
import type { StudioProject } from "@/studio/project/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasCameraStore } from "@/studio/canvas/cameraStore";
import {
	getAllProjects,
	getCurrentProjectId,
	getProject,
	type ProjectRecord,
	putProject,
} from "./projectDb";

vi.mock("./projectDb", async () => {
	const actual =
		await vi.importActual<typeof import("./projectDb")>("./projectDb");
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
			kind: "image",
			name: "asset-1",
			locator: {
				type: "linked-file",
				filePath: "/asset-1.png",
			},
			meta: {
				fileName: "asset-1.png",
				hash: "hash-asset-1",
			},
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
				siblingOrder: 0,
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
		canvasSnapEnabled: true,
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
		siblingOrder: 1,
		locked: false,
		hidden: false,
		createdAt: 2,
		updatedAt: 2,
	});
	project.ui.focusedNodeId = videoId;
	project.ui.activeNodeId = videoId;
	return project;
};

const createSceneReferenceElement = (
	id: string,
	sceneId: string,
	type: "Composition" | "CompositionAudioClip" = "Composition",
) => ({
	id,
	type,
	component: type === "Composition" ? "composition" : "composition-audio",
	name: id,
	props: { sceneId },
	timeline: {
		start: 0,
		end: 30,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:01:00",
		trackIndex: 0,
		role:
			type === "CompositionAudioClip" ? ("audio" as const) : ("clip" as const),
	},
});

const createProjectWithReferencedScene = (): StudioProject => {
	const project = createProject();
	const scene1 = project.scenes["scene-1"];
	if (!scene1) {
		throw new Error("scene-1 不存在");
	}
	project.canvas.nodes.push({
		id: "node-2",
		type: "scene",
		sceneId: "scene-2",
		name: "Scene 2",
		x: 1200,
		y: 0,
		width: 960,
		height: 540,
		siblingOrder: 1,
		locked: false,
		hidden: false,
		createdAt: 2,
		updatedAt: 2,
	});
	project.scenes["scene-2"] = {
		id: "scene-2",
		name: "Scene 2",
		timeline: {
			...scene1.timeline,
			elements: [
				createSceneReferenceElement("composition-scene-2", "scene-1"),
				createSceneReferenceElement(
					"composition-audio-scene-2",
					"scene-1",
					"CompositionAudioClip",
				),
			],
		},
		posterFrame: 0,
		createdAt: 2,
		updatedAt: 2,
	};
	project.ui.activeSceneId = "scene-1";
	project.ui.activeNodeId = "node-1";
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
		sceneTimelineMutationOpIds: {},
		error: null,
	});
	useCanvasCameraStore.getState().setFromProject(project.ui.camera);
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

	it("updateCanvasNodeLayoutBatch 会在一次写入中更新多个节点", () => {
		const extraNodeId = useProjectStore.getState().createCanvasNode({
			type: "video",
			assetId: "asset-1",
		});
		const beforeRevision =
			useProjectStore.getState().currentProject?.revision ?? 0;
		useProjectStore.getState().updateCanvasNodeLayoutBatch([
			{
				nodeId: "node-1",
				patch: {
					x: 120,
					y: 80,
				},
			},
			{
				nodeId: extraNodeId,
				patch: {
					x: 360,
					y: 240,
					width: 520,
				},
			},
		]);
		const project = useProjectStore.getState().currentProject;
		const node1 = project?.canvas.nodes.find((node) => node.id === "node-1");
		const extraNode =
			project?.canvas.nodes.find((node) => node.id === extraNodeId) ?? null;
		expect(node1?.x).toBe(120);
		expect(node1?.y).toBe(80);
		expect(extraNode?.x).toBe(360);
		expect(extraNode?.y).toBe(240);
		expect(extraNode?.width).toBe(520);
		expect(project?.revision).toBe(beforeRevision + 1);
	});

	it("updateCanvasNodeLayoutBatch 会忽略无效节点与 no-op patch", () => {
		const beforeProject = useProjectStore.getState().currentProject;
		const beforeRevision = beforeProject?.revision ?? 0;
		useProjectStore.getState().updateCanvasNodeLayoutBatch([
			{
				nodeId: "node-missing",
				patch: {
					x: 999,
				},
			},
			{
				nodeId: "node-1",
				patch: {
					x: 0,
					y: 0,
					width: 960,
					height: 540,
					siblingOrder: 0,
					hidden: false,
					locked: false,
				},
			},
			{
				nodeId: "node-1",
				patch: {},
			},
		]);
		const afterProject = useProjectStore.getState().currentProject;
		expect(afterProject).toBe(beforeProject);
		expect(afterProject?.revision).toBe(beforeRevision);
	});

	it("ensureProjectAsset 按 kind+hash 去重", () => {
		const firstId = useProjectStore.getState().ensureProjectAsset({
			kind: "audio",
			name: "same.wav",
			locator: {
				type: "linked-file",
				filePath: "/same-a.wav",
			},
			meta: {
				hash: "same-hash",
				fileName: "same.wav",
			},
		});
		const secondId = useProjectStore.getState().ensureProjectAsset({
			kind: "audio",
			name: "same-duplicate.wav",
			locator: {
				type: "linked-file",
				filePath: "/same-b.wav",
			},
			meta: {
				hash: "same-hash",
				fileName: "same-duplicate.wav",
			},
		});
		expect(firstId).toBe(secondId);
		const assets = useProjectStore.getState().currentProject?.assets ?? [];
		expect(
			assets.filter(
				(asset) => asset.kind === "audio" && asset.meta?.hash === "same-hash",
			).length,
		).toBe(1);
	});

	it("ensureProjectAsset 在无 hash 时按 kind+locator 去重", () => {
		const firstId = useProjectStore.getState().ensureProjectAsset({
			kind: "audio",
			name: "same.wav",
			locator: {
				type: "linked-file",
				filePath: "/same.wav",
			},
		});
		const secondId = useProjectStore.getState().ensureProjectAsset({
			kind: "audio",
			name: "same.wav",
			locator: {
				type: "linked-file",
				filePath: "/same.wav",
			},
		});
		expect(firstId).toBe(secondId);
		const assets = useProjectStore.getState().currentProject?.assets ?? [];
		expect(
			assets.filter(
				(asset) =>
					asset.kind === "audio" &&
					asset.locator.type === "linked-file" &&
					asset.locator.filePath === "/same.wav",
			).length,
		).toBe(1);
	});

	it("ensureProjectAsset 合并 meta 时不覆盖已有 asr", () => {
		useProjectStore.getState().updateProjectAssetMeta("asset-1", (prev) => ({
			...(prev ?? {}),
			asr: {
				id: "asr-1",
				source: {
					type: "asset",
					assetId: "asset-1",
					kind: "video",
					uri: "https://example.com/asset-1.png",
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

		useProjectStore.getState().ensureProjectAsset({
			kind: "image",
			name: "asset-1.png",
			locator: {
				type: "linked-file",
				filePath: "/asset-1.png",
			},
			meta: {
				hash: "hash-asset-1",
				fileName: "asset-1.png",
				sourceSize: {
					width: 100,
					height: 50,
				},
			},
		});

		const asset = useProjectStore.getState().getProjectAssetById("asset-1");
		expect(asset?.meta?.asr?.id).toBe("asr-1");
		expect(asset?.meta?.sourceSize).toEqual({
			width: 100,
			height: 50,
		});
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
		expect(
			project?.canvas.nodes.find((node) => node.id === videoId)?.type,
		).toBe("video");
		expect(
			project?.canvas.nodes.find((node) => node.id === audioId)?.type,
		).toBe("audio");
		expect(
			project?.canvas.nodes.find((node) => node.id === imageId)?.type,
		).toBe("image");
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

	it("updateSceneTimeline 会记录 sceneTimelineMutationOpIds", () => {
		const baseTimeline =
			useProjectStore.getState().currentProject?.scenes["scene-1"].timeline;
		if (!baseTimeline) return;
		useProjectStore.getState().updateSceneTimeline(
			"scene-1",
			{
				...baseTimeline,
				elements: baseTimeline.elements.slice(0, 0),
			},
			{ historyOpId: "op-project-1" },
		);
		expect(
			useProjectStore.getState().sceneTimelineMutationOpIds["scene-1"],
		).toBe("op-project-1");
	});

	it("setFocusedNode(scene) 会同步 activeNode 与 activeScene", () => {
		useProjectStore.getState().setFocusedNode("node-1");
		const ui = useProjectStore.getState().currentProject?.ui;
		expect(ui?.focusedNodeId).toBe("node-1");
		expect(ui?.activeNodeId).toBe("node-1");
		expect(ui?.activeSceneId).toBe("scene-1");
	});

	it("setCanvasSnapEnabled 会更新项目级画布吸附开关", () => {
		useProjectStore.getState().setCanvasSnapEnabled(false);
		expect(
			useProjectStore.getState().currentProject?.ui.canvasSnapEnabled,
		).toBe(false);
		useProjectStore.getState().setCanvasSnapEnabled(true);
		expect(
			useProjectStore.getState().currentProject?.ui.canvasSnapEnabled,
		).toBe(true);
	});

	it("setFocusedNode 会写入 focusedNodeId", () => {
		const textId = useProjectStore.getState().createCanvasNode({
			type: "text",
			text: "Demo",
		});
		useProjectStore.getState().setActiveNode("node-1");
		useProjectStore.getState().setFocusedNode(textId);
		const ui = useProjectStore.getState().currentProject?.ui;
		expect(ui?.focusedNodeId).toBe(textId);
		expect(ui?.activeNodeId).toBe(textId);
		expect(ui?.activeSceneId).toBe("scene-1");
	});

	it("删除 focused 节点时会清理 focusedNodeId", () => {
		useProjectStore.getState().setFocusedNode("node-1");
		useProjectStore.getState().removeCanvasNodeForHistory("node-1");
		expect(
			useProjectStore.getState().currentProject?.ui.focusedNodeId,
		).toBeNull();
	});

	it("removeCanvasGraphBatch 会保留仍被引用的 scene 文档，只移除 scene node", () => {
		const project = createProjectWithReferencedScene();
		useProjectStore.setState({
			status: "ready",
			projects: [],
			currentProjectId: project.id,
			currentProject: project,
			focusedSceneDrafts: {},
			sceneTimelineMutationOpIds: {},
			error: null,
		});

		useProjectStore.getState().removeCanvasGraphBatch(["node-1"]);

		const currentProject = useProjectStore.getState().currentProject;
		expect(
			currentProject?.canvas.nodes.some((node) => node.id === "node-1"),
		).toBe(false);
		expect(currentProject?.scenes["scene-1"]).toBeTruthy();
		expect(currentProject?.ui.activeSceneId).toBe("scene-1");
		expect(currentProject?.ui.activeNodeId).toBeNull();
		expect(
			useProjectStore.getState().getSceneTombstone("scene-1")?.node.id,
		).toBe("node-1");
	});

	it("restoreDetachedSceneNodeForHistory 会恢复 detached scene node 并清理 tombstone", () => {
		const project = createProjectWithReferencedScene();
		useProjectStore.setState({
			status: "ready",
			projects: [],
			currentProjectId: project.id,
			currentProject: project,
			focusedSceneDrafts: {},
			sceneTimelineMutationOpIds: {},
			error: null,
		});

		useProjectStore.getState().removeCanvasGraphBatch(["node-1"]);
		const tombstone = useProjectStore.getState().getSceneTombstone("scene-1");
		expect(tombstone).toBeTruthy();
		if (!tombstone) return;

		useProjectStore
			.getState()
			.restoreDetachedSceneNodeForHistory(tombstone.node);

		const currentProject = useProjectStore.getState().currentProject;
		expect(
			currentProject?.canvas.nodes.some((node) => node.id === "node-1"),
		).toBe(true);
		expect(useProjectStore.getState().getSceneTombstone("scene-1")).toBeNull();
	});

	it("removeCanvasGraphBatch 会完整删除未被引用的 scene", () => {
		useProjectStore.getState().removeCanvasGraphBatch(["node-1"]);
		const currentProject = useProjectStore.getState().currentProject;
		expect(currentProject?.scenes["scene-1"]).toBeUndefined();
		expect(
			currentProject?.canvas.nodes.some((node) => node.id === "node-1"),
		).toBe(false);
	});

	it("initialize 会清理 focusedNodeId", async () => {
		const project = createProjectWithFocusedVideo();
		project.ui.camera = { x: 12, y: -18, zoom: 1.2 };
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
			sceneTimelineMutationOpIds: {},
			error: null,
		});

		await useProjectStore.getState().initialize();

		expect(
			useProjectStore.getState().currentProject?.ui.focusedNodeId,
		).toBeNull();
		expect(useCanvasCameraStore.getState().camera).toEqual(project.ui.camera);
	});

	it("createProject 会把新项目 ui.camera 同步到 cameraStore", async () => {
		useCanvasCameraStore.getState().setCamera({ x: 88, y: -32, zoom: 1.4 });

		await expect(
			useProjectStore.getState().createProject(),
		).resolves.toBeUndefined();

		const project = useProjectStore.getState().currentProject;
		expect(project).toBeTruthy();
		if (!project) return;
		expect(useCanvasCameraStore.getState().camera).toEqual(project.ui.camera);
	});

	it("switchProject 会清理 focusedNodeId", async () => {
		const project = createProjectWithFocusedVideo();
		project.ui.camera = { x: -45, y: 30, zoom: 0.85 };
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

		expect(
			useProjectStore.getState().currentProject?.ui.focusedNodeId,
		).toBeNull();
		expect(useCanvasCameraStore.getState().camera).toEqual(project.ui.camera);
	});

	it("saveCurrentProject 可持久化当前项目", async () => {
		const nextCamera = { x: 33, y: 44, zoom: 1.3 };
		useCanvasCameraStore.getState().setCamera(nextCamera);
		await expect(
			useProjectStore.getState().saveCurrentProject(),
		).resolves.toBeUndefined();
		expect(useProjectStore.getState().currentProject?.revision).toBeGreaterThan(
			0,
		);
		expect(useProjectStore.getState().currentProject?.ui.camera).toEqual(
			nextCamera,
		);
	});

	it("saveCurrentProject 持久化时不写入 ot 调试数据", async () => {
		const nextCamera = { x: -20, y: 16, zoom: 0.9 };
		useCanvasCameraStore.getState().setCamera(nextCamera);
		await expect(
			useProjectStore.getState().saveCurrentProject(),
		).resolves.toBeUndefined();
		const lastCall = vi.mocked(putProject).mock.calls.at(-1)?.[0];
		expect(lastCall).toBeDefined();
		expect(lastCall?.data.ot).toBeUndefined();
		expect(lastCall?.data.ui.camera).toEqual(nextCamera);
	});
});
