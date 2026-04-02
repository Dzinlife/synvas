// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { TimelineAsset } from "core/element/types";
import type { CanvasNode, StudioProject } from "core/studio/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAudioOwnerForTests, getOwner, requestOwner } from "@/audio/owner";
import { componentRegistry } from "@/element/model/componentRegistry";
import { resolveClipboardNodeGeometry } from "@/element/model/clipboardTransform";
import { createTransformMeta } from "@/element/transform";
import { useProjectStore } from "@/projects/projectStore";
import {
	createRuntimeProviderWrapper,
	createTestEditorRuntime,
} from "@/scene-editor/runtime/testUtils";
import { useDragStore } from "@/scene-editor/drag";
import { buildTimelineMeta } from "@/scene-editor/utils/timelineTime";
import { useStudioClipboardStore } from "@/studio/clipboard/studioClipboardStore";
import { useCanvasCameraStore } from "@/studio/canvas/cameraStore";
import { getCanvasNodeDefinition } from "@/studio/canvas/node-system/registry";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import {
	CANVAS_OVERLAY_GAP_PX,
	CANVAS_OVERLAY_OUTER_PADDING_PX,
	CANVAS_OVERLAY_RIGHT_PANEL_WIDTH_PX,
	CANVAS_OVERLAY_SIDEBAR_WIDTH_PX,
} from "./canvasOverlayLayout";
import {
	resolveDynamicMinZoom,
	type CameraState,
} from "./canvasWorkspaceUtils";
import * as canvasSnapUtils from "./canvasSnapUtils";
import CanvasWorkspace from "./CanvasWorkspace";
import {
	TILE_MAX_TASKS_PER_TICK,
	TILE_MAX_TASKS_PER_TICK_DRAG,
} from "./tile/constants";

const togglePlaybackMock = vi.fn();
const infiniteSkiaCanvasPropsMock = vi.fn();
const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();
let rafCounter = 1;
let nativeRequestAnimationFrame: typeof window.requestAnimationFrame;
let nativeCancelAnimationFrame: typeof window.cancelAnimationFrame;
const { latestSceneDrawerPropsRef } = vi.hoisted(() => ({
	latestSceneDrawerPropsRef: {
		current: null as null | {
			onDropTimelineElementsToCanvas?: (request: {
				payload: unknown;
				clientX: number;
				clientY: number;
			}) => boolean;
		},
	},
}));

interface MockCanvasNodePointerEvent {
	clientX: number;
	clientY: number;
	button: number;
	buttons: number;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
}

interface MockCanvasNodeDragEvent extends MockCanvasNodePointerEvent {
	movementX: number;
	movementY: number;
	first: boolean;
	last: boolean;
	tap: boolean;
}

interface MockInfiniteSkiaCanvasProps {
	width: number;
	height: number;
	nodes?: CanvasNode[];
	camera?: { value: CameraState; _isSharedValue?: boolean };
	marqueeRectScreen?: {
		visible: boolean;
		x1: number;
		y1: number;
		x2: number;
		y2: number;
	} | null;
	tileDebugEnabled?: boolean;
	tileInputMode?: "raster" | "picture";
	tileMaxTasksPerTick?: number;
	tileLodTransition?: { mode: "follow" | "freeze" | "snap"; zoom?: number } | null;
	focusedNodeId?: string | null;
	hoveredNodeId?: string | null;
	selectedNodeIds?: string[];
	snapGuidesScreen?: {
		vertical: number[];
		horizontal: number[];
	};
	suspendHover?: boolean;
	onNodeResize?: (event: {
		phase: "start" | "move" | "end";
		node: CanvasNode;
		anchor: "top-left" | "top-right" | "bottom-right" | "bottom-left";
		event: MockCanvasNodeDragEvent;
	}) => void;
	onSelectionResize?: (event: {
		phase: "start" | "move" | "end";
		anchor: "top-left" | "top-right" | "bottom-right" | "bottom-left";
		event: MockCanvasNodeDragEvent;
	}) => void;
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
	const SceneDrawer = ({
		onClose,
		onDropTimelineElementsToCanvas,
	}: {
		onClose: () => void;
		onDropTimelineElementsToCanvas?: (request: {
			payload: unknown;
			clientX: number;
			clientY: number;
		}) => boolean;
	}) => {
		latestSceneDrawerPropsRef.current = {
			onDropTimelineElementsToCanvas,
		};
		return (
			<button
				type="button"
				data-testid="scene-timeline-drawer"
				onClick={onClose}
			>
				drawer
			</button>
		);
	};
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
			toTimelineClipboardElement: ({
				node,
				fps,
				startFrame,
				trackIndex,
				createElementId,
			}: {
				node: { name: string; sceneId: string; width: number; height: number };
				fps: number;
				startFrame: number;
				trackIndex: number;
				createElementId: () => string;
			}) => ({
				id: createElementId(),
				type: "Composition",
				component: "composition",
				name: node.name,
				props: {
					sceneId: node.sceneId,
				},
				transform: createTransformMeta({
					width: Math.max(1, Math.round(Math.abs(node.width))),
					height: Math.max(1, Math.round(Math.abs(node.height))),
					positionX: 0,
					positionY: 0,
				}),
				timeline: buildTimelineMeta(
					{
						start: startFrame,
						end: startFrame + 150,
						trackIndex: trackIndex >= 0 ? trackIndex : 0,
						role: "clip",
					},
					fps,
				),
				render: {
					zIndex: 0,
					visible: true,
					opacity: 1,
				},
			}),
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
					ensureProjectAsset: (input: {
						kind: "video" | "audio" | "image";
						name: string;
						locator: TimelineAsset["locator"];
						meta?: TimelineAsset["meta"];
					}) => string;
					ingestExternalFileAsset: (
						file: File,
						kind: "video" | "audio" | "image",
					) => Promise<{
						name: string;
						locator: TimelineAsset["locator"];
						meta?: TimelineAsset["meta"];
					}>;
				},
			) => {
				if (!file.type.startsWith("video/")) return null;
				const assetId = context.ensureProjectAsset({
					kind: "video",
					name: file.name,
					locator: {
						type: "linked-remote",
						uri: `https://example.com/${file.name}`,
					},
					meta: {
						fileName: file.name,
						sourceSize: {
							width: 200,
							height: 120,
						},
					},
				});
				return {
					type: "video",
					assetId,
					name: file.name,
					width: 200,
					height: 120,
				};
			},
			toTimelineClipboardElement: ({
				node,
				fps,
				startFrame,
				trackIndex,
				createElementId,
			}: {
				node: {
					name: string;
					assetId?: string;
					width: number;
					height: number;
					duration?: number;
				};
				fps: number;
				startFrame: number;
				trackIndex: number;
				createElementId: () => string;
			}) => {
				if (!node.assetId) return null;
				const durationFrames = Math.max(1, Math.round(node.duration ?? 150));
				return {
					id: createElementId(),
					type: "VideoClip",
					component: "video-clip",
					name: node.name,
					assetId: node.assetId,
					props: {},
					transform: createTransformMeta({
						width: Math.max(1, Math.round(Math.abs(node.width))),
						height: Math.max(1, Math.round(Math.abs(node.height))),
						positionX: 0,
						positionY: 0,
					}),
					timeline: buildTimelineMeta(
						{
							start: startFrame,
							end: startFrame + durationFrames,
							trackIndex: trackIndex >= 0 ? trackIndex : 0,
							role: "clip",
						},
						fps,
					),
					render: {
						zIndex: 0,
						visible: true,
						opacity: 1,
					},
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
					ensureProjectAsset: (input: {
						kind: "video" | "audio" | "image";
						name: string;
						locator: TimelineAsset["locator"];
						meta?: TimelineAsset["meta"];
					}) => string;
					ingestExternalFileAsset: (
						file: File,
						kind: "video" | "audio" | "image",
					) => Promise<{
						name: string;
						locator: TimelineAsset["locator"];
						meta?: TimelineAsset["meta"];
					}>;
				},
			) => {
				if (!file.type.startsWith("audio/")) return null;
				const assetId = context.ensureProjectAsset({
					kind: "audio",
					name: file.name,
					locator: {
						type: "linked-remote",
						uri: `https://example.com/${file.name}`,
					},
					meta: {
						fileName: file.name,
					},
				});
				return {
					type: "audio",
					assetId,
					name: file.name,
					width: 180,
					height: 80,
				};
			},
			toTimelineClipboardElement: ({
				node,
				fps,
				startFrame,
				trackIndex,
				createElementId,
			}: {
				node: {
					name: string;
					assetId?: string;
					width: number;
					height: number;
					duration?: number;
				};
				fps: number;
				startFrame: number;
				trackIndex: number;
				createElementId: () => string;
			}) => {
				if (!node.assetId) return null;
				const durationFrames = Math.max(1, Math.round(node.duration ?? 150));
				return {
					id: createElementId(),
					type: "AudioClip",
					component: "audio-clip",
					name: node.name,
					assetId: node.assetId,
					props: {
						reversed: false,
					},
					transform: createTransformMeta({
						width: Math.max(1, Math.round(Math.abs(node.width))),
						height: Math.max(1, Math.round(Math.abs(node.height))),
						positionX: 0,
						positionY: 0,
					}),
					timeline: buildTimelineMeta(
						{
							start: startFrame,
							end: startFrame + durationFrames,
							trackIndex: trackIndex < 0 ? trackIndex : -1,
							role: "audio",
						},
						fps,
					),
					render: {
						zIndex: 0,
						visible: true,
						opacity: 1,
					},
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
					ensureProjectAsset: (input: {
						kind: "video" | "audio" | "image";
						name: string;
						locator: TimelineAsset["locator"];
						meta?: TimelineAsset["meta"];
					}) => string;
					ingestExternalFileAsset: (
						file: File,
						kind: "video" | "audio" | "image",
					) => Promise<{
						name: string;
						locator: TimelineAsset["locator"];
						meta?: TimelineAsset["meta"];
					}>;
				},
			) => {
				if (!file.type.startsWith("image/")) return null;
				const assetId = context.ensureProjectAsset({
					kind: "image",
					name: file.name,
					locator: {
						type: "linked-remote",
						uri: `https://example.com/${file.name}`,
					},
					meta: {
						fileName: file.name,
						sourceSize: {
							width: 240,
							height: 140,
						},
					},
				});
				return {
					type: "image",
					assetId,
					name: file.name,
					width: 240,
					height: 140,
				};
			},
			toTimelineClipboardElement: ({
				node,
				fps,
				startFrame,
				trackIndex,
				createElementId,
			}: {
				node: { name: string; assetId?: string; width: number; height: number };
				fps: number;
				startFrame: number;
				trackIndex: number;
				createElementId: () => string;
			}) => {
				if (!node.assetId) return null;
				return {
					id: createElementId(),
					type: "Image",
					component: "image",
					name: node.name,
					assetId: node.assetId,
					props: {},
					transform: createTransformMeta({
						width: Math.max(1, Math.round(Math.abs(node.width))),
						height: Math.max(1, Math.round(Math.abs(node.height))),
						positionX: 0,
						positionY: 0,
					}),
					timeline: buildTimelineMeta(
						{
							start: startFrame,
							end: startFrame + 150,
							trackIndex: trackIndex >= 0 ? trackIndex : 0,
							role: "clip",
						},
						fps,
					),
					render: {
						zIndex: 0,
						visible: true,
						opacity: 1,
					},
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
const SKIA_RESOURCE_TRACKER_STORAGE_KEY = "ai-nle:skia-resource-tracker:v1";

vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
	() => mockDOMRect,
);

const createProject = (): StudioProject => ({
	id: "project-1",
	revision: 0,
	assets: [
		{
			id: "asset-scene",
			kind: "image",
			name: "scene.png",
			locator: {
				type: "linked-file",
				filePath: "/scene.png",
			},
			meta: {
				fileName: "scene.png",
			},
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
		canvasSnapEnabled: true,
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

const resolveFixedCameraSafeInsets = () => ({
	top: CANVAS_OVERLAY_OUTER_PADDING_PX,
	bottom: CANVAS_OVERLAY_OUTER_PADDING_PX,
	left:
		CANVAS_OVERLAY_OUTER_PADDING_PX +
		CANVAS_OVERLAY_SIDEBAR_WIDTH_PX +
		CANVAS_OVERLAY_GAP_PX,
	right:
		CANVAS_OVERLAY_OUTER_PADDING_PX +
		CANVAS_OVERLAY_RIGHT_PANEL_WIDTH_PX +
		CANVAS_OVERLAY_GAP_PX,
});

const resolveExpectedDynamicMinZoom = (): number => {
	const project = useProjectStore.getState().currentProject;
	if (!project) {
		throw new Error("project 不存在");
	}
	return resolveDynamicMinZoom({
		nodes: project.canvas.nodes,
		stageWidth: mockDOMRect.width,
		stageHeight: mockDOMRect.height,
		safeInsets: resolveFixedCameraSafeInsets(),
	});
};

let clipboardConvertersRegistered = false;

const registerClipboardConvertersForTests = (): void => {
	if (clipboardConvertersRegistered) return;
	componentRegistry.register({
		type: "Image",
		component: "image",
		createModel: (() => ({}) as never) as never,
		Renderer: (() => null) as never,
		Timeline: (() => null) as never,
		toCanvasClipboardNode: ({ element, sourceCanvasSize }) => {
			if (!element.assetId) return null;
			const geometry = resolveClipboardNodeGeometry(element, sourceCanvasSize, {
				width: 640,
				height: 360,
			});
			return {
				type: "image",
				assetId: element.assetId,
				name: element.name,
				x: geometry.x,
				y: geometry.y,
				width: geometry.width,
				height: geometry.height,
			};
		},
		meta: {
			name: "Image",
			category: "test",
		},
	});
	clipboardConvertersRegistered = true;
};

beforeEach(() => {
	togglePlaybackMock.mockReset();
	infiniteSkiaCanvasPropsMock.mockReset();
	latestSceneDrawerPropsRef.current = null;
	__resetAudioOwnerForTests();
	registerClipboardConvertersForTests();
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
	const project = createProject();
	useProjectStore.setState({
		status: "ready",
		projects: [],
		currentProjectId: "project-1",
		currentProject: project,
		focusedSceneDrafts: {},
		error: null,
	});
	useCanvasCameraStore.getState().setFromProject(project.ui.camera);
	useStudioHistoryStore.getState().clear();
	useStudioClipboardStore.getState().clearPayload();
	useDragStore.getState().endDrag();
	useDragStore.getState().setTimelineScrollLeft(0);
});

afterEach(() => {
	__resetAudioOwnerForTests();
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

const getLatestRenderNodeIds = (): string[] => {
	return (getLatestInfiniteSkiaCanvasProps().nodes ?? []).map((node) => node.id);
};

const createCanvasWorkspaceRuntime = () => {
	const runtime = createTestEditorRuntime("canvas-workspace-test");
	const timelineRef = { kind: "scene" as const, sceneId: "scene-1" };
	runtime.ensureTimelineRuntime(timelineRef);
	runtime.setActiveEditTimeline(timelineRef);
	return runtime;
};

const createTimelineSelectionElement = (id = "element-1") => {
	return {
		id,
		type: "Image" as const,
		component: "image",
		name: "Image Clip",
		assetId: "asset-scene",
		props: {},
		transform: createTransformMeta({
			width: 320,
			height: 180,
			positionX: 0,
			positionY: 0,
		}),
		timeline: buildTimelineMeta(
			{
				start: 0,
				end: 150,
				trackIndex: 0,
				role: "clip",
			},
			30,
		),
		render: {
			zIndex: 0,
			visible: true,
			opacity: 1,
		},
	};
};

const mountMainTimelineDropZone = () => {
	const mainZone = document.createElement("div");
	mainZone.setAttribute("data-track-drop-zone", "main");
	Object.defineProperty(mainZone, "getBoundingClientRect", {
		value: () => ({
			x: 0,
			y: 0,
			left: 0,
			top: 0,
			right: 400,
			bottom: 200,
			width: 400,
			height: 200,
			toJSON: () => ({}),
		}),
	});
	const contentArea = document.createElement("div");
	contentArea.setAttribute("data-track-content-area", "main");
	Object.defineProperty(contentArea, "getBoundingClientRect", {
		value: () => ({
			x: 0,
			y: 0,
			left: 0,
			top: 0,
			right: 400,
			bottom: 200,
			width: 400,
			height: 200,
			toJSON: () => ({}),
		}),
	});
	mainZone.append(contentArea);
	document.body.append(mainZone);
	return () => {
		mainZone.remove();
	};
};

const setAssetSceneSourceSize = (width: number, height: number): void => {
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
								width,
								height,
							},
						},
					};
				}),
			},
		};
	});
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
	clickNodeAt(clientX, clientY);
};

