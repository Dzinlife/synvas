import { describe, expect, it } from "vitest";
import { parseStudioProject } from "./schema";

const createValidProject = () => ({
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
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
			timeline: {
				fps: 30,
				canvas: { width: 1920, height: 1080 },
				settings: {},
				tracks: [],
				assets: [],
				elements: [],
			},
		},
	},
	ui: {
		activeSceneId: "scene-1",
		focusedSceneId: null,
		camera: {
			x: 0,
			y: 0,
			zoom: 1,
		},
	},
	createdAt: 1,
	updatedAt: 1,
});

describe("studio schema", () => {
	it("新项目结构校验通过", () => {
		expect(() => parseStudioProject(createValidProject())).not.toThrow();
	});

	it("缺失 ui.camera 时应报错", () => {
		const invalid = createValidProject();
		delete (invalid.ui as { camera?: unknown }).camera;
		expect(() => parseStudioProject(invalid)).toThrow();
	});

	it("旧 schema 应被拒绝", () => {
		const legacy = {
			id: "legacy-project",
			revision: 0,
			timeline: {
				fps: 30,
				canvas: { width: 1920, height: 1080 },
				settings: {},
				tracks: [],
				assets: [],
				elements: [],
			},
			compositions: {},
			assets: {},
			ui: {
				activeMainView: "preview",
				activeScope: { type: "main" },
			},
			createdAt: 1,
			updatedAt: 1,
		};
		expect(() => parseStudioProject(legacy)).toThrow();
	});
});
