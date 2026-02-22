import { describe, expect, it } from "vitest";
import { DEFAULT_TIMELINE_SETTINGS } from "../editor/timelineLoader";
import {
	selectActiveScene,
	selectElementsForActiveScene,
	selectFocusedScene,
	selectTimelineForActiveScene,
} from "./selectors";
import type { StudioProject } from "./types";

const createProject = (): StudioProject => ({
	id: "project-1",
	revision: 0,
	canvas: {
		nodes: [],
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
				assets: [],
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
				assets: [],
				elements: [],
			},
		},
	},
	ui: {
		activeSceneId: "scene-1",
		focusedSceneId: "scene-2",
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
	});

	it("selectElementsForActiveScene 返回 active scene 元素", () => {
		const project = createProject();
		expect(selectElementsForActiveScene(project).map((item) => item.id)).toEqual([
			"element-1",
		]);
	});
});
