import { resolveTimelineEndFrame } from "core/editor/utils/timelineEndFrame";
import type { TimelineAsset, TimelineElement } from "core/element/types";
import type { CanvasNode, SceneDocument, SceneNode } from "core/studio/types";
import { PanelLeftOpen, Plus, Search, SearchX } from "lucide-react";
import type React from "react";
import {
	useCallback,
	useContext,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
} from "react";
import type { SkiaPointerEvent } from "react-skia-lite";
import { writeAudioToOpfs } from "@/asr/opfsAudio";
import { createTransformMeta } from "@/element/transform";
import TimelineContextMenu, {
	type TimelineContextMenuAction,
} from "@/scene-editor/components/TimelineContextMenu";
import { findAttachments } from "@/scene-editor/utils/attachments";
import { resolveExternalVideoUri } from "@/scene-editor/utils/externalVideo";
import { finalizeTimelineElements } from "@/scene-editor/utils/mainTrackMagnet";
import { buildTimelineMeta } from "@/scene-editor/utils/timelineTime";
import { EditorRuntimeContext } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import { writeProjectFileToOpfs } from "@/lib/projectOpfsStorage";
import { useProjectStore } from "@/projects/projectStore";
import CanvasNodeDrawerShell, {
	CANVAS_NODE_DRAWER_DEFAULT_HEIGHT,
	CANVAS_NODE_DRAWER_MAX_HEIGHT_RATIO,
	CANVAS_NODE_DRAWER_MIN_HEIGHT,
} from "@/studio/canvas/CanvasNodeDrawerShell";
import { isCanvasNodeFocusable } from "@/studio/canvas/node-system/focus";
import {
	canvasNodeDefinitionList,
	getCanvasNodeDefinition,
} from "@/studio/canvas/node-system/registry";
import type {
	CanvasNodeContextMenuAction,
	CanvasNodeDrawerOptions,
	CanvasNodeDrawerProps,
	CanvasNodeDrawerTrigger,
} from "@/studio/canvas/node-system/types";
import CanvasSidebar, {
	type CanvasSidebarTab,
} from "@/studio/canvas/sidebar/CanvasSidebar";
import {
	type CanvasNodeLayoutSnapshot,
	useStudioHistoryStore,
} from "@/studio/history/studioHistoryStore";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { secondsToFrames } from "@/utils/timecode";
import CanvasActiveNodeMetaPanel from "./CanvasActiveNodeMetaPanel";
import {
	CANVAS_OVERLAY_RIGHT_PANEL_WIDTH_PX,
	CANVAS_OVERLAY_SIDEBAR_WIDTH_PX,
	type CameraSafeInsets,
	resolveCanvasOverlayLayout,
} from "./canvasOverlayLayout";
import FocusSceneKonvaLayer from "./FocusSceneKonvaLayer";
import InfiniteSkiaCanvas from "./InfiniteSkiaCanvas";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const GRID_SIZE = 120;
const CAMERA_ZOOM_EPSILON = 1e-6;
const DROP_GRID_COLUMNS = 4;
const DROP_GRID_OFFSET_X = 48;
const DROP_GRID_OFFSET_Y = 40;
const FILE_PREFIX = "file://";
const FOCUS_VIEW_PADDING = 80;
const SIDEBAR_VIEW_PADDING_PX = 24;
const CAMERA_SMOOTH_DURATION_MS = 220;

interface CameraState {
	x: number;
	y: number;
	zoom: number;
}

type CameraTransitionMode = "smooth" | "instant";

interface ApplyCameraOptions {
	transition?: CameraTransitionMode;
}

const DEFAULT_CAMERA: CameraState = {
	x: 0,
	y: 0,
	zoom: 1,
};

type CanvasContextMenuState =
	| { open: false }
	| {
			open: true;
			scope: "canvas";
			x: number;
			y: number;
			worldX: number;
			worldY: number;
	  }
	| {
			open: true;
			scope: "node";
			x: number;
			y: number;
			actions: TimelineContextMenuAction[];
	  };

interface DragState {
	nodeId: string;
	startClientX: number;
	startClientY: number;
	startNodeX: number;
	startNodeY: number;
	before: CanvasNodeLayoutSnapshot;
	moved: boolean;
}

type FileWithPath = File & { path?: string };
type AnyCanvasDrawer = React.FC<CanvasNodeDrawerProps<CanvasNode>>;

interface ResolvedNodeDrawer {
	Drawer: AnyCanvasDrawer;
	node: CanvasNode;
	scene: SceneDocument | null;
	asset: TimelineAsset | null;
	trigger: CanvasNodeDrawerTrigger;
	options: ResolvedCanvasDrawerOptions;
}

interface ResolvedNodeDrawerTarget {
	Drawer: AnyCanvasDrawer;
	node: CanvasNode;
	trigger: CanvasNodeDrawerTrigger;
	options: ResolvedCanvasDrawerOptions;
}

interface ResolvedCanvasDrawerOptions {
	trigger: CanvasNodeDrawerTrigger;
	resizable: boolean;
	defaultHeight: number;
	minHeight: number;
	maxHeightRatio: number;
}

interface NodeFitCameraInput {
	node: CanvasNode;
	stageWidth: number;
	stageHeight: number;
	safeInsets: CameraSafeInsets;
}

interface NodePanCameraInput {
	node: CanvasNode;
	camera: CameraState;
	stageWidth: number;
	stageHeight: number;
	safeInsets: CameraSafeInsets;
	paddingPx: number;
}

interface SafeViewportRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

const clampZoom = (zoom: number): number => {
	return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
};

const resolveSafeViewportRect = (
	stageWidth: number,
	stageHeight: number,
	safeInsets: CameraSafeInsets,
): SafeViewportRect => {
	const safeLeft = Math.max(0, safeInsets.left);
	const safeTop = Math.max(0, safeInsets.top);
	const safeRight = Math.max(safeLeft + 1, stageWidth - Math.max(0, safeInsets.right));
	const safeBottom = Math.max(
		safeTop + 1,
		stageHeight - Math.max(0, safeInsets.bottom),
	);
	return {
		left: safeLeft,
		top: safeTop,
		right: safeRight,
		bottom: safeBottom,
		width: Math.max(1, safeRight - safeLeft),
		height: Math.max(1, safeBottom - safeTop),
	};
};

const buildNodeFitCamera = ({
	node,
	stageWidth,
	stageHeight,
	safeInsets,
}: NodeFitCameraInput): CameraState => {
	const safeNodeWidth = Math.max(1, Math.abs(node.width));
	const safeNodeHeight = Math.max(1, Math.abs(node.height));
	const viewport = resolveSafeViewportRect(stageWidth, stageHeight, safeInsets);
	const availableWidth = Math.max(1, viewport.width - FOCUS_VIEW_PADDING * 2);
	const availableHeight = Math.max(1, viewport.height - FOCUS_VIEW_PADDING * 2);
	const zoomX = availableWidth / safeNodeWidth;
	const zoomY = availableHeight / safeNodeHeight;
	const nextZoom = clampZoom(Math.min(zoomX, zoomY));
	const safeZoom = Math.max(nextZoom, CAMERA_ZOOM_EPSILON);
	const worldCenterX = node.x + node.width / 2;
	const worldCenterY = node.y + node.height / 2;
	const viewportCenterX = viewport.left + viewport.width / 2;
	const viewportCenterY = viewport.top + viewport.height / 2;
	return {
		x: viewportCenterX / safeZoom - worldCenterX,
		y: viewportCenterY / safeZoom - worldCenterY,
		zoom: nextZoom,
	};
};