type PointerPatch = Partial<MockCanvasNodePointerEvent> & {
	pointerType?: string;
	pointerId?: number;
};

const createPointerPatch = (
	clientX: number,
	clientY: number,
	patch: PointerPatch = {},
) => {
	return {
		clientX,
		clientY,
		pointerId: patch.pointerId ?? 1,
		pointerType: patch.pointerType ?? "mouse",
		isPrimary: true,
		button: patch.button ?? 0,
		buttons:
			patch.buttons ??
			(typeof patch.button === "number" && patch.button !== 0 ? 0 : 1),
		shiftKey: patch.shiftKey ?? false,
		altKey: patch.altKey ?? false,
		metaKey: patch.metaKey ?? false,
		ctrlKey: patch.ctrlKey ?? false,
	};
};

const pointerTapAt = (
	clientX: number,
	clientY: number,
	patch: PointerPatch = {},
) => {
	const canvas = screen.getByTestId("infinite-skia-canvas");
	const pointerDown = createPointerPatch(clientX, clientY, patch);
	fireEvent.pointerDown(canvas, {
		...pointerDown,
		buttons: pointerDown.button === 0 ? 1 : 0,
	});
	fireEvent.pointerUp(canvas, {
		...pointerDown,
		buttons: 0,
	});
};

const createPointerMeta = (
	clientX: number,
	clientY: number,
	patch: Partial<MockCanvasNodePointerEvent> = {},
): MockCanvasNodePointerEvent => ({
	clientX,
	clientY,
	button: 0,
	buttons: 1,
	shiftKey: false,
	altKey: false,
	metaKey: false,
	ctrlKey: false,
	...patch,
});

const clickNodeAt = (
	clientX: number,
	clientY: number,
	patch: PointerPatch = {},
): void => {
	pointerTapAt(clientX, clientY, patch);
};

const rightClickNodeAt = (clientX: number, clientY: number): void => {
	fireEvent.contextMenu(screen.getByTestId("infinite-skia-canvas"), {
		clientX,
		clientY,
	});
};

const doubleClickNodeAt = (
	clientX: number,
	clientY: number,
	patch: PointerPatch = {},
): void => {
	pointerTapAt(clientX, clientY, patch);
	pointerTapAt(clientX, clientY, patch);
};

const dragNodeAt = (
	startClientX: number,
	startClientY: number,
	endClientX: number,
	endClientY: number,
	patch: PointerPatch = {},
): void => {
	const canvas = screen.getByTestId("infinite-skia-canvas");
	act(() => {
		const startEvent = createPointerPatch(startClientX, startClientY, patch);
		fireEvent.pointerDown(canvas, {
			...startEvent,
			buttons: 1,
		});
		fireEvent.pointerMove(canvas, {
			...createPointerPatch(endClientX, endClientY, patch),
			buttons: 1,
		});
		fireEvent.pointerUp(canvas, {
			...createPointerPatch(endClientX, endClientY, patch),
			buttons: 0,
		});
	});
};

const dragSelectionBoundsAt = (
	startClientX: number,
	startClientY: number,
	endClientX: number,
	endClientY: number,
	patch: PointerPatch = {},
): void => {
	dragNodeAt(startClientX, startClientY, endClientX, endClientY, patch);
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
			...createPointerMeta(startClientX, startClientY),
			movementX: 0,
			movementY: 0,
			first: true,
			last: false,
			tap: false,
		};
		getLatestInfiniteSkiaCanvasProps().onNodeResize?.({
			phase: "start",
			node,
			anchor,
			event: startEvent,
		});
		const moveEvent: MockCanvasNodeDragEvent = {
			...createPointerMeta(endClientX, endClientY),
			movementX: endClientX - startClientX,
			movementY: endClientY - startClientY,
			first: false,
			last: false,
			tap: false,
		};
		getLatestInfiniteSkiaCanvasProps().onNodeResize?.({
			phase: "move",
			node,
			anchor,
			event: moveEvent,
		});
		const endEvent: MockCanvasNodeDragEvent = {
			...moveEvent,
			last: true,
			buttons: 0,
		};
		getLatestInfiniteSkiaCanvasProps().onNodeResize?.({
			phase: "end",
			node,
			anchor,
			event: endEvent,
		});
	});
};

const resizeSelectionBoundsAt = (
	startClientX: number,
	startClientY: number,
	endClientX: number,
	endClientY: number,
	anchor: "top-left" | "top-right" | "bottom-right" | "bottom-left",
	patch: Partial<MockCanvasNodePointerEvent> = {},
): void => {
	act(() => {
		const startEvent: MockCanvasNodeDragEvent = {
			...createPointerMeta(startClientX, startClientY, patch),
			movementX: 0,
			movementY: 0,
			first: true,
			last: false,
			tap: false,
		};
		getLatestInfiniteSkiaCanvasProps().onSelectionResize?.({
			phase: "start",
			anchor,
			event: startEvent,
		});
		const moveEvent: MockCanvasNodeDragEvent = {
			...createPointerMeta(endClientX, endClientY, patch),
			movementX: endClientX - startClientX,
			movementY: endClientY - startClientY,
			first: false,
			last: false,
			tap: false,
		};
		getLatestInfiniteSkiaCanvasProps().onSelectionResize?.({
			phase: "move",
			anchor,
			event: moveEvent,
		});
		const endEvent: MockCanvasNodeDragEvent = {
			...moveEvent,
			last: true,
			buttons: 0,
		};
		getLatestInfiniteSkiaCanvasProps().onSelectionResize?.({
			phase: "end",
			anchor,
			event: endEvent,
		});
	});
};

const resizeNodeByIdAt = (
	nodeId: string,
	startClientX: number,
	startClientY: number,
	endClientX: number,
	endClientY: number,
	anchor: "top-left" | "top-right" | "bottom-right" | "bottom-left",
	patch: Partial<MockCanvasNodePointerEvent> = {},
): void => {
	const node = useProjectStore
		.getState()
		.currentProject?.canvas.nodes.find((item) => item.id === nodeId);
	if (!node) {
		throw new Error(`未找到节点: ${nodeId}`);
	}
	act(() => {
		const startEvent: MockCanvasNodeDragEvent = {
			...createPointerMeta(startClientX, startClientY, patch),
			movementX: 0,
			movementY: 0,
			first: true,
			last: false,
			tap: false,
		};
		getLatestInfiniteSkiaCanvasProps().onNodeResize?.({
			phase: "start",
			node,
			anchor,
			event: startEvent,
		});
		const moveEvent: MockCanvasNodeDragEvent = {
			...createPointerMeta(endClientX, endClientY, patch),
			movementX: endClientX - startClientX,
			movementY: endClientY - startClientY,
			first: false,
			last: false,
			tap: false,
		};
		getLatestInfiniteSkiaCanvasProps().onNodeResize?.({
			phase: "move",
			node,
			anchor,
			event: moveEvent,
		});
		const endEvent: MockCanvasNodeDragEvent = {
			...moveEvent,
			last: true,
			buttons: 0,
		};
		getLatestInfiniteSkiaCanvasProps().onNodeResize?.({
			phase: "end",
			node,
			anchor,
			event: endEvent,
		});
	});
};

const marqueeCanvasAt = (
	startClientX: number,
	startClientY: number,
	endClientX: number,
	endClientY: number,
	options: { shiftKey?: boolean } = {},
): void => {
	const canvas = screen.getByTestId("infinite-skia-canvas");
	fireEvent.pointerDown(canvas, {
		...createPointerPatch(startClientX, startClientY, {
			shiftKey: options.shiftKey ?? false,
		}),
		buttons: 1,
	});
	fireEvent.pointerMove(canvas, {
		...createPointerPatch(endClientX, endClientY, {
			shiftKey: options.shiftKey ?? false,
		}),
		buttons: 1,
	});
	fireEvent.pointerUp(canvas, {
		...createPointerPatch(endClientX, endClientY, {
			shiftKey: options.shiftKey ?? false,
		}),
		buttons: 0,
	});
};

const movePointerAt = (clientX: number, clientY: number): void => {
	const canvas = screen.getByTestId("infinite-skia-canvas");
	fireEvent.pointerMove(canvas, {
		...createPointerPatch(clientX, clientY),
		buttons: 0,
	});
};

const leavePointer = (): void => {
	const canvas = screen.getByTestId("infinite-skia-canvas");
	fireEvent.pointerLeave(canvas, {
		pointerType: "mouse",
		isPrimary: true,
		pointerId: 1,
	});
};

const cancelPointerAt = (clientX: number, clientY: number): void => {
	const canvas = screen.getByTestId("infinite-skia-canvas");
	fireEvent.pointerCancel(canvas, {
		...createPointerPatch(clientX, clientY),
		buttons: 0,
	});
};

const touchDoubleTapNodeAt = (clientX: number, clientY: number): void => {
	pointerTapAt(clientX, clientY, {
		pointerType: "touch",
	});
	pointerTapAt(clientX, clientY, {
		pointerType: "touch",
	});
};

const pointerTapWithCapturedUpAt = (
	clientX: number,
	clientY: number,
	patch: PointerPatch = {},
): void => {
	const canvas = screen.getByTestId("infinite-skia-canvas");
	const workspace = screen.getByTestId("canvas-workspace");
	const pointerDown = createPointerPatch(clientX, clientY, patch);
	fireEvent.pointerDown(canvas, {
		...pointerDown,
		buttons: pointerDown.button === 0 ? 1 : 0,
	});
	fireEvent.pointerUp(workspace, {
		...pointerDown,
		buttons: 0,
	});
};

const clickSidebarNode = (nodeId: string): void => {
	fireEvent.click(screen.getByTestId(`canvas-sidebar-node-item-${nodeId}`));
};

