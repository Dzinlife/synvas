import type { TimelineJSON } from "core/editor/timelineLoader";
import type { StudioProject } from "core/studio/types";
import { framesToTimecode } from "core/utils/timecode";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "@/projects/projectStore";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { useStudioHistoryStore } from "./studioHistoryStore";

const createTimeline = (elementsCount: number): TimelineJSON => ({
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
	elements: Array.from({ length: elementsCount }).map((_, index) => {
		const start = index * 30;
		const end = start + 30;
		return {
			id: `element-${index}`,
			type: "Image",
			component: "image",
			name: `Image ${index}`,
			assetId: "asset-1",
			props: {},
			timeline: {
				start,
				end,
				startTimecode: framesToTimecode(start, 30),
				endTimecode: framesToTimecode(end, 30),
				trackIndex: 0,
				role: "clip",
			},
		};
	}),
});

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
			{
				id: "node-2",
				type: "scene",
				sceneId: "scene-2",
				name: "Scene 2",
				x: 200,
				y: 120,
				width: 960,
				height: 540,
				zIndex: 1,
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
			timeline: createTimeline(0),
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
		},
		"scene-2": {
			id: "scene-2",
			name: "Scene 2",
			timeline: createTimeline(1),
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
		},
	},
	ui: {
		activeSceneId: "scene-1",
		focusedNodeId: "node-1",
		activeNodeId: "node-1",
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

beforeEach(() => {
	useProjectStore.setState({
		status: "ready",
		projects: [],
		currentProjectId: "project-1",
		currentProject: createProject(),
		focusedSceneDrafts: {},
		sceneTimelineMutationOpIds: {},
		error: null,
	});
	useStudioHistoryStore.getState().clear();
});

describe("studioHistoryStore", () => {
	it("同 opId 的跨 scene timeline 历史会合并为一条 batch", () => {
		useStudioHistoryStore.getState().push({
			kind: "scene.timeline",
			timelineRef: toSceneTimelineRef("scene-1"),
			sceneId: "scene-1",
			before: createTimeline(0),
			after: createTimeline(1),
			focusNodeId: "node-1",
			opId: "op-1",
		});
		useStudioHistoryStore.getState().push({
			kind: "scene.timeline",
			timelineRef: toSceneTimelineRef("scene-2"),
			sceneId: "scene-2",
			before: createTimeline(1),
			after: createTimeline(2),
			focusNodeId: "node-2",
			opId: "op-1",
		});

		const past = useStudioHistoryStore.getState().past;
		expect(past).toHaveLength(1);
		expect(past[0]?.kind).toBe("scene.timeline.batch");
		if (past[0]?.kind !== "scene.timeline.batch") return;
		expect(past[0].entries).toHaveLength(2);
	});

	it("同 scene 同 opId 多次 push 仅保留首次 before", () => {
		useStudioHistoryStore.getState().push({
			kind: "scene.timeline",
			timelineRef: toSceneTimelineRef("scene-2"),
			sceneId: "scene-2",
			before: createTimeline(0),
			after: createTimeline(1),
			focusNodeId: "node-2",
			opId: "op-2",
		});
		useStudioHistoryStore.getState().push({
			kind: "scene.timeline",
			timelineRef: toSceneTimelineRef("scene-2"),
			sceneId: "scene-2",
			before: createTimeline(5),
			after: createTimeline(3),
			focusNodeId: "node-2",
			opId: "op-2",
		});

		const past = useStudioHistoryStore.getState().past;
		expect(past).toHaveLength(1);
		expect(past[0]?.kind).toBe("scene.timeline");
		if (past[0]?.kind !== "scene.timeline") return;
		expect(past[0].before.elements).toHaveLength(0);
		expect(past[0].after.elements).toHaveLength(3);
	});

	it("undo/redo scene.timeline 时会同步 focus scene", () => {
		const before = createTimeline(0);
		const after = createTimeline(2);
		useStudioHistoryStore.getState().push({
			kind: "scene.timeline",
			timelineRef: toSceneTimelineRef("scene-2"),
			sceneId: "scene-2",
			before,
			after,
			focusNodeId: "node-2",
		});

		useStudioHistoryStore.getState().undo();
		expect(useProjectStore.getState().currentProject?.ui.focusedNodeId).toBe(
			"node-2",
		);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-2"].timeline
				.elements.length,
		).toBe(0);

		useStudioHistoryStore.getState().redo();
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-2"].timeline
				.elements.length,
		).toBe(2);
	});

	it("undo/redo scene.timeline.batch 时会同步回滚多个 scene", () => {
		useStudioHistoryStore.getState().push({
			kind: "scene.timeline",
			timelineRef: toSceneTimelineRef("scene-1"),
			sceneId: "scene-1",
			before: createTimeline(0),
			after: createTimeline(1),
			focusNodeId: "node-1",
			opId: "op-batch",
		});
		useStudioHistoryStore.getState().push({
			kind: "scene.timeline",
			timelineRef: toSceneTimelineRef("scene-2"),
			sceneId: "scene-2",
			before: createTimeline(1),
			after: createTimeline(3),
			focusNodeId: "node-2",
			opId: "op-batch",
		});

		useStudioHistoryStore.getState().undo();
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-1"].timeline
				.elements.length,
		).toBe(0);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-2"].timeline
				.elements.length,
		).toBe(1);

		useStudioHistoryStore.getState().redo();
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-1"].timeline
				.elements.length,
		).toBe(1);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-2"].timeline
				.elements.length,
		).toBe(3);
	});

	it("canvas.node-layout.batch 可撤销和重做", () => {
		useProjectStore.getState().updateCanvasNodeLayout("node-1", {
			x: 120,
			y: 80,
		});
		useProjectStore.getState().updateCanvasNodeLayout("node-2", {
			x: 360,
			y: 240,
		});
		useStudioHistoryStore.getState().push({
			kind: "canvas.node-layout.batch",
			entries: [
				{
					nodeId: "node-1",
					before: {
						x: 0,
						y: 0,
						width: 960,
						height: 540,
						zIndex: 0,
						hidden: false,
						locked: false,
					},
					after: {
						x: 120,
						y: 80,
						width: 960,
						height: 540,
						zIndex: 0,
						hidden: false,
						locked: false,
					},
				},
				{
					nodeId: "node-2",
					before: {
						x: 200,
						y: 120,
						width: 960,
						height: 540,
						zIndex: 1,
						hidden: false,
						locked: false,
					},
					after: {
						x: 360,
						y: 240,
						width: 960,
						height: 540,
						zIndex: 1,
						hidden: false,
						locked: false,
					},
				},
			],
			focusNodeId: "node-2",
		});

		useStudioHistoryStore.getState().undo();
		expect(
			useProjectStore.getState().currentProject?.canvas.nodes.find(
				(node) => node.id === "node-1",
			)?.x,
		).toBe(0);
		expect(
			useProjectStore.getState().currentProject?.canvas.nodes.find(
				(node) => node.id === "node-2",
			)?.x,
		).toBe(200);

		useStudioHistoryStore.getState().redo();
		expect(
			useProjectStore.getState().currentProject?.canvas.nodes.find(
				(node) => node.id === "node-1",
			)?.x,
		).toBe(120);
		expect(
			useProjectStore.getState().currentProject?.canvas.nodes.find(
				(node) => node.id === "node-2",
			)?.x,
		).toBe(360);
	});

	it("canvas.node-create.batch 可撤销和重做", () => {
		const scene = {
			id: "scene-3",
			name: "Scene 3",
			timeline: createTimeline(2),
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
		};
		const sceneNode = {
			id: "node-3",
			type: "scene" as const,
			sceneId: "scene-3",
			name: "Scene 3",
			x: 480,
			y: 320,
			width: 960,
			height: 540,
			zIndex: 2,
			locked: false,
			hidden: false,
			createdAt: 1,
			updatedAt: 1,
		};
		const videoNode = {
			id: "node-4",
			type: "video" as const,
			assetId: "asset-1",
			name: "Video 4",
			x: 1280,
			y: 320,
			width: 320,
			height: 180,
			zIndex: 3,
			locked: false,
			hidden: false,
			createdAt: 1,
			updatedAt: 1,
		};
		const entries = [{ node: sceneNode, scene }, { node: videoNode }];
		useStudioHistoryStore.getState().push({
			kind: "canvas.node-create.batch",
			entries,
			focusNodeId: null,
		});

		useProjectStore.getState().appendCanvasGraphBatch(entries);
		expect(
			useProjectStore.getState().currentProject?.canvas.nodes.some(
				(node) => node.id === "node-3",
			),
		).toBe(true);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-3"],
		).toBeTruthy();

		useStudioHistoryStore.getState().undo();
		expect(
			useProjectStore.getState().currentProject?.canvas.nodes.some(
				(node) => node.id === "node-3",
			),
		).toBe(false);
		expect(
			useProjectStore.getState().currentProject?.canvas.nodes.some(
				(node) => node.id === "node-4",
			),
		).toBe(false);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-3"],
		).toBeUndefined();

		useStudioHistoryStore.getState().redo();
		expect(
			useProjectStore.getState().currentProject?.canvas.nodes.some(
				(node) => node.id === "node-3",
			),
		).toBe(true);
		expect(
			useProjectStore.getState().currentProject?.canvas.nodes.some(
				(node) => node.id === "node-4",
			),
		).toBe(true);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-3"],
		).toBeTruthy();
	});

	it("canvas.node-create(scene) 可撤销和重做", () => {
		const scene = {
			id: "scene-3",
			name: "Scene 3",
			timeline: createTimeline(0),
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
		};
		const node = {
			id: "node-3",
			type: "scene" as const,
			sceneId: "scene-3",
			name: "Scene 3",
			x: 0,
			y: 0,
			width: 960,
			height: 540,
			zIndex: 2,
			locked: false,
			hidden: false,
			createdAt: 1,
			updatedAt: 1,
		};
		useStudioHistoryStore.getState().push({
			kind: "canvas.node-create",
			scene,
			node,
			focusNodeId: null,
		});

		useProjectStore.getState().restoreSceneGraphForHistory(scene, node);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-3"],
		).toBeTruthy();

		useStudioHistoryStore.getState().undo();
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-3"],
		).toBeUndefined();

		useStudioHistoryStore.getState().redo();
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-3"],
		).toBeTruthy();
	});
});
