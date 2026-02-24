// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StudioProject } from "core/studio/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "@/projects/projectStore";
import CanvasWorkspace from "./CanvasWorkspace";

const togglePlaybackMock = vi.fn();

vi.mock("@/studio/scene/usePlaybackOwnerController", () => ({
	usePlaybackOwnerController: () => ({
		togglePlayback: togglePlaybackMock,
		isOwnerPlaying: () => false,
	}),
}));

vi.mock("./InfiniteSkiaCanvas", () => ({
	default: () => <div data-testid="infinite-skia-canvas" />,
}));

vi.mock("./FocusSceneKonvaLayer", () => ({
	default: () => <div data-testid="focus-scene-konva-layer" />,
}));

vi.mock("@/editor/components/SceneTimelineDrawer", () => ({
	SCENE_TIMELINE_DRAWER_DEFAULT_HEIGHT: 320,
	default: ({ onExitFocus }: { onExitFocus: () => void }) => (
		<button type="button" data-testid="scene-timeline-drawer" onClick={onExitFocus}>
			drawer
		</button>
	),
}));

vi.mock("@/editor/MaterialLibrary", () => ({
	default: () => <div data-testid="material-library-content" />,
}));

vi.mock("@/studio/canvas/node-system/registry", () => {
	const GenericSkiaRenderer = () => null;
	const createToolbar = (type: string) => () => <div data-testid={`node-toolbar-${type}`} />;
	const definitions = {
		scene: {
			type: "scene",
			title: "Scene",
			create: () => ({ type: "scene" }),
			skiaRenderer: GenericSkiaRenderer,
			toolbar: createToolbar("scene"),
		},
		video: {
			type: "video",
			title: "Video",
			create: () => ({ type: "video" }),
			skiaRenderer: GenericSkiaRenderer,
			toolbar: createToolbar("video"),
			fromExternalFile: async (
				file: File,
				context: {
					ensureProjectAssetByUri: (input: {
						uri: string;
						kind: "video" | "audio" | "image";
						name?: string;
					}) => string;
				},
			) => {
				if (!file.type.startsWith("video/")) return null;
				const uri = `file://${file.name}`;
				const assetId = context.ensureProjectAssetByUri({
					uri,
					kind: "video",
					name: file.name,
				});
				return { type: "video", assetId, name: file.name, width: 200, height: 120 };
			},
		},
		audio: {
			type: "audio",
			title: "Audio",
			create: () => ({ type: "audio" }),
			skiaRenderer: GenericSkiaRenderer,
			toolbar: createToolbar("audio"),
			fromExternalFile: async (
				file: File,
				context: {
					ensureProjectAssetByUri: (input: {
						uri: string;
						kind: "video" | "audio" | "image";
						name?: string;
					}) => string;
				},
			) => {
				if (!file.type.startsWith("audio/")) return null;
				const uri = `file://${file.name}`;
				const assetId = context.ensureProjectAssetByUri({
					uri,
					kind: "audio",
					name: file.name,
				});
				return { type: "audio", assetId, name: file.name, width: 180, height: 80 };
			},
		},
		image: {
			type: "image",
			title: "Image",
			create: () => ({ type: "image" }),
			skiaRenderer: GenericSkiaRenderer,
			toolbar: createToolbar("image"),
			fromExternalFile: async (
				file: File,
				context: {
					ensureProjectAssetByUri: (input: {
						uri: string;
						kind: "video" | "audio" | "image";
						name?: string;
					}) => string;
				},
			) => {
				if (!file.type.startsWith("image/")) return null;
				const uri = `file://${file.name}`;
				const assetId = context.ensureProjectAssetByUri({
					uri,
					kind: "image",
					name: file.name,
				});
				return { type: "image", assetId, name: file.name, width: 240, height: 140 };
			},
		},
		text: {
			type: "text",
			title: "Text",
			create: () => ({ type: "text", text: "新建文本", name: "Text" }),
			skiaRenderer: GenericSkiaRenderer,
			toolbar: createToolbar("text"),
		},
	};
	return {
		canvasNodeDefinitionList: Object.values(definitions),
		getCanvasNodeDefinition: (type: keyof typeof definitions) => definitions[type],
	};
});

const mockDOMRect = {
	x: 0,
	y: 0,
	width: 1200,
	height: 800,
	top: 0,
	right: 1200,
	bottom: 800,
	left: 0,
	toJSON: () => ({}),
} as DOMRect;

vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
	() => mockDOMRect,
);