const buildNodePanCamera = ({
	node,
	camera,
	stageWidth,
	stageHeight,
	safeInsets,
	paddingPx,
}: NodePanCameraInput): CameraState => {
	const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
	const viewport = resolveSafeViewportRect(stageWidth, stageHeight, safeInsets);
	const nodeLeft = Math.min(node.x, node.x + node.width);
	const nodeRight = Math.max(node.x, node.x + node.width);
	const nodeTop = Math.min(node.y, node.y + node.height);
	const nodeBottom = Math.max(node.y, node.y + node.height);
	const stageLeft = (nodeLeft + camera.x) * safeZoom;
	const stageRight = (nodeRight + camera.x) * safeZoom;
	const stageTop = (nodeTop + camera.y) * safeZoom;
	const stageBottom = (nodeBottom + camera.y) * safeZoom;
	const viewportLeft = viewport.left + paddingPx;
	const viewportRight = Math.max(
		viewportLeft + 1,
		viewport.right - paddingPx,
	);
	const viewportTop = viewport.top + paddingPx;
	const viewportBottom = Math.max(
		viewportTop + 1,
		viewport.bottom - paddingPx,
	);
	const viewportWidth = viewportRight - viewportLeft;
	const viewportHeight = viewportBottom - viewportTop;

	const resolveAxisShift = (
		nodeStart: number,
		nodeEnd: number,
		viewportStart: number,
		viewportEnd: number,
		viewportSize: number,
	): number => {
		const nodeSize = nodeEnd - nodeStart;
		if (nodeSize > viewportSize) {
			const viewportCenter = viewportStart + viewportSize / 2;
			const nodeCenter = nodeStart + nodeSize / 2;
			return viewportCenter - nodeCenter;
		}
		if (nodeStart < viewportStart) {
			return viewportStart - nodeStart;
		}
		if (nodeEnd > viewportEnd) {
			return viewportEnd - nodeEnd;
		}
		return 0;
	};

	const shiftX = resolveAxisShift(
		stageLeft,
		stageRight,
		viewportLeft,
		viewportRight,
		viewportWidth,
	);
	const shiftY = resolveAxisShift(
		stageTop,
		stageBottom,
		viewportTop,
		viewportBottom,
		viewportHeight,
	);

	if (Math.abs(shiftX) < 0.5 && Math.abs(shiftY) < 0.5) {
		return camera;
	}

	return {
		x: camera.x + shiftX / safeZoom,
		y: camera.y + shiftY / safeZoom,
		zoom: camera.zoom,
	};
};

const pickLayout = (node: CanvasNode): CanvasNodeLayoutSnapshot => ({
	x: node.x,
	y: node.y,
	width: node.width,
	height: node.height,
	zIndex: node.zIndex,
	hidden: node.hidden,
	locked: node.locked,
});

const isLayoutEqual = (
	before: CanvasNodeLayoutSnapshot,
	after: CanvasNodeLayoutSnapshot,
): boolean => {
	return (
		before.x === after.x &&
		before.y === after.y &&
		before.width === after.width &&
		before.height === after.height &&
		before.zIndex === after.zIndex &&
		before.hidden === after.hidden &&
		before.locked === after.locked
	);
};

const isWorldPointInNode = (
	node: CanvasNode,
	worldX: number,
	worldY: number,
): boolean => {
	const left = Math.min(node.x, node.x + node.width);
	const right = Math.max(node.x, node.x + node.width);
	const top = Math.min(node.y, node.y + node.height);
	const bottom = Math.max(node.y, node.y + node.height);
	return worldX >= left && worldX <= right && worldY >= top && worldY <= bottom;
};

const isCameraAlmostEqual = (
	left: CameraState,
	right: CameraState,
): boolean => {
	return (
		Math.abs(left.x - right.x) < 0.5 &&
		Math.abs(left.y - right.y) < 0.5 &&
		Math.abs(left.zoom - right.zoom) < 0.0001
	);
};

const easeOutCubic = (value: number): number => {
	return 1 - (1 - value) ** 3;
};

const lerp = (from: number, to: number, progress: number): number => {
	return from + (to - from) * progress;
};

const lerpCamera = (
	from: CameraState,
	to: CameraState,
	progress: number,
): CameraState => {
	const nextZoom = lerp(from.zoom, to.zoom, progress);
	const safeNextZoom = Math.max(nextZoom, CAMERA_ZOOM_EPSILON);
	const nextTranslateX = lerp(from.x * from.zoom, to.x * to.zoom, progress);
	const nextTranslateY = lerp(from.y * from.zoom, to.y * to.zoom, progress);
	return {
		x: nextTranslateX / safeNextZoom,
		y: nextTranslateY / safeNextZoom,
		zoom: nextZoom,
	};
};

const isElectronEnv = (): boolean => {
	return typeof window !== "undefined" && "aiNleElectron" in window;
};

const getFilePath = (file: File): string | null => {
	const rawPath = (file as FileWithPath).path;
	if (typeof rawPath !== "string") return null;
	const trimmed = rawPath.trim();
	return trimmed ? trimmed : null;
};

const getElectronFilePath = (file: File): string | null => {
	if (typeof window === "undefined") return null;
	const bridge = (
		window as Window & {
			aiNleElectron?: {
				webUtils?: {
					getPathForFile?: (file: File) => string | null | undefined;
				};
			};
		}
	).aiNleElectron;
	const resolved = bridge?.webUtils?.getPathForFile?.(file);
	if (typeof resolved !== "string") return null;
	const trimmed = resolved.trim();
	return trimmed ? trimmed : null;
};

const buildFileUrlFromPath = (rawPath: string): string => {
	if (rawPath.startsWith(FILE_PREFIX)) return rawPath;
	const normalized = rawPath.replace(/\\/g, "/");
	let pathPart = normalized;
	let isUnc = false;
	if (pathPart.startsWith("//")) {
		isUnc = true;
		pathPart = pathPart.slice(2);
	} else if (/^[a-zA-Z]:\//.test(pathPart)) {
		pathPart = `/${pathPart}`;
	} else if (!pathPart.startsWith("/")) {
		pathPart = `/${pathPart}`;
	}
	const encoded = pathPart
		.split("/")
		.map((segment) => {
			if (!segment) return "";
			if (!isUnc && /^[a-zA-Z]:$/.test(segment)) return segment;
			return encodeURIComponent(segment);
		})
		.join("/");
	return `${FILE_PREFIX}${encoded}`;
};

const resolveDroppedFiles = (dataTransfer: DataTransfer | null): File[] => {
	if (!dataTransfer) return [];
	if (dataTransfer.files && dataTransfer.files.length > 0) {
		return Array.from(dataTransfer.files);
	}
	if (!dataTransfer.items) return [];
	return Array.from(dataTransfer.items)
		.map((item) => (item.kind === "file" ? item.getAsFile() : null))
		.filter((file): file is File => Boolean(file));
};