describe("CanvasWorkspace", () => {
	it("编辑器区域 mouseover 不会冒泡到 document", () => {
		const onDocumentMouseOver = vi.fn();
		document.addEventListener("mouseover", onDocumentMouseOver);
		try {
			render(<CanvasWorkspace />);
			fireEvent.mouseOver(screen.getByTestId("infinite-skia-canvas"));
			expect(onDocumentMouseOver).not.toHaveBeenCalled();
		} finally {
			document.removeEventListener("mouseover", onDocumentMouseOver);
		}
	});

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

		doubleClickNodeAt(600, 400);
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

	it("timeline element 选中时右侧优先展示 element 属性面板并可回退 Active Node", async () => {
		const runtime = createCanvasWorkspaceRuntime();
		const selectedElement = createTimelineSelectionElement();
		runtime.getActiveEditTimelineRuntime()?.timelineStore.setState({
			elements: [selectedElement],
			selectedIds: [selectedElement.id],
			primarySelectedId: selectedElement.id,
		});
		render(<CanvasWorkspace />, {
			wrapper: createRuntimeProviderWrapper(runtime),
		});

		expect(
			screen.getByTestId("canvas-timeline-element-settings-panel"),
		).toBeTruthy();
		expect(screen.queryByTestId("canvas-active-node-meta-panel")).toBeNull();

		act(() => {
			runtime
				.getActiveEditTimelineRuntime()
				?.timelineStore.getState()
				.setSelectedIds([], null);
		});

		await waitFor(() => {
			expect(
				screen.queryByTestId("canvas-timeline-element-settings-panel"),
			).toBeNull();
		});
		expect(screen.getByTestId("canvas-active-node-meta-panel")).toBeTruthy();
	});

	it("无 active node 时只要 timeline element 仍被选中，右侧属性面板仍显示", async () => {
		const runtime = createCanvasWorkspaceRuntime();
		const selectedElement = createTimelineSelectionElement();
		runtime.getActiveEditTimelineRuntime()?.timelineStore.setState({
			elements: [selectedElement],
			selectedIds: [selectedElement.id],
			primarySelectedId: selectedElement.id,
		});
		render(<CanvasWorkspace />, {
			wrapper: createRuntimeProviderWrapper(runtime),
		});

		act(() => {
			useProjectStore.getState().setActiveNode(null);
		});

		expect(
			screen.getByTestId("canvas-timeline-element-settings-panel"),
		).toBeTruthy();

		act(() => {
			runtime
				.getActiveEditTimelineRuntime()
				?.timelineStore.getState()
				.setSelectedIds([], null);
		});

		await waitFor(() => {
			expect(screen.queryByTestId("canvas-overlay-right-panel")).toBeNull();
		});
	});

	it("在右侧面板滚轮不会触发画布 camera 平移", () => {
		render(<CanvasWorkspace />);
		const before = useCanvasCameraStore.getState().camera;
		const panel = screen.getByTestId("canvas-active-node-meta-panel");
		fireEvent.wheel(panel, {
			deltaY: 120,
		});
		const after = useCanvasCameraStore.getState().camera;
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
				useCanvasCameraStore.getState().camera.zoom ?? 1;
			expect(Math.abs(zoom - 1)).toBeGreaterThan(0.001);
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const beforeZoom =
			useCanvasCameraStore.getState().camera.zoom ?? 0;
		fireEvent.click(screen.getByLabelText("收起侧边栏"));
		await waitFor(() => {
			const zoom =
				useCanvasCameraStore.getState().camera.zoom ?? 0;
			expect(Math.abs(zoom - beforeZoom)).toBeGreaterThan(0.001);
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const afterZoom =
			useCanvasCameraStore.getState().camera.zoom ?? 0;
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
				useCanvasCameraStore.getState().camera.zoom ?? 1;
			expect(Math.abs(zoom - 1)).toBeGreaterThan(0.001);
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const beforeZoom =
			useCanvasCameraStore.getState().camera.zoom ?? 0;
		act(() => {
			useProjectStore.getState().setActiveNode(null);
		});
		await waitFor(() => {
			expect(screen.queryByTestId("canvas-active-node-meta-panel")).toBeNull();
		});
		await waitFor(() => {
			const zoom =
				useCanvasCameraStore.getState().camera.zoom ?? 0;
			expect(Math.abs(zoom - beforeZoom)).toBeGreaterThan(0.001);
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const afterZoom =
			useCanvasCameraStore.getState().camera.zoom ?? 0;
		expect(afterZoom).toBeGreaterThan(beforeZoom);
	});

	it("focus 大尺寸节点时允许缩放低于 0.2，避免超出可视约束", async () => {
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
							node.id === "node-scene-1"
								? {
										...node,
										x: 0,
										y: 0,
										width: 12000,
										height: 3200,
									}
								: node,
						),
					},
				},
			};
		});
		render(<CanvasWorkspace />);
		doubleClickNodeAt(80, 80);
		await waitFor(() => {
			expect(screen.getByTestId("focus-scene-skia-layer")).toBeTruthy();
		});
		await waitFor(() => {
			const zoom =
				useCanvasCameraStore.getState().camera.zoom ?? 1;
			expect(zoom).toBeLessThan(0.2);
		});
	});

	it("初始 active node 会渲染同位同尺寸 overlay", () => {
		render(<CanvasWorkspace />);
		const overlay = screen.getByTestId("canvas-active-node-overlay");
		expect(overlay.style.left).toBe("0px");
		expect(overlay.style.top).toBe("0px");
		expect(overlay.style.width).toBe("960px");
		expect(overlay.style.height).toBe("540px");
		expect(screen.getByTestId("node-toolbar-scene")).toBeTruthy();
	});

	it("camera 变化会同步 active node overlay 屏幕坐标", async () => {
		render(<CanvasWorkspace />);
		act(() => {
			useCanvasCameraStore.getState().setCamera({
				x: 10,
				y: 20,
				zoom: 2,
			});
		});
		await waitFor(() => {
			const overlay = screen.getByTestId("canvas-active-node-overlay");
			expect(overlay.style.left).toBe("20px");
			expect(overlay.style.top).toBe("40px");
			expect(overlay.style.width).toBe("1920px");
			expect(overlay.style.height).toBe("1080px");
		});
	});

	it("active node overlay 本体不可点击且 toolbar 使用 bottom-full 并可点击", () => {
		render(<CanvasWorkspace />);
		const overlay = screen.getByTestId("canvas-active-node-overlay");
		const toolbar = screen.getByTestId("canvas-active-node-toolbar");
		expect(overlay.className).toContain("pointer-events-none");
		expect(toolbar.className).toContain("bottom-full");
		expect(toolbar.className).toContain("pointer-events-auto");
	});

	it("active node 切换会更新节点 overlay toolbar", () => {
		render(<CanvasWorkspace />);
		const beforeOverlay = screen.getByTestId("canvas-active-node-overlay");
		expect(beforeOverlay.style.left).toBe("0px");
		expect(beforeOverlay.style.top).toBe("0px");
		expect(beforeOverlay.style.width).toBe("960px");
		expect(beforeOverlay.style.height).toBe("540px");
		expect(screen.getByTestId("node-toolbar-scene")).toBeTruthy();

		clickNodeAt(300, 160);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-video-1",
		);
		expect(screen.getByTestId("node-toolbar-video")).toBeTruthy();
		const afterOverlay = screen
			.getByTestId("node-toolbar-video")
			.closest('[data-testid="canvas-active-node-overlay"]');
		expect(afterOverlay).toBeTruthy();
		expect(afterOverlay?.style.left).toBe("240px");
		expect(afterOverlay?.style.top).toBe("120px");
		expect(afterOverlay?.style.width).toBe("320px");
		expect(afterOverlay?.style.height).toBe("180px");
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

	it("touch 双击同一节点会进入 focus", async () => {
		render(<CanvasWorkspace />);
		touchDoubleTapNodeAt(80, 80);
		expect(useProjectStore.getState().currentProject?.ui.focusedNodeId).toBe(
			"node-scene-1",
		);
		await waitFor(() => {
			expect(screen.getByTestId("focus-scene-skia-layer")).toBeTruthy();
		});
	});

	it("pointer capture 下 pointerup 落在 workspace 仍可触发单击/双击", () => {
		render(<CanvasWorkspace />);
		pointerTapWithCapturedUpAt(300, 160);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-video-1",
		);
		pointerTapWithCapturedUpAt(80, 80);
		pointerTapWithCapturedUpAt(80, 80);
		expect(useProjectStore.getState().currentProject?.ui.focusedNodeId).toBe(
			"node-scene-1",
		);
	});

	it("scene 失去 active 时会暂停并保留时间", async () => {
		const runtime = createCanvasWorkspaceRuntime();
		const sceneRuntime = runtime.getTimelineRuntime({
			kind: "scene" as const,
			sceneId: "scene-1",
		});
		expect(sceneRuntime).toBeTruthy();
		if (!sceneRuntime) return;

		sceneRuntime.timelineStore.setState({
			currentTime: 42,
			previewTime: null,
			isPlaying: true,
		});
		requestOwner("scene:scene-1");

		render(<CanvasWorkspace />, {
			wrapper: createRuntimeProviderWrapper(runtime),
		});

		expect(sceneRuntime.timelineStore.getState().isPlaying).toBe(true);
		expect(getOwner()).toBe("scene:scene-1");

		clickNodeAt(300, 160);
		await waitFor(() => {
			expect(sceneRuntime.timelineStore.getState().isPlaying).toBe(false);
			expect(getOwner()).toBeNull();
		});
		expect(sceneRuntime.timelineStore.getState().currentTime).toBe(42);
	});
	it("scene drawer 回调投放 timeline payload 到画布会创建副本节点并写入 batch 历史", async () => {
		const runtime = createCanvasWorkspaceRuntime();
		const originalElementFromPoint = (
			document as Document & {
				elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
			}
		).elementFromPoint;
		try {
			render(<CanvasWorkspace />, {
				wrapper: createRuntimeProviderWrapper(runtime),
			});
			doubleClickNodeAt(80, 80);
			await waitFor(() => {
				expect(screen.getByTestId("scene-timeline-drawer")).toBeTruthy();
			});
			const drawerOverlay = screen.getByTestId("canvas-overlay-drawer");
			Object.defineProperty(drawerOverlay, "getBoundingClientRect", {
				value: () => ({
					left: 200,
					top: 420,
					right: 1000,
					bottom: 780,
					width: 800,
					height: 360,
					x: 200,
					y: 420,
					toJSON: () => ({}),
				}),
			});
			const canvasSurface = screen.getByTestId("infinite-skia-canvas");
			Object.defineProperty(document, "elementFromPoint", {
				configurable: true,
				value: () => canvasSurface,
			});
			const timelineElement = {
				...createTimelineSelectionElement("element-drawer-drop"),
				name: "Drawer Clip",
			};
			let handled = false;
			act(() => {
				handled = Boolean(
					latestSceneDrawerPropsRef.current?.onDropTimelineElementsToCanvas?.({
						payload: {
							kind: "timeline-elements",
							payload: {
								elements: [timelineElement],
								primaryId: timelineElement.id,
								anchor: {
									assetId: timelineElement.id,
									start: timelineElement.timeline.start,
									trackIndex: timelineElement.timeline.trackIndex ?? 0,
								},
								source: {
									sceneId: "scene-1",
									canvasSize: { width: 1920, height: 1080 },
									fps: 30,
								},
							},
							source: {
								sceneId: "scene-1",
								canvasSize: { width: 1920, height: 1080 },
								fps: 30,
							},
						},
						clientX: 900,
						clientY: 120,
					}),
				);
			});
			expect(handled).toBe(true);
			const project = useProjectStore.getState().currentProject;
			const createdNode = project?.canvas.nodes.find(
				(node) => node.name === "Drawer Clip副本",
			);
			expect(createdNode).toBeTruthy();
			expect(createdNode?.x).toBe(900);
			expect(createdNode?.y).toBe(120);
			const timelineElements =
				runtime.getActiveEditTimelineRuntime()?.timelineStore.getState().elements ??
				[];
			expect(timelineElements).toHaveLength(0);
			const past = useStudioHistoryStore.getState().past;
			expect(past.at(-1)?.kind).toBe("canvas.node-create.batch");
		} finally {
			if (typeof originalElementFromPoint === "function") {
				Object.defineProperty(document, "elementFromPoint", {
					configurable: true,
					value: originalElementFromPoint,
				});
			} else {
				delete (
					document as Document & {
						elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
					}
				).elementFromPoint;
			}
		}
	});

	it("scene drawer 回调在轨道区域释放时不应接管 timeline 拖拽", async () => {
		const runtime = createCanvasWorkspaceRuntime();
		const originalElementFromPoint = (
			document as Document & {
				elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
			}
		).elementFromPoint;
		try {
			render(<CanvasWorkspace />, {
				wrapper: createRuntimeProviderWrapper(runtime),
			});
			doubleClickNodeAt(80, 80);
			await waitFor(() => {
				expect(screen.getByTestId("scene-timeline-drawer")).toBeTruthy();
			});
			const timelineZone = document.createElement("div");
			timelineZone.setAttribute("data-track-drop-zone", "main");
			Object.defineProperty(timelineZone, "getBoundingClientRect", {
				value: () => ({
					left: 200,
					top: 300,
					right: 900,
					bottom: 700,
					width: 700,
					height: 400,
					x: 200,
					y: 300,
					toJSON: () => ({}),
				}),
			});
			document.body.appendChild(timelineZone);
			Object.defineProperty(document, "elementFromPoint", {
				configurable: true,
				value: () => timelineZone,
			});
			const timelineElement = {
				...createTimelineSelectionElement("element-drawer-drop-track"),
				name: "Drawer Track Drag",
			};
			const beforeNodeCount =
				useProjectStore.getState().currentProject?.canvas.nodes.length ?? 0;
			let handled = true;
			act(() => {
				handled = Boolean(
					latestSceneDrawerPropsRef.current?.onDropTimelineElementsToCanvas?.({
						payload: {
							kind: "timeline-elements",
							payload: {
								elements: [timelineElement],
								primaryId: timelineElement.id,
								anchor: {
									assetId: timelineElement.id,
									start: timelineElement.timeline.start,
									trackIndex: timelineElement.timeline.trackIndex ?? 0,
								},
								source: {
									sceneId: "scene-1",
									canvasSize: { width: 1920, height: 1080 },
									fps: 30,
								},
							},
							source: {
								sceneId: "scene-1",
								canvasSize: { width: 1920, height: 1080 },
								fps: 30,
							},
						},
						clientX: 520,
						clientY: 420,
					}),
				);
			});
			expect(handled).toBe(false);
			const afterNodeCount =
				useProjectStore.getState().currentProject?.canvas.nodes.length ?? 0;
			expect(afterNodeCount).toBe(beforeNodeCount);
			timelineZone.remove();
		} finally {
			if (typeof originalElementFromPoint === "function") {
				Object.defineProperty(document, "elementFromPoint", {
					configurable: true,
					value: originalElementFromPoint,
				});
			} else {
				delete (
					document as Document & {
						elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
					}
				).elementFromPoint;
			}
		}
	});

	it("scene drawer 回调在 timeline-editor 区域内释放时不应判定为画布投放", async () => {
		const runtime = createCanvasWorkspaceRuntime();
		const originalElementFromPoint = (
			document as Document & {
				elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
			}
		).elementFromPoint;
		try {
			render(<CanvasWorkspace />, {
				wrapper: createRuntimeProviderWrapper(runtime),
			});
			doubleClickNodeAt(80, 80);
			await waitFor(() => {
				expect(screen.getByTestId("scene-timeline-drawer")).toBeTruthy();
			});
			const timelineEditor = document.createElement("div");
			timelineEditor.setAttribute("data-testid", "timeline-editor");
			Object.defineProperty(timelineEditor, "getBoundingClientRect", {
				value: () => ({
					left: 200,
					top: 200,
					right: 1000,
					bottom: 760,
					width: 800,
					height: 560,
					x: 200,
					y: 200,
					toJSON: () => ({}),
				}),
			});
			document.body.appendChild(timelineEditor);
			const canvasSurface = screen.getByTestId("infinite-skia-canvas");
			Object.defineProperty(document, "elementFromPoint", {
				configurable: true,
				value: () => canvasSurface,
			});
			const timelineElement = {
				...createTimelineSelectionElement("element-drawer-drop-editor"),
				name: "Drawer Editor Drag",
			};
			const beforeNodeCount =
				useProjectStore.getState().currentProject?.canvas.nodes.length ?? 0;
			let handled = true;
			act(() => {
				handled = Boolean(
					latestSceneDrawerPropsRef.current?.onDropTimelineElementsToCanvas?.({
						payload: {
							kind: "timeline-elements",
							payload: {
								elements: [timelineElement],
								primaryId: timelineElement.id,
								anchor: {
									assetId: timelineElement.id,
									start: timelineElement.timeline.start,
									trackIndex: timelineElement.timeline.trackIndex ?? 0,
								},
								source: {
									sceneId: "scene-1",
									canvasSize: { width: 1920, height: 1080 },
									fps: 30,
								},
							},
							source: {
								sceneId: "scene-1",
								canvasSize: { width: 1920, height: 1080 },
								fps: 30,
							},
						},
						clientX: 420,
						clientY: 360,
					}),
				);
			});
			expect(handled).toBe(false);
			const afterNodeCount =
				useProjectStore.getState().currentProject?.canvas.nodes.length ?? 0;
			expect(afterNodeCount).toBe(beforeNodeCount);
			timelineEditor.remove();
		} finally {
			if (typeof originalElementFromPoint === "function") {
				Object.defineProperty(document, "elementFromPoint", {
					configurable: true,
					value: originalElementFromPoint,
				});
			} else {
				delete (
					document as Document & {
						elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
					}
				).elementFromPoint;
			}
		}
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
		const before = useCanvasCameraStore.getState().camera;
		clickSidebarNode("node-video-offscreen");
		const immediate = useCanvasCameraStore.getState().camera;
		expect(before).toBeTruthy();
		expect(immediate).toBeTruthy();
		if (!before || !immediate) return;
		expect(immediate).toEqual(before);
		await waitFor(() => {
			const after = useCanvasCameraStore.getState().camera;
			expect(after).toBeTruthy();
			if (!after) return;
			expect(after.zoom).toBe(before.zoom);
			expect(after.x).not.toBe(before.x);
		});
	});

	it("点击被面板遮挡的节点会触发 camera 平移进入安全区", async () => {
		render(<CanvasWorkspace />);
		const before = useCanvasCameraStore.getState().camera;
		clickSidebarNode("node-video-1");
		const immediate = useCanvasCameraStore.getState().camera;
		expect(before).toBeTruthy();
		expect(immediate).toBeTruthy();
		if (!before || !immediate) return;
		expect(immediate).toEqual(before);
		await waitFor(() => {
			const after = useCanvasCameraStore.getState().camera;
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
		const beforeCamera = useCanvasCameraStore.getState().camera;
		const nodeButton = screen.getByTestId(
			"canvas-sidebar-node-item-node-video-1",
		);
		expect(nodeButton.getAttribute("disabled")).not.toBeNull();
		fireEvent.click(nodeButton);
		const afterUi = useProjectStore.getState().currentProject?.ui;
		const afterCamera = useCanvasCameraStore.getState().camera;
		expect(beforeUi).toBeTruthy();
		expect(afterUi).toBeTruthy();
		expect(afterUi?.activeNodeId).toBe(beforeUi?.activeNodeId);
		expect(afterCamera).toEqual(beforeCamera);
	});

	it("双击非 focusable 节点仅调整 camera，不进入 focus", async () => {
		render(<CanvasWorkspace />);
		const beforeCamera = useCanvasCameraStore.getState().camera;
		doubleClickNodeAt(300, 160);
		const immediateCamera =
			useCanvasCameraStore.getState().camera;
		expect(
			useProjectStore.getState().currentProject?.ui.focusedNodeId,
		).toBeNull();
		expect(screen.queryByTestId("focus-scene-skia-layer")).toBeNull();
		expect(immediateCamera).toBeTruthy();
		expect(beforeCamera).toBeTruthy();
		if (!immediateCamera || !beforeCamera) return;
		expect(immediateCamera).toEqual(beforeCamera);
		await waitFor(() => {
			const afterCamera = useCanvasCameraStore.getState().camera;
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
		const beforeCamera = useCanvasCameraStore.getState().camera;
		fireEvent.wheel(workspace, {
			deltaX: 120,
			deltaY: 80,
		});
		const afterCamera = useCanvasCameraStore.getState().camera;
		expect(beforeCamera).toBeTruthy();
		expect(afterCamera).toBeTruthy();
		if (!beforeCamera || !afterCamera) return;
		expect(afterCamera.x).not.toBe(beforeCamera.x);
		expect(afterCamera.y).not.toBe(beforeCamera.y);
	});

	it("smooth 动画会一次切到起终并集可见集并在动画中保持稳定", async () => {
		render(<CanvasWorkspace />);
		clickCanvasAt(1120, 700);
		expect(getLatestRenderNodeIds()).toEqual([
			"node-scene-1",
			"node-video-1",
			"node-image-1",
		]);
		clickSidebarNode("node-video-offscreen");
		const unionNodeIds = [
			"node-scene-1",
			"node-video-1",
			"node-scene-2",
			"node-video-offscreen",
			"node-image-1",
		];
		expect(getLatestRenderNodeIds()).toEqual(unionNodeIds);
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 96);
			});
		});
		expect(getLatestRenderNodeIds()).toEqual(unionNodeIds);
	});

	it("连续 wheel pan 会降频更新可见裁切并在空闲后补算", async () => {
		render(<CanvasWorkspace />);
		clickCanvasAt(1120, 700);
		expect(getLatestRenderNodeIds()).toEqual([
			"node-scene-1",
			"node-video-1",
			"node-image-1",
		]);
		const workspace = screen.getByTestId("canvas-workspace");
		const initialRenderCount = infiniteSkiaCanvasPropsMock.mock.calls.length;
		for (let i = 0; i < 6; i += 1) {
			fireEvent.wheel(workspace, {
				deltaX: 200,
				deltaY: 0,
			});
		}
		const afterBurstRenderCount = infiniteSkiaCanvasPropsMock.mock.calls.length;
		expect(afterBurstRenderCount - initialRenderCount).toBeLessThanOrEqual(6);
		expect(getLatestRenderNodeIds()).toEqual([
			"node-scene-1",
			"node-video-1",
			"node-image-1",
		]);
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 170);
			});
		});
		expect(getLatestRenderNodeIds()).toEqual([
			"node-scene-2",
			"node-video-offscreen",
		]);
		expect(infiniteSkiaCanvasPropsMock.mock.calls.length).toBeGreaterThan(
			afterBurstRenderCount,
		);
	});

	it("ctrl+wheel zoom 会降频更新可见裁切并在空闲后补算", async () => {
		render(<CanvasWorkspace />);
		clickCanvasAt(1120, 700);
		const workspace = screen.getByTestId("canvas-workspace");
		const initialRenderCount = infiniteSkiaCanvasPropsMock.mock.calls.length;
		for (let i = 0; i < 6; i += 1) {
			fireEvent.wheel(workspace, {
				deltaY: 80,
				ctrlKey: true,
				clientX: 600,
				clientY: 400,
			});
		}
		const afterBurstRenderCount = infiniteSkiaCanvasPropsMock.mock.calls.length;
		expect(afterBurstRenderCount - initialRenderCount).toBeLessThanOrEqual(6);
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 170);
			});
		});
		expect(infiniteSkiaCanvasPropsMock.mock.calls.length).toBeGreaterThan(
			afterBurstRenderCount,
		);
	});

	it("渲染节点会按相机视口进行 AABB 裁切", () => {
		render(<CanvasWorkspace />);
		clickCanvasAt(1120, 700);
		expect(getLatestRenderNodeIds()).toEqual([
			"node-scene-1",
			"node-video-1",
			"node-image-1",
		]);
		const workspace = screen.getByTestId("canvas-workspace");
		fireEvent.wheel(workspace, {
			deltaX: 2000,
			deltaY: 0,
		});
		expect(getLatestRenderNodeIds()).toEqual([
			"node-scene-2",
			"node-video-offscreen",
		]);
	});

	it("viewport 外 active 节点会被强制保留在渲染列表", () => {
		render(<CanvasWorkspace />);
		clickCanvasAt(1120, 700);
		expect(getLatestRenderNodeIds()).toEqual([
			"node-scene-1",
			"node-video-1",
			"node-image-1",
		]);
		act(() => {
			useProjectStore.getState().setActiveNode("node-video-offscreen");
		});
		expect(getLatestRenderNodeIds()).toContain("node-video-offscreen");
	});

	it("外部 setCamera 会立即更新可见裁切", () => {
		render(<CanvasWorkspace />);
		clickCanvasAt(1120, 700);
		expect(getLatestRenderNodeIds()).toEqual([
			"node-scene-1",
			"node-video-1",
			"node-image-1",
		]);
		act(() => {
			useCanvasCameraStore.getState().setCamera({
				x: -2000,
				y: 0,
				zoom: 1,
			});
		});
		expect(getLatestRenderNodeIds()).toEqual([
			"node-scene-2",
			"node-video-offscreen",
		]);
	});

	it("wheel pan 不会改写 projectStore.currentProject 引用", () => {
		render(<CanvasWorkspace />);
		const workspace = screen.getByTestId("canvas-workspace");
		const beforeProject = useProjectStore.getState().currentProject;
		const beforeCamera = useCanvasCameraStore.getState().camera;
		fireEvent.wheel(workspace, {
			deltaX: 24,
			deltaY: 18,
		});
		const afterProject = useProjectStore.getState().currentProject;
		const afterCamera = useCanvasCameraStore.getState().camera;
		expect(beforeProject).toBeTruthy();
		expect(afterProject).toBeTruthy();
		expect(afterProject).toBe(beforeProject);
		expect(
			afterCamera.x !== beforeCamera.x || afterCamera.y !== beforeCamera.y,
		).toBe(true);
	});

	it("全局可俯瞰时 ctrl+wheel 使用默认下限 0.1", () => {
		useProjectStore.setState((state) => {
			const project = state.currentProject;
			if (!project) return state;
			return {
				...state,
				currentProject: {
					...project,
					canvas: {
						...project.canvas,
						nodes: project.canvas.nodes.map((node) => ({
							...node,
							x: 0,
							y: 0,
							width: 400,
							height: 200,
						})),
					},
				},
			};
		});
		const expectedFloor = resolveExpectedDynamicMinZoom();
		render(<CanvasWorkspace />);
		const workspace = screen.getByTestId("canvas-workspace");
		for (let i = 0; i < 120; i += 1) {
			fireEvent.wheel(workspace, {
				deltaY: 80,
				ctrlKey: true,
				clientX: 600,
				clientY: 400,
			});
		}
		const zoom = useCanvasCameraStore.getState().camera.zoom ?? 0;
		expect(expectedFloor).toBeCloseTo(0.1, 3);
		expect(zoom).toBeCloseTo(expectedFloor, 3);
	});

	it("节点分布较散时 ctrl+wheel 可缩放到 0.1 以下", () => {
		useProjectStore.setState((state) => {
			const project = state.currentProject;
			if (!project) return state;
			return {
				...state,
				currentProject: {
					...project,
					canvas: {
						...project.canvas,
						nodes: project.canvas.nodes.map((node) => {
							if (node.id === "node-image-hidden") {
								return {
									...node,
									x: 0,
									y: 0,
									width: 12000,
									height: 100,
									hidden: true,
								};
							}
							return {
								...node,
								x: 0,
								y: 0,
								width: 400,
								height: 200,
							};
						}),
					},
				},
			};
		});
		const expectedFloor = resolveExpectedDynamicMinZoom();
		render(<CanvasWorkspace />);
		const workspace = screen.getByTestId("canvas-workspace");
		for (let i = 0; i < 120; i += 1) {
			fireEvent.wheel(workspace, {
				deltaY: 80,
				ctrlKey: true,
				clientX: 600,
				clientY: 400,
			});
		}
		const zoom = useCanvasCameraStore.getState().camera.zoom ?? 0;
		expect(expectedFloor).toBeLessThan(0.1);
		expect(zoom).toBeCloseTo(expectedFloor, 3);
	});

	it("drawer 高度变化前后最小缩放阈值保持一致", async () => {
		const sceneDefinition = getCanvasNodeDefinition("scene");
		const drawerOptions = sceneDefinition?.drawerOptions;
		const previousTrigger = drawerOptions?.trigger;
		if (drawerOptions) {
			drawerOptions.trigger = "active";
		}
		try {
			useProjectStore.setState((state) => {
				const project = state.currentProject;
				if (!project) return state;
				return {
					...state,
					currentProject: {
						...project,
						canvas: {
							...project.canvas,
							nodes: project.canvas.nodes.map((node) => {
								if (node.id === "node-image-hidden") {
									return {
										...node,
										x: 0,
										y: 0,
										width: 12000,
										height: 100,
										hidden: true,
									};
								}
								return {
									...node,
									x: 0,
									y: 0,
									width: 400,
									height: 200,
								};
							}),
						},
					},
				};
			});
			const expectedFloor = resolveExpectedDynamicMinZoom();
			render(<CanvasWorkspace />);
			const workspace = screen.getByTestId("canvas-workspace");
			await waitFor(() => {
				expect(screen.getByLabelText("调整 Drawer 高度")).toBeTruthy();
			});

			for (let i = 0; i < 120; i += 1) {
				fireEvent.wheel(workspace, {
					deltaY: 80,
					ctrlKey: true,
					clientX: 600,
					clientY: 400,
				});
			}
			const beforeFloor = useCanvasCameraStore.getState().camera.zoom ?? 0;

			for (let i = 0; i < 40; i += 1) {
				fireEvent.wheel(workspace, {
					deltaY: -80,
					ctrlKey: true,
					clientX: 600,
					clientY: 400,
				});
			}

			const handle = screen.getByLabelText("调整 Drawer 高度");
			fireEvent.mouseDown(handle, { clientY: 700 });
			fireEvent.mouseMove(document, { clientY: 760 });
			fireEvent.mouseUp(document);

			for (let i = 0; i < 120; i += 1) {
				fireEvent.wheel(workspace, {
					deltaY: 80,
					ctrlKey: true,
					clientX: 600,
					clientY: 400,
				});
			}
			const afterFloor = useCanvasCameraStore.getState().camera.zoom ?? 0;
			expect(beforeFloor).toBeCloseTo(expectedFloor, 3);
			expect(afterFloor).toBeCloseTo(expectedFloor, 3);
			expect(afterFloor).toBeCloseTo(beforeFloor, 3);
		} finally {
			if (drawerOptions) {
				drawerOptions.trigger = previousTrigger;
			}
		}
	});

	it("smooth 动画期间 instant zoom 更新会被忽略", async () => {
		render(<CanvasWorkspace />);
		const workspace = screen.getByTestId("canvas-workspace");
		clickSidebarNode("node-video-offscreen");
		const beforeWheel = useCanvasCameraStore.getState().camera;
		fireEvent.wheel(workspace, {
			deltaY: 80,
			ctrlKey: true,
		});
		const afterWheel = useCanvasCameraStore.getState().camera;
		expect(beforeWheel).toBeTruthy();
		expect(afterWheel).toBeTruthy();
		if (!beforeWheel || !afterWheel) return;
		expect(afterWheel).toEqual(beforeWheel);

		await waitFor(() => {
			const cameraAfterAnimation =
				useCanvasCameraStore.getState().camera;
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
		const settled = useCanvasCameraStore.getState().camera;
		expect(settled).toBeTruthy();
		if (!settled) return;
		expect(
			settled.x !== afterWheel.x ||
				settled.y !== afterWheel.y ||
				settled.zoom !== afterWheel.zoom,
		).toBe(true);
	});

	it("退出 focus 的 smooth 动画期间 instant pan 会被忽略", async () => {
		render(<CanvasWorkspace />);
		doubleClickNodeAt(80, 80);
		await waitFor(() => {
			expect(screen.getByTestId("focus-scene-skia-layer")).toBeTruthy();
		});

		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => {
			expect(getLatestInfiniteSkiaCanvasProps().suspendHover).toBe(true);
		});

		const beforePanCamera = getLatestInfiniteSkiaCanvasProps().camera;
		expect(beforePanCamera).toBeTruthy();
		if (!beforePanCamera) return;

		fireEvent.wheel(screen.getByTestId("canvas-workspace"), {
			deltaX: 120,
			deltaY: 80,
		});

		const afterPanCamera = getLatestInfiniteSkiaCanvasProps().camera;
		expect(afterPanCamera).toBeTruthy();
		if (!afterPanCamera) return;
		expect(afterPanCamera).toEqual(beforePanCamera);
		expect(getLatestInfiniteSkiaCanvasProps().suspendHover).toBe(true);
	});

	it("进入 focus 的 smooth 动画会锁定 tile LOD 过渡为 freeze", async () => {
		render(<CanvasWorkspace />);
		doubleClickNodeAt(80, 80);
		await waitFor(() => {
			expect(screen.getByTestId("focus-scene-skia-layer")).toBeTruthy();
		});
		await waitFor(() => {
			expect(getLatestInfiniteSkiaCanvasProps().tileLodTransition?.mode).toBe(
				"freeze",
			);
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		expect(getLatestInfiniteSkiaCanvasProps().suspendHover).toBe(false);
		expect(getLatestInfiniteSkiaCanvasProps().tileLodTransition?.mode).toBe(
			"freeze",
		);
	});

	it("退出 focus 未触发半缩放约束时保持 freeze 并恢复 pre-focus camera", async () => {
		render(<CanvasWorkspace />);
		const workspace = screen.getByTestId("canvas-workspace");
		for (let index = 0; index < 40; index += 1) {
			fireEvent.wheel(workspace, {
				deltaY: 80,
				ctrlKey: true,
				clientX: 600,
				clientY: 400,
			});
		}
		const preFocusCamera = getLatestInfiniteSkiaCanvasProps().camera?.value;
		expect(preFocusCamera).toBeTruthy();
		if (!preFocusCamera) return;
		expect(preFocusCamera.zoom).toBeLessThanOrEqual(0.11);

		act(() => {
			useProjectStore.getState().setFocusedNode("node-scene-1");
		});
		await waitFor(() => {
			expect(screen.getByTestId("focus-scene-skia-layer")).toBeTruthy();
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});

		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => {
			expect(getLatestInfiniteSkiaCanvasProps().suspendHover).toBe(true);
		});
		await waitFor(() => {
			expect(getLatestInfiniteSkiaCanvasProps().tileLodTransition?.mode).toBe(
				"freeze",
			);
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const settled = useCanvasCameraStore.getState().camera;
		expect(settled.x).toBeCloseTo(preFocusCamera.x, 3);
		expect(settled.y).toBeCloseTo(preFocusCamera.y, 3);
		expect(settled.zoom).toBeCloseTo(preFocusCamera.zoom, 3);
	});

	it("退出 focus 触发半缩放约束时使用 snap 并保持 pre-focus 视口中心", async () => {
		render(<CanvasWorkspace />);
		const workspace = screen.getByTestId("canvas-workspace");
		fireEvent.wheel(workspace, {
			deltaX: 180,
			deltaY: -120,
		});
		for (let index = 0; index < 3; index += 1) {
			fireEvent.wheel(workspace, {
				deltaY: -80,
				ctrlKey: true,
				clientX: 600,
				clientY: 400,
			});
		}
		const preFocusCamera = getLatestInfiniteSkiaCanvasProps().camera?.value;
		expect(preFocusCamera).toBeTruthy();
		if (!preFocusCamera) return;
		expect(preFocusCamera.zoom).toBeGreaterThan(1);
		expect(Math.abs(preFocusCamera.x) + Math.abs(preFocusCamera.y)).toBeGreaterThan(
			0.001,
		);
		const preFocusCenter = {
			x: mockDOMRect.width / Math.max(preFocusCamera.zoom, 1e-6) / 2 - preFocusCamera.x,
			y:
				mockDOMRect.height / Math.max(preFocusCamera.zoom, 1e-6) / 2 -
				preFocusCamera.y,
		};

		act(() => {
			useProjectStore.getState().setFocusedNode("node-scene-1");
		});
		await waitFor(() => {
			expect(screen.getByTestId("focus-scene-skia-layer")).toBeTruthy();
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});
		const focusZoom = useCanvasCameraStore.getState().camera.zoom;
		const expectedExitZoom = Math.min(preFocusCamera.zoom, focusZoom * 0.5);

		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => {
			expect(getLatestInfiniteSkiaCanvasProps().suspendHover).toBe(true);
		});
		await waitFor(() => {
			const transition = getLatestInfiniteSkiaCanvasProps().tileLodTransition;
			expect(transition?.mode).toBe("snap");
			expect(transition?.zoom).toBeCloseTo(expectedExitZoom, 4);
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 280);
			});
		});

		const settled = useCanvasCameraStore.getState().camera;
		expect(settled.zoom).toBeCloseTo(expectedExitZoom, 3);
		expect(settled.zoom).toBeLessThanOrEqual(focusZoom * 0.5 + 1e-6);
		const settledCenter = {
			x: mockDOMRect.width / Math.max(settled.zoom, 1e-6) / 2 - settled.x,
			y: mockDOMRect.height / Math.max(settled.zoom, 1e-6) / 2 - settled.y,
		};
		expect(settledCenter.x).toBeCloseTo(preFocusCenter.x, 3);
		expect(settledCenter.y).toBeCloseTo(preFocusCenter.y, 3);
	});

	it("未完成的 smooth 动画会被新的 smooth 动画覆盖", async () => {
		render(<CanvasWorkspace />);
		const initialCamera = useCanvasCameraStore.getState().camera;
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
		const settled = useCanvasCameraStore.getState().camera;
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
			useCanvasCameraStore.getState().camera.zoom ?? 0;

		const handle = screen.getByLabelText("调整 Drawer 高度");
		const zoomSamples: number[] = [];
		const unsubscribe = useCanvasCameraStore.subscribe((state) => {
			zoomSamples.push(state.camera.zoom);
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
			clientX: 1040,
			clientY: 640,
		});
		fireEvent.click(screen.getByRole("menuitem", { name: "新建文本节点" }));

		await waitFor(() => {
			const textNode = useProjectStore
				.getState()
				.currentProject?.canvas.nodes.find((node) => node.type === "text");
			expect(textNode).toBeTruthy();
			expect(textNode?.x).toBe(1040);
			expect(textNode?.y).toBe(640);
		});
	});

	it("右键节点菜单可复制单个节点到全局剪贴板", () => {
		render(<CanvasWorkspace />);

		rightClickNodeAt(300, 160);
		fireEvent.click(screen.getByRole("menuitem", { name: "复制" }));

		const payload = useStudioClipboardStore.getState().payload;
		expect(payload?.kind).toBe("canvas-nodes");
		if (!payload || payload.kind !== "canvas-nodes") return;
		expect(payload.entries.map((entry) => entry.node.id)).toEqual([
			"node-video-1",
		]);
	});

	it("右键命中已多选节点时复制整组选区", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });

		rightClickNodeAt(300, 160);
		fireEvent.click(screen.getByRole("menuitem", { name: "复制" }));

		const payload = useStudioClipboardStore.getState().payload;
		expect(payload?.kind).toBe("canvas-nodes");
		if (!payload || payload.kind !== "canvas-nodes") return;
		expect(payload.entries.map((entry) => entry.node.id)).toEqual([
			"node-video-1",
			"node-image-1",
		]);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-video-1",
			"node-image-1",
		]);
	});

	it("右键命中非选中节点时仅复制该节点", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });

		rightClickNodeAt(60, 60);
		fireEvent.click(screen.getByRole("menuitem", { name: "复制" }));

		const payload = useStudioClipboardStore.getState().payload;
		expect(payload?.kind).toBe("canvas-nodes");
		if (!payload || payload.kind !== "canvas-nodes") return;
		expect(payload.entries.map((entry) => entry.node.id)).toEqual([
			"node-scene-1",
		]);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-video-1",
			"node-image-1",
		]);
	});

	it("右键节点菜单剪切会先复制再删除节点", () => {
		render(<CanvasWorkspace />);

		rightClickNodeAt(300, 160);
		fireEvent.click(screen.getByRole("menuitem", { name: "剪切" }));

		const payload = useStudioClipboardStore.getState().payload;
		expect(payload?.kind).toBe("canvas-nodes");
		if (!payload || payload.kind !== "canvas-nodes") return;
		expect(payload.entries.map((entry) => entry.node.id)).toEqual([
			"node-video-1",
		]);
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some(
					(node) => node.id === "node-video-1",
				),
		).toBe(false);
		expect(useStudioHistoryStore.getState().past[0]?.kind).toBe(
			"canvas.node-delete",
		);
	});

	it("空白处右键菜单在不可粘贴时显示禁用粘贴项", () => {
		render(<CanvasWorkspace />);
		const beforeNodeCount =
			useProjectStore.getState().currentProject?.canvas.nodes.length ?? 0;

		fireEvent.contextMenu(screen.getByTestId("infinite-skia-canvas"), {
			clientX: 1040,
			clientY: 640,
		});
		const pasteItem = screen.getByRole("menuitem", { name: "粘贴" });
		expect(pasteItem.getAttribute("data-disabled")).not.toBeNull();

		fireEvent.click(pasteItem);
		const afterNodeCount =
			useProjectStore.getState().currentProject?.canvas.nodes.length ?? 0;
		expect(afterNodeCount).toBe(beforeNodeCount);
	});

	it("空白处右键菜单可粘贴并按右键位置落点", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		fireEvent.keyDown(window, { key: "c", ctrlKey: true });

		fireEvent.contextMenu(screen.getByTestId("infinite-skia-canvas"), {
			clientX: 1020,
			clientY: 620,
		});
		const pasteItem = screen.getByRole("menuitem", { name: "粘贴" });
		expect(pasteItem.getAttribute("data-disabled")).toBeNull();
		fireEvent.click(pasteItem);

		const project = useProjectStore.getState().currentProject;
		const pastedNode =
			project?.canvas.nodes.find(
				(node) => node.type === "video" && node.name === "Video 1副本",
			) ?? null;
		expect(pastedNode).toBeTruthy();
		if (!pastedNode || pastedNode.type !== "video") return;
		expect(pastedNode.x).toBe(1020);
		expect(pastedNode.y).toBe(620);
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

	it("右键普通节点会显示删除菜单", () => {
		render(<CanvasWorkspace />);
		rightClickNodeAt(300, 160);
		expect(screen.getByRole("menuitem", { name: "删除" })).toBeTruthy();
		expect(screen.queryByRole("menuitem", { name: "新建文本节点" })).toBeNull();
	});

	it("Delete 键可删除单选节点并支持 undo", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);

		fireEvent.keyDown(window, { key: "Delete" });

		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some(
					(node) => node.id === "node-video-1",
				),
		).toBe(false);
		expect(useStudioHistoryStore.getState().past[0]?.kind).toBe(
			"canvas.node-delete",
		);

		useStudioHistoryStore.getState().undo();
		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some(
					(node) => node.id === "node-video-1",
				),
		).toBe(true);
	});

	it("TimelineEditor 有 element 选中时会阻止 Delete 删除 node", () => {
		const runtime = createCanvasWorkspaceRuntime();
		runtime.getActiveEditTimelineRuntime()?.timelineStore.setState({
			isTimelineEditorMounted: true,
			isTimelineEditorHovered: false,
			selectedIds: ["element-1"],
			primarySelectedId: "element-1",
		});
		render(<CanvasWorkspace />, {
			wrapper: createRuntimeProviderWrapper(runtime),
		});
		clickNodeAt(300, 160);

		fireEvent.keyDown(window, { key: "Delete" });

		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some(
					(node) => node.id === "node-video-1",
				),
		).toBe(true);
		expect(useStudioHistoryStore.getState().past).toHaveLength(0);
	});

	it("鼠标 hover TimelineEditor 时会阻止 Delete 删除 node", () => {
		const runtime = createCanvasWorkspaceRuntime();
		runtime.getActiveEditTimelineRuntime()?.timelineStore.setState({
			isTimelineEditorMounted: true,
			isTimelineEditorHovered: true,
			selectedIds: [],
			primarySelectedId: null,
		});
		render(<CanvasWorkspace />, {
			wrapper: createRuntimeProviderWrapper(runtime),
		});
		clickNodeAt(300, 160);

		fireEvent.keyDown(window, { key: "Delete" });

		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some(
					(node) => node.id === "node-video-1",
				),
		).toBe(true);
		expect(useStudioHistoryStore.getState().past).toHaveLength(0);
	});

	it("TimelineEditor 已挂载但空闲时 Delete 仍可删除 node", () => {
		const runtime = createCanvasWorkspaceRuntime();
		runtime.getActiveEditTimelineRuntime()?.timelineStore.setState({
			isTimelineEditorMounted: true,
			isTimelineEditorHovered: false,
			selectedIds: [],
			primarySelectedId: null,
		});
		render(<CanvasWorkspace />, {
			wrapper: createRuntimeProviderWrapper(runtime),
		});
		clickNodeAt(300, 160);

		fireEvent.keyDown(window, { key: "Delete" });

		expect(
			useProjectStore
				.getState()
				.currentProject?.canvas.nodes.some(
					(node) => node.id === "node-video-1",
				),
		).toBe(false);
		expect(useStudioHistoryStore.getState().past[0]?.kind).toBe(
			"canvas.node-delete",
		);
	});

	it("Backspace 键可删除多选节点并写入 batch 历史", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });

		fireEvent.keyDown(window, { key: "Backspace" });

		const project = useProjectStore.getState().currentProject;
		expect(
			project?.canvas.nodes.some((node) => node.id === "node-video-1"),
		).toBe(false);
		expect(
			project?.canvas.nodes.some((node) => node.id === "node-image-1"),
		).toBe(false);
		expect(useStudioHistoryStore.getState().past[0]?.kind).toBe(
			"canvas.node-delete.batch",
		);
	});

	it("Ctrl+C/V 可复制节点并按鼠标位置对齐包围盒左上", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		fireEvent.pointerMove(screen.getByTestId("infinite-skia-canvas"), {
			...createPointerPatch(960, 540),
			buttons: 0,
		});

		fireEvent.keyDown(window, { key: "c", ctrlKey: true });
		fireEvent.keyDown(window, { key: "v", ctrlKey: true });

		const project = useProjectStore.getState().currentProject;
		const copiedNode =
			project?.canvas.nodes.find(
				(node) => node.type === "video" && node.name === "Video 1副本",
			) ?? null;
		expect(copiedNode).toBeTruthy();
		if (!copiedNode || copiedNode.type !== "video") return;
		expect(copiedNode.x).toBe(960);
		expect(copiedNode.y).toBe(540);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			copiedNode.id,
		]);
		expect(useStudioHistoryStore.getState().past[0]?.kind).toBe(
			"canvas.node-create.batch",
		);
	});

	it("Timeline 正在编辑时 Ctrl+C 不会触发 canvas 复制", () => {
		const runtime = createCanvasWorkspaceRuntime();
		runtime.getActiveEditTimelineRuntime()?.timelineStore.setState({
			isTimelineEditorMounted: true,
			isTimelineEditorHovered: false,
			selectedIds: ["element-1"],
			primarySelectedId: "element-1",
		});
		render(<CanvasWorkspace />, {
			wrapper: createRuntimeProviderWrapper(runtime),
		});
		clickNodeAt(300, 160);

		fireEvent.keyDown(window, { key: "c", ctrlKey: true });

		expect(useStudioClipboardStore.getState().payload).toBeNull();
	});

	it("timeline element 可粘贴为 canvas node，并按鼠标位置落点", () => {
		render(<CanvasWorkspace />);
		useStudioClipboardStore.getState().setPayload({
			kind: "timeline-elements",
			payload: {
				elements: [
					{
						id: "element-image-copy",
						type: "Image",
						component: "image",
						name: "Image Clip",
						assetId: "asset-scene",
						props: {},
						transform: createTransformMeta({
							width: 320,
							height: 180,
							positionX: 0,
							positionY: 0,
						}),
						timeline: {
							start: 0,
							end: 150,
							startTimecode: "00:00:00:00",
							endTimecode: "00:00:05:00",
							trackIndex: 0,
							role: "clip",
						},
						render: {
							zIndex: 0,
							visible: true,
							opacity: 1,
						},
					},
				],
				primaryId: "element-image-copy",
				anchor: {
					assetId: "element-image-copy",
					start: 0,
					trackIndex: 0,
				},
				source: {
					sceneId: "scene-1",
					canvasSize: { width: 1920, height: 1080 },
					fps: 30,
				},
			},
			source: {
				sceneId: "scene-1",
				canvasSize: { width: 1920, height: 1080 },
				fps: 30,
			},
		});
		fireEvent.pointerMove(screen.getByTestId("infinite-skia-canvas"), {
			...createPointerPatch(520, 440),
			buttons: 0,
		});

		fireEvent.keyDown(window, { key: "v", ctrlKey: true });

		const project = useProjectStore.getState().currentProject;
		const pastedNode =
			project?.canvas.nodes.find(
				(node) => node.type === "image" && node.name === "Image Clip副本",
			) ?? null;
		expect(pastedNode).toBeTruthy();
		if (!pastedNode || pastedNode.type !== "image") return;
		expect(pastedNode.x).toBe(520);
		expect(pastedNode.y).toBe(440);
		expect(useStudioHistoryStore.getState().past[0]?.kind).toBe(
			"canvas.node-create.batch",
		);
	});

	it("鼠标命中 timeline drop zone 时 Ctrl+V 不会触发 canvas 粘贴", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		fireEvent.keyDown(window, { key: "c", ctrlKey: true });

		const mainZone = document.createElement("div");
		mainZone.setAttribute("data-track-drop-zone", "main");
		Object.defineProperty(mainZone, "getBoundingClientRect", {
			value: () => ({
				x: 0,
				y: 0,
				left: 0,
				top: 0,
				right: 300,
				bottom: 200,
				width: 300,
				height: 200,
				toJSON: () => ({}),
			}),
		});
		const contentArea = document.createElement("div");
		contentArea.setAttribute("data-track-content-area", "main");
		Object.defineProperty(contentArea, "getBoundingClientRect", {
			value: () => ({
				x: 0,
				y: 0,
				left: 0,
				top: 0,
				right: 300,
				bottom: 200,
				width: 300,
				height: 200,
				toJSON: () => ({}),
			}),
		});
		mainZone.append(contentArea);
		document.body.append(mainZone);

		try {
			fireEvent.mouseMove(window, { clientX: 120, clientY: 80 });
			fireEvent.keyDown(window, { key: "v", ctrlKey: true });
		} finally {
			mainZone.remove();
		}

		const project = useProjectStore.getState().currentProject;
		const pastedNodes =
			project?.canvas.nodes.filter(
				(node) => node.type === "video" && node.name === "Video 1副本",
			) ?? [];
		expect(pastedNodes).toHaveLength(0);
	});

	it("右键多选 bbox 空白区域可删除整组选区", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });

		fireEvent.contextMenu(screen.getByTestId("infinite-skia-canvas"), {
			clientX: 600,
			clientY: 200,
		});
		fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));

		const project = useProjectStore.getState().currentProject;
		expect(
			project?.canvas.nodes.some((node) => node.id === "node-video-1"),
		).toBe(false);
		expect(
			project?.canvas.nodes.some((node) => node.id === "node-image-1"),
		).toBe(false);
		expect(useStudioHistoryStore.getState().past[0]?.kind).toBe(
			"canvas.node-delete.batch",
		);
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

	it("hover 命中取最高层节点并在 leave/cancel 时清空", () => {
		render(<CanvasWorkspace />);
		movePointerAt(300, 160);
		expect(getLatestInfiniteSkiaCanvasProps().hoveredNodeId).toBe(
			"node-video-1",
		);
		movePointerAt(720, 360);
		expect(getLatestInfiniteSkiaCanvasProps().hoveredNodeId).toBe(
			"node-image-1",
		);
		leavePointer();
		expect(getLatestInfiniteSkiaCanvasProps().hoveredNodeId).toBeNull();
		movePointerAt(300, 160);
		expect(getLatestInfiniteSkiaCanvasProps().hoveredNodeId).toBe(
			"node-video-1",
		);
		cancelPointerAt(300, 160);
		expect(getLatestInfiniteSkiaCanvasProps().hoveredNodeId).toBeNull();
	});

	it("Shift 点击可多选和反选，主选中随最后一个选中节点切换", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-video-1",
			"node-image-1",
		]);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-image-1",
		);

		clickNodeAt(720, 360, { shiftKey: true });
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-video-1",
		]);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-video-1",
		);
	});

	it("框选结束后，首次单击其他节点应立即生效", () => {
		render(<CanvasWorkspace />);
		marqueeCanvasAt(980, 20, 100, 80);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-scene-1",
		]);

		clickNodeAt(720, 360);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-image-1",
		]);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-image-1",
		);
	});

	it("框选拖拽过程中会透传 marqueeRectScreen.visible，结束后恢复 false", () => {
		render(<CanvasWorkspace />);
		const canvas = screen.getByTestId("infinite-skia-canvas");
		fireEvent.pointerDown(canvas, {
			...createPointerPatch(1000, 100),
			buttons: 1,
		});
		fireEvent.pointerMove(canvas, {
			...createPointerPatch(300, 160),
			buttons: 1,
		});
		expect(getLatestInfiniteSkiaCanvasProps().marqueeRectScreen?.visible).toBe(
			true,
		);
		fireEvent.pointerUp(canvas, {
			...createPointerPatch(300, 160),
			buttons: 0,
		});
		expect(getLatestInfiniteSkiaCanvasProps().marqueeRectScreen?.visible).toBe(
			false,
		);
	});

	it("框选 dragend 落在空白处后，单击空白即可清空选择", () => {
		render(<CanvasWorkspace />);
		const beforeActiveNodeId =
			useProjectStore.getState().currentProject?.ui.activeNodeId ?? null;
		marqueeCanvasAt(1100, 100, 200, 700);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-scene-1",
			"node-video-1",
			"node-image-1",
		]);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			beforeActiveNodeId,
		);

		clickCanvasAt(1120, 700);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([]);
		expect(
			useProjectStore.getState().currentProject?.ui.activeNodeId,
		).toBeNull();
	});

	it("Shift 框选会基于初始选择做 toggle", () => {
		render(<CanvasWorkspace />);
		const beforeActiveNodeId =
			useProjectStore.getState().currentProject?.ui.activeNodeId ?? null;
		marqueeCanvasAt(1000, 100, 300, 160);
		marqueeCanvasAt(1000, 520, 650, 300, { shiftKey: true });
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-video-1",
			"node-image-1",
		]);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			beforeActiveNodeId,
		);
	});

	it("框选命中 0 个节点时会清空选择但保持 active", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		const beforeActiveNodeId =
			useProjectStore.getState().currentProject?.ui.activeNodeId ?? null;
		expect(beforeActiveNodeId).toBe("node-video-1");

		marqueeCanvasAt(1080, 60, 1180, 140);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([]);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			beforeActiveNodeId,
		);
	});

	it("无 active 时框选单节点会转为 active 并清空选区", () => {
		render(<CanvasWorkspace />);
		clickCanvasAt(1120, 700);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBeNull();

		marqueeCanvasAt(980, 20, 100, 80);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([]);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-scene-1",
		);
	});

	it("节点拖拽会更新位置且不改 active", () => {
		render(<CanvasWorkspace />);
		dragNodeAt(300, 160, 420, 260);
		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		expect(node?.x).toBe(360);
		expect(node?.y).toBe(220);
		expect(project?.ui.activeNodeId).toBe("node-scene-1");
	});

	it("节点拖拽吸附时会显示 guide，并在 dragEnd 后清空", () => {
		render(<CanvasWorkspace />);
		const canvas = screen.getByTestId("infinite-skia-canvas");
		act(() => {
			fireEvent.pointerDown(canvas, {
				...createPointerPatch(720, 360),
				buttons: 1,
			});
			fireEvent.pointerMove(canvas, {
				...createPointerPatch(603, 360),
				buttons: 1,
			});
		});
		const draggingProject = useProjectStore.getState().currentProject;
		const draggingNode = draggingProject?.canvas.nodes.find(
			(item) => item.id === "node-image-1",
		);
		expect(draggingNode?.x).toBe(560);
		expect(
			getLatestInfiniteSkiaCanvasProps().snapGuidesScreen?.vertical,
		).toContain(560);

		act(() => {
			fireEvent.pointerUp(canvas, {
				...createPointerPatch(603, 360),
				buttons: 0,
			});
		});
		expect(getLatestInfiniteSkiaCanvasProps().snapGuidesScreen).toEqual({
			vertical: [],
			horizontal: [],
		});
	});

	it("同一拖拽手势会复用吸附 guide 值缓存", () => {
		const collectSpy = vi.spyOn(canvasSnapUtils, "collectCanvasSnapGuideValues");
		try {
			render(<CanvasWorkspace />);
			clickNodeAt(300, 160);
			clickNodeAt(720, 360, { shiftKey: true });
			const beforeCalls = collectSpy.mock.calls.length;
			const canvas = screen.getByTestId("infinite-skia-canvas");
			act(() => {
				fireEvent.pointerDown(canvas, {
					...createPointerPatch(720, 360),
					buttons: 1,
				});
				fireEvent.pointerMove(canvas, {
					...createPointerPatch(800, 420),
					buttons: 1,
				});
				fireEvent.pointerMove(canvas, {
					...createPointerPatch(880, 480),
					buttons: 1,
				});
					fireEvent.pointerUp(canvas, {
						...createPointerPatch(880, 480),
						buttons: 0,
					});
				});
			expect(collectSpy.mock.calls.length - beforeCalls).toBe(1);
		} finally {
			collectSpy.mockRestore();
		}
	});

	it("拖入 timeline 区域后会复位画布节点并创建 timeline element", () => {
		const runtime = createCanvasWorkspaceRuntime();
		const removeDropZone = mountMainTimelineDropZone();
		try {
			render(<CanvasWorkspace />, {
				wrapper: createRuntimeProviderWrapper(runtime),
			});
			dragNodeAt(300, 160, 120, 80);
			const project = useProjectStore.getState().currentProject;
			const draggedNode = project?.canvas.nodes.find(
				(item) => item.id === "node-video-1",
			);
			expect(draggedNode?.x).toBe(240);
			expect(draggedNode?.y).toBe(120);
			const timelineElements =
				runtime.getActiveEditTimelineRuntime()?.timelineStore.getState().elements ??
				[];
			expect(timelineElements.length).toBe(1);
			expect(timelineElements[0]?.type).toBe("VideoClip");
			expect(timelineElements[0]?.timeline.trackIndex).toBe(0);
			expect(useStudioHistoryStore.getState().past).toHaveLength(0);
		} finally {
			removeDropZone();
		}
	});

	it("主轨波纹开启时从画布拖入主轨会执行插入而不是落到新轨道", () => {
		const runtime = createCanvasWorkspaceRuntime();
		const removeDropZone = mountMainTimelineDropZone();
		try {
			const timelineRuntime = runtime.getActiveEditTimelineRuntime();
			timelineRuntime?.timelineStore.setState({
				rippleEditingEnabled: true,
				elements: [createTimelineSelectionElement("existing-main-clip")],
			});
			render(<CanvasWorkspace />, {
				wrapper: createRuntimeProviderWrapper(runtime),
			});
			dragNodeAt(300, 160, 120, 80);
			const timelineElements =
				runtime.getActiveEditTimelineRuntime()?.timelineStore.getState().elements ??
				[];
			expect(timelineElements.length).toBe(2);
			expect(
				timelineElements
					.filter((element) => element.type !== "AudioClip")
					.every((element) => (element.timeline.trackIndex ?? 0) === 0),
			).toBe(true);
		} finally {
			removeDropZone();
		}
	});

	it("Alt 拖入 timeline 区域会取消画布复制态并进入 timeline drop", () => {
		const runtime = createCanvasWorkspaceRuntime();
		const removeDropZone = mountMainTimelineDropZone();
		try {
			render(<CanvasWorkspace />, {
				wrapper: createRuntimeProviderWrapper(runtime),
			});
			const beforeNodeCount =
				useProjectStore.getState().currentProject?.canvas.nodes.length ?? 0;
			dragNodeAt(300, 160, 120, 80, { altKey: true });
			const project = useProjectStore.getState().currentProject;
			const draggedNode = project?.canvas.nodes.find(
				(item) => item.id === "node-video-1",
			);
			expect(project?.canvas.nodes.length).toBe(beforeNodeCount);
			expect(project?.canvas.nodes.some((item) => item.name.includes("副本"))).toBe(
				false,
			);
			expect(draggedNode?.x).toBe(240);
			expect(draggedNode?.y).toBe(120);
			const timelineElements =
				runtime.getActiveEditTimelineRuntime()?.timelineStore.getState().elements ??
				[];
			expect(timelineElements.length).toBe(1);
			expect(timelineElements[0]?.type).toBe("VideoClip");
			expect(useStudioHistoryStore.getState().past).toHaveLength(0);
		} finally {
			removeDropZone();
		}
	});

	it("进入 timeline drop 态后拖离并松手，会恢复画布拖拽但不会投放", () => {
		const runtime = createCanvasWorkspaceRuntime();
		const removeDropZone = mountMainTimelineDropZone();
		const originalElementFromPoint = (
			document as Document & {
				elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
			}
		).elementFromPoint;
		try {
			render(<CanvasWorkspace />, {
				wrapper: createRuntimeProviderWrapper(runtime),
			});
			const canvasSurface = screen.getByTestId("infinite-skia-canvas");
			const canvas = screen.getByTestId("infinite-skia-canvas");
			Object.defineProperty(document, "elementFromPoint", {
				configurable: true,
				value: (x: number, y: number) =>
					x >= 500 && y >= 300 ? canvasSurface : null,
			});
			act(() => {
				fireEvent.pointerDown(canvas, {
					...createPointerPatch(300, 160),
					buttons: 1,
				});
				fireEvent.pointerMove(canvas, {
					...createPointerPatch(120, 80),
					buttons: 1,
				});
				fireEvent.pointerMove(canvas, {
					...createPointerPatch(620, 360),
					buttons: 1,
				});
				fireEvent.pointerUp(canvas, {
					...createPointerPatch(620, 360),
					buttons: 0,
				});
			});
			const project = useProjectStore.getState().currentProject;
			const draggedNode = project?.canvas.nodes.find(
				(item) => item.id === "node-video-1",
			);
			expect(draggedNode?.x).toBe(560);
			expect(draggedNode?.y).toBe(320);
			const timelineElements =
				runtime.getActiveEditTimelineRuntime()?.timelineStore.getState().elements ??
				[];
			expect(timelineElements).toHaveLength(0);
			const past = useStudioHistoryStore.getState().past;
			expect(past).toHaveLength(1);
			expect(past[0]?.kind).toBe("canvas.node-layout");
		} finally {
			if (typeof originalElementFromPoint === "function") {
				Object.defineProperty(document, "elementFromPoint", {
					configurable: true,
					value: originalElementFromPoint,
				});
			} else {
				delete (
					document as Document & {
						elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
					}
				).elementFromPoint;
			}
			removeDropZone();
		}
	});

	it("多选组拖拽会整体移动并只写入一条 batch 历史", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });
		dragNodeAt(720, 360, 820, 420);

		const project = useProjectStore.getState().currentProject;
		const video = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		const image = project?.canvas.nodes.find(
			(item) => item.id === "node-image-1",
		);
		expect(video?.x).toBe(340);
		expect(video?.y).toBe(180);
		expect(image?.x).toBe(780);
		expect(image?.y).toBe(380);
		const past = useStudioHistoryStore.getState().past;
		expect(past).toHaveLength(1);
		expect(past[0]?.kind).toBe("canvas.node-layout.batch");
	});

	it("多选拖拽一次 move 仅触发一次 project revision 递增", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });
		const beforeRevision =
			useProjectStore.getState().currentProject?.revision ?? 0;
		dragNodeAt(720, 360, 820, 420);
		const afterRevision =
			useProjectStore.getState().currentProject?.revision ?? 0;
		expect(afterRevision).toBe(beforeRevision + 1);
	});

	it("多选 resize 一次 move 仅触发一次 project revision 递增", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });
		const beforeRevision =
			useProjectStore.getState().currentProject?.revision ?? 0;
		resizeSelectionBoundsAt(940, 480, 1080, 480, "bottom-right");
		const afterRevision =
			useProjectStore.getState().currentProject?.revision ?? 0;
		expect(afterRevision).toBe(beforeRevision + 1);
	});

	it("多选组拖拽会按 bbox 吸附到其他节点边线", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });
		dragSelectionBoundsAt(600, 200, 618, 200);

		const project = useProjectStore.getState().currentProject;
		const video = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		const image = project?.canvas.nodes.find(
			(item) => item.id === "node-image-1",
		);
		expect(video?.x).toBe(260);
		expect(image?.x).toBe(700);
	});

	it("多选 bbox 内点击空白区域不会清空选择", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });
		clickCanvasAt(600, 200);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-video-1",
			"node-image-1",
		]);
	});

	it("多选 bbox 拖拽会在空白区域整体移动", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });
		dragSelectionBoundsAt(600, 200, 700, 260);

		const project = useProjectStore.getState().currentProject;
		const video = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		const image = project?.canvas.nodes.find(
			(item) => item.id === "node-image-1",
		);
		expect(video?.x).toBe(340);
		expect(video?.y).toBe(180);
		expect(image?.x).toBe(780);
		expect(image?.y).toBe(380);
		expect(useStudioHistoryStore.getState().past[0]?.kind).toBe(
			"canvas.node-layout.batch",
		);
	});

	it("Shift 拖拽会锁定主导轴", () => {
		render(<CanvasWorkspace />);
		dragNodeAt(300, 160, 420, 200, { shiftKey: true });
		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		expect(node?.x).toBe(360);
		expect(node?.y).toBe(120);
	});

	it("Alt 拖拽会复制节点且不改 active", () => {
		render(<CanvasWorkspace />);
		dragNodeAt(300, 160, 420, 260, { altKey: true });

		const project = useProjectStore.getState().currentProject;
		const original = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		const copiedNode =
			project?.canvas.nodes.find(
				(item) =>
					item.type === "video" &&
					item.id !== "node-video-1" &&
					item.name === "Video 1副本",
			) ?? null;
		expect(original?.x).toBe(240);
		expect(original?.y).toBe(120);
		expect(copiedNode).toBeTruthy();
		if (!copiedNode || copiedNode.type !== "video") return;
		expect(copiedNode?.type).toBe("video");
		expect(copiedNode?.name).toContain("副本");
		expect(copiedNode?.x).toBe(360);
		expect(copiedNode?.y).toBe(220);
		expect(project?.ui.activeNodeId).toBe("node-scene-1");
		expect(useStudioHistoryStore.getState().past[0]?.kind).toBe(
			"canvas.node-create.batch",
		);
	});

	it("Alt 拖拽副本时会保留原节点作为吸附参考线", () => {
		render(<CanvasWorkspace />);
		dragNodeAt(300, 160, 618, 160, { altKey: true });

		const project = useProjectStore.getState().currentProject;
		const copiedNode =
			project?.canvas.nodes.find(
				(item) =>
					item.type === "video" &&
					item.id !== "node-video-1" &&
					item.name === "Video 1副本",
			) ?? null;
		expect(copiedNode?.type).toBe("video");
		expect(copiedNode?.x).toBe(560);
	});

	it("关闭画布吸附后拖拽不会吸附，也不会透传 guide", () => {
		render(<CanvasWorkspace />);
		fireEvent.click(screen.getByRole("button", { name: "画布吸附" }));
		expect(
			useProjectStore.getState().currentProject?.ui.canvasSnapEnabled,
		).toBe(false);

		dragNodeAt(720, 360, 603, 360);

		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find(
			(item) => item.id === "node-image-1",
		);
		expect(node?.x).toBe(563);
		expect(getLatestInfiniteSkiaCanvasProps().snapGuidesScreen).toEqual({
			vertical: [],
			horizontal: [],
		});
	});

	it("toolbar 的 Tile 调试按钮会透传到 InfiniteSkiaCanvas", () => {
		render(<CanvasWorkspace />);
		expect(getLatestInfiniteSkiaCanvasProps().tileDebugEnabled).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "Tile 调试" }));
		expect(getLatestInfiniteSkiaCanvasProps().tileDebugEnabled).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Tile 调试" }));
		expect(getLatestInfiniteSkiaCanvasProps().tileDebugEnabled).toBe(false);
	});

	it("toolbar 的 Tile 输入模式按钮会透传到 InfiniteSkiaCanvas", () => {
		render(<CanvasWorkspace />);
		expect(getLatestInfiniteSkiaCanvasProps().tileInputMode).toBe("raster");
		fireEvent.click(screen.getByTestId("canvas-tile-input-mode-toggle"));
		expect(getLatestInfiniteSkiaCanvasProps().tileInputMode).toBe("picture");
		fireEvent.click(screen.getByTestId("canvas-tile-input-mode-toggle"));
		expect(getLatestInfiniteSkiaCanvasProps().tileInputMode).toBe("raster");
	});

	it("toolbar 的 Skia 追踪按钮会写入并删除 localStorage 配置", () => {
		window.localStorage.removeItem(SKIA_RESOURCE_TRACKER_STORAGE_KEY);
		render(<CanvasWorkspace />);
		const toggle = screen.getByTestId("canvas-skia-resource-tracker-toggle");
		expect(toggle.getAttribute("aria-pressed")).toBe("false");

		fireEvent.click(toggle);
		const rawConfig = window.localStorage.getItem(
			SKIA_RESOURCE_TRACKER_STORAGE_KEY,
		);
		expect(rawConfig).not.toBeNull();
		const parsedConfig = JSON.parse(rawConfig ?? "{}");
		expect(parsedConfig).toEqual({
			enabled: true,
			captureStacks: true,
			autoProjectSwitchSnapshot: true,
			sampleLimitPerType: 200,
		});
		expect(toggle.getAttribute("aria-pressed")).toBe("true");

		fireEvent.click(toggle);
		expect(
			window.localStorage.getItem(SKIA_RESOURCE_TRACKER_STORAGE_KEY),
		).toBeNull();
		expect(toggle.getAttribute("aria-pressed")).toBe("false");
	});

	it("node-drag 手势期间会提升 tile 任务上限，结束后恢复默认值", () => {
		render(<CanvasWorkspace />);
		const canvas = screen.getByTestId("infinite-skia-canvas");
		expect(getLatestInfiniteSkiaCanvasProps().tileMaxTasksPerTick).toBe(
			TILE_MAX_TASKS_PER_TICK,
		);
		act(() => {
			fireEvent.pointerDown(canvas, {
				...createPointerPatch(300, 160),
				buttons: 1,
			});
		});
		expect(getLatestInfiniteSkiaCanvasProps().tileMaxTasksPerTick).toBe(
			TILE_MAX_TASKS_PER_TICK_DRAG,
		);
		act(() => {
			fireEvent.pointerUp(canvas, {
				...createPointerPatch(300, 160),
				buttons: 0,
			});
		});
		expect(getLatestInfiniteSkiaCanvasProps().tileMaxTasksPerTick).toBe(
			TILE_MAX_TASKS_PER_TICK,
		);
	});

	it("selection-drag 手势期间会提升 tile 任务上限，结束后恢复默认值", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });
		const canvas = screen.getByTestId("infinite-skia-canvas");
		expect(getLatestInfiniteSkiaCanvasProps().tileMaxTasksPerTick).toBe(
			TILE_MAX_TASKS_PER_TICK,
		);
		act(() => {
			fireEvent.pointerDown(canvas, {
				...createPointerPatch(600, 200),
				buttons: 1,
			});
		});
		expect(getLatestInfiniteSkiaCanvasProps().tileMaxTasksPerTick).toBe(
			TILE_MAX_TASKS_PER_TICK_DRAG,
		);
		act(() => {
			fireEvent.pointerUp(canvas, {
				...createPointerPatch(600, 200),
				buttons: 0,
			});
		});
		expect(getLatestInfiniteSkiaCanvasProps().tileMaxTasksPerTick).toBe(
			TILE_MAX_TASKS_PER_TICK,
		);
	});

	it("多选 bbox Alt 拖拽会复制整组并保持当前 active", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });
		dragSelectionBoundsAt(600, 200, 720, 260, { altKey: true });

		const project = useProjectStore.getState().currentProject;
		const copiedVideo =
			project?.canvas.nodes.find(
				(node) =>
					node.type === "video" &&
					node.id !== "node-video-1" &&
					node.name === "Video 1副本",
			) ?? null;
		const copiedImage =
			project?.canvas.nodes.find(
				(node) =>
					node.type === "image" &&
					node.id !== "node-image-1" &&
					node.name === "Image 1副本",
			) ?? null;
		expect(copiedVideo).toBeTruthy();
		expect(copiedImage).toBeTruthy();
		expect(
			project?.canvas.nodes.find((item) => item.id === "node-video-1")?.x,
		).toBe(240);
		expect(
			project?.canvas.nodes.find((item) => item.id === "node-image-1")?.x,
		).toBe(680);
		expect(copiedVideo?.x).toBe(360);
		expect(copiedVideo?.y).toBe(180);
		expect(copiedImage?.x).toBe(800);
		expect(copiedImage?.y).toBe(380);
		expect(project?.ui.activeNodeId).toBe("node-image-1");
		expect(useStudioHistoryStore.getState().past[0]?.kind).toBe(
			"canvas.node-create.batch",
		);
	});

	it("Alt 拖拽无位移时会取消复制", () => {
		render(<CanvasWorkspace />);
		dragNodeAt(300, 160, 300, 160, { altKey: true });
		const project = useProjectStore.getState().currentProject;
		expect(
			project?.canvas.nodes.filter((item) => item.id !== "node-video-1").length,
		).toBe(5);
		expect(useStudioHistoryStore.getState().past).toHaveLength(0);
	});

	it("Alt 拖拽 Scene 会深拷贝 scene，并支持 undo/redo", () => {
		render(<CanvasWorkspace />);
		dragNodeAt(80, 80, 180, 120, { altKey: true });

		const afterCopy = useProjectStore.getState().currentProject;
		const copiedSceneNode =
			afterCopy?.canvas.nodes.find(
				(node) =>
					node.type === "scene" &&
					node.id !== "node-scene-1" &&
					node.sceneId !== "scene-1" &&
					node.sceneId !== "scene-2",
			) ?? null;
		expect(copiedSceneNode).toBeTruthy();
		if (!copiedSceneNode || copiedSceneNode.type !== "scene") return;
		expect(copiedSceneNode.sceneId).not.toBe("scene-1");
		expect(afterCopy?.scenes[copiedSceneNode.sceneId]).toBeTruthy();

		useStudioHistoryStore.getState().undo();
		expect(
			useProjectStore.getState().currentProject?.scenes[
				copiedSceneNode.sceneId
			],
		).toBeUndefined();

		useStudioHistoryStore.getState().redo();
		expect(
			useProjectStore.getState().currentProject?.scenes[
				copiedSceneNode.sceneId
			],
		).toBeTruthy();
	});

	it("多选时 resize 不生效", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });
		resizeNodeAt(300, 160, 420, 260, "bottom-right");
		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		expect(node?.width).toBe(320);
		expect(node?.height).toBe(180);
	});

	it("多选 bbox resize 会保持 dragstart 比例，并对每个受约束 node 独立求解最终 rect", () => {
		setAssetSceneSourceSize(400, 300);
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });
		resizeSelectionBoundsAt(940, 480, 1080, 480, "bottom-right");
		const project = useProjectStore.getState().currentProject;
		const video = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		const image = project?.canvas.nodes.find(
			(item) => item.id === "node-image-1",
		);
		expect(video?.x).toBeCloseTo(240);
		expect(video?.y).toBeCloseTo(120);
		expect(video?.width).toBeCloseTo(352);
		expect(video?.height).toBeCloseTo(264);
		expect(image?.x).toBeCloseTo(724);
		expect(image?.y).toBeCloseTo(340);
		expect(image?.width).toBeCloseTo(286);
		expect(image?.height).toBeCloseTo(214.5);
		expect(
			Math.abs((video?.width ?? 0) / Math.max(video?.height ?? 1, 1) - 4 / 3),
		).toBeLessThan(1e-6);
		expect(
			Math.abs((image?.width ?? 0) / Math.max(image?.height ?? 1, 1) - 4 / 3),
		).toBeLessThan(1e-6);
		expect(useStudioHistoryStore.getState().past[0]?.kind).toBe(
			"canvas.node-layout.batch",
		);
	});

	it("多选 resize 结束后，首次单击其他节点应立即生效", () => {
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });
		resizeSelectionBoundsAt(940, 480, 1040, 480, "bottom-right");

		clickNodeAt(100, 80);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-scene-1",
		);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-scene-1",
		]);
	});

	it("单节点 resize 会吸附到其他节点边线", () => {
		render(<CanvasWorkspace />);
		resizeNodeAt(720, 360, 482, 360, "top-left");
		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find(
			(item) => item.id === "node-image-1",
		);
		expect(node?.x).toBe(560);
	});

	it("无比例约束 node 的角点 resize 可以同时吸附到两个轴", () => {
		const textId = useProjectStore.getState().createCanvasNode({
			type: "text",
			name: "Snap Text",
			text: "snap",
			fontSize: 24,
			x: 620,
			y: 360,
			width: 120,
			height: 120,
		});
		render(<CanvasWorkspace />);
		resizeNodeAt(620, 360, 562, 302, "top-left");
		const project = useProjectStore.getState().currentProject;
		const text = project?.canvas.nodes.find((item) => item.id === textId);
		expect(text?.x).toBe(560);
		expect(text?.y).toBe(300);
		expect(text?.width).toBe(180);
		expect(text?.height).toBe(180);
	});

	it("多选横向拖拽时 bbox 会等比缩放，text 也跟随外框比例变化", () => {
		setAssetSceneSourceSize(400, 300);
		const textId = useProjectStore.getState().createCanvasNode({
			type: "text",
			name: "Free Text",
			text: "free",
			fontSize: 24,
			x: 980,
			y: 340,
			width: 200,
			height: 80,
		});
		render(<CanvasWorkspace />);
		clickNodeAt(720, 360);
		clickNodeAt(1000, 360, { shiftKey: true });
		resizeSelectionBoundsAt(1180, 480, 1280, 480, "bottom-right");
		const project = useProjectStore.getState().currentProject;
		const image = project?.canvas.nodes.find(
			(item) => item.id === "node-image-1",
		);
		const text = project?.canvas.nodes.find((item) => item.id === textId);
		expect(image).toBeTruthy();
		expect(text).toBeTruthy();
		if (!image || !text) return;
		expect(image.x).toBeCloseTo(680);
		expect(image.y).toBeCloseTo(320);
		expect(image.width).toBeCloseTo(286);
		expect(image.height).toBeCloseTo(214.5);
		expect(Math.abs(image.width / image.height - 4 / 3)).toBeLessThan(1e-6);
		expect(text.x).toBeCloseTo(1010);
		expect(text.y).toBeCloseTo(342);
		expect(text.width).toBeCloseTo(220);
		expect(text.height).toBeCloseTo(88);
	});

	it("无约束 node 的多选 resize 会保持 dragstart 比例", () => {
		const firstTextId = useProjectStore.getState().createCanvasNode({
			type: "text",
			name: "Text A",
			text: "A",
			fontSize: 24,
			x: 760,
			y: 520,
			width: 120,
			height: 60,
		});
		const secondTextId = useProjectStore.getState().createCanvasNode({
			type: "text",
			name: "Text B",
			text: "B",
			fontSize: 24,
			x: 980,
			y: 620,
			width: 200,
			height: 80,
		});
		render(<CanvasWorkspace />);
		clickNodeAt(780, 540);
		clickNodeAt(1000, 640, { shiftKey: true });
		resizeSelectionBoundsAt(1180, 700, 1285, 700, "bottom-right");
		const project = useProjectStore.getState().currentProject;
		const firstText = project?.canvas.nodes.find(
			(item) => item.id === firstTextId,
		);
		const secondText = project?.canvas.nodes.find(
			(item) => item.id === secondTextId,
		);
		expect(firstText?.x).toBeCloseTo(760);
		expect(firstText?.y).toBeCloseTo(520);
		expect(firstText?.width).toBeCloseTo(135);
		expect(firstText?.height).toBeCloseTo(67.5);
		expect(secondText?.x).toBeCloseTo(1007.5);
		expect(secondText?.y).toBeCloseTo(632.5);
		expect(secondText?.width).toBeCloseTo(225);
		expect(secondText?.height).toBeCloseTo(90);
	});

	it("多选 bbox resize 会按等比外框吸附", () => {
		const firstTextId = useProjectStore.getState().createCanvasNode({
			type: "text",
			name: "Snap Text A",
			text: "A",
			fontSize: 24,
			x: 760,
			y: 520,
			width: 120,
			height: 60,
		});
		const secondTextId = useProjectStore.getState().createCanvasNode({
			type: "text",
			name: "Snap Text B",
			text: "B",
			fontSize: 24,
			x: 980,
			y: 620,
			width: 200,
			height: 80,
		});
		render(<CanvasWorkspace />);
		clickNodeAt(780, 540);
		clickNodeAt(1000, 640, { shiftKey: true });
		resizeSelectionBoundsAt(1180, 700, 1596, 880, "bottom-right");
		const project = useProjectStore.getState().currentProject;
		const firstText = project?.canvas.nodes.find(
			(item) => item.id === firstTextId,
		);
		const secondText = project?.canvas.nodes.find(
			(item) => item.id === secondTextId,
		);
		expect(firstText?.x).toBeCloseTo(760);
		expect(firstText?.width).toBeCloseTo(240);
		expect(firstText?.height).toBeCloseTo(120);
		expect(secondText?.x).toBeCloseTo(1200);
		expect(secondText?.y).toBeCloseTo(720);
		expect(secondText?.width).toBeCloseTo(400);
		expect(secondText?.height).toBeCloseTo(160);
		expect((secondText?.x ?? 0) + (secondText?.width ?? 0)).toBeCloseTo(1600);
	});

	it("resize anchor 落在 node rect 外侧时不会误触发框选，也不会卡死后续拖拽", () => {
		render(<CanvasWorkspace />);
		const canvas = screen.getByTestId("infinite-skia-canvas");
		const workspace = screen.getByTestId("canvas-workspace");

		fireEvent.pointerDown(canvas, {
			...createPointerPatch(236, 116),
			buttons: 1,
		});
		fireEvent.pointerMove(workspace, {
			...createPointerPatch(200, 90),
			buttons: 1,
		});
		resizeNodeByIdAt("node-video-1", 236, 116, 200, 90, "top-left");
		fireEvent.pointerUp(workspace, {
			...createPointerPatch(200, 90),
			buttons: 0,
		});

		expect(getLatestInfiniteSkiaCanvasProps().marqueeRectScreen?.visible).toBe(
			false,
		);

		dragNodeAt(720, 360, 820, 420);
		const image = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((item) => item.id === "node-image-1");
		expect(image?.x).toBe(780);
		expect(image?.y).toBe(380);
	});

	it("组拖拽时锁定节点保持原位", () => {
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
							node.id === "node-image-1" ? { ...node, locked: true } : node,
						),
					},
				},
			};
		});
		render(<CanvasWorkspace />);
		clickNodeAt(300, 160);
		clickNodeAt(720, 360, { shiftKey: true });
		dragNodeAt(300, 160, 420, 260);
		const project = useProjectStore.getState().currentProject;
		const video = project?.canvas.nodes.find(
			(item) => item.id === "node-video-1",
		);
		const image = project?.canvas.nodes.find(
			(item) => item.id === "node-image-1",
		);
		expect(video?.x).toBe(360);
		expect(video?.y).toBe(220);
		expect(image?.x).toBe(680);
		expect(image?.y).toBe(320);
	});

	it("拖拽结束后，首次单击其他节点应立即生效", () => {
		render(<CanvasWorkspace />);
		dragNodeAt(300, 160, 420, 260);
		clickNodeAt(720, 360);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-image-1",
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
		setAssetSceneSourceSize(400, 300);
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

	it("resize 结束后，首次单击其他节点应立即生效", () => {
		render(<CanvasWorkspace />);
		resizeNodeAt(300, 160, 360, 220, "bottom-right");
		clickNodeAt(720, 360);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-image-1",
		);
	});

		it("节点拖拽后坐标会被约束为整数", () => {
			useCanvasCameraStore.getState().setCamera({
				x: 0,
				y: 0,
				zoom: 1.3,
			});
			render(<CanvasWorkspace />);
			dragNodeAt(340, 200, 460, 300);
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
