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
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import {
	CAMERA_SMOOTH_DURATION_MS,
	type CameraState,
} from "./canvasWorkspaceUtils";
import CanvasWorkspace from "./CanvasWorkspace";

const togglePlaybackMock = vi.fn();
const infiniteSkiaCanvasPropsMock = vi.fn();
const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();
let rafCounter = 1;
let nativeRequestAnimationFrame: typeof window.requestAnimationFrame;
let nativeCancelAnimationFrame: typeof window.cancelAnimationFrame;

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
	camera?: CameraState;
	focusedNodeId?: string | null;
	selectedNodeIds?: string[];
	snapGuidesScreen?: {
		vertical: number[];
		horizontal: number[];
	};
	suspendHover?: boolean;
	cameraAnimationKey?: number;
	onCameraAnimationComplete?: (
		animationKey: number,
		settledCamera?: CameraState,
	) => void;
	onNodeClick?: (node: CanvasNode, event: MockCanvasNodePointerEvent) => void;
	onNodeDoubleClick?: (
		node: CanvasNode,
		event: MockCanvasNodePointerEvent,
	) => void;
	onNodeDragStart?: (node: CanvasNode, event: MockCanvasNodeDragEvent) => void;
	onNodeDrag?: (node: CanvasNode, event: MockCanvasNodeDragEvent) => void;
	onNodeDragEnd?: (node: CanvasNode, event: MockCanvasNodeDragEvent) => void;
	onSelectionDragStart?: (event: MockCanvasNodeDragEvent) => void;
	onSelectionDrag?: (event: MockCanvasNodeDragEvent) => void;
	onSelectionDragEnd?: (event: MockCanvasNodeDragEvent) => void;
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
		useEffect(() => {
			if (!props.suspendHover) return;
			if (!props.onCameraAnimationComplete) return;
			const animationKey = props.cameraAnimationKey ?? 0;
			const timer = window.setTimeout(() => {
				props.onCameraAnimationComplete?.(animationKey);
			}, CAMERA_SMOOTH_DURATION_MS);
			return () => {
				window.clearTimeout(timer);
			};
		}, [
			props.cameraAnimationKey,
			props.onCameraAnimationComplete,
			props.suspendHover,
		]);
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
		canvasSnapEnabled: true,
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

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
	useProjectStore.setState({
		status: "ready",
		projects: [],
		currentProjectId: "project-1",
		currentProject: createProject(),
		focusedSceneDrafts: {},
		error: null,
	});
	useStudioHistoryStore.getState().clear();
	useStudioClipboardStore.getState().clearPayload();
	useDragStore.getState().endDrag();
	useDragStore.getState().setTimelineScrollLeft(0);
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

