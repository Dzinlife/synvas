// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { CanvasNode, StudioProject } from "core/studio/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "@/projects/projectStore";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import CanvasWorkspace from "./CanvasWorkspace";

const togglePlaybackMock = vi.fn();
const infiniteSkiaCanvasPropsMock = vi.fn();
const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();
let rafCounter = 1;
let nativeRequestAnimationFrame: typeof window.requestAnimationFrame;
let nativeCancelAnimationFrame: typeof window.cancelAnimationFrame;

interface MockCanvasNodeDragEvent {
	movementX: number;
	movementY: number;
	clientX: number;
	clientY: number;
	first: boolean;
	last: boolean;
	tap: boolean;
	button: number;
	buttons: number;
}

interface MockInfiniteSkiaCanvasProps {
	width: number;
	height: number;
	focusedNodeId?: string | null;
	onNodeClick?: (node: CanvasNode) => void;
	onNodeDoubleClick?: (node: CanvasNode) => void;
	onNodeDragStart?: (node: CanvasNode, event: MockCanvasNodeDragEvent) => void;
	onNodeDrag?: (node: CanvasNode, event: MockCanvasNodeDragEvent) => void;
	onNodeDragEnd?: (node: CanvasNode, event: MockCanvasNodeDragEvent) => void;
	onNodeResizeStart?: (
		node: CanvasNode,
		anchor: "top-left" | "top-right" | "bottom-right" | "bottom-left",
		event: MockCanvasNodeDragEvent,
	) => void;
	onNodeResize?: (
		node: CanvasNode,
		anchor: "top-left" | "top-right" | "bottom-right" | "bottom-left",
		event: MockCanvasNodeDragEvent,
	) => void;
	onNodeResizeEnd?: (
		node: CanvasNode,
		anchor: "top-left" | "top-right" | "bottom-right" | "bottom-left",
		event: MockCanvasNodeDragEvent,
	) => void;
}

vi.mock("@/studio/scene/usePlaybackOwnerController", () => ({
	usePlaybackOwnerController: () => ({
		togglePlayback: togglePlaybackMock,
		isOwnerPlaying: () => false,
	}),
}));

vi.mock("./InfiniteSkiaCanvas", () => ({
	default: (props: MockInfiniteSkiaCanvasProps) => {
		infiniteSkiaCanvasPropsMock(props);
		return (
			<>
				<div data-testid="infinite-skia-canvas" data-canvas-surface="true" />
				{props.focusedNodeId ? (
					<div data-testid="focus-scene-skia-layer" />
				) : null}
			</>
		);
	},
}));

vi.mock("@/scene-editor/components/SceneTimelineDrawer", () => ({
	SCENE_TIMELINE_DRAWER_DEFAULT_HEIGHT: 320,
	default: ({ onExitFocus }: { onExitFocus: () => void }) => (
		<button
			type="button"
			data-testid="scene-timeline-drawer"
			onClick={onExitFocus}
		>
			drawer
		</button>
	),
}));

vi.mock("@/studio/canvas/sidebar/CanvasElementLibrary", () => ({
	default: () => <div data-testid="canvas-element-library" />,
}));

