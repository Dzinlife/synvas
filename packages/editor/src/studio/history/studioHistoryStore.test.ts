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
		focusedSceneId: "scene-1",
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
		error: null,
	});
	useStudioHistoryStore.getState().clear();
});

describe("studioHistoryStore", () => {
	it("undo/redo scene.timeline 时会同步 focus scene", () => {
		const before = createTimeline(0);
		const after = createTimeline(2);
		useStudioHistoryStore.getState().push({
			kind: "scene.timeline",
			timelineRef: toSceneTimelineRef("scene-2"),
			sceneId: "scene-2",
			before,
			after,
			focusSceneId: "scene-2",
		});

		useStudioHistoryStore.getState().undo();
		expect(useProjectStore.getState().currentProject?.ui.focusedSceneId).toBe(
			"scene-2",
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
			focusSceneId: null,
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