const createCanvasWorkspaceRuntime = () => {
	const runtime = createTestEditorRuntime("canvas-workspace-test");
	const timelineRef = { kind: "scene" as const, sceneId: "scene-1" };
	runtime.ensureTimelineRuntime(timelineRef);
	runtime.setActiveEditTimeline(timelineRef);
	return runtime;
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
	const canvas = screen.getByTestId("infinite-skia-canvas");
	fireEvent.mouseDown(canvas, {
		button: 0,
		clientX,
		clientY,
	});
	fireEvent.mouseUp(canvas, {
		button: 0,
		clientX,
		clientY,
	});
	fireEvent.click(canvas, {
		button: 0,
		clientX,
		clientY,
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
	patch: Partial<MockCanvasNodePointerEvent> = {},
): void => {
	const node = getTopVisibleNodeAt(clientX, clientY);
	act(() => {
		getLatestInfiniteSkiaCanvasProps().onNodeClick?.(
			node,
			createPointerMeta(clientX, clientY, patch),
		);
	});
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
	patch: Partial<MockCanvasNodePointerEvent> = {},
): void => {
	const node = getTopVisibleNodeAt(clientX, clientY);
	act(() => {
		getLatestInfiniteSkiaCanvasProps().onNodeDoubleClick?.(
			node,
			createPointerMeta(clientX, clientY, patch),
		);
	});
};

const dragNodeAt = (
	startClientX: number,
	startClientY: number,
	endClientX: number,
	endClientY: number,
	patch: Partial<MockCanvasNodePointerEvent> = {},
): void => {
	const node = getTopVisibleNodeAt(startClientX, startClientY);
	act(() => {
		const startEvent: MockCanvasNodeDragEvent = {
			...createPointerMeta(startClientX, startClientY, patch),
			movementX: 0,
			movementY: 0,
			first: true,
			last: false,
			tap: false,
		};
		getLatestInfiniteSkiaCanvasProps().onNodeDragStart?.(node, startEvent);
		getLatestInfiniteSkiaCanvasProps().onNodeDrag?.(node, startEvent);
		const moveEvent: MockCanvasNodeDragEvent = {
			...createPointerMeta(endClientX, endClientY, patch),
			movementX: endClientX - startClientX,
			movementY: endClientY - startClientY,
			first: false,
			last: false,
			tap: false,
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

const dragSelectionBoundsAt = (
	startClientX: number,
	startClientY: number,
	endClientX: number,
	endClientY: number,
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
		getLatestInfiniteSkiaCanvasProps().onSelectionDragStart?.(startEvent);
		getLatestInfiniteSkiaCanvasProps().onSelectionDrag?.(startEvent);
		const moveEvent: MockCanvasNodeDragEvent = {
			...createPointerMeta(endClientX, endClientY, patch),
			movementX: endClientX - startClientX,
			movementY: endClientY - startClientY,
			first: false,
			last: false,
			tap: false,
		};
		getLatestInfiniteSkiaCanvasProps().onSelectionDrag?.(moveEvent);
		const endEvent: MockCanvasNodeDragEvent = {
			...moveEvent,
			last: true,
			buttons: 0,
		};
		getLatestInfiniteSkiaCanvasProps().onSelectionDragEnd?.(endEvent);
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
	fireEvent.mouseDown(canvas, {
		button: 0,
		clientX: startClientX,
		clientY: startClientY,
		shiftKey: options.shiftKey ?? false,
	});
	fireEvent.mouseMove(canvas, {
		buttons: 1,
		clientX: endClientX,
		clientY: endClientY,
		shiftKey: options.shiftKey ?? false,
	});
	fireEvent.mouseUp(window, {
		button: 0,
		clientX: endClientX,
		clientY: endClientY,
		shiftKey: options.shiftKey ?? false,
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

	it("smooth 动画期间 instant zoom 更新会被忽略", async () => {
		render(<CanvasWorkspace />);
		const workspace = screen.getByTestId("canvas-workspace");
		clickSidebarNode("node-video-offscreen");
		const beforeWheel = useProjectStore.getState().currentProject?.ui.camera;
		fireEvent.wheel(workspace, {
			deltaY: 80,
			ctrlKey: true,
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
		fireEvent.mouseMove(screen.getByTestId("infinite-skia-canvas"), {
			clientX: 960,
			clientY: 540,
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
		fireEvent.mouseMove(screen.getByTestId("infinite-skia-canvas"), {
			clientX: 520,
			clientY: 440,
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

	it("框选会替换选择，dragend 落在 node 上也不会被尾随 click 覆盖", () => {
		render(<CanvasWorkspace />);
		marqueeCanvasAt(1000, 100, 300, 160);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-scene-1",
			"node-video-1",
		]);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-video-1",
		);

		const hitNode = getTopVisibleNodeAt(300, 160);
		act(() => {
			getLatestInfiniteSkiaCanvasProps().onNodeClick?.(
				hitNode,
				createPointerMeta(300, 160),
			);
		});
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-scene-1",
			"node-video-1",
		]);
	});

	it("框选 dragend 落在空白处后，单击空白即可清空选择", () => {
		render(<CanvasWorkspace />);
		marqueeCanvasAt(1100, 100, 200, 700);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-scene-1",
			"node-video-1",
			"node-image-1",
		]);

		clickCanvasAt(1120, 700);
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([]);
		expect(
			useProjectStore.getState().currentProject?.ui.activeNodeId,
		).toBeNull();
	});

	it("Shift 框选会基于初始选择做 toggle", () => {
		render(<CanvasWorkspace />);
		marqueeCanvasAt(1000, 100, 300, 160);
		marqueeCanvasAt(1000, 520, 650, 300, { shiftKey: true });
		expect(getLatestInfiniteSkiaCanvasProps().selectedNodeIds).toEqual([
			"node-video-1",
			"node-image-1",
		]);
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-image-1",
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
		const node = getTopVisibleNodeAt(720, 360);
		act(() => {
			const startEvent: MockCanvasNodeDragEvent = {
				...createPointerMeta(720, 360),
				movementX: 0,
				movementY: 0,
				first: true,
				last: false,
				tap: false,
			};
			getLatestInfiniteSkiaCanvasProps().onNodeDragStart?.(node, startEvent);
			getLatestInfiniteSkiaCanvasProps().onNodeDrag?.(node, startEvent);
			const moveEvent: MockCanvasNodeDragEvent = {
				...createPointerMeta(603, 360),
				movementX: -117,
				movementY: 0,
				first: false,
				last: false,
				tap: false,
			};
			getLatestInfiniteSkiaCanvasProps().onNodeDrag?.(node, moveEvent);
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
			const endEvent: MockCanvasNodeDragEvent = {
				...createPointerMeta(603, 360),
				movementX: -117,
				movementY: 0,
				first: false,
				last: true,
				tap: false,
				buttons: 0,
			};
			getLatestInfiniteSkiaCanvasProps().onNodeDragEnd?.(node, endEvent);
		});
		expect(getLatestInfiniteSkiaCanvasProps().snapGuidesScreen).toEqual({
			vertical: [],
			horizontal: [],
		});
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

	it("进入 timeline drop 态后拖离并松手，不会恢复画布拖拽也不会投放", () => {
		const runtime = createCanvasWorkspaceRuntime();
		const removeDropZone = mountMainTimelineDropZone();
		try {
			render(<CanvasWorkspace />, {
				wrapper: createRuntimeProviderWrapper(runtime),
			});
			const node = getTopVisibleNodeAt(300, 160);
			act(() => {
				const startEvent: MockCanvasNodeDragEvent = {
					...createPointerMeta(300, 160),
					movementX: 0,
					movementY: 0,
					first: true,
					last: false,
					tap: false,
				};
				getLatestInfiniteSkiaCanvasProps().onNodeDragStart?.(node, startEvent);
				getLatestInfiniteSkiaCanvasProps().onNodeDrag?.(node, startEvent);
				const moveToTimelineEvent: MockCanvasNodeDragEvent = {
					...createPointerMeta(120, 80),
					movementX: -180,
					movementY: -80,
					first: false,
					last: false,
					tap: false,
				};
				getLatestInfiniteSkiaCanvasProps().onNodeDrag?.(node, moveToTimelineEvent);
				const leaveTimelineEvent: MockCanvasNodeDragEvent = {
					...createPointerMeta(620, 360),
					movementX: 320,
					movementY: 200,
					first: false,
					last: false,
					tap: false,
				};
				getLatestInfiniteSkiaCanvasProps().onNodeDrag?.(node, leaveTimelineEvent);
				const endEvent: MockCanvasNodeDragEvent = {
					...leaveTimelineEvent,
					last: true,
					buttons: 0,
				};
				getLatestInfiniteSkiaCanvasProps().onNodeDragEnd?.(node, endEvent);
			});
			const project = useProjectStore.getState().currentProject;
			const draggedNode = project?.canvas.nodes.find(
				(item) => item.id === "node-video-1",
			);
			expect(draggedNode?.x).toBe(240);
			expect(draggedNode?.y).toBe(120);
			const timelineElements =
				runtime.getActiveEditTimelineRuntime()?.timelineStore.getState().elements ??
				[];
			expect(timelineElements).toHaveLength(0);
			expect(useStudioHistoryStore.getState().past).toHaveLength(0);
		} finally {
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

		fireEvent.mouseDown(canvas, {
			button: 0,
			clientX: 236,
			clientY: 116,
		});
		fireEvent.mouseMove(workspace, {
			buttons: 1,
			clientX: 200,
			clientY: 90,
		});
		resizeNodeByIdAt("node-video-1", 236, 116, 200, 90, "top-left");
		fireEvent.mouseUp(window, {
			button: 0,
			clientX: 200,
			clientY: 90,
		});

		expect(screen.queryByTestId("canvas-selection-rect")).toBeNull();

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

	it("拖拽结束后的首个 click 会被抑制，避免 active 误切换", () => {
		render(<CanvasWorkspace />);
		dragNodeAt(300, 160, 420, 260);
		const otherNode = getTopVisibleNodeAt(720, 360);
		act(() => {
			getLatestInfiniteSkiaCanvasProps().onNodeClick?.(
				otherNode,
				createPointerMeta(720, 360),
			);
		});
		expect(useProjectStore.getState().currentProject?.ui.activeNodeId).toBe(
			"node-scene-1",
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

	it("resize 结束后的首个 click 会被抑制，避免选中其他节点", () => {
		render(<CanvasWorkspace />);
		resizeNodeAt(300, 160, 360, 220, "bottom-right");
		const otherNode = getTopVisibleNodeAt(720, 360);
		act(() => {
			getLatestInfiniteSkiaCanvasProps().onNodeClick?.(
				otherNode,
				createPointerMeta(720, 360),
			);
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
