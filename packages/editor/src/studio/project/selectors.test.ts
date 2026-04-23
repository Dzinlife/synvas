import { describe, expect, it } from "vitest";
import { DEFAULT_TIMELINE_SETTINGS } from "core/timeline-system/loader";
import {
	selectActiveScene,
	selectElementsForActiveScene,
	selectFocusedNode,
	selectFocusedNodeId,
	selectFocusedScene,
	selectFocusedSceneId,
	selectTimelineForActiveScene,
} from "./selectors";
import type { StudioProject } from "./types";

const createProject = (): StudioProject => ({
	id: "project-1",
	revision: 0,
	canvas: {
		nodes: [
			{
				id: "node-scene-1",
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
				id: "node-scene-2",
				type: "scene",
				sceneId: "scene-2",
				name: "Scene 2",
				x: 0,
				y: 0,
				width: 960,
				height: 540,
				siblingOrder: 1,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
			{
				id: "node-text-1",
				type: "text",
				name: "Text 1",
				text: "hello",
				fontSize: 32,
				x: 0,
				y: 0,
				width: 320,
				height: 120,
				siblingOrder: 2,
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
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
			timeline: {
				fps: 30,
				canvas: { width: 1920, height: 1080 },
				settings: DEFAULT_TIMELINE_SETTINGS,
				tracks: [],
				elements: [
					{
						id: "element-1",
						type: "Image",
						component: "image",
						name: "Image",
						props: {},
						timeline: {
							start: 0,
							end: 30,
							startTimecode: "00:00:00.000",
							endTimecode: "00:00:01.000",
							trackIndex: 0,
							role: "clip",
						},
					},
				],
			},
		},
		"scene-2": {
			id: "scene-2",
			name: "Scene 2",
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
			timeline: {
				fps: 30,
				canvas: { width: 1920, height: 1080 },
				settings: DEFAULT_TIMELINE_SETTINGS,
				tracks: [],
				elements: [],
			},
		},
	},
	assets: [],
	ui: {
		activeSceneId: "scene-1",
		focusedNodeId: "node-scene-2",
		activeNodeId: null,
		canvasSnapEnabled: true,
		camera: {
			x: 0,
			y: 0,
			zoom: 1,
		},
	},
	createdAt: 1,
	updatedAt: 1,
});

describe("studio selectors", () => {
	it("selectTimelineForActiveScene 返回 active scene timeline", () => {
		const project = createProject();
		const timeline = selectTimelineForActiveScene(project);
		expect(timeline?.elements.length).toBe(1);
	});

	it("selectActiveScene / selectFocusedScene 返回正确场景", () => {
		const project = createProject();
		expect(selectActiveScene(project)?.id).toBe("scene-1");
		expect(selectFocusedScene(project)?.id).toBe("scene-2");
		expect(selectFocusedSceneId(project)).toBe("scene-2");
		expect(selectFocusedNodeId(project)).toBe("node-scene-2");
		expect(selectFocusedNode(project)?.id).toBe("node-scene-2");
	});

	it("focused 节点不是 scene 时 selectFocusedScene 返回 null", () => {
		const project = createProject();
		project.ui.focusedNodeId = "node-text-1";
		expect(selectFocusedScene(project)).toBeNull();
		expect(selectFocusedSceneId(project)).toBeNull();
		expect(selectFocusedNode(project)?.id).toBe("node-text-1");
	});

	it("selectElementsForActiveScene 返回 active scene 元素", () => {
		const project = createProject();
		expect(selectElementsForActiveScene(project).map((item) => item.id)).toEqual([
			"element-1",
		]);
	});
});
