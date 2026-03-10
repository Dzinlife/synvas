import { describe, expect, it } from "vitest";
import { parseStudioProject } from "./schema";

const createValidProject = () => ({
	id: "project-1",
	revision: 0,
	assets: [
		{
			id: "asset-video-1",
			uri: "file:///video.mp4",
			kind: "video",
			name: "video.mp4",
		},
		{
			id: "asset-audio-1",
			uri: "file:///audio.mp3",
			kind: "audio",
			name: "audio.mp3",
		},
		{
			id: "asset-image-1",
			uri: "file:///image.png",
			kind: "image",
			name: "image.png",
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
				type: "video",
				assetId: "asset-video-1",
				name: "Video 1",
				x: 100,
				y: 80,
				width: 640,
				height: 360,
				zIndex: 1,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
			{
				id: "node-3",
				type: "audio",
				assetId: "asset-audio-1",
				name: "Audio 1",
				x: 120,
				y: 480,
				width: 640,
				height: 180,
				zIndex: 2,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
			{
				id: "node-4",
				type: "image",
				assetId: "asset-image-1",
				name: "Image 1",
				x: 800,
				y: 120,
				width: 640,
				height: 360,
				zIndex: 3,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
			{
				id: "node-5",
				type: "text",
				text: "hello",
				fontSize: 48,
				name: "Text 1",
				x: 900,
				y: 520,
				width: 500,
				height: 160,
				zIndex: 4,
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
				elements: [],
			},
		},
	},
	ui: {
		activeSceneId: "scene-1",
		focusedNodeId: null,
		activeNodeId: "node-1",
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

describe("studio schema", () => {
	it("新项目结构校验通过", () => {
		expect(() => parseStudioProject(createValidProject())).not.toThrow();
	});

	it("缺失 ui.camera 时应报错", () => {
		const invalid = createValidProject();
		delete (invalid.ui as { camera?: unknown }).camera;
		expect(() => parseStudioProject(invalid)).toThrow();
	});

	it("缺失 canvasSnapEnabled 时应回填默认值", () => {
		const legacy = createValidProject();
		delete (legacy.ui as { canvasSnapEnabled?: unknown }).canvasSnapEnabled;
		const parsed = parseStudioProject(legacy);
		expect(parsed.ui.canvasSnapEnabled).toBe(true);
	});

	it("使用 focusedSceneId 旧字段时应报错", () => {
		const invalid = createValidProject() as {
			ui: Record<string, unknown>;
		};
		delete invalid.ui.focusedNodeId;
		invalid.ui.focusedSceneId = null;
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
