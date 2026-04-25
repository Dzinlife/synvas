import { describe, expect, it } from "vitest";
import { DEFAULT_COLOR_MANAGEMENT_SETTINGS } from "core";
import { parseStudioProject } from "./schema";

const createValidProject = () => ({
	id: "project-1",
	revision: 0,
	assets: [
		{
			id: "asset-video-1",
			kind: "video",
			name: "video.mp4",
			locator: {
				type: "linked-file",
				filePath: "/video.mp4",
			},
			meta: {
				fileName: "video.mp4",
			},
		},
		{
			id: "asset-audio-1",
			kind: "audio",
			name: "audio.mp3",
			locator: {
				type: "linked-file",
				filePath: "/audio.mp3",
			},
			meta: {
				fileName: "audio.mp3",
			},
		},
		{
			id: "asset-image-1",
			kind: "image",
			name: "image.png",
			locator: {
				type: "linked-file",
				filePath: "/image.png",
			},
			meta: {
				fileName: "image.png",
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
				type: "video",
				assetId: "asset-video-1",
				name: "Video 1",
				x: 100,
				y: 80,
				width: 640,
				height: 360,
				siblingOrder: 1,
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
				siblingOrder: 2,
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
				siblingOrder: 3,
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
				siblingOrder: 4,
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

const appendCanvasNode = (
	project: ReturnType<typeof createValidProject>,
	node: Record<string, unknown>,
) => {
	(project.canvas.nodes as Array<Record<string, unknown>>).push(node);
};

describe("studio schema", () => {
	it("新项目结构校验通过", () => {
		expect(() => parseStudioProject(createValidProject())).not.toThrow();
	});

	it("缺失 ui.camera 时应回填默认值", () => {
		const legacy = createValidProject();
		delete (legacy.ui as { camera?: unknown }).camera;
		const parsed = parseStudioProject(legacy);
		expect(parsed.ui.camera).toEqual({
			x: 0,
			y: 0,
			zoom: 1,
		});
	});

	it("缺失 canvasSnapEnabled 时应回填默认值", () => {
		const legacy = createValidProject();
		delete (legacy.ui as { canvasSnapEnabled?: unknown }).canvasSnapEnabled;
		const parsed = parseStudioProject(legacy);
		expect(parsed.ui.canvasSnapEnabled).toBe(true);
	});

	it("缺失色彩管理字段时应回填项目默认值", () => {
		const legacy = createValidProject();
		const parsed = parseStudioProject(legacy);
		expect(parsed.color).toEqual(DEFAULT_COLOR_MANAGEMENT_SETTINGS);
	});

	it("会保留 scene 与 asset 的色彩 metadata", () => {
		const project = createValidProject();
		(project.scenes["scene-1"] as { color?: unknown }).color = {
			preview: "srgb",
		};
		(project.assets[0].meta as { color?: unknown }).color = {
			detected: {
				primaries: "bt2020",
				transfer: "pq",
				matrix: "bt2020-ncl",
				range: "limited",
				label: "Rec.2100 PQ",
			},
		};

		const parsed = parseStudioProject(project);

		expect(parsed.scenes["scene-1"]?.color?.preview).toBe("srgb");
		expect(parsed.assets[0]?.meta?.color?.detected?.transfer).toBe("pq");
	});

	it("缺失 parentId 时应回填 null", () => {
		const legacy = createValidProject();
		const parsed = parseStudioProject(legacy);
		for (const node of parsed.canvas.nodes) {
			expect(node.parentId).toBeNull();
		}
	});

	it("board 缺失 layoutMode 时应回填 free", () => {
		const legacy = createValidProject();
		appendCanvasNode(legacy, {
			id: "node-board",
			type: "board",
			name: "Board",
			x: 0,
			y: 0,
			width: 400,
			height: 300,
			siblingOrder: 5,
			locked: false,
			hidden: false,
			createdAt: 2,
			updatedAt: 2,
		});

		const parsed = parseStudioProject(legacy);
		const board = parsed.canvas.nodes.find((node) => node.id === "node-board");
		expect(board?.type).toBe("board");
		if (board?.type !== "board") return;
		expect(board.layoutMode).toBe("free");
	});

	it("siblingOrder 支持小数并拒绝 NaN/Infinity", () => {
		const withFloatZIndex = createValidProject();
		withFloatZIndex.canvas.nodes[1] = {
			...withFloatZIndex.canvas.nodes[1],
			siblingOrder: 1.25,
		};
		const parsed = parseStudioProject(withFloatZIndex);
		expect(parsed.canvas.nodes[1]?.siblingOrder).toBe(1.25);

		const withNaNZIndex = createValidProject();
		withNaNZIndex.canvas.nodes[1] = {
			...withNaNZIndex.canvas.nodes[1],
			siblingOrder: Number.NaN,
		};
		expect(() => parseStudioProject(withNaNZIndex)).toThrow();

		const withInfinityZIndex = createValidProject();
		withInfinityZIndex.canvas.nodes[1] = {
			...withInfinityZIndex.canvas.nodes[1],
			siblingOrder: Number.POSITIVE_INFINITY,
		};
		expect(() => parseStudioProject(withInfinityZIndex)).toThrow();
	});

	it("非法 parentId 与环引用会在加载时修复为 null", () => {
		const project = createValidProject();
		appendCanvasNode(project, {
			id: "node-board-a",
			type: "board",
			name: "Board A",
			parentId: "node-board-b",
			x: 0,
			y: 0,
			width: 400,
			height: 300,
			siblingOrder: 5,
			locked: false,
			hidden: false,
			createdAt: 2,
			updatedAt: 2,
		});
		appendCanvasNode(project, {
			id: "node-board-b",
			type: "board",
			name: "Board B",
			parentId: "node-board-a",
			x: 20,
			y: 20,
			width: 300,
			height: 200,
			siblingOrder: 6,
			locked: false,
			hidden: false,
			createdAt: 2,
			updatedAt: 2,
		});
		appendCanvasNode(project, {
			id: "node-text-child",
			type: "text",
			text: "child",
			fontSize: 24,
			name: "Text Child",
			parentId: "node-2",
			x: 60,
			y: 80,
			width: 120,
			height: 60,
			siblingOrder: 7,
			locked: false,
			hidden: false,
			createdAt: 2,
			updatedAt: 2,
		});
		appendCanvasNode(project, {
			id: "node-video-orphan",
			type: "video",
			assetId: "asset-video-1",
			name: "Video Orphan",
			parentId: "node-not-exist",
			x: 10,
			y: 10,
			width: 200,
			height: 100,
			siblingOrder: 8,
			locked: false,
			hidden: false,
			createdAt: 2,
			updatedAt: 2,
		});
		const parsed = parseStudioProject(project);
		const boardA = parsed.canvas.nodes.find(
			(node) => node.id === "node-board-a",
		);
		const boardB = parsed.canvas.nodes.find(
			(node) => node.id === "node-board-b",
		);
		const textChild = parsed.canvas.nodes.find(
			(node) => node.id === "node-text-child",
		);
		const orphan = parsed.canvas.nodes.find(
			(node) => node.id === "node-video-orphan",
		);
		expect(boardA?.parentId).toBeNull();
		expect(boardB?.parentId).toBeNull();
		expect(textChild?.parentId).toBeNull();
		expect(orphan?.parentId).toBeNull();
	});

	it("包含 node thumbnail 字段时应校验通过并保留字段", () => {
		const project = createValidProject();
		const target = project.canvas.nodes.find((node) => node.id === "node-2");
		if (!target) {
			throw new Error("node-2 not found");
		}
		(
			target as {
				thumbnail?: {
					assetId: string;
					sourceSignature: string;
					frame: number;
					generatedAt: number;
					version: 1;
				};
			}
		).thumbnail = {
			assetId: "asset-thumbnail-node-2",
			sourceSignature: "asset-video-1:hash-1",
			frame: 0,
			generatedAt: 99,
			version: 1,
		};
		const parsed = parseStudioProject(project);
		const parsedNode = parsed.canvas.nodes.find((node) => node.id === "node-2");
		expect(parsedNode?.thumbnail).toEqual({
			assetId: "asset-thumbnail-node-2",
			sourceSignature: "asset-video-1:hash-1",
			frame: 0,
			generatedAt: 99,
			version: 1,
		});
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

	it("旧的扁平 uri 资产结构应被拒绝", () => {
		const invalid = createValidProject();
		(invalid.assets[0] as unknown as { uri?: string }).uri =
			"file:///legacy.mp4";
		delete (invalid.assets[0] as unknown as { locator?: unknown }).locator;
		expect(() => parseStudioProject(invalid)).toThrow();
	});
});