const createProject = (): StudioProject => ({
	id: "project-1",
	revision: 0,
	assets: [
		{
			id: "asset-scene",
			uri: "file:///scene.png",
			kind: "image",
			name: "scene.png",
		},
	],
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
				zIndex: 0,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
			{
				id: "node-video-1",
				type: "video",
				assetId: "asset-scene",
				name: "Video 1",
				x: 240,
				y: 120,
				width: 320,
				height: 180,
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
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
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
		},
	},
	ui: {
		activeSceneId: "scene-1",
		focusedSceneId: null,
		activeNodeId: "node-scene-1",
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

beforeEach(() => {
	togglePlaybackMock.mockReset();
	useProjectStore.setState({
		status: "ready",
		projects: [],
		currentProjectId: "project-1",
		currentProject: createProject(),
		focusedSceneDrafts: {},
		error: null,
	});
});

afterEach(() => {
	cleanup();
});

const clickNodeAt = (clientX: number, clientY: number): void => {
	const hitLayer = screen.getByTestId("canvas-node-hit-layer");
	fireEvent.pointerDown(hitLayer, {
		button: 0,
		clientX,
		clientY,
	});
	fireEvent.pointerUp(window, {
		button: 0,
		clientX,
		clientY,
	});
};

describe("CanvasWorkspace", () => {
	it("active node 切换会更新顶部 toolbar", () => {
		render(<CanvasWorkspace />);
		expect(screen.getByTestId("node-toolbar-scene")).toBeTruthy();

		clickNodeAt(300, 160);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-video-1",
		);
		expect(screen.getByTestId("node-toolbar-video")).toBeTruthy();
	});

	it("scene 节点可进入 focus，非 scene 仅选中不改 focus", () => {
		render(<CanvasWorkspace />);

		clickNodeAt(300, 160);
		expect(useProjectStore.getState().currentProject?.ui.focusedSceneId).toBeNull();
		expect(useProjectStore.getState().currentProject?.ui.activeSceneId).toBe(
			"scene-1",
		);

		clickNodeAt(80, 80);
		expect(useProjectStore.getState().currentProject?.ui.focusedSceneId).toBe(
			"scene-1",
		);
		expect(screen.getByTestId("focus-scene-konva-layer")).toBeTruthy();
	});

	it("右键菜单可在画布位置创建 text 节点", async () => {
		render(<CanvasWorkspace />);

		fireEvent.contextMenu(screen.getByTestId("canvas-workspace"), {
			clientX: 420,
			clientY: 260,
		});
		fireEvent.click(screen.getByRole("menuitem", { name: "新建文本节点" }));

		await waitFor(() => {
			const textNode = useProjectStore
				.getState()
				.currentProject?.canvas.nodes.find((node) => node.type === "text");
			expect(textNode).toBeTruthy();
			expect(textNode?.x).toBe(420);
			expect(textNode?.y).toBe(260);
		});
	});

	it("外部文件 drop 可创建多类型节点并按 4 列网格偏移", async () => {
		render(<CanvasWorkspace />);
		const video = new File([new Uint8Array([1])], "drop-video.mp4", {
			type: "video/mp4",
		});
		const audio = new File([new Uint8Array([1])], "drop-audio.mp3", {
			type: "audio/mpeg",
		});
		const image = new File([new Uint8Array([1])], "drop-image.png", {
			type: "image/png",
		});
		fireEvent.drop(screen.getByTestId("canvas-workspace"), {
			clientX: 100,
			clientY: 120,
			dataTransfer: {
				files: [video, audio, image],
				items: [],
				types: ["Files"],
			},
		});

		await waitFor(() => {
			const project = useProjectStore.getState().currentProject;
			const droppedNodes =
				project?.canvas.nodes.filter((node) =>
					["video", "audio", "image"].includes(node.type),
				) ?? [];
			expect(droppedNodes.length).toBeGreaterThanOrEqual(4);
		});

		const project = useProjectStore.getState().currentProject;
		const newVideo = project?.canvas.nodes.find(
			(node) => node.type === "video" && node.id !== "node-video-1",
		);
		const newAudio = project?.canvas.nodes.find((node) => node.type === "audio");
		const newImage = project?.canvas.nodes.find((node) => node.type === "image");
		expect(newVideo).toBeTruthy();
		expect(newAudio).toBeTruthy();
		expect(newImage).toBeTruthy();
		if (!newVideo || !newAudio || !newImage) return;
		expect(newAudio.x - newVideo.x).toBe(48);
		expect(newImage.x - newAudio.x).toBe(48);
		expect(newVideo.y).toBe(newAudio.y);
		expect(newAudio.y).toBe(newImage.y);
		expect(useProjectStore.getState().currentProject?.ui.activeSceneId).toBe(
			"scene-1",
		);
		expect(useProjectStore.getState().currentProject?.ui.focusedSceneId).toBeNull();
	});

	it("重叠节点命中优先 zIndex 更高者", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-video-1",
		);
	});

	it("locked 节点可选中但不可拖拽", () => {
		useProjectStore.setState((state) => {
			const project = state.currentProject;
			if (!project) return state;
			return {
				...state,
				currentProject: {
					...project,
					canvas: {
						...project.canvas,
						nodes: project.canvas.nodes.map((node) =>
							node.id === "node-video-1" ? { ...node, locked: true } : node,
						),
					},
				},
			};
		});
		render(<CanvasWorkspace />);
		const hitLayer = screen.getByTestId("canvas-node-hit-layer");
		fireEvent.pointerDown(hitLayer, {
			button: 0,
			clientX: 300,
			clientY: 160,
		});
		fireEvent.pointerMove(window, {
			clientX: 420,
			clientY: 260,
		});
		fireEvent.pointerUp(window, {
			button: 0,
			clientX: 420,
			clientY: 260,
		});

		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find((item) => item.id === "node-video-1");
		expect(node?.x).toBe(240);
		expect(node?.y).toBe(120);
		expect(project?.ui.activeNodeId).toBe("node-video-1");
	});
});
