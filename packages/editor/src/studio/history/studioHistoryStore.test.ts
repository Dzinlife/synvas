import { buildTimelineBatchCommandFromSnapshots } from "core/editor/ot";
import {
	loadTimelineFromObject,
	type TimelineJSON,
} from "core/editor/timelineLoader";
import type { StudioProject } from "core/studio/types";
import { framesToTimecode } from "core/utils/timecode";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "@/projects/projectStore";
import { createTestEditorRuntime } from "@/scene-editor/runtime/testUtils";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { applyTimelineJsonToStore } from "@/studio/scene/timelineSession";
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

const createSceneReferenceElement = (
	sceneId: string,
	type: "Composition" | "CompositionAudioClip" = "Composition",
) => ({
	id: `${type}-${sceneId}`,
	type,
	component: type === "Composition" ? "composition" : "composition-audio",
	name: `${type}-${sceneId}`,
	props: { sceneId },
	timeline: {
		start: 0,
		end: 30,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:01:00",
		trackIndex: type === "CompositionAudioClip" ? -1 : 0,
		role:
			type === "CompositionAudioClip" ? ("audio" as const) : ("clip" as const),
	},
});

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
			{
				id: "node-2",
				type: "scene",
				sceneId: "scene-2",
				name: "Scene 2",
				x: 200,
				y: 120,
				width: 960,
				height: 540,
				siblingOrder: 1,
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
		canvasSnapEnabled: true,
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

const toTimelineOtSnapshot = (timeline: TimelineJSON) => {
	const loaded = loadTimelineFromObject(timeline);
	return {
		elements: loaded.elements,
		tracks: loaded.tracks,
		audioTrackStates: {},
		rippleEditingEnabled: loaded.settings.rippleEditingEnabled,
	};
};

const createRippleTimeline = (): TimelineJSON => {
	const base = createTimeline(2);
	return {
		...base,
		settings: {
			...base.settings,
			rippleEditingEnabled: true,
		},
	};
};

const moveElementFrames = (
	timeline: TimelineJSON,
	elementId: string,
	start: number,
	end: number,
): TimelineJSON => {
	return {
		...timeline,
		elements: timeline.elements.map((element) =>
			element.id === elementId
				? {
						...element,
						timeline: {
							...element.timeline,
							start,
							end,
							startTimecode: framesToTimecode(start, timeline.fps),
							endTimecode: framesToTimecode(end, timeline.fps),
						},
					}
				: element,
		),
	};
};

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
			opId: "op-1",
		});
		useStudioHistoryStore.getState().push({
			kind: "scene.timeline",
			timelineRef: toSceneTimelineRef("scene-2"),
			sceneId: "scene-2",
			before: createTimeline(1),
			after: createTimeline(2),
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
			opId: "op-2",
		});
		useStudioHistoryStore.getState().push({
			kind: "scene.timeline",
			timelineRef: toSceneTimelineRef("scene-2"),
			sceneId: "scene-2",
			before: createTimeline(5),
			after: createTimeline(3),
			opId: "op-2",
		});

		const past = useStudioHistoryStore.getState().past;
		expect(past).toHaveLength(1);
		expect(past[0]?.kind).toBe("scene.timeline");
		if (past[0]?.kind !== "scene.timeline") return;
		expect(past[0].before.elements).toHaveLength(0);
		expect(past[0].after.elements).toHaveLength(3);
	});

	it("undo/redo scene.timeline 时不会改动 focus scene", () => {
		const before = createTimeline(0);
		const after = createTimeline(2);
		useStudioHistoryStore.getState().push({
			kind: "scene.timeline",
			timelineRef: toSceneTimelineRef("scene-2"),
			sceneId: "scene-2",
			before,
			after,
		});

		useStudioHistoryStore.getState().undo();
		expect(useProjectStore.getState().currentProject?.ui.focusedNodeId).toBe(
			"node-1",
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
			opId: "op-batch",
		});
		useStudioHistoryStore.getState().push({
			kind: "scene.timeline",
			timelineRef: toSceneTimelineRef("scene-2"),
			sceneId: "scene-2",
			before: createTimeline(1),
			after: createTimeline(3),
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
						siblingOrder: 0,
						hidden: false,
						locked: false,
					},
					after: {
						x: 120,
						y: 80,
						width: 960,
						height: 540,
						siblingOrder: 0,
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
						siblingOrder: 1,
						hidden: false,
						locked: false,
					},
					after: {
						x: 360,
						y: 240,
						width: 960,
						height: 540,
						siblingOrder: 1,
						hidden: false,
						locked: false,
					},
				},
			],
			focusNodeId: "node-2",
		});

		useStudioHistoryStore.getState().undo();
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.find((node) => node.id === "node-1")?.x,
		).toBe(0);
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.find((node) => node.id === "node-2")?.x,
		).toBe(200);

		useStudioHistoryStore.getState().redo();
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.find((node) => node.id === "node-1")?.x,
		).toBe(120);
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.find((node) => node.id === "node-2")?.x,
		).toBe(360);
	});

	it("canvas.node-update 可撤销和重做", () => {
		const textNode = {
			id: "node-text-1",
			type: "text" as const,
			name: "Text 1",
			x: 320,
			y: 240,
			width: 640,
			height: 160,
			siblingOrder: 9,
			locked: false,
			hidden: false,
			text: "before",
			fontSize: 48,
			createdAt: 1,
			updatedAt: 1,
		};
		useProjectStore.getState().restoreCanvasNodeForHistory(textNode);
		const before = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((node) => node.id === textNode.id);
		expect(before?.type).toBe("text");
		if (!before || before.type !== "text") return;
		useProjectStore.getState().updateCanvasNode(textNode.id, {
			text: "after",
			height: 200,
		} as never);
		const after = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((node) => node.id === textNode.id);
		expect(after?.type).toBe("text");
		if (!after || after.type !== "text") return;
		useStudioHistoryStore.getState().push({
			kind: "canvas.node-update",
			nodeId: textNode.id,
			before,
			after,
			focusNodeId: textNode.id,
		});

		useStudioHistoryStore.getState().undo();
		const undoNode = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((node) => node.id === textNode.id);
		expect(undoNode?.type).toBe("text");
		if (!undoNode || undoNode.type !== "text") return;
		expect(undoNode.text).toBe("before");
		expect(undoNode.height).toBe(160);

		useStudioHistoryStore.getState().redo();
		const redoNode = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((node) => node.id === textNode.id);
		expect(redoNode?.type).toBe("text");
		if (!redoNode || redoNode.type !== "text") return;
		expect(redoNode.text).toBe("after");
		expect(redoNode.height).toBe(200);
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
			siblingOrder: 2,
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
			siblingOrder: 3,
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
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-3"),
		).toBe(true);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-3"],
		).toBeTruthy();

		useStudioHistoryStore.getState().undo();
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-3"),
		).toBe(false);
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-4"),
		).toBe(false);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-3"],
		).toBeUndefined();

		useStudioHistoryStore.getState().redo();
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-3"),
		).toBe(true);
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-4"),
		).toBe(true);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-3"],
		).toBeTruthy();
	});

	it("canvas.node-delete 可撤销和重做", () => {
		const node = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((item) => item.id === "node-2");
		const scene = useProjectStore.getState().currentProject?.scenes["scene-2"];
		expect(node?.type).toBe("scene");
		expect(scene).toBeTruthy();
		if (!node || node.type !== "scene" || !scene) return;

		useStudioHistoryStore.getState().push({
			kind: "canvas.node-delete",
			node,
			scene,
			focusNodeId: null,
		});
		useProjectStore.getState().removeSceneGraphForHistory(scene.id, node.id);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-2"],
		).toBeUndefined();

		useStudioHistoryStore.getState().undo();
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-2"],
		).toBeTruthy();

		useStudioHistoryStore.getState().redo();
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-2"],
		).toBeUndefined();
	});

	it("canvas.node-delete(scene detached) 可撤销和重做", () => {
		const project = createProject();
		const scene2 = project.scenes["scene-2"];
		if (!scene2) {
			throw new Error("scene-2 不存在");
		}
		project.scenes["scene-2"] = {
			...scene2,
			timeline: {
				...scene2.timeline,
				elements: [
					createSceneReferenceElement("scene-1"),
					createSceneReferenceElement("scene-1", "CompositionAudioClip"),
				],
			},
		};
		useProjectStore.setState({
			status: "ready",
			projects: [],
			currentProjectId: project.id,
			currentProject: project,
			focusedSceneDrafts: {},
			sceneTimelineMutationOpIds: {},
			error: null,
		});

		const node = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((item) => item.id === "node-1");
		expect(node?.type).toBe("scene");
		if (!node || node.type !== "scene") return;

		useStudioHistoryStore.getState().push({
			kind: "canvas.node-delete",
			node,
			focusNodeId: null,
		});
		useProjectStore.getState().removeSceneNodeForHistory(node.sceneId, node.id);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-1"],
		).toBeTruthy();
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((item) => item.id === "node-1"),
		).toBe(false);

		useStudioHistoryStore.getState().undo();
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((item) => item.id === "node-1"),
		).toBe(true);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-1"],
		).toBeTruthy();

		useStudioHistoryStore.getState().redo();
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((item) => item.id === "node-1"),
		).toBe(false);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-1"],
		).toBeTruthy();
	});

	it("canvas.node-delete.batch 可撤销和重做", () => {
		const currentProject = useProjectStore.getState().currentProject;
		const sceneNode = currentProject?.canvas.nodes.find(
			(item) => item.id === "node-2",
		);
		const scene = currentProject?.scenes["scene-2"];
		const plainNode = {
			id: "node-4",
			type: "video" as const,
			assetId: "asset-1",
			name: "Video 4",
			x: 1280,
			y: 320,
			width: 320,
			height: 180,
			siblingOrder: 3,
			locked: false,
			hidden: false,
			createdAt: 1,
			updatedAt: 1,
		};
		expect(sceneNode?.type).toBe("scene");
		expect(scene).toBeTruthy();
		if (!sceneNode || sceneNode.type !== "scene" || !scene) return;
		useProjectStore.getState().restoreCanvasNodeForHistory(plainNode);
		const entries = [
			{
				node: sceneNode,
				scene,
			},
			{ node: plainNode },
		];
		useStudioHistoryStore.getState().push({
			kind: "canvas.node-delete.batch",
			entries,
			focusNodeId: null,
		});
		useProjectStore.getState().removeCanvasGraphBatch(entries);

		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-2"),
		).toBe(false);
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-4"),
		).toBe(false);

		useStudioHistoryStore.getState().undo();
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-2"),
		).toBe(true);
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-4"),
		).toBe(true);

		useStudioHistoryStore.getState().redo();
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-2"),
		).toBe(false);
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-4"),
		).toBe(false);
	});

	it("canvas.node-delete.batch(scene detached) 可撤销和重做", () => {
		const project = createProject();
		const scene2 = project.scenes["scene-2"];
		if (!scene2) {
			throw new Error("scene-2 不存在");
		}
		project.scenes["scene-2"] = {
			...scene2,
			timeline: {
				...scene2.timeline,
				elements: [createSceneReferenceElement("scene-1")],
			},
		};
		useProjectStore.setState({
			status: "ready",
			projects: [],
			currentProjectId: project.id,
			currentProject: project,
			focusedSceneDrafts: {},
			sceneTimelineMutationOpIds: {},
			error: null,
		});
		const currentProject = useProjectStore.getState().currentProject;
		const sceneNode = currentProject?.canvas.nodes.find(
			(item) => item.id === "node-1",
		);
		const plainNode = {
			id: "node-4",
			type: "video" as const,
			assetId: "asset-1",
			name: "Video 4",
			x: 1280,
			y: 320,
			width: 320,
			height: 180,
			siblingOrder: 3,
			locked: false,
			hidden: false,
			createdAt: 1,
			updatedAt: 1,
		};
		expect(sceneNode?.type).toBe("scene");
		if (!sceneNode || sceneNode.type !== "scene") return;
		useProjectStore.getState().restoreCanvasNodeForHistory(plainNode);
		const entries = [{ node: sceneNode }, { node: plainNode }];

		useStudioHistoryStore.getState().push({
			kind: "canvas.node-delete.batch",
			entries,
			focusNodeId: null,
		});
		useProjectStore.getState().removeCanvasGraphBatch(entries);

		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-1"),
		).toBe(false);
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-4"),
		).toBe(false);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-1"],
		).toBeTruthy();

		useStudioHistoryStore.getState().undo();
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-1"),
		).toBe(true);
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-4"),
		).toBe(true);

		useStudioHistoryStore.getState().redo();
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-1"),
		).toBe(false);
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some((node) => node.id === "node-4"),
		).toBe(false);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-1"],
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
			siblingOrder: 2,
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

	it("canvas.frame-create 可撤销和重做 frame 与 parentId 变更", () => {
		const frameNode = {
			id: "node-frame-1",
			type: "frame" as const,
			name: "Frame 1",
			x: 120,
			y: 80,
			width: 640,
			height: 360,
			siblingOrder: 10,
			locked: false,
			hidden: false,
			parentId: null,
			createdAt: 1,
			updatedAt: 1,
		};
		useProjectStore.getState().restoreCanvasNodeForHistory(frameNode);
		const nodeBeforeReparent = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((node) => node.id === "node-2");
		useProjectStore.getState().updateCanvasNodeLayoutBatch([
			{
				nodeId: "node-2",
				patch: {
					parentId: frameNode.id,
				},
			},
		]);
		useStudioHistoryStore.getState().push({
			kind: "canvas.frame-create",
			createdFrame: frameNode,
			reparentChanges: [
				{
					nodeId: "node-2",
					beforeParentId: null,
					afterParentId: frameNode.id,
					beforeSiblingOrder: nodeBeforeReparent?.siblingOrder ?? 0,
					afterSiblingOrder: nodeBeforeReparent?.siblingOrder ?? 0,
				},
			],
			focusNodeId: frameNode.id,
		});

		useStudioHistoryStore.getState().undo();
		const frameAfterUndo = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((node) => node.id === frameNode.id);
		const nodeAfterUndo = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((node) => node.id === "node-2");
		expect(frameAfterUndo).toBeUndefined();
		expect(nodeAfterUndo?.parentId ?? null).toBeNull();

		useStudioHistoryStore.getState().redo();
		const frameAfterRedo = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((node) => node.id === frameNode.id);
		const nodeAfterRedo = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((node) => node.id === "node-2");
		expect(frameAfterRedo?.type).toBe("frame");
		expect(nodeAfterRedo?.parentId ?? null).toBe(frameNode.id);
	});

	it("切换用户后 canUndo/canRedo 按当前用户历史栈切换", () => {
		useStudioHistoryStore.getState().setActiveActor("user-1");
		useStudioHistoryStore.getState().push({
			kind: "scene.timeline",
			timelineRef: toSceneTimelineRef("scene-1"),
			sceneId: "scene-1",
			before: createTimeline(0),
			after: createTimeline(1),
		});

		expect(useStudioHistoryStore.getState().canUndo).toBe(true);
		useStudioHistoryStore.getState().setActiveActor("user-2");
		expect(useStudioHistoryStore.getState().canUndo).toBe(false);
		expect(useStudioHistoryStore.getState().canRedo).toBe(false);
		useStudioHistoryStore.getState().setActiveActor("user-1");
		expect(useStudioHistoryStore.getState().canUndo).toBe(true);
	});

	it("交错用户编辑下，撤销只移除当前用户影响", () => {
		const projectStore = useProjectStore.getState();
		projectStore.updateCanvasNodeLayout("node-1", { x: 100 });
		useStudioHistoryStore.getState().setActiveActor("user-1");
		useStudioHistoryStore.getState().push({
			kind: "canvas.node-layout",
			nodeId: "node-1",
			before: {
				x: 0,
				y: 0,
				width: 960,
				height: 540,
				siblingOrder: 0,
				hidden: false,
				locked: false,
			},
			after: {
				x: 100,
				y: 0,
				width: 960,
				height: 540,
				siblingOrder: 0,
				hidden: false,
				locked: false,
			},
			focusNodeId: "node-1",
		});

		projectStore.updateCanvasNodeLayout("node-1", { x: 200 });
		useStudioHistoryStore.getState().setActiveActor("user-2");
		useStudioHistoryStore.getState().push({
			kind: "canvas.node-layout",
			nodeId: "node-1",
			before: {
				x: 100,
				y: 0,
				width: 960,
				height: 540,
				siblingOrder: 0,
				hidden: false,
				locked: false,
			},
			after: {
				x: 200,
				y: 0,
				width: 960,
				height: 540,
				siblingOrder: 0,
				hidden: false,
				locked: false,
			},
			focusNodeId: "node-1",
		});

		useStudioHistoryStore.getState().setActiveActor("user-1");
		useStudioHistoryStore.getState().undo();

		const node = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((item) => item.id === "node-1");
		expect(node?.x).toBe(200);
	});

	it("timeline 命令交错编辑时，撤销仅回退当前用户 root 操作", () => {
		const projectStore = useProjectStore.getState();
		const beforeScene1 = createTimeline(2);
		const afterScene1 = createTimeline(1);
		projectStore.updateSceneTimeline("scene-1", beforeScene1, {
			txnId: "seed-s1",
		});

		useStudioHistoryStore.getState().setActiveActor("user-1");
		projectStore.updateSceneTimeline("scene-1", afterScene1, {
			txnId: "u1-del",
		});
		const scene1Command = buildTimelineBatchCommandFromSnapshots({
			before: toTimelineOtSnapshot(beforeScene1),
			after: toTimelineOtSnapshot(afterScene1),
		});
		expect(scene1Command).toBeTruthy();
		if (!scene1Command) return;
		useStudioHistoryStore.getState().push({
			kind: "timeline.ot",
			sceneId: "scene-1",
			command: scene1Command,
			txnId: "u1-del",
			intent: "root",
		});

		const beforeScene2 = createTimeline(1);
		const afterScene2 = {
			...beforeScene2,
			elements: beforeScene2.elements.map((element, index) =>
				index === 0
					? {
							...element,
							timeline: {
								...element.timeline,
								start: element.timeline.start + 15,
								end: element.timeline.end + 15,
								startTimecode: framesToTimecode(
									element.timeline.start + 15,
									30,
								),
								endTimecode: framesToTimecode(element.timeline.end + 15, 30),
							},
						}
					: element,
			),
		};
		projectStore.updateSceneTimeline("scene-2", beforeScene2, {
			txnId: "seed-s2",
		});
		useStudioHistoryStore.getState().setActiveActor("user-2");
		projectStore.updateSceneTimeline("scene-2", afterScene2, {
			txnId: "u2-move",
		});
		const scene2Command = buildTimelineBatchCommandFromSnapshots({
			before: toTimelineOtSnapshot(beforeScene2),
			after: toTimelineOtSnapshot(afterScene2),
		});
		expect(scene2Command).toBeTruthy();
		if (!scene2Command) return;
		useStudioHistoryStore.getState().push({
			kind: "timeline.ot",
			sceneId: "scene-2",
			command: scene2Command,
			txnId: "u2-move",
			intent: "root",
		});

		useStudioHistoryStore.getState().setActiveActor("user-1");
		useStudioHistoryStore.getState().undo();

		const current = useProjectStore.getState().currentProject;
		expect(current?.scenes["scene-1"].timeline.elements.length).toBe(2);
		const beforeStart = beforeScene2.elements[0]?.timeline.start ?? 0;
		expect(
			current?.scenes["scene-2"].timeline.elements[0]?.timeline.start,
		).toBe(beforeStart + 15);
	});

	it("timeline undo 回放会执行轨道重排，避免主轨重叠", () => {
		const projectStore = useProjectStore.getState();
		const before = createRippleTimeline();
		const afterUser1 = {
			...before,
			elements: before.elements.filter((element) => element.id !== "element-0"),
		};
		const afterUser2 = moveElementFrames(afterUser1, "element-1", 10, 40);

		projectStore.updateSceneTimeline("scene-1", before, {
			txnId: "seed-ripple",
		});

		useStudioHistoryStore.getState().setActiveActor("user-1");
		projectStore.updateSceneTimeline("scene-1", afterUser1, {
			txnId: "u1-delete",
		});
		const user1Command = buildTimelineBatchCommandFromSnapshots({
			before: toTimelineOtSnapshot(before),
			after: toTimelineOtSnapshot(afterUser1),
		});
		expect(user1Command).toBeTruthy();
		if (!user1Command) return;
		useStudioHistoryStore.getState().push({
			kind: "timeline.ot",
			sceneId: "scene-1",
			command: user1Command,
			txnId: "u1-delete",
			intent: "root",
		});

		useStudioHistoryStore.getState().setActiveActor("user-2");
		projectStore.updateSceneTimeline("scene-1", afterUser2, {
			txnId: "u2-move",
		});
		const user2Command = buildTimelineBatchCommandFromSnapshots({
			before: toTimelineOtSnapshot(afterUser1),
			after: toTimelineOtSnapshot(afterUser2),
		});
		expect(user2Command).toBeTruthy();
		if (!user2Command) return;
		useStudioHistoryStore.getState().push({
			kind: "timeline.ot",
			sceneId: "scene-1",
			command: user2Command,
			txnId: "u2-move",
			intent: "root",
		});

		useStudioHistoryStore.getState().setActiveActor("user-1");
		useStudioHistoryStore.getState().undo();

		const elements =
			useProjectStore.getState().currentProject?.scenes["scene-1"].timeline
				.elements ?? [];
		const element0 = elements.find((element) => element.id === "element-0");
		const element1 = elements.find((element) => element.id === "element-1");
		expect(element0).toBeTruthy();
		expect(element1).toBeTruthy();
		if (!element0 || !element1) return;
		if (element0.timeline.trackIndex === element1.timeline.trackIndex) {
			expect(element1.timeline.start).toBeGreaterThanOrEqual(
				element0.timeline.end,
			);
		}
	});

	it("新 session 首次删除 + 他人编辑触发 derived 后，当前用户 undo 仍可恢复删除", () => {
		const projectStore = useProjectStore.getState();
		const beforeScene1 = createTimeline(2);
		const afterDeleteScene1 = createTimeline(1);
		const beforeScene2 = createTimeline(1);
		const afterScene2Move = {
			...beforeScene2,
			elements: beforeScene2.elements.map((element, index) =>
				index === 0
					? {
							...element,
							timeline: {
								...element.timeline,
								start: element.timeline.start + 20,
								end: element.timeline.end + 20,
								startTimecode: framesToTimecode(
									element.timeline.start + 20,
									30,
								),
								endTimecode: framesToTimecode(element.timeline.end + 20, 30),
							},
						}
					: element,
			),
		};
		const afterDerivedScene1 = {
			...afterDeleteScene1,
			elements: afterDeleteScene1.elements.map((element, index) =>
				index === 0
					? {
							...element,
							timeline: {
								...element.timeline,
								end: element.timeline.end + 10,
								endTimecode: framesToTimecode(element.timeline.end + 10, 30),
							},
						}
					: element,
			),
		};

		projectStore.updateSceneTimeline("scene-1", beforeScene1, {
			txnId: "seed-s1",
		});
		projectStore.updateSceneTimeline("scene-2", beforeScene2, {
			txnId: "seed-s2",
		});

		const persistedProject = JSON.parse(
			JSON.stringify(useProjectStore.getState().currentProject),
		) as StudioProject;
		useProjectStore.setState((state) => ({
			...state,
			currentProject: persistedProject,
			sceneTimelineMutationOpIds: {},
		}));
		useStudioHistoryStore.getState().clear();

		useStudioHistoryStore.getState().setActiveActor("user-1");
		projectStore.updateSceneTimeline("scene-1", afterDeleteScene1, {
			txnId: "u1-delete",
		});
		const deleteCommand = buildTimelineBatchCommandFromSnapshots({
			before: toTimelineOtSnapshot(beforeScene1),
			after: toTimelineOtSnapshot(afterDeleteScene1),
		});
		expect(deleteCommand).toBeTruthy();
		if (!deleteCommand) return;
		useStudioHistoryStore.getState().push({
			kind: "timeline.ot",
			sceneId: "scene-1",
			command: deleteCommand,
			txnId: "u1-delete",
			intent: "root",
		});

		useStudioHistoryStore.getState().setActiveActor("user-2");
		projectStore.updateSceneTimeline("scene-2", afterScene2Move, {
			txnId: "u2-root",
		});
		const rootCommand = buildTimelineBatchCommandFromSnapshots({
			before: toTimelineOtSnapshot(beforeScene2),
			after: toTimelineOtSnapshot(afterScene2Move),
		});
		expect(rootCommand).toBeTruthy();
		if (!rootCommand) return;
		useStudioHistoryStore.getState().push({
			kind: "timeline.ot",
			sceneId: "scene-2",
			command: rootCommand,
			txnId: "u2-root",
			intent: "root",
		});
		const latestRootEntry = useStudioHistoryStore
			.getState()
			.past.filter((entry) => entry.kind === "timeline.ot")
			.at(-1);
		expect(latestRootEntry?.__otOpId).toBeTruthy();
		if (!latestRootEntry?.__otOpId) return;

		projectStore.updateSceneTimeline("scene-1", afterDerivedScene1, {
			txnId: "u2-root",
		});
		const derivedCommand = buildTimelineBatchCommandFromSnapshots({
			before: toTimelineOtSnapshot(afterDeleteScene1),
			after: toTimelineOtSnapshot(afterDerivedScene1),
		});
		expect(derivedCommand).toBeTruthy();
		if (!derivedCommand) return;
		useStudioHistoryStore.getState().push({
			kind: "timeline.ot",
			sceneId: "scene-1",
			command: derivedCommand,
			txnId: "u2-root",
			causedBy: [latestRootEntry.__otOpId],
			intent: "derived",
		});

		useStudioHistoryStore.getState().setActiveActor("user-1");
		useStudioHistoryStore.getState().undo();

		const scene1Elements =
			useProjectStore.getState().currentProject?.scenes["scene-1"].timeline
				.elements ?? [];
		expect(scene1Elements.length).toBe(2);
	});

	it("undo 会先重建 runtime 基线，避免首删场景在 runtime 上无效", () => {
		const projectStore = useProjectStore.getState();
		const runtimeManager = createTestEditorRuntime("history-runtime-replay");
		const scene1Runtime = runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef("scene-1"),
		);
		runtimeManager.ensureTimelineRuntime(toSceneTimelineRef("scene-2"));

		const beforeScene1 = createTimeline(2);
		const afterDeleteScene1 = createTimeline(1);
		const beforeScene2 = createTimeline(1);
		const afterScene2Move = {
			...beforeScene2,
			elements: beforeScene2.elements.map((element, index) =>
				index === 0
					? {
							...element,
							timeline: {
								...element.timeline,
								start: element.timeline.start + 20,
								end: element.timeline.end + 20,
								startTimecode: framesToTimecode(
									element.timeline.start + 20,
									30,
								),
								endTimecode: framesToTimecode(element.timeline.end + 20, 30),
							},
						}
					: element,
			),
		};
		const afterDerivedScene1 = {
			...afterDeleteScene1,
			elements: afterDeleteScene1.elements.map((element, index) =>
				index === 0
					? {
							...element,
							timeline: {
								...element.timeline,
								end: element.timeline.end + 10,
								endTimecode: framesToTimecode(element.timeline.end + 10, 30),
							},
						}
					: element,
			),
		};

		projectStore.updateSceneTimeline("scene-1", beforeScene1, {
			txnId: "seed-s1",
		});
		projectStore.updateSceneTimeline("scene-2", beforeScene2, {
			txnId: "seed-s2",
		});
		useStudioHistoryStore.getState().clear();

		useStudioHistoryStore.getState().setActiveActor("user-1");
		projectStore.updateSceneTimeline("scene-1", afterDeleteScene1, {
			txnId: "u1-delete",
		});
		const deleteCommand = buildTimelineBatchCommandFromSnapshots({
			before: toTimelineOtSnapshot(beforeScene1),
			after: toTimelineOtSnapshot(afterDeleteScene1),
		});
		expect(deleteCommand).toBeTruthy();
		if (!deleteCommand) return;
		useStudioHistoryStore.getState().push({
			kind: "timeline.ot",
			sceneId: "scene-1",
			command: deleteCommand,
			txnId: "u1-delete",
			intent: "root",
		});

		useStudioHistoryStore.getState().setActiveActor("user-2");
		projectStore.updateSceneTimeline("scene-2", afterScene2Move, {
			txnId: "u2-root",
		});
		const rootCommand = buildTimelineBatchCommandFromSnapshots({
			before: toTimelineOtSnapshot(beforeScene2),
			after: toTimelineOtSnapshot(afterScene2Move),
		});
		expect(rootCommand).toBeTruthy();
		if (!rootCommand) return;
		useStudioHistoryStore.getState().push({
			kind: "timeline.ot",
			sceneId: "scene-2",
			command: rootCommand,
			txnId: "u2-root",
			intent: "root",
		});
		const latestRootEntry = useStudioHistoryStore
			.getState()
			.past.filter((entry) => entry.kind === "timeline.ot")
			.at(-1);
		expect(latestRootEntry?.__otOpId).toBeTruthy();
		if (!latestRootEntry?.__otOpId) return;

		projectStore.updateSceneTimeline("scene-1", afterDerivedScene1, {
			txnId: "u2-root",
		});
		const derivedCommand = buildTimelineBatchCommandFromSnapshots({
			before: toTimelineOtSnapshot(afterDeleteScene1),
			after: toTimelineOtSnapshot(afterDerivedScene1),
		});
		expect(derivedCommand).toBeTruthy();
		if (!derivedCommand) return;
		useStudioHistoryStore.getState().push({
			kind: "timeline.ot",
			sceneId: "scene-1",
			command: derivedCommand,
			txnId: "u2-root",
			causedBy: [latestRootEntry.__otOpId],
			intent: "derived",
		});

		// 模拟 runtime 仍停留在“所有操作都已执行后”的状态。
		applyTimelineJsonToStore(afterDerivedScene1, scene1Runtime.timelineStore);
		expect(scene1Runtime.timelineStore.getState().elements.length).toBe(1);

		useStudioHistoryStore.getState().setActiveActor("user-1");
		useStudioHistoryStore
			.getState()
			.undo({ runtimeManager, timelineStore: scene1Runtime.timelineStore });

		expect(scene1Runtime.timelineStore.getState().elements.length).toBe(2);
	});
});