const resolveDrawerTrigger = (
	trigger: CanvasNodeDrawerTrigger | undefined,
): CanvasNodeDrawerTrigger => {
	return trigger ?? "focus";
};

const resolveDrawerOptions = (
	options: CanvasNodeDrawerOptions | undefined,
	deprecatedTrigger: CanvasNodeDrawerTrigger | undefined,
): ResolvedCanvasDrawerOptions => {
	const trigger = resolveDrawerTrigger(options?.trigger ?? deprecatedTrigger);
	return {
		trigger,
		resizable: options?.resizable ?? false,
		defaultHeight: options?.defaultHeight ?? CANVAS_NODE_DRAWER_DEFAULT_HEIGHT,
		minHeight: options?.minHeight ?? CANVAS_NODE_DRAWER_MIN_HEIGHT,
		maxHeightRatio:
			options?.maxHeightRatio ?? CANVAS_NODE_DRAWER_MAX_HEIGHT_RATIO,
	};
};

const isOverlayWheelTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof Element)) return false;
	return Boolean(target.closest('[data-canvas-overlay-ui="true"]'));
};

const toTimelineContextMenuActions = (
	actions: CanvasNodeContextMenuAction[],
): TimelineContextMenuAction[] => {
	return actions.map((action) => ({
		key: action.key,
		label: action.label,
		disabled: action.disabled,
		danger: action.danger,
		onSelect: action.onSelect,
		children: action.children
			? toTimelineContextMenuActions(action.children)
			: undefined,
	}));
};