vi.mock("@/studio/canvas/node-system/registry", () => {
	const GenericSkiaRenderer = () => null;
	const createToolbar = (type: string) => () => (
		<div data-testid={`node-toolbar-${type}`} />
	);
	const SceneDrawer = ({ onClose }: { onClose: () => void }) => (
		<button type="button" data-testid="scene-timeline-drawer" onClick={onClose}>
			drawer
		</button>
	);
	const VideoDrawer = ({ onClose }: { onClose: () => void }) => (
		<button type="button" data-testid="video-node-drawer" onClick={onClose}>
			drawer
		</button>
	);
	const wouldCreateCycle = (
		project: {
			scenes: Record<
				string,
				{
					timeline?: {
						elements?: Array<{ type?: string; props?: { sceneId?: string } }>;
					};
				}
			>;
		},
		parentSceneId: string,
		childSceneId: string,
	): boolean => {
		if (parentSceneId === childSceneId) return true;
		const stack = [childSceneId];
		const visited = new Set<string>();
		while (stack.length > 0) {
			const sceneId = stack.pop();
			if (!sceneId) continue;
			if (sceneId === parentSceneId) return true;
			if (visited.has(sceneId)) continue;
			visited.add(sceneId);
			const scene = project.scenes[sceneId];
			const elements = scene?.timeline?.elements ?? [];
			for (const element of elements) {
				if (element.type !== "Composition") continue;
				const nextSceneId = element.props?.sceneId;
				if (!nextSceneId) continue;
				stack.push(nextSceneId);
			}
		}
		return false;
	};
	const definitions = {
		scene: {
			type: "scene",
			title: "Scene",
			create: () => ({ type: "scene" }),
			skiaRenderer: GenericSkiaRenderer,
			toolbar: createToolbar("scene"),
			resolveResizeConstraints: ({
				scene,
				node,
			}: {
				scene: {
					timeline?: { canvas?: { width?: number; height?: number } };
				} | null;
				node: { width: number; height: number };
			}) => ({
				lockAspectRatio: true,
				aspectRatio:
					(scene?.timeline?.canvas?.width ?? node.width) /
					(scene?.timeline?.canvas?.height ?? node.height),
			}),
			focusable: true,
			drawer: SceneDrawer,
			drawerOptions: {
				trigger: "focus" as const,
				resizable: true,
				defaultHeight: 320,
				minHeight: 240,
				maxHeightRatio: 0.65,
			},
			contextMenu: (context: {
				node: { sceneId: string };
				project: {
					scenes: Record<
						string,
						{
							timeline?: {
								elements?: Array<{
									type?: string;
									props?: { sceneId?: string };
								}>;
							};
						}
					>;
				};
				sceneOptions: Array<{ sceneId: string; label: string }>;
				onInsertNodeToScene: (sceneId: string) => void;
			}) => {
				const sceneActions = context.sceneOptions.map((scene) => {
					const disabled =
						scene.sceneId === context.node.sceneId ||
						wouldCreateCycle(
							context.project,
							scene.sceneId,
							context.node.sceneId,
						);
					return {
						key: `insert-scene:${scene.sceneId}`,
						label: scene.label,
						disabled,
						onSelect: () => {
							context.onInsertNodeToScene(scene.sceneId);
						},
					};
				});
				return [
					{
						key: "insert-scene",
						label: "插入到其他 Scene",
						disabled: sceneActions.length === 0,
						onSelect: () => {},
						children: sceneActions,
					},
				];
			},
		},
		video: {
			type: "video",
			title: "Video",
			create: () => ({ type: "video" }),
			skiaRenderer: GenericSkiaRenderer,
			toolbar: createToolbar("video"),
			resolveResizeConstraints: ({
				asset,
				node,
			}: {
				asset: {
					meta?: { sourceSize?: { width?: number; height?: number } };
				} | null;
				node: { width: number; height: number };
			}) => ({
				lockAspectRatio: true,
				aspectRatio:
					(asset?.meta?.sourceSize?.width ?? node.width) /
					(asset?.meta?.sourceSize?.height ?? node.height),
			}),
			drawer: VideoDrawer,
			drawerOptions: {
				trigger: "active" as const,
			},
			fromExternalFile: async (
				file: File,
				context: {
					ensureProjectAssetByUri: (input: {
						uri: string;
						kind: "video" | "audio" | "image";
						name?: string;
					}) => string;
					updateProjectAssetMeta: (
						assetId: string,
						updater: (prev: Record<string, unknown> | undefined) => unknown,
					) => void;
				},
			) => {
				if (!file.type.startsWith("video/")) return null;
				const uri = `file://${file.name}`;
				const assetId = context.ensureProjectAssetByUri({
					uri,
					kind: "video",
					name: file.name,
				});
				context.updateProjectAssetMeta(assetId, (prev) => ({
					...(prev ?? {}),
					sourceSize: {
						width: 200,
						height: 120,
					},
				}));
				return {
					type: "video",
					assetId,
					name: file.name,
					width: 200,
					height: 120,
				};
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
				return {
					type: "audio",
					assetId,
					name: file.name,
					width: 180,
					height: 80,
				};
			},
		},
		image: {
			type: "image",
			title: "Image",
			create: () => ({ type: "image" }),
			skiaRenderer: GenericSkiaRenderer,
			toolbar: createToolbar("image"),
			resolveResizeConstraints: ({
				asset,
				node,
			}: {
				asset: {
					meta?: { sourceSize?: { width?: number; height?: number } };
				} | null;
				node: { width: number; height: number };
			}) => ({
				lockAspectRatio: true,
				aspectRatio:
					(asset?.meta?.sourceSize?.width ?? node.width) /
					(asset?.meta?.sourceSize?.height ?? node.height),
			}),
			contextMenu: (context: {
				node: { assetId: string };
				sceneOptions: Array<{ sceneId: string; label: string }>;
				onInsertNodeToScene: (sceneId: string) => void;
			}) => {
				const canInsert = Boolean(context.node.assetId);
				const sceneActions = context.sceneOptions.map((scene) => ({
					key: `insert:${scene.sceneId}`,
					label: scene.label,
					disabled: !canInsert,
					onSelect: () => {
						context.onInsertNodeToScene(scene.sceneId);
					},
				}));
				return [
					{
						key: "insert-scene",
						label: "插入到 Scene",
						disabled: !canInsert || sceneActions.length === 0,
						onSelect: () => {},
						children: sceneActions,
					},
				];
			},
			fromExternalFile: async (
				file: File,
				context: {
					ensureProjectAssetByUri: (input: {
						uri: string;
						kind: "video" | "audio" | "image";
						name?: string;
					}) => string;
					updateProjectAssetMeta: (
						assetId: string,
						updater: (prev: Record<string, unknown> | undefined) => unknown,
					) => void;
				},
			) => {
				if (!file.type.startsWith("image/")) return null;
				const uri = `file://${file.name}`;
				const assetId = context.ensureProjectAssetByUri({
					uri,
					kind: "image",
					name: file.name,
				});
				context.updateProjectAssetMeta(assetId, (prev) => ({
					...(prev ?? {}),
					sourceSize: {
						width: 240,
						height: 140,
					},
				}));
				return {
					type: "image",
					assetId,
					name: file.name,
					width: 240,
					height: 140,
				};
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
		getCanvasNodeDefinition: (type: keyof typeof definitions) =>
			definitions[type],
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
			{
				id: "node-scene-2",
				type: "scene",
				sceneId: "scene-2",
				name: "Scene 2",
				x: 1600,
				y: 80,
				width: 960,
				height: 540,
				zIndex: 1,
				locked: false,
				hidden: false,
				createdAt: 2,
				updatedAt: 2,
			},
			{
				id: "node-video-offscreen",
				type: "video",
				assetId: "asset-scene",
				name: "Offscreen Video",
				x: 2200,
				y: 160,
				width: 320,
				height: 180,
				zIndex: 2,
				locked: false,
				hidden: false,
				createdAt: 2,
				updatedAt: 2,
			},
			{
				id: "node-image-1",
				type: "image",
				assetId: "asset-scene",
				name: "Image 1",
				x: 680,
				y: 320,
				width: 260,
				height: 160,
				zIndex: 2,
				locked: false,
				hidden: false,
				createdAt: 3,
				updatedAt: 3,
			},
			{
				id: "node-image-hidden",
				type: "image",
				assetId: "asset-scene",
				name: "Hidden Image",
				x: -260,
				y: 40,
				width: 320,
				height: 180,
				zIndex: 3,
				locked: false,
				hidden: true,
				createdAt: 3,
				updatedAt: 3,
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
		"scene-2": {
			id: "scene-2",
			name: "Scene 2",
			posterFrame: 0,
			createdAt: 2,
			updatedAt: 2,
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
		focusedNodeId: null,
		activeNodeId: "node-scene-1",
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

beforeEach(() => {
	togglePlaybackMock.mockReset();
	infiniteSkiaCanvasPropsMock.mockReset();
	nativeRequestAnimationFrame = window.requestAnimationFrame;
	nativeCancelAnimationFrame = window.cancelAnimationFrame;
	rafTimers.clear();
	rafCounter = 1;
	window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
		const rafId = rafCounter;
		rafCounter += 1;
		const timer = setTimeout(() => {
			rafTimers.delete(rafId);
			callback(performance.now());
		}, 16);
		rafTimers.set(rafId, timer);
		return rafId;
	};
	window.cancelAnimationFrame = (rafId: number): void => {
		const timer = rafTimers.get(rafId);
		if (!timer) return;
		clearTimeout(timer);
		rafTimers.delete(rafId);
	};
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

afterEach(() => {
	for (const timer of rafTimers.values()) {
		clearTimeout(timer);
	}
	rafTimers.clear();
	window.requestAnimationFrame = nativeRequestAnimationFrame;
	window.cancelAnimationFrame = nativeCancelAnimationFrame;
	cleanup();
});

const getLatestInfiniteSkiaCanvasProps = (): MockInfiniteSkiaCanvasProps => {
	const props = infiniteSkiaCanvasPropsMock.mock.calls.at(-1)?.[0] as
		| MockInfiniteSkiaCanvasProps
		| undefined;
	if (!props) {
		throw new Error("InfiniteSkiaCanvas props 未捕获");
	}
	return props;
};

const isPointInNode = (node: CanvasNode, x: number, y: number): boolean => {
	const left = Math.min(node.x, node.x + node.width);
	const right = Math.max(node.x, node.x + node.width);
	const top = Math.min(node.y, node.y + node.height);
	const bottom = Math.max(node.y, node.y + node.height);
	return x >= left && x <= right && y >= top && y <= bottom;
};

const getTopVisibleNodeAt = (clientX: number, clientY: number): CanvasNode => {
	const project = useProjectStore.getState().currentProject;
	if (!project) {
		throw new Error("project 不存在");
	}
	const sortedNodes = [...project.canvas.nodes]
		.filter((node) => !node.hidden)
		.sort((a, b) => {
			if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
			return a.createdAt - b.createdAt;
		});
	for (let i = sortedNodes.length - 1; i >= 0; i -= 1) {
		const node = sortedNodes[i];
		if (!node) continue;
		if (!isPointInNode(node, clientX, clientY)) continue;
		return node;
	}
	throw new Error(`未命中节点: ${clientX},${clientY}`);
};

const clickCanvasAt = (clientX: number, clientY: number): void => {
	fireEvent.click(screen.getByTestId("infinite-skia-canvas"), {
		button: 0,
		clientX,
		clientY,
	});
};

const clickNodeAt = (clientX: number, clientY: number): void => {
	const node = getTopVisibleNodeAt(clientX, clientY);
	act(() => {
		getLatestInfiniteSkiaCanvasProps().onNodeClick?.(node);
	});
};

const rightClickNodeAt = (clientX: number, clientY: number): void => {
	fireEvent.contextMenu(screen.getByTestId("infinite-skia-canvas"), {
		clientX,
		clientY,
	});
};

const doubleClickNodeAt = (clientX: number, clientY: number): void => {
	const node = getTopVisibleNodeAt(clientX, clientY);
	act(() => {
		getLatestInfiniteSkiaCanvasProps().onNodeDoubleClick?.(node);
	});
};

const dragNodeAt = (
	startClientX: number,
	startClientY: number,
	endClientX: number,
	endClientY: number,
): void => {
	const node = getTopVisibleNodeAt(startClientX, startClientY);
	act(() => {
		const startEvent: MockCanvasNodeDragEvent = {
			movementX: 0,
			movementY: 0,
			clientX: startClientX,
			clientY: startClientY,
			first: true,
			last: false,
			tap: false,
			button: 0,
			buttons: 1,
		};
		getLatestInfiniteSkiaCanvasProps().onNodeDragStart?.(node, startEvent);
		getLatestInfiniteSkiaCanvasProps().onNodeDrag?.(node, startEvent);
		const moveEvent: MockCanvasNodeDragEvent = {
			movementX: endClientX - startClientX,
			movementY: endClientY - startClientY,
			clientX: endClientX,
			clientY: endClientY,
			first: false,
			last: false,
			tap: false,
			button: 0,
			buttons: 1,
		};
		getLatestInfiniteSkiaCanvasProps().onNodeDrag?.(node, moveEvent);
		const endEvent: MockCanvasNodeDragEvent = {
			...moveEvent,
			last: true,
			buttons: 0,
		};
		getLatestInfiniteSkiaCanvasProps().onNodeDragEnd?.(node, endEvent);
	});
};

const resizeNodeAt = (
	startClientX: number,
	startClientY: number,
	endClientX: number,
	endClientY: number,
	anchor: "top-left" | "top-right" | "bottom-right" | "bottom-left",
): void => {
	const node = getTopVisibleNodeAt(startClientX, startClientY);
	act(() => {
		const startEvent: MockCanvasNodeDragEvent = {
			movementX: 0,
			movementY: 0,
			clientX: startClientX,
			clientY: startClientY,
			first: true,
			last: false,
			tap: false,
			button: 0,
			buttons: 1,
		};
		getLatestInfiniteSkiaCanvasProps().onNodeResizeStart?.(
			node,
			anchor,
			startEvent,
		);
		getLatestInfiniteSkiaCanvasProps().onNodeResize?.(node, anchor, startEvent);
		const moveEvent: MockCanvasNodeDragEvent = {
			movementX: endClientX - startClientX,
			movementY: endClientY - startClientY,
			clientX: endClientX,
			clientY: endClientY,
			first: false,
			last: false,
			tap: false,
			button: 0,
			buttons: 1,
		};
		getLatestInfiniteSkiaCanvasProps().onNodeResize?.(node, anchor, moveEvent);
		const endEvent: MockCanvasNodeDragEvent = {
			...moveEvent,
			last: true,
			buttons: 0,
		};
		getLatestInfiniteSkiaCanvasProps().onNodeResizeEnd?.(
			node,
			anchor,
			endEvent,
		);
	});
};

const clickSidebarNode = (nodeId: string): void => {
	fireEvent.click(screen.getByTestId(`canvas-sidebar-node-item-${nodeId}`));
};

describe("CanvasWorkspace", () => {
	it("全局侧边栏展示所有节点并按 zIndex/createdAt 排序", () => {
		render(<CanvasWorkspace />);
		const nodeItems = screen.getAllByTestId(/canvas-sidebar-node-item-/);
		const order = nodeItems.map((item) => item.getAttribute("data-node-id"));
		expect(order).toEqual([
			"node-image-hidden",
			"node-image-1",
			"node-video-offscreen",
			"node-scene-2",
			"node-video-1",
			"node-scene-1",
		]);
		expect(screen.getByText("隐藏")).toBeTruthy();
	});

	it("overlay 布局不改变画布渲染尺寸", () => {
		render(<CanvasWorkspace />);
		const firstProps = infiniteSkiaCanvasPropsMock.mock.calls.at(-1)?.[0] as
			| { width: number; height: number }
			| undefined;
		expect(firstProps?.width).toBe(1200);
		expect(firstProps?.height).toBe(800);

		doubleClickNodeAt(80, 80);
		const secondProps = infiniteSkiaCanvasPropsMock.mock.calls.at(-1)?.[0] as
			| { width: number; height: number }
			| undefined;
		expect(secondProps?.width).toBe(1200);
		expect(secondProps?.height).toBe(800);
	});

	it("右侧面板展示 active node 元数据并在无 active 时隐藏", () => {
		render(<CanvasWorkspace />);
		const panel = screen.getByTestId("canvas-active-node-meta-panel");
		expect(panel.textContent).toContain("Scene 1");
		expect(panel.textContent).toContain("node-scene-1");

		clickCanvasAt(1120, 700);
		expect(
			useProjectStore.getState().currentProject?.ui.activeNodeId,
		).toBeNull();
		expect(screen.queryByTestId("canvas-active-node-meta-panel")).toBeNull();
	});

	it("在右侧面板滚轮不会触发画布 camera 平移", () => {
		render(<CanvasWorkspace />);
		const before = useProjectStore.getState().currentProject?.ui.camera;
		const panel = screen.getByTestId("canvas-active-node-meta-panel");
		fireEvent.wheel(panel, {
			deltaY: 120,
		});
		const after = useProjectStore.getState().currentProject?.ui.camera;
		expect(before).toBeTruthy();
		expect(after).toBeTruthy();
		if (!before || !after) return;
		expect(after.x).toBe(before.x);
		expect(after.y).toBe(before.y);
		expect(after.zoom).toBe(before.zoom);
	});

	it("左侧栏收起后 drawer 应占满左侧区域", async () => {
		render(<CanvasWorkspace />);
		doubleClickNodeAt(80, 80);
		await waitFor(() => {
			expect(screen.getByTestId("canvas-overlay-drawer")).toBeTruthy();
		});
		const drawer = screen.getByTestId("canvas-overlay-drawer");
		expect(drawer.style.left).toBe("312px");

		fireEvent.click(screen.getByLabelText("收起侧边栏"));
		await waitFor(() => {
			expect(screen.getByTestId("canvas-overlay-drawer").style.left).toBe(
				"12px",
			);
		});
		expect(screen.getByTestId("canvas-sidebar-expand-button")).toBeTruthy();
	});

	it("右侧面板会根据 drawer 高度让出底部区域", async () => {
		render(<CanvasWorkspace />);
		doubleClickNodeAt(80, 80);
		await waitFor(() => {
			expect(screen.getByLabelText("调整 Drawer 高度")).toBeTruthy();
			expect(screen.getByTestId("canvas-overlay-right-panel")).toBeTruthy();
		});
		const panel = screen.getByTestId("canvas-overlay-right-panel");
		const beforeHeight = Number.parseFloat(panel.style.height);
		expect(beforeHeight).toBeGreaterThan(0);

		const handle = screen.getByLabelText("调整 Drawer 高度");
		fireEvent.mouseDown(handle, { clientY: 700 });
		fireEvent.mouseMove(document, { clientY: 360 });
		fireEvent.mouseUp(document);

		await waitFor(() => {
			const afterHeight = Number.parseFloat(
				screen.getByTestId("canvas-overlay-right-panel").style.height,
			);
			expect(afterHeight).toBeLessThan(beforeHeight);
		});
	});

	it("focus camera 会在左侧栏收起后扩大可视缩放", async () => {
		render(<CanvasWorkspace />);
		doubleClickNodeAt(80, 80);
		await waitFor(() => {
			expect(screen.getByTestId("focus-scene-skia-layer")).toBeTruthy();
		});
		await waitFor(() => {
			const zoom =
				useProjectStore.getState().currentProject?.ui.camera.zoom ?? 1;
			expect(Math.abs(zoom - 1)).toBeGreaterThan(0.001);
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const beforeZoom =
			useProjectStore.getState().currentProject?.ui.camera.zoom ?? 0;
		fireEvent.click(screen.getByLabelText("收起侧边栏"));
		await waitFor(() => {
			const zoom =
				useProjectStore.getState().currentProject?.ui.camera.zoom ?? 0;
			expect(Math.abs(zoom - beforeZoom)).toBeGreaterThan(0.001);
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const afterZoom =
			useProjectStore.getState().currentProject?.ui.camera.zoom ?? 0;
		expect(afterZoom).toBeGreaterThan(beforeZoom);
	});

	it("focus camera 会在右侧面板隐藏后扩大可视缩放", async () => {
		render(<CanvasWorkspace />);
		doubleClickNodeAt(80, 80);
		await waitFor(() => {
			expect(screen.getByTestId("canvas-active-node-meta-panel")).toBeTruthy();
		});
		await waitFor(() => {
			const zoom =
				useProjectStore.getState().currentProject?.ui.camera.zoom ?? 1;
			expect(Math.abs(zoom - 1)).toBeGreaterThan(0.001);
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const beforeZoom =
			useProjectStore.getState().currentProject?.ui.camera.zoom ?? 0;
		act(() => {
			useProjectStore.getState().setActiveNode(null);
		});
		await waitFor(() => {
			expect(screen.queryByTestId("canvas-active-node-meta-panel")).toBeNull();
		});
		await waitFor(() => {
			const zoom =
				useProjectStore.getState().currentProject?.ui.camera.zoom ?? 0;
			expect(Math.abs(zoom - beforeZoom)).toBeGreaterThan(0.001);
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const afterZoom =
			useProjectStore.getState().currentProject?.ui.camera.zoom ?? 0;
		expect(afterZoom).toBeGreaterThan(beforeZoom);
	});

	it("active node 切换会更新顶部 toolbar", () => {
		render(<CanvasWorkspace />);
		expect(screen.getByTestId("node-toolbar-scene")).toBeTruthy();

		clickNodeAt(300, 160);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-video-1",
		);
		expect(screen.getByTestId("node-toolbar-video")).toBeTruthy();
	});

	it("单击仅 active，双击 scene 才进入 focus", async () => {
		render(<CanvasWorkspace />);

		clickNodeAt(300, 160);
		expect(
			useProjectStore.getState().currentProject?.ui.focusedNodeId,
		).toBeNull();
		expect(useProjectStore.getState().currentProject?.ui.activeSceneId).toBe(
			"scene-1",
		);
		expect(screen.getByTestId("video-node-drawer")).toBeTruthy();
		expect(screen.queryByLabelText("调整 Drawer 高度")).toBeNull();

		doubleClickNodeAt(80, 80);
		expect(useProjectStore.getState().currentProject?.ui.focusedNodeId).toBe(
			"node-scene-1",
		);
		await waitFor(() => {
			expect(screen.getByTestId("focus-scene-skia-layer")).toBeTruthy();
		});
		expect(screen.getByTestId("scene-timeline-drawer")).toBeTruthy();
		expect(screen.getByLabelText("调整 Drawer 高度")).toBeTruthy();
	});

	it("点击侧边栏 scene 节点会同步 activeScene", () => {
		render(<CanvasWorkspace />);
		clickSidebarNode("node-scene-2");
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-scene-2",
		);
		expect(useProjectStore.getState().currentProject?.ui.activeSceneId).toBe(
			"scene-2",
		);
	});

	it("点击 viewport 外节点只平移 camera，不改变 zoom", async () => {
		render(<CanvasWorkspace />);
		const before = useProjectStore.getState().currentProject?.ui.camera;
		clickSidebarNode("node-video-offscreen");
		const immediate = useProjectStore.getState().currentProject?.ui.camera;
		expect(before).toBeTruthy();
		expect(immediate).toBeTruthy();
		if (!before || !immediate) return;
		expect(immediate).toEqual(before);
		await waitFor(() => {
			const after = useProjectStore.getState().currentProject?.ui.camera;
			expect(after).toBeTruthy();
			if (!after) return;
			expect(after.zoom).toBe(before.zoom);
			expect(after.x).not.toBe(before.x);
		});
	});

	it("点击被面板遮挡的节点会触发 camera 平移进入安全区", async () => {
		render(<CanvasWorkspace />);
		const before = useProjectStore.getState().currentProject?.ui.camera;
		clickSidebarNode("node-video-1");
		const immediate = useProjectStore.getState().currentProject?.ui.camera;
		expect(before).toBeTruthy();
		expect(immediate).toBeTruthy();
		if (!before || !immediate) return;
		expect(immediate).toEqual(before);
		await waitFor(() => {
			const after = useProjectStore.getState().currentProject?.ui.camera;
			expect(after).toBeTruthy();
			if (!after) return;
			expect(after.zoom).toBe(before.zoom);
			expect(after.x !== before.x || after.y !== before.y).toBe(true);
		});
	});

	it("Focus 模式默认 元素 tab，Node tab 仅占位禁用", () => {
		render(<CanvasWorkspace />);
		doubleClickNodeAt(80, 80);
		expect(screen.getByTestId("canvas-sidebar-tab-element")).toBeTruthy();
		expect(screen.getByTestId("canvas-element-library")).toBeTruthy();

		fireEvent.click(screen.getByTestId("canvas-sidebar-tab-nodes"));
		expect(screen.getByText("拖拽 node asset 到时间线（待实现）")).toBeTruthy();
		const beforeUi = useProjectStore.getState().currentProject?.ui;
		const nodeButton = screen.getByTestId(
			"canvas-sidebar-node-item-node-video-1",
		);
		expect(nodeButton.getAttribute("disabled")).not.toBeNull();
		fireEvent.click(nodeButton);
		const afterUi = useProjectStore.getState().currentProject?.ui;
		expect(beforeUi).toBeTruthy();
		expect(afterUi).toBeTruthy();
		expect(afterUi?.activeNodeId).toBe(beforeUi?.activeNodeId);
		expect(afterUi?.camera).toEqual(beforeUi?.camera);
	});

	it("双击非 focusable 节点仅调整 camera，不进入 focus", async () => {
		render(<CanvasWorkspace />);
		const beforeCamera = useProjectStore.getState().currentProject?.ui.camera;
		doubleClickNodeAt(300, 160);
		const immediateCamera =
			useProjectStore.getState().currentProject?.ui.camera;
		expect(
			useProjectStore.getState().currentProject?.ui.focusedNodeId,
		).toBeNull();
		expect(screen.queryByTestId("focus-scene-skia-layer")).toBeNull();
		expect(immediateCamera).toBeTruthy();
		expect(beforeCamera).toBeTruthy();
		if (!immediateCamera || !beforeCamera) return;
		expect(immediateCamera).toEqual(beforeCamera);
		await waitFor(() => {
			const afterCamera = useProjectStore.getState().currentProject?.ui.camera;
			expect(afterCamera).toBeTruthy();
			if (!afterCamera) return;
			expect(
				afterCamera.zoom !== beforeCamera.zoom ||
					afterCamera.x !== beforeCamera.x ||
					afterCamera.y !== beforeCamera.y,
			).toBe(true);
		});
	});

	it("双击非 focusable 节点后动画结束仍可滚动画布", async () => {
		render(<CanvasWorkspace />);
		doubleClickNodeAt(300, 160);
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const workspace = screen.getByTestId("canvas-workspace");
		const beforeCamera = useProjectStore.getState().currentProject?.ui.camera;
		fireEvent.wheel(workspace, {
			deltaX: 120,
			deltaY: 80,
		});
		const afterCamera = useProjectStore.getState().currentProject?.ui.camera;
		expect(beforeCamera).toBeTruthy();
		expect(afterCamera).toBeTruthy();
		if (!beforeCamera || !afterCamera) return;
		expect(afterCamera.x).not.toBe(beforeCamera.x);
		expect(afterCamera.y).not.toBe(beforeCamera.y);
	});

	it("smooth 动画期间 instant camera 更新会被忽略", async () => {
		render(<CanvasWorkspace />);
		const workspace = screen.getByTestId("canvas-workspace");
		clickSidebarNode("node-video-offscreen");
		const beforeWheel = useProjectStore.getState().currentProject?.ui.camera;
		fireEvent.wheel(workspace, {
			deltaX: 120,
			deltaY: 80,
		});
		const afterWheel = useProjectStore.getState().currentProject?.ui.camera;
		expect(beforeWheel).toBeTruthy();
		expect(afterWheel).toBeTruthy();
		if (!beforeWheel || !afterWheel) return;
		expect(afterWheel).toEqual(beforeWheel);

		await waitFor(() => {
			const cameraAfterAnimation =
				useProjectStore.getState().currentProject?.ui.camera;
			expect(cameraAfterAnimation).toBeTruthy();
			if (!cameraAfterAnimation) return;
			expect(
				cameraAfterAnimation.x !== beforeWheel.x ||
					cameraAfterAnimation.y !== beforeWheel.y ||
					cameraAfterAnimation.zoom !== beforeWheel.zoom,
			).toBe(true);
		});

		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const settled = useProjectStore.getState().currentProject?.ui.camera;
		expect(settled).toBeTruthy();
		if (!settled) return;
		expect(
			settled.x !== afterWheel.x ||
				settled.y !== afterWheel.y ||
				settled.zoom !== afterWheel.zoom,
		).toBe(true);
	});

	it("未完成的 smooth 动画会被新的 smooth 动画覆盖", async () => {
		render(<CanvasWorkspace />);
		const initialCamera = useProjectStore.getState().currentProject?.ui.camera;
		clickSidebarNode("node-video-offscreen");
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 80);
			});
		});
		expect(initialCamera).toBeTruthy();
		if (!initialCamera) return;

		fireEvent.click(screen.getByRole("button", { name: "重置视图" }));
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const settled = useProjectStore.getState().currentProject?.ui.camera;
		expect(settled).toBeTruthy();
		if (!settled) return;
		expect(settled.x).toBeCloseTo(initialCamera.x, 3);
		expect(settled.y).toBeCloseTo(initialCamera.y, 3);
		expect(settled.zoom).toBeCloseTo(initialCamera.zoom, 3);
	});

	it("拖拽 drawer resize 时 camera 不会回退到无 drawer 视口", async () => {
		render(<CanvasWorkspace />);
		doubleClickNodeAt(80, 80);
		await waitFor(() => {
			expect(screen.getByLabelText("调整 Drawer 高度")).toBeTruthy();
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const beforeResizeZoom =
			useProjectStore.getState().currentProject?.ui.camera.zoom ?? 0;

		const handle = screen.getByLabelText("调整 Drawer 高度");
		const zoomSamples: number[] = [];
		const unsubscribe = useProjectStore.subscribe((state) => {
			const zoom = state.currentProject?.ui.camera.zoom;
			if (typeof zoom !== "number") return;
			zoomSamples.push(zoom);
		});

		fireEvent.mouseDown(handle, { clientY: 700 });
		fireEvent.mouseMove(document, { clientY: 360 });
		fireEvent.mouseMove(document, { clientY: 420 });
		fireEvent.mouseMove(document, { clientY: 300 });
		fireEvent.mouseUp(document);

		await waitFor(() => {
			expect(zoomSamples.length).toBeGreaterThan(0);
		});
		unsubscribe();

		const maxSample = Math.max(beforeResizeZoom, ...zoomSamples);
		expect(maxSample).toBeLessThanOrEqual(beforeResizeZoom + 0.02);
	});

	it("右键菜单可在画布位置创建 text 节点", async () => {
		render(<CanvasWorkspace />);

		fireEvent.contextMenu(screen.getByTestId("infinite-skia-canvas"), {
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

	it("非 InfiniteSkiaCanvas 区域右键不会弹出画布菜单", () => {
		render(<CanvasWorkspace />);
		fireEvent.contextMenu(screen.getByTestId("canvas-workspace"), {
			clientX: 420,
			clientY: 260,
		});
		expect(screen.queryByRole("menuitem", { name: "新建文本节点" })).toBeNull();
	});

	it("右键 image 节点可通过二级菜单插入到目标 scene timeline", async () => {
		render(<CanvasWorkspace />);
		const beforeUi = useProjectStore.getState().currentProject?.ui;

		rightClickNodeAt(720, 360);
		fireEvent.mouseEnter(
			screen.getByRole("menuitem", { name: /插入到 Scene/ }),
		);
		fireEvent.click(await screen.findByRole("menuitem", { name: "Scene 2" }));

		const project = useProjectStore.getState().currentProject;
		const inserted =
			project?.scenes["scene-2"]?.timeline.elements.find(
				(element) => element.type === "Image" && element.component === "image",
			) ?? null;
		expect(inserted).toBeTruthy();
		if (!inserted) return;
		expect(inserted.assetId).toBe("asset-scene");
		expect(inserted.timeline.start).toBe(0);
		expect(inserted.timeline.end).toBe(150);
		expect(inserted.timeline.trackIndex).toBe(0);
		expect(inserted.timeline.role).toBe("clip");
		expect(inserted.transform?.position.x).toBe(0);
		expect(inserted.transform?.position.y).toBe(0);

		const afterUi = project?.ui;
		expect(afterUi).toEqual(beforeUi);
	});

	it("右键 scene 节点可插入 Composition 到目标 scene timeline", async () => {
		render(<CanvasWorkspace />);
		const beforeUi = useProjectStore.getState().currentProject?.ui;

		rightClickNodeAt(60, 60);
		fireEvent.mouseEnter(
			screen.getByRole("menuitem", { name: /插入到其他 Scene/ }),
		);
		fireEvent.click(await screen.findByRole("menuitem", { name: "Scene 2" }));

		const project = useProjectStore.getState().currentProject;
		const inserted =
			project?.scenes["scene-2"]?.timeline.elements.find(
				(element) =>
					element.type === "Composition" && element.component === "composition",
			) ?? null;
		expect(inserted).toBeTruthy();
		if (!inserted) return;
		expect((inserted.props as { sceneId?: string }).sceneId).toBe("scene-1");
		expect(inserted.timeline.start).toBe(0);
		expect(inserted.timeline.end).toBe(150);
		expect(inserted.timeline.trackIndex).toBe(0);
		expect(inserted.timeline.role).toBe("clip");
		expect(inserted.transform?.baseSize.width).toBe(1920);
		expect(inserted.transform?.baseSize.height).toBe(1080);

		const afterUi = project?.ui;
		expect(afterUi).toEqual(beforeUi);
	});

	it("scene 插入会形成循环时菜单项禁用且点击无副作用", async () => {
		useProjectStore.setState((state) => {
			const project = state.currentProject;
			if (!project) return state;
			return {
				currentProject: {
					...project,
					scenes: {
						...project.scenes,
						"scene-1": {
							...project.scenes["scene-1"],
							timeline: {
								...project.scenes["scene-1"].timeline,
								elements: [
									{
										id: "composition-existing",
										type: "Composition",
										component: "composition",
										name: "scene-2",
										props: { sceneId: "scene-2" },
										timeline: {
											start: 0,
											end: 90,
											startTimecode: "00:00:00:00",
											endTimecode: "00:00:03:00",
											trackIndex: 0,
											role: "clip",
										},
										transform: {
											baseSize: { width: 1920, height: 1080 },
											position: { x: 0, y: 0, space: "canvas" },
											anchor: { x: 0.5, y: 0.5, space: "normalized" },
											scale: { x: 1, y: 1 },
											rotation: { value: 0, unit: "deg" },
										},
										render: {
											zIndex: 0,
											visible: true,
											opacity: 1,
										},
									},
								],
							},
						},
					},
				},
			};
		});

		render(<CanvasWorkspace />);
		rightClickNodeAt(60, 60);
		fireEvent.mouseEnter(
			screen.getByRole("menuitem", { name: /插入到其他 Scene/ }),
		);
		const scene2Item = await screen.findByRole("menuitem", { name: "Scene 2" });
		expect(scene2Item.getAttribute("data-disabled")).not.toBeNull();
		fireEvent.click(scene2Item);

		const project = useProjectStore.getState().currentProject;
		const scene2Compositions =
			project?.scenes["scene-2"]?.timeline.elements.filter(
				(element) =>
					element.type === "Composition" &&
					(element.props as { sceneId?: string }).sceneId === "scene-1",
			) ?? [];
		expect(scene2Compositions).toHaveLength(0);
	});

	it("右键非 image 节点会回退到画布菜单", () => {
		render(<CanvasWorkspace />);
		rightClickNodeAt(300, 160);
		expect(screen.getByRole("menuitem", { name: "新建文本节点" })).toBeTruthy();
		expect(screen.queryByRole("menuitem", { name: "插入到 Scene" })).toBeNull();
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
			(node) => node.type === "video" && node.name === "drop-video.mp4",
		);
		const newAudio = project?.canvas.nodes.find(
			(node) => node.type === "audio" && node.name === "drop-audio.mp3",
		);
		const newImage = project?.canvas.nodes.find(
			(node) => node.type === "image" && node.name === "drop-image.png",
		);
		expect(newVideo).toBeTruthy();
		expect(newAudio).toBeTruthy();
		expect(newImage).toBeTruthy();
		if (!newVideo || !newAudio || !newImage) return;
		if (
			newVideo.type !== "video" ||
			newAudio.type !== "audio" ||
			newImage.type !== "image"
		) {
			return;
		}
		const newVideoAsset = project?.assets.find(
			(asset) => asset.id === newVideo.assetId,
		);
		const newImageAsset = project?.assets.find(
			(asset) => asset.id === newImage.assetId,
		);
		expect(newAudio.x - newVideo.x).toBe(48);
		expect(newImage.x - newAudio.x).toBe(48);
		expect(newVideo.y).toBe(newAudio.y);
		expect(newAudio.y).toBe(newImage.y);
		expect(newVideoAsset?.meta?.sourceSize).toEqual({
			width: 200,
			height: 120,
		});
		expect(newImageAsset?.meta?.sourceSize).toEqual({
			width: 240,
			height: 140,
		});
		expect(useProjectStore.getState().currentProject?.ui.activeSceneId).toBe(
			"scene-1",
		);
		expect(
			useProjectStore.getState().currentProject?.ui.focusedNodeId,
		).toBeNull();
	});

	it("重叠节点命中优先 zIndex 更高者", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-video-1",
		);
	});

	it("节点拖拽会更新位置并保持 active", () => {
		render(<CanvasWorkspace />);
		dragNodeAt(300, 160, 420, 260);
		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		expect(node?.x).toBe(360);
		expect(node?.y).toBe(220);
		expect(project?.ui.activeNodeId).toBe("node-video-1");
	});

	it("拖拽结束后的首个 click 会被抑制，避免 active 误切换", () => {
		render(<CanvasWorkspace />);
		dragNodeAt(300, 160, 420, 260);
		const otherNode = getTopVisibleNodeAt(720, 360);
		act(() => {
			getLatestInfiniteSkiaCanvasProps().onNodeClick?.(otherNode);
		});
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-video-1",
		);
	});

	it("右下角 resize 会保持左上角不动", () => {
		render(<CanvasWorkspace />);
		resizeNodeAt(300, 160, 420, 260, "bottom-right");
		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		expect(node?.x).toBe(240);
		expect(node?.y).toBe(120);
		expect((node?.width ?? 0) > 320).toBe(true);
		expect((node?.height ?? 0) > 180).toBe(true);
	});

	it("左上角 resize 会保持右下角不动", () => {
		render(<CanvasWorkspace />);
		const before = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((item) => item.id === "node-video-1");
		expect(before).toBeTruthy();
		if (!before) return;
		const beforeRight = before.x + before.width;
		const beforeBottom = before.y + before.height;

		resizeNodeAt(300, 160, 360, 220, "top-left");
		const after = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((item) => item.id === "node-video-1");
		expect(after).toBeTruthy();
		if (!after) return;
		expect(Math.abs(after.x + after.width - beforeRight)).toBeLessThan(1e-6);
		expect(Math.abs(after.y + after.height - beforeBottom)).toBeLessThan(1e-6);
	});

	it("scene/video/image 等比缩放，text 保持自由缩放", () => {
		useProjectStore.setState((state) => {
			const project = state.currentProject;
			if (!project) return state;
			return {
				...state,
				currentProject: {
					...project,
					assets: project.assets.map((asset) => {
						if (asset.id !== "asset-scene") return asset;
						return {
							...asset,
							meta: {
								...(asset.meta ?? {}),
								sourceSize: {
									width: 400,
									height: 300,
								},
							},
						};
					}),
				},
			};
		});
		const textId = useProjectStore.getState().createCanvasNode({
			type: "text",
			name: "Resizable Text",
			text: "hello",
			fontSize: 24,
			x: 980,
			y: 620,
			width: 200,
			height: 80,
		});
		render(<CanvasWorkspace />);
		resizeNodeAt(300, 160, 420, 200, "bottom-right");
		resizeNodeAt(1000, 640, 1120, 640, "bottom-right");

		const project = useProjectStore.getState().currentProject;
		const video = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		const text = project?.canvas.nodes.find((item) => item.id === textId);
		expect(video).toBeTruthy();
		expect(text).toBeTruthy();
		if (!video || !text) return;
		expect(Math.abs(video.width / video.height - 4 / 3)).toBeLessThan(1e-6);
		expect(Math.abs(text.width / text.height - 200 / 80)).toBeGreaterThan(0.2);
	});

	it("resize 最小尺寸按 32px(屏幕) 约束", () => {
		const textId = useProjectStore.getState().createCanvasNode({
			type: "text",
			name: "Min Text",
			text: "min",
			fontSize: 24,
			x: 980,
			y: 100,
			width: 80,
			height: 60,
		});
		render(<CanvasWorkspace />);
		resizeNodeAt(1000, 120, 1200, 260, "top-left");
		const project = useProjectStore.getState().currentProject;
		const text = project?.canvas.nodes.find((item) => item.id === textId);
		expect(text).toBeTruthy();
		if (!text) return;
		expect(text.width).toBeGreaterThanOrEqual(32);
		expect(text.height).toBeGreaterThanOrEqual(32);
	});

	it("resize 结束仅在布局变化时写入一次历史", () => {
		render(<CanvasWorkspace />);
		expect(useStudioHistoryStore.getState().past).toHaveLength(0);

		resizeNodeAt(300, 160, 300, 160, "bottom-right");
		expect(useStudioHistoryStore.getState().past).toHaveLength(0);

		resizeNodeAt(300, 160, 360, 220, "bottom-right");
		const past = useStudioHistoryStore.getState().past;
		expect(past).toHaveLength(1);
		expect(past[0]?.kind).toBe("canvas.node-layout");
	});

	it("resize 结束后的首个 click 会被抑制，避免选中其他节点", () => {
		render(<CanvasWorkspace />);
		resizeNodeAt(300, 160, 360, 220, "bottom-right");
		const otherNode = getTopVisibleNodeAt(720, 360);
		act(() => {
			getLatestInfiniteSkiaCanvasProps().onNodeClick?.(otherNode);
		});
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-video-1",
		);
	});

	it("节点拖拽后坐标会被约束为整数", () => {
		useProjectStore.setState((state) => {
			const project = state.currentProject;
			if (!project) return state;
			return {
				...state,
				currentProject: {
					...project,
					ui: {
						...project.ui,
						camera: {
							...project.ui.camera,
							zoom: 1.3,
						},
					},
				},
			};
		});
		render(<CanvasWorkspace />);
		dragNodeAt(300, 160, 420, 260);
		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		expect(node?.x).toBe(332);
		expect(node?.y).toBe(197);
		expect(Number.isInteger(node?.x ?? NaN)).toBe(true);
		expect(Number.isInteger(node?.y ?? NaN)).toBe(true);
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
		dragNodeAt(300, 160, 420, 260);

		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		expect(node?.x).toBe(240);
		expect(node?.y).toBe(120);
		expect(project?.ui.activeNodeId).toBe("node-video-1");
	});
});