const CanvasWorkspace = () => {
	const currentProject = useProjectStore((state) => state.currentProject);
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const createCanvasNode = useProjectStore((state) => state.createCanvasNode);
	const updateCanvasNode = useProjectStore((state) => state.updateCanvasNode);
	const updateCanvasNodeLayout = useProjectStore(
		(state) => state.updateCanvasNodeLayout,
	);
	const ensureProjectAssetByUri = useProjectStore(
		(state) => state.ensureProjectAssetByUri,
	);
	const updateSceneTimeline = useProjectStore((state) => state.updateSceneTimeline);
	const setFocusedNode = useProjectStore((state) => state.setFocusedNode);
	const setActiveScene = useProjectStore((state) => state.setActiveScene);
	const setActiveNode = useProjectStore((state) => state.setActiveNode);
	const setCanvasCamera = useProjectStore((state) => state.setCanvasCamera);
	const pushHistory = useStudioHistoryStore((state) => state.push);
	const runtime = useContext(EditorRuntimeContext);
	const runtimeManager = useMemo<StudioRuntimeManager | null>(() => {
		const manager = runtime as Partial<StudioRuntimeManager> | null;
		if (
			!manager?.getTimelineRuntime ||
			!manager.listTimelineRuntimes
		) {
			return null;
		}
		return manager as StudioRuntimeManager;
	}, [runtime]);

	const focusedNodeId = currentProject?.ui.focusedNodeId ?? null;
	const activeSceneId = currentProject?.ui.activeSceneId ?? null;
	const activeNodeId = currentProject?.ui.activeNodeId ?? null;
	const camera = currentProject?.ui.camera ?? DEFAULT_CAMERA;
	const isCanvasInteractionLocked = Boolean(focusedNodeId);
	const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
	const [visibleDrawerHeight, setVisibleDrawerHeight] = useState(
		CANVAS_NODE_DRAWER_DEFAULT_HEIGHT,
	);
	const [contextMenuState, setContextMenuState] =
		useState<CanvasContextMenuState>({ open: false });
	const containerRef = useRef<HTMLDivElement | null>(null);
	const preFocusCameraRef = useRef<CameraState | null>(null);
	const prevFocusedNodeIdRef = useRef<string | null>(focusedNodeId);
	const dragStateRef = useRef<DragState | null>(null);
	const suppressNodeClickIdRef = useRef<string | null>(null);
	const cameraAnimationFrameRef = useRef<number | null>(null);
	const cameraAnimationTokenRef = useRef(0);

	const getCamera = useEffectEvent((): CameraState => {
		return currentProject?.ui.camera ?? DEFAULT_CAMERA;
	});

	const stopCameraAnimation = useEffectEvent(() => {
		if (
			typeof window !== "undefined" &&
			typeof window.cancelAnimationFrame === "function" &&
			cameraAnimationFrameRef.current !== null
		) {
			window.cancelAnimationFrame(cameraAnimationFrameRef.current);
		}
		cameraAnimationFrameRef.current = null;
		cameraAnimationTokenRef.current += 1;
	});

	const applyCamera = useEffectEvent(
		(nextCamera: CameraState, options?: ApplyCameraOptions) => {
			const transition = options?.transition ?? "smooth";
			const currentCamera = getCamera();
			if (isCameraAlmostEqual(currentCamera, nextCamera)) {
				stopCameraAnimation();
				return;
			}
			if (
				transition === "instant" ||
				typeof window === "undefined" ||
				typeof window.requestAnimationFrame !== "function"
			) {
				stopCameraAnimation();
				setCanvasCamera(nextCamera);
				return;
			}
			stopCameraAnimation();
			const fromCamera = currentCamera;
			const token = cameraAnimationTokenRef.current;
			const startedAt =
				typeof performance !== "undefined" ? performance.now() : Date.now();
			const animate = (timestamp: number) => {
				if (cameraAnimationTokenRef.current !== token) return;
				const elapsed = timestamp - startedAt;
				const progress = Math.max(
					0,
					Math.min(1, elapsed / CAMERA_SMOOTH_DURATION_MS),
				);
				const easedProgress = easeOutCubic(progress);
				setCanvasCamera(lerpCamera(fromCamera, nextCamera, easedProgress));
				if (progress >= 1) {
					cameraAnimationFrameRef.current = null;
					setCanvasCamera(nextCamera);
					return;
				}
				cameraAnimationFrameRef.current = window.requestAnimationFrame(animate);
			};
			cameraAnimationFrameRef.current = window.requestAnimationFrame(animate);
		},
	);

	const sidebarNodes = useMemo(() => {
		if (!currentProject) return [];
		return [...currentProject.canvas.nodes].sort((a, b) => {
			if (a.zIndex !== b.zIndex) return b.zIndex - a.zIndex;
			return b.createdAt - a.createdAt;
		});
	}, [currentProject]);

	const sortedNodes = useMemo(() => {
		if (!currentProject) return [];
		return [...currentProject.canvas.nodes]
			.filter((node) => !node.hidden)
			.sort((a, b) => {
				if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
				return a.createdAt - b.createdAt;
			});
	}, [currentProject]);

	const focusedNode = useMemo(() => {
		if (!focusedNodeId) return null;
		return (
			currentProject?.canvas.nodes.find((node) => node.id === focusedNodeId) ??
			null
		);
	}, [currentProject, focusedNodeId]);

	const activeNode = useMemo(() => {
		if (!activeNodeId) return null;
		return (
			currentProject?.canvas.nodes.find((node) => node.id === activeNodeId) ??
			null
		);
	}, [activeNodeId, currentProject]);

	const activeNodeDefinition = useMemo(() => {
		if (!activeNode) return null;
		return getCanvasNodeDefinition(activeNode.type);
	}, [activeNode]);
	const ActiveNodeToolbar = activeNodeDefinition?.toolbar ?? null;

	const activeNodeScene = useMemo(() => {
		if (!activeNode || activeNode.type !== "scene") return null;
		return currentProject?.scenes[activeNode.sceneId] ?? null;
	}, [activeNode, currentProject]);

	const activeNodeAsset = useMemo(() => {
		if (!activeNode || !("assetId" in activeNode)) return null;
		return (
			currentProject?.assets.find((asset) => asset.id === activeNode.assetId) ??
			null
		);
	}, [activeNode, currentProject]);

	const contextMenuSceneOptions = useMemo(() => {
		if (!currentProject) return [];
		const toSceneOption = (sceneId: string) => {
			const scene = currentProject.scenes[sceneId];
			if (!scene) return null;
			return {
				sceneId,
				label: scene.name?.trim() ? scene.name : sceneId,
			};
		};
		if (runtimeManager) {
			const runtimeSceneOptions: Array<{ sceneId: string; label: string }> = [];
			const seen = new Set<string>();
			for (const timelineRuntime of runtimeManager.listTimelineRuntimes()) {
				const sceneId = timelineRuntime.ref.sceneId;
				if (seen.has(sceneId)) continue;
				seen.add(sceneId);
				const option = toSceneOption(sceneId);
				if (option) runtimeSceneOptions.push(option);
			}
			if (runtimeSceneOptions.length > 0) {
				return runtimeSceneOptions;
			}
		}
		return Object.keys(currentProject.scenes)
			.map((sceneId) => toSceneOption(sceneId))
			.filter((scene): scene is { sceneId: string; label: string } =>
				Boolean(scene),
			);
	}, [currentProject, runtimeManager]);

	const insertImageNodeToScene = useCallback(
		(node: CanvasNode, sceneId: string) => {
			if (node.type !== "image") return;
			if (!node.assetId) return;
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const targetScene = latestProject.scenes[sceneId];
			if (!targetScene) return;

			const appendImageElement = (
				elements: TimelineElement[],
				fps: number,
				rippleEditingEnabled: boolean,
				autoAttach: boolean,
			): TimelineElement[] => {
				const start = resolveTimelineEndFrame(elements);
				const duration = Math.max(1, secondsToFrames(5, fps));
				const nextElement: TimelineElement = {
					id: `element-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					type: "Image",
					component: "image",
					name: node.name,
					assetId: node.assetId,
					props: {},
					transform: createTransformMeta({
						width: Math.max(1, Math.abs(node.width)),
						height: Math.max(1, Math.abs(node.height)),
						positionX: 0,
						positionY: 0,
					}),
					timeline: buildTimelineMeta(
						{
							start,
							end: start + duration,
							trackIndex: 0,
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
				return finalizeTimelineElements([...elements, nextElement], {
					rippleEditingEnabled,
					attachments: autoAttach ? findAttachments(elements) : undefined,
					autoAttach,
					fps,
				});
			};

			if (runtimeManager) {
				const timelineRuntime = runtimeManager.getTimelineRuntime(
					toSceneTimelineRef(sceneId),
				);
				if (timelineRuntime) {
					const timelineState = timelineRuntime.timelineStore.getState();
					timelineState.setElements((prev) => {
						return appendImageElement(
							prev,
							timelineState.fps,
							timelineState.rippleEditingEnabled,
							timelineState.autoAttach,
						);
					});
					return;
				}
			}

			const nextElements = appendImageElement(
				targetScene.timeline.elements,
				targetScene.timeline.fps,
				targetScene.timeline.settings.rippleEditingEnabled,
				targetScene.timeline.settings.autoAttach,
			);
			updateSceneTimeline(sceneId, {
				...targetScene.timeline,
				elements: nextElements,
			});
		},
		[runtimeManager, updateSceneTimeline],
	);

	const resolvedDrawerTarget = useMemo<ResolvedNodeDrawerTarget | null>(() => {
		if (focusedNode) {
			const definition = getCanvasNodeDefinition(focusedNode.type);
			const options = resolveDrawerOptions(
				definition.drawerOptions,
				definition.drawerTrigger,
			);
			const trigger = options.trigger;
			if (definition.drawer && trigger === "focus") {
				return {
					Drawer: definition.drawer as unknown as AnyCanvasDrawer,
					node: focusedNode,
					trigger,
					options,
				};
			}
		}
		if (activeNode) {
			const definition = getCanvasNodeDefinition(activeNode.type);
			const options = resolveDrawerOptions(
				definition.drawerOptions,
				definition.drawerTrigger,
			);
			const trigger = options.trigger;
			if (definition.drawer && trigger === "active") {
				return {
					Drawer: definition.drawer as unknown as AnyCanvasDrawer,
					node: activeNode,
					trigger,
					options,
				};
			}
		}
		return null;
	}, [activeNode, focusedNode]);

	const resolvedDrawer = useMemo<ResolvedNodeDrawer | null>(() => {
		if (!resolvedDrawerTarget) return null;
		const node = resolvedDrawerTarget.node;
		const scene =
			node.type === "scene"
				? (currentProject?.scenes[node.sceneId] ?? null)
				: null;
		const asset =
			"assetId" in node
				? (currentProject?.assets.find((item) => item.id === node.assetId) ??
					null)
				: null;
		return {
			...resolvedDrawerTarget,
			scene,
			asset,
		};
	}, [currentProject, resolvedDrawerTarget]);

	const focusedSceneNode = useMemo((): SceneNode | null => {
		if (!focusedNode || focusedNode.type !== "scene") return null;
		return focusedNode;
	}, [focusedNode]);
	const sidebarMode = focusedSceneNode ? "focus" : "canvas";
	const [sidebarTab, setSidebarTab] = useState<CanvasSidebarTab>("nodes");
	const [sidebarExpanded, setSidebarExpanded] = useState(true);

	useEffect(() => {
		setSidebarTab(focusedNodeId ? "element" : "nodes");
	}, [focusedNodeId]);

	const drawerIdentity = resolvedDrawerTarget
		? `${resolvedDrawerTarget.node.id}:${resolvedDrawerTarget.trigger}`
		: null;
	const drawerDefaultHeight =
		resolvedDrawerTarget?.options.defaultHeight ??
		CANVAS_NODE_DRAWER_DEFAULT_HEIGHT;
	const drawerVisible = Boolean(resolvedDrawerTarget);
	const rightPanelVisible = Boolean(activeNode);
	const overlayLayout = useMemo(() => {
		return resolveCanvasOverlayLayout({
			containerWidth: stageSize.width,
			containerHeight: stageSize.height,
			sidebarExpanded,
			drawerVisible,
			drawerHeight: visibleDrawerHeight,
			rightPanelVisible,
			sidebarWidthPx: CANVAS_OVERLAY_SIDEBAR_WIDTH_PX,
			rightPanelWidthPx: CANVAS_OVERLAY_RIGHT_PANEL_WIDTH_PX,
		});
	}, [
		drawerVisible,
		rightPanelVisible,
		sidebarExpanded,
		stageSize.height,
		stageSize.width,
		visibleDrawerHeight,
	]);
	const cameraSafeInsets = overlayLayout.cameraSafeInsets;
	const rightPanelShouldRender =
		rightPanelVisible &&
		overlayLayout.rightPanelRect.width > 0 &&
		overlayLayout.rightPanelRect.height > 0;

	const resolveWorldPoint = useCallback(
		(clientX: number, clientY: number) => {
			const container = containerRef.current;
			if (!container) return { x: 0, y: 0 };
			const rect = container.getBoundingClientRect();
			const safeClientX = Number.isFinite(clientX) ? clientX : rect.left;
			const safeClientY = Number.isFinite(clientY) ? clientY : rect.top;
			const localX = safeClientX - rect.left;
			const localY = safeClientY - rect.top;
			const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
			return {
				x: localX / safeZoom - camera.x,
				y: localY / safeZoom - camera.y,
			};
		},
		[camera],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const updateSize = () => {
			const rect = container.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			setStageSize({ width: rect.width, height: rect.height });
		};
		updateSize();
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", updateSize);
			return () => window.removeEventListener("resize", updateSize);
		}
		const observer = new ResizeObserver(updateSize);
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (!focusedNodeId) return;
			event.preventDefault();
			setFocusedNode(null);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [focusedNodeId, setFocusedNode]);

	useEffect(() => {
		if (focusedNodeId) return;
		setVisibleDrawerHeight(CANVAS_NODE_DRAWER_DEFAULT_HEIGHT);
	}, [focusedNodeId]);

	useEffect(() => {
		if (!drawerIdentity) return;
		setVisibleDrawerHeight(drawerDefaultHeight);
	}, [drawerDefaultHeight, drawerIdentity]);

	useEffect(() => {
		return () => {
			if (
				typeof window !== "undefined" &&
				typeof window.cancelAnimationFrame === "function" &&
				cameraAnimationFrameRef.current !== null
			) {
				window.cancelAnimationFrame(cameraAnimationFrameRef.current);
			}
			cameraAnimationFrameRef.current = null;
			cameraAnimationTokenRef.current += 1;
		};
	}, []);

	useEffect(() => {
		const prevFocusedNodeId = prevFocusedNodeIdRef.current;
		const currentCamera = getCamera();
		if (!prevFocusedNodeId && focusedNodeId) {
			preFocusCameraRef.current = currentCamera;
		}
		if (prevFocusedNodeId && !focusedNodeId) {
			const previous = preFocusCameraRef.current;
			preFocusCameraRef.current = null;
			if (previous && !isCameraAlmostEqual(previous, currentCamera)) {
				applyCamera(previous);
			}
		}
		prevFocusedNodeIdRef.current = focusedNodeId;
	}, [focusedNodeId]);

	useEffect(() => {
		if (!focusedNodeId) return;
		if (!focusedNode) return;
		if (stageSize.width <= 0 || stageSize.height <= 0) return;
		const nextCamera = buildNodeFitCamera({
			node: focusedNode,
			stageWidth: stageSize.width,
			stageHeight: stageSize.height,
			safeInsets: cameraSafeInsets,
		});
		const currentCamera = getCamera();
		if (isCameraAlmostEqual(currentCamera, nextCamera)) return;
		applyCamera(nextCamera);
	}, [
		cameraSafeInsets,
		focusedNode,
		focusedNodeId,
		stageSize.height,
		stageSize.width,
	]);

	const handleCreateScene = useCallback(() => {
		const nodeId = createCanvasNode({ type: "scene" });
		const latestProject = useProjectStore.getState().currentProject;
		if (!latestProject) return;
		const node = latestProject.canvas.nodes.find((item) => item.id === nodeId);
		if (!node || node.type !== "scene") return;
		const scene = latestProject.scenes[node.sceneId];
		pushHistory({
			kind: "canvas.node-create",
			node,
			scene,
			focusNodeId: latestProject.ui.focusedNodeId,
		});
	}, [createCanvasNode, pushHistory]);

	const handleZoomByStep = useCallback(
		(multiplier: number) => {
			const currentCamera = getCamera();
			const nextZoom = clampZoom(currentCamera.zoom * multiplier);
			if (nextZoom === currentCamera.zoom) return;
			const safeCurrentZoom = Math.max(currentCamera.zoom, CAMERA_ZOOM_EPSILON);
			const safeNextZoom = Math.max(nextZoom, CAMERA_ZOOM_EPSILON);
			const anchorX = stageSize.width > 0 ? stageSize.width / 2 : 0;
			const anchorY = stageSize.height > 0 ? stageSize.height / 2 : 0;
			const anchorWorldX = anchorX / safeCurrentZoom - currentCamera.x;
			const anchorWorldY = anchorY / safeCurrentZoom - currentCamera.y;
			applyCamera(
				{
					x: anchorX / safeNextZoom - anchorWorldX,
					y: anchorY / safeNextZoom - anchorWorldY,
					zoom: nextZoom,
				},
				{ transition: "instant" },
			);
		},
		[applyCamera, getCamera, stageSize.height, stageSize.width],
	);

	const handleResetView = useCallback(() => {
		applyCamera(DEFAULT_CAMERA);
	}, [applyCamera]);

	const handleContainerWheel = useCallback(
		(event: WheelEvent) => {
			if (isOverlayWheelTarget(event.target)) return;
			event.preventDefault();
			if (focusedNodeId) return;
			const currentCamera = getCamera();
			if (event.ctrlKey || event.metaKey) {
				const oldZoom = Math.max(currentCamera.zoom, CAMERA_ZOOM_EPSILON);
				const zoomDelta = event.deltaY > 0 ? 0.92 : 1.08;
				const nextZoom = clampZoom(oldZoom * zoomDelta);
				const safeNextZoom = Math.max(nextZoom, CAMERA_ZOOM_EPSILON);
				const container = containerRef.current;
				if (!container) return;
				const rect = container.getBoundingClientRect();
				const pointerX = event.clientX - rect.left;
				const pointerY = event.clientY - rect.top;
				const worldPoint = {
					x: pointerX / oldZoom - currentCamera.x,
					y: pointerY / oldZoom - currentCamera.y,
				};
				applyCamera(
					{
						x: pointerX / safeNextZoom - worldPoint.x,
						y: pointerY / safeNextZoom - worldPoint.y,
						zoom: nextZoom,
					},
					{ transition: "instant" },
				);
				return;
			}
			const safeZoom = Math.max(currentCamera.zoom, CAMERA_ZOOM_EPSILON);
			applyCamera(
				{
					x: currentCamera.x - event.deltaX / safeZoom,
					y: currentCamera.y - event.deltaY / safeZoom,
					zoom: currentCamera.zoom,
				},
				{ transition: "instant" },
			);
		},
		[applyCamera, focusedNodeId, getCamera],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const listener = (event: WheelEvent) => {
			handleContainerWheel(event);
		};
		container.addEventListener("wheel", listener, { passive: false });
		return () => {
			container.removeEventListener("wheel", listener);
		};
	}, [handleContainerWheel]);

	const getTopHitNode = useCallback(
		(worldX: number, worldY: number): CanvasNode | null => {
			for (let index = sortedNodes.length - 1; index >= 0; index -= 1) {
				const node = sortedNodes[index];
				if (!node) continue;
				const canInteractNode =
					!isCanvasInteractionLocked || node.id === focusedNodeId;
				if (!canInteractNode) continue;
				if (!isWorldPointInNode(node, worldX, worldY)) continue;
				return node;
			}
			return null;
		},
		[focusedNodeId, isCanvasInteractionLocked, sortedNodes],
	);

	const handleNodeActivate = useCallback(
		(node: CanvasNode) => {
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			setActiveNode(node.id);
			if (node.type === "scene") {
				setActiveScene(node.sceneId);
			}
		},
		[focusedNodeId, isCanvasInteractionLocked, setActiveNode, setActiveScene],
	);

	const handleSkiaNodePointerDown = useCallback(
		(node: CanvasNode, event: SkiaPointerEvent) => {
			if (event.button !== 0) return;
			suppressNodeClickIdRef.current = null;
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			if (node.locked) {
				handleNodeActivate(node);
				return;
			}
			setActiveNode(node.id);
			dragStateRef.current = {
				nodeId: node.id,
				startClientX: event.clientX,
				startClientY: event.clientY,
				startNodeX: node.x,
				startNodeY: node.y,
				before: pickLayout(node),
				moved: false,
			};
		},
		[focusedNodeId, handleNodeActivate, isCanvasInteractionLocked, setActiveNode],
	);

	const handleSkiaNodeClick = useCallback(
		(node: CanvasNode) => {
			if (suppressNodeClickIdRef.current === node.id) {
				suppressNodeClickIdRef.current = null;
				return;
			}
			handleNodeActivate(node);
		},
		[handleNodeActivate],
	);

	const handleSkiaNodeDoubleClick = useCallback(
		(node: CanvasNode) => {
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			if (isCanvasNodeFocusable(node, getCanvasNodeDefinition)) {
				setFocusedNode(node.id);
				return;
			}
			const container = containerRef.current;
			const stageWidth =
				stageSize.width > 0
					? stageSize.width
					: (container?.getBoundingClientRect().width ?? 0);
			const stageHeight =
				stageSize.height > 0
					? stageSize.height
					: (container?.getBoundingClientRect().height ?? 0);
			if (stageWidth <= 0 || stageHeight <= 0) return;
			const nextCamera = buildNodeFitCamera({
				node,
				stageWidth,
				stageHeight,
				safeInsets: cameraSafeInsets,
			});
			const currentCamera = getCamera();
			if (isCameraAlmostEqual(currentCamera, nextCamera)) return;
			applyCamera(nextCamera);
		},
		[
			applyCamera,
			cameraSafeInsets,
			focusedNodeId,
			getCamera,
			isCanvasInteractionLocked,
			setFocusedNode,
			stageSize.height,
			stageSize.width,
		],
	);

	const handleSidebarNodeSelect = useCallback(
		(node: CanvasNode) => {
			handleNodeActivate(node);
			if (sidebarMode !== "canvas") return;
			if (stageSize.width <= 0 || stageSize.height <= 0) return;
			const currentCamera = getCamera();
			const nextCamera = buildNodePanCamera({
				node,
				camera: currentCamera,
				stageWidth: stageSize.width,
				stageHeight: stageSize.height,
				safeInsets: cameraSafeInsets,
				paddingPx: SIDEBAR_VIEW_PADDING_PX,
			});
			if (isCameraAlmostEqual(currentCamera, nextCamera)) return;
			applyCamera(nextCamera);
		},
		[
			applyCamera,
			cameraSafeInsets,
			getCamera,
			handleNodeActivate,
			sidebarMode,
			stageSize.height,
			stageSize.width,
		],
	);

	const handleNodeHitLayerPointerDown = useCallback(
		(event: React.PointerEvent<HTMLButtonElement>) => {
			if (event.button !== 0) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			const node = getTopHitNode(world.x, world.y);
			if (!node) {
				if (!isCanvasInteractionLocked) {
					setActiveNode(null);
				}
				return;
			}
			if (node.locked) {
				handleNodeActivate(node);
				return;
			}
			setActiveNode(node.id);
			if (typeof event.currentTarget.setPointerCapture === "function") {
				event.currentTarget.setPointerCapture(event.pointerId);
			}
			dragStateRef.current = {
				nodeId: node.id,
				startClientX: event.clientX,
				startClientY: event.clientY,
				startNodeX: node.x,
				startNodeY: node.y,
				before: pickLayout(node),
				moved: false,
			};
		},
		[
			getTopHitNode,
			handleNodeActivate,
			isCanvasInteractionLocked,
			resolveWorldPoint,
			setActiveNode,
		],
	);

	const handleNodeHitLayerDoubleClick = useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			if (event.button !== 0) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			const node = getTopHitNode(world.x, world.y);
			if (!node) return;
			if (isCanvasNodeFocusable(node, getCanvasNodeDefinition)) {
				setFocusedNode(node.id);
				return;
			}
			const container = containerRef.current;
			const stageWidth =
				stageSize.width > 0
					? stageSize.width
					: (container?.getBoundingClientRect().width ?? 0);
			const stageHeight =
				stageSize.height > 0
					? stageSize.height
					: (container?.getBoundingClientRect().height ?? 0);
			if (stageWidth <= 0 || stageHeight <= 0) return;
			const nextCamera = buildNodeFitCamera({
				node,
				stageWidth,
				stageHeight,
				safeInsets: cameraSafeInsets,
			});
			const currentCamera = getCamera();
			if (isCameraAlmostEqual(currentCamera, nextCamera)) return;
			applyCamera(nextCamera);
		},
		[
			applyCamera,
			cameraSafeInsets,
			getCamera,
			getTopHitNode,
			resolveWorldPoint,
			setFocusedNode,
			stageSize.height,
			stageSize.width,
		],
	);

	useEffect(() => {
		const handlePointerMove = (event: PointerEvent) => {
			const dragState = dragStateRef.current;
			if (!dragState) return;
			const deltaX = event.clientX - dragState.startClientX;
			const deltaY = event.clientY - dragState.startClientY;
			const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
			const nextX = dragState.startNodeX + deltaX / safeZoom;
			const nextY = dragState.startNodeY + deltaY / safeZoom;
			dragState.moved =
				dragState.moved || Math.abs(deltaX) + Math.abs(deltaY) > 2;
			updateCanvasNodeLayout(dragState.nodeId, {
				x: nextX,
				y: nextY,
			});
		};

		const handlePointerUp = () => {
			const dragState = dragStateRef.current;
			dragStateRef.current = null;
			if (!dragState) return;
			if (!dragState.moved) {
				return;
			}
			suppressNodeClickIdRef.current = dragState.nodeId;
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const node = latestProject.canvas.nodes.find(
				(item) => item.id === dragState.nodeId,
			);
			if (!node) return;
			const after = pickLayout(node);
			if (isLayoutEqual(dragState.before, after)) return;
			pushHistory({
				kind: "canvas.node-layout",
				nodeId: node.id,
				before: dragState.before,
				after,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
		};

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerUp);
		return () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
		};
	}, [camera.zoom, pushHistory, updateCanvasNodeLayout]);

	const openCanvasContextMenuAt = useCallback(
		(clientX: number, clientY: number) => {
			const world = resolveWorldPoint(clientX, clientY);
			setContextMenuState({
				open: true,
				scope: "canvas",
				x: clientX,
				y: clientY,
				worldX: world.x,
				worldY: world.y,
			});
		},
		[resolveWorldPoint],
	);

	const handleCanvasContextMenu = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			if (isCanvasInteractionLocked) return;
			openCanvasContextMenuAt(event.clientX, event.clientY);
		},
		[isCanvasInteractionLocked, openCanvasContextMenuAt],
	);

	const closeContextMenu = useCallback(() => {
		setContextMenuState({ open: false });
	}, []);

	const handleNodeHitLayerContextMenu = useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			event.preventDefault();
			event.stopPropagation();
			if (isCanvasInteractionLocked) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			const node = getTopHitNode(world.x, world.y);
			if (!node) {
				openCanvasContextMenuAt(event.clientX, event.clientY);
				return;
			}
			if (!currentProject) {
				openCanvasContextMenuAt(event.clientX, event.clientY);
				return;
			}
			const definition = getCanvasNodeDefinition(node.type);
			if (!definition.contextMenu) {
				openCanvasContextMenuAt(event.clientX, event.clientY);
				return;
			}
			const nodeActions = definition.contextMenu({
				node,
				project: currentProject,
				sceneOptions: contextMenuSceneOptions,
				onInsertNodeToScene: (sceneId) => {
					insertImageNodeToScene(node, sceneId);
				},
			});
			if (nodeActions.length === 0) {
				openCanvasContextMenuAt(event.clientX, event.clientY);
				return;
			}
			setContextMenuState({
				open: true,
				scope: "node",
				x: event.clientX,
				y: event.clientY,
				actions: toTimelineContextMenuActions(nodeActions),
			});
		},
		[
			contextMenuSceneOptions,
			currentProject,
			getTopHitNode,
			insertImageNodeToScene,
			isCanvasInteractionLocked,
			openCanvasContextMenuAt,
			resolveWorldPoint,
		],
	);

	const handleCreateTextNodeAt = useCallback(
		(worldX: number, worldY: number) => {
			const textNodeDefinition = getCanvasNodeDefinition("text");
			const nodeId = createCanvasNode({
				...textNodeDefinition.create(),
				x: worldX,
				y: worldY,
			});
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const node = latestProject.canvas.nodes.find(
				(item) => item.id === nodeId,
			);
			if (!node) return;
			pushHistory({
				kind: "canvas.node-create",
				node,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
		},
		[createCanvasNode, pushHistory],
	);

	const handleCanvasDrop = useCallback(
		async (event: React.DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			if (!currentProjectId || !currentProject) return;
			const files = resolveDroppedFiles(event.dataTransfer);
			if (files.length === 0) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			const activeSceneTimeline =
				(activeSceneId
					? currentProject.scenes[activeSceneId]?.timeline
					: undefined) ?? Object.values(currentProject.scenes)[0]?.timeline;
			const fps = activeSceneTimeline?.fps ?? 30;

			const resolveExternalFileUri = async (
				file: File,
				kind: "video" | "audio" | "image",
			): Promise<string> => {
				if (kind === "video") {
					return resolveExternalVideoUri(file, currentProjectId);
				}
				if (isElectronEnv()) {
					const filePath = getFilePath(file) ?? getElectronFilePath(file);
					if (!filePath) {
						throw new Error("无法读取本地文件路径");
					}
					return buildFileUrlFromPath(filePath);
				}
				if (kind === "audio") {
					const { uri } = await writeAudioToOpfs(file, currentProjectId);
					return uri;
				}
				const { uri } = await writeProjectFileToOpfs(
					file,
					currentProjectId,
					"images",
				);
				return uri;
			};

			const nodeInputs: Array<{
				input: Parameters<typeof createCanvasNode>[0];
				index: number;
			}> = [];

			for (const [index, file] of files.entries()) {
				let resolvedInput: Parameters<typeof createCanvasNode>[0] | null = null;
				for (const definition of canvasNodeDefinitionList) {
					if (!definition.fromExternalFile) continue;
					const matched = await definition.fromExternalFile(file, {
						projectId: currentProjectId,
						fps,
						ensureProjectAssetByUri,
						resolveExternalFileUri,
					});
					if (!matched) continue;
					resolvedInput = matched;
					break;
				}
				if (!resolvedInput) continue;
				nodeInputs.push({ input: resolvedInput, index });
			}

			for (const item of nodeInputs) {
				const column = item.index % DROP_GRID_COLUMNS;
				const row = Math.floor(item.index / DROP_GRID_COLUMNS);
				const nodeId = createCanvasNode({
					...item.input,
					x: world.x + column * DROP_GRID_OFFSET_X,
					y: world.y + row * DROP_GRID_OFFSET_Y,
				});
				const latestProject = useProjectStore.getState().currentProject;
				if (!latestProject) continue;
				const node = latestProject.canvas.nodes.find(
					(candidate) => candidate.id === nodeId,
				);
				if (!node) continue;
				if (node.type === "scene") continue;
				pushHistory({
					kind: "canvas.node-create",
					node,
					focusNodeId: latestProject.ui.focusedNodeId,
				});
			}
		},
		[
			activeSceneId,
			createCanvasNode,
			currentProject,
			currentProjectId,
			ensureProjectAssetByUri,
			pushHistory,
			resolveWorldPoint,
		],
	);

	const handleCloseDrawer = useCallback(() => {
		if (focusedNodeId) {
			setFocusedNode(null);
			return;
		}
		if (activeNodeId) {
			setActiveNode(null);
		}
	}, [activeNodeId, focusedNodeId, setActiveNode, setFocusedNode]);

	if (!currentProject) {
		return (
			<div className="flex h-full w-full items-center justify-center">
				Loading...
			</div>
		);
	}

	const gridSizePx = Math.max(20, GRID_SIZE * camera.zoom);
	const gridOffsetX = (camera.x * camera.zoom) % gridSizePx;
	const gridOffsetY = (camera.y * camera.zoom) % gridSizePx;

	const contextMenuActions = useMemo<TimelineContextMenuAction[]>(() => {
		if (!contextMenuState.open) return [];
		if (contextMenuState.scope === "node") {
			return contextMenuState.actions;
		}
		if (focusedNodeId) return [];
		return [
			{
				key: "new-text-node",
				label: "新建文本节点",
				onSelect: () => {
					handleCreateTextNodeAt(
						contextMenuState.worldX,
						contextMenuState.worldY,
					);
				},
			},
		];
	}, [contextMenuState, focusedNodeId, handleCreateTextNodeAt]);

	const DrawerComponent = resolvedDrawer?.Drawer;
	const toolbarLeftOffset = sidebarExpanded
		? overlayLayout.cameraSafeInsets.left + 4
		: 56;
	const toolbarTopOffset = overlayLayout.cameraSafeInsets.top + 4;
	const expandButtonOffsetX = overlayLayout.sidebarRect.x + 4;
	const expandButtonOffsetY = overlayLayout.sidebarRect.y + 4;
	const drawerBottomOffset = Math.max(
		0,
		stageSize.height -
			(overlayLayout.drawerRect.y + overlayLayout.drawerRect.height),
	);

	return (
		<div
			ref={containerRef}
			data-testid="canvas-workspace"
			role="application"
			className="relative h-full w-full overflow-hidden"
			onContextMenu={handleCanvasContextMenu}
			onDragOver={(event) => {
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
			}}
			onDrop={handleCanvasDrop}
		>
			<div
				className="pointer-events-none absolute inset-0"
				style={{
					backgroundImage:
						"linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
					backgroundSize: `${gridSizePx}px ${gridSizePx}px`,
					backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
				}}
			/>

			<InfiniteSkiaCanvas
				width={stageSize.width}
				height={stageSize.height}
				camera={camera}
				nodes={sortedNodes}
				scenes={currentProject.scenes}
				assets={currentProject.assets}
				activeNodeId={activeNodeId}
				focusedNodeId={focusedNodeId}
				onNodePointerDown={handleSkiaNodePointerDown}
				onNodeClick={handleSkiaNodeClick}
				onNodeDoubleClick={handleSkiaNodeDoubleClick}
			/>

			<button
				type="button"
				data-testid="canvas-node-hit-layer"
				aria-label="画布节点命中层"
				className="absolute inset-0 z-20 border-0 bg-transparent p-0"
				onPointerDown={handleNodeHitLayerPointerDown}
				onDoubleClick={handleNodeHitLayerDoubleClick}
				onContextMenu={handleNodeHitLayerContextMenu}
			/>

			{activeNode && ActiveNodeToolbar && (
				<div className="absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-xl border border-white/10 bg-black/65 px-3 py-2 backdrop-blur">
					<ActiveNodeToolbar
						node={activeNode}
						scene={activeNodeScene}
						asset={activeNodeAsset}
						updateNode={(patch) => {
							updateCanvasNode(activeNode.id, patch as never);
						}}
						setFocusedNode={setFocusedNode}
						setActiveScene={setActiveScene}
					/>
				</div>
			)}

				{!focusedNodeId && (
					<div
						className="absolute z-30 flex items-center gap-2 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white backdrop-blur"
						style={{ left: toolbarLeftOffset, top: toolbarTopOffset }}
					>
						<button
							type="button"
							onClick={handleCreateScene}
							className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 hover:bg-white/20"
						>
							<Plus className="size-3" />
							<span>新建 Scene</span>
						</button>
						<button
							type="button"
							onClick={() => handleZoomByStep(1.1)}
							className="rounded bg-white/10 p-1 hover:bg-white/20"
							aria-label="放大"
						>
							<Search className="size-3" />
						</button>
						<button
							type="button"
							onClick={() => handleZoomByStep(0.9)}
							className="rounded bg-white/10 p-1 hover:bg-white/20"
							aria-label="缩小"
						>
							<SearchX className="size-3" />
						</button>
						<button
							type="button"
							onClick={handleResetView}
							className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
						>
							重置视图
						</button>
						<span className="text-white/70">
							{Math.round(camera.zoom * 100)}%
						</span>
					</div>
				)}

				{sidebarExpanded ? (
					<div
						data-testid="canvas-overlay-sidebar"
						className="pointer-events-none absolute z-50"
						style={{
							left: overlayLayout.sidebarRect.x,
							top: overlayLayout.sidebarRect.y,
							width: overlayLayout.sidebarRect.width,
							height: overlayLayout.sidebarRect.height,
						}}
					>
						<div
							className="pointer-events-auto h-full w-full"
							data-canvas-overlay-ui="true"
						>
							<CanvasSidebar
								mode={sidebarMode}
								nodes={sidebarNodes}
								activeNodeId={activeNodeId}
								activeTab={sidebarTab}
								onTabChange={setSidebarTab}
								onNodeSelect={handleSidebarNodeSelect}
								onCollapse={() => setSidebarExpanded(false)}
							/>
						</div>
					</div>
				) : (
					<button
						type="button"
						data-testid="canvas-sidebar-expand-button"
						aria-label="展开侧边栏"
						onClick={() => setSidebarExpanded(true)}
						className="absolute z-50 inline-flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-xs text-white ring-1 ring-white/20 hover:bg-black/70"
						style={{ left: expandButtonOffsetX, top: expandButtonOffsetY }}
					>
						<PanelLeftOpen className="size-3" />
						侧栏
					</button>
				)}

				{rightPanelShouldRender && activeNode && (
					<div
						data-testid="canvas-overlay-right-panel"
						className="pointer-events-none absolute z-50"
						style={{
							left: overlayLayout.rightPanelRect.x,
							top: overlayLayout.rightPanelRect.y,
							width: overlayLayout.rightPanelRect.width,
							height: overlayLayout.rightPanelRect.height,
						}}
					>
						<div
							className="pointer-events-auto h-full w-full"
							data-canvas-overlay-ui="true"
						>
							<CanvasActiveNodeMetaPanel
								node={activeNode}
								scene={activeNodeScene}
								asset={activeNodeAsset}
							/>
						</div>
					</div>
				)}

				{focusedSceneNode && (
					<FocusSceneKonvaLayer
						width={stageSize.width}
						height={stageSize.height}
						camera={camera}
						focusedNode={focusedSceneNode}
						sceneId={focusedSceneNode.sceneId}
					/>
				)}

				{resolvedDrawer && DrawerComponent && (
					<div
						data-testid="canvas-overlay-drawer"
						className="absolute z-40 pointer-events-auto"
						data-canvas-overlay-ui="true"
						style={{
							left: overlayLayout.drawerRect.x,
							bottom: drawerBottomOffset,
							width: overlayLayout.drawerRect.width,
						}}
					>
						<CanvasNodeDrawerShell
							key={drawerIdentity ?? undefined}
							defaultHeight={resolvedDrawer.options.defaultHeight}
							minHeight={resolvedDrawer.options.minHeight}
							maxHeightRatio={resolvedDrawer.options.maxHeightRatio}
							resizable={resolvedDrawer.options.resizable}
							onHeightChange={setVisibleDrawerHeight}
						>
							<DrawerComponent
								node={resolvedDrawer.node}
								scene={resolvedDrawer.scene}
								asset={resolvedDrawer.asset}
								onClose={handleCloseDrawer}
								onHeightChange={setVisibleDrawerHeight}
							/>
						</CanvasNodeDrawerShell>
					</div>
				)}

			<TimelineContextMenu
				open={contextMenuState.open}
				x={contextMenuState.open ? contextMenuState.x : 0}
				y={contextMenuState.open ? contextMenuState.y : 0}
				actions={contextMenuActions}
				onClose={closeContextMenu}
			/>
		</div>
	);
};

export default CanvasWorkspace;
