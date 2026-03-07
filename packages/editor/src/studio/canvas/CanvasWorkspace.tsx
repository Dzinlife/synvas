import { resolveTimelineEndFrame } from "core/editor/utils/timelineEndFrame";
import type { TimelineElement } from "core/element/types";
import type { CanvasNode } from "core/studio/types";
import type React from "react";
import {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { writeAudioToOpfs } from "@/asr/opfsAudio";
import { createTransformMeta } from "@/element/transform";
import { writeProjectFileToOpfs } from "@/lib/projectOpfsStorage";
import { useProjectStore } from "@/projects/projectStore";
import type { TimelineContextMenuAction } from "@/scene-editor/components/TimelineContextMenu";
import { EditorRuntimeContext } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import { findAttachments } from "@/scene-editor/utils/attachments";
import { resolveExternalVideoUri } from "@/scene-editor/utils/externalVideo";
import { finalizeTimelineElements } from "@/scene-editor/utils/mainTrackMagnet";
import { buildTimelineMeta } from "@/scene-editor/utils/timelineTime";
import { CANVAS_NODE_DRAWER_DEFAULT_HEIGHT } from "@/studio/canvas/CanvasNodeDrawerShell";
import { isCanvasNodeFocusable } from "@/studio/canvas/node-system/focus";
import {
	canvasNodeDefinitionList,
	getCanvasNodeDefinition,
} from "@/studio/canvas/node-system/registry";
import type {
	CanvasNodeDrawerProps,
	CanvasNodeDrawerTrigger,
	CanvasNodeResizeConstraints,
} from "@/studio/canvas/node-system/types";
import type { CanvasSidebarTab } from "@/studio/canvas/sidebar/CanvasSidebar";
import {
	type CanvasNodeLayoutSnapshot,
	useStudioHistoryStore,
} from "@/studio/history/studioHistoryStore";
import { wouldCreateSceneCompositionCycle } from "@/studio/scene/sceneComposition";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { secondsToFrames } from "@/utils/timecode";
import CanvasWorkspaceOverlay, {
	type DrawerViewData,
} from "./CanvasWorkspaceOverlay";
import {
	CANVAS_OVERLAY_RIGHT_PANEL_WIDTH_PX,
	CANVAS_OVERLAY_SIDEBAR_WIDTH_PX,
	resolveCanvasOverlayLayout,
} from "./canvasOverlayLayout";
import {
	buildNodeFitCamera,
	buildNodePanCamera,
	CAMERA_ZOOM_EPSILON,
	type CameraState,
	clampZoom,
	DEFAULT_CAMERA,
	DROP_GRID_COLUMNS,
	DROP_GRID_OFFSET_X,
	DROP_GRID_OFFSET_Y,
	isCameraAlmostEqual,
	isCanvasSurfaceTarget,
	isLayoutEqual,
	isOverlayWheelTarget,
	isWorldPointInNode,
	pickLayout,
	type ResolvedCanvasDrawerOptions,
	resolveDrawerOptions,
	resolveDroppedFiles,
	resolveExternalFileUri,
	SIDEBAR_VIEW_PADDING_PX,
	toTimelineContextMenuActions,
} from "./canvasWorkspaceUtils";
import type {
	CanvasNodeDragEvent,
	CanvasNodeResizeAnchor,
} from "./InfiniteSkiaCanvas";
import InfiniteSkiaCanvas from "./InfiniteSkiaCanvas";
import { useCanvasCameraController } from "./useCanvasCameraController";

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

interface NodeDragSession {
	nodeId: string;
	startNodeX: number;
	startNodeY: number;
	before: CanvasNodeLayoutSnapshot;
	moved: boolean;
}

interface ResolvedCanvasNodeResizeConstraints {
	lockAspectRatio: boolean;
	aspectRatio: number | null;
	minWidth: number | null;
	minHeight: number | null;
	maxWidth: number | null;
	maxHeight: number | null;
}

interface NodeResizeSession {
	nodeId: string;
	anchor: CanvasNodeResizeAnchor;
	startNodeX: number;
	startNodeY: number;
	startNodeWidth: number;
	startNodeHeight: number;
	fixedCornerX: number;
	fixedCornerY: number;
	before: CanvasNodeLayoutSnapshot;
	moved: boolean;
	constraints: ResolvedCanvasNodeResizeConstraints;
}

const resolvePositiveNumber = (value: unknown): number | null => {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	if (value <= 0) return null;
	return value;
};

const clampSize = (
	value: number,
	minValue: number,
	maxValue?: number,
): number => {
	if (!Number.isFinite(value)) return minValue;
	if (!Number.isFinite(minValue)) return value;
	if (maxValue !== undefined && Number.isFinite(maxValue)) {
		if (maxValue < minValue) return minValue;
		return Math.min(Math.max(value, minValue), maxValue);
	}
	return Math.max(value, minValue);
};

type AnyCanvasDrawer = React.FC<CanvasNodeDrawerProps<CanvasNode>>;

interface ResolvedNodeDrawer extends DrawerViewData {
	trigger: CanvasNodeDrawerTrigger;
}

interface ResolvedNodeDrawerTarget {
	Drawer: AnyCanvasDrawer;
	node: CanvasNode;
	trigger: CanvasNodeDrawerTrigger;
	options: ResolvedCanvasDrawerOptions;
}

const CanvasWorkspace = () => {
	const currentProject = useProjectStore((state) => state.currentProject);
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const createCanvasNode = useProjectStore((state) => state.createCanvasNode);
	const updateCanvasNodeLayout = useProjectStore(
		(state) => state.updateCanvasNodeLayout,
	);
	const ensureProjectAssetByUri = useProjectStore(
		(state) => state.ensureProjectAssetByUri,
	);
	const updateProjectAssetMeta = useProjectStore(
		(state) => state.updateProjectAssetMeta,
	);
	const updateSceneTimeline = useProjectStore(
		(state) => state.updateSceneTimeline,
	);
	const setFocusedNode = useProjectStore((state) => state.setFocusedNode);
	const setActiveScene = useProjectStore((state) => state.setActiveScene);
	const setActiveNode = useProjectStore((state) => state.setActiveNode);
	const setCanvasCamera = useProjectStore((state) => state.setCanvasCamera);
	const pushHistory = useStudioHistoryStore((state) => state.push);
	const runtime = useContext(EditorRuntimeContext);
	const runtimeManager = useMemo<StudioRuntimeManager | null>(() => {
		const manager = runtime as Partial<StudioRuntimeManager> | null;
		if (!manager?.getTimelineRuntime || !manager.listTimelineRuntimes) {
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
	const [isCameraAnimating, setIsCameraAnimating] = useState(false);
	const [contextMenuState, setContextMenuState] =
		useState<CanvasContextMenuState>({ open: false });
	const containerRef = useRef<HTMLDivElement | null>(null);
	const preFocusCameraRef = useRef<CameraState | null>(null);
	const prevFocusedNodeIdRef = useRef<string | null>(focusedNodeId);
	const nodeDragSessionRef = useRef<NodeDragSession | null>(null);
	const nodeResizeSessionRef = useRef<NodeResizeSession | null>(null);
	const suppressNextNodeClickRef = useRef(false);
	const { getCamera, applyCamera } = useCanvasCameraController({
		camera,
		onChange: setCanvasCamera,
		onAnimationStateChange: setIsCameraAnimating,
	});

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

	const insertNodeToScene = useCallback(
		(node: CanvasNode, sceneId: string) => {
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
				if (node.type !== "image" || !node.assetId) return elements;
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

			const appendCompositionElement = (
				elements: TimelineElement[],
				fps: number,
				rippleEditingEnabled: boolean,
				autoAttach: boolean,
			): TimelineElement[] => {
				if (node.type !== "scene") return elements;
				const sourceScene = latestProject.scenes[node.sceneId];
				if (!sourceScene) return elements;
				if (
					wouldCreateSceneCompositionCycle(
						latestProject,
						sceneId,
						sourceScene.id,
					)
				) {
					return elements;
				}
				const sourceRuntime = runtimeManager?.getTimelineRuntime(
					toSceneTimelineRef(sourceScene.id),
				);
				const sourceTimelineState = sourceRuntime?.timelineStore.getState();
				const sourceElements =
					sourceTimelineState?.elements ?? sourceScene.timeline.elements;
				const sourceFps = Math.max(
					1,
					Math.round(
						sourceTimelineState?.fps ?? sourceScene.timeline.fps ?? fps,
					),
				);
				const sourceCanvasSize =
					sourceTimelineState?.canvasSize ?? sourceScene.timeline.canvas;
				const sourceDuration = resolveTimelineEndFrame(sourceElements);
				const durationBySource = Math.max(
					1,
					Math.round((sourceDuration / sourceFps) * fps),
				);
				const fallbackDuration = Math.max(1, secondsToFrames(5, fps));
				const duration =
					sourceDuration > 0 ? durationBySource : fallbackDuration;
				const start = resolveTimelineEndFrame(elements);
				const width = Math.max(
					1,
					Math.round(sourceCanvasSize.width || Math.abs(node.width) || 1),
				);
				const height = Math.max(
					1,
					Math.round(sourceCanvasSize.height || Math.abs(node.height) || 1),
				);
				const nextElement: TimelineElement = {
					id: `element-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					type: "Composition",
					component: "composition",
					name: sourceScene.name?.trim() || node.name || "Composition",
					props: {
						sceneId: sourceScene.id,
					},
					transform: createTransformMeta({
						width,
						height,
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

			const appendElement = (
				elements: TimelineElement[],
				fps: number,
				rippleEditingEnabled: boolean,
				autoAttach: boolean,
			): TimelineElement[] => {
				if (node.type === "image") {
					return appendImageElement(
						elements,
						fps,
						rippleEditingEnabled,
						autoAttach,
					);
				}
				if (node.type === "scene") {
					return appendCompositionElement(
						elements,
						fps,
						rippleEditingEnabled,
						autoAttach,
					);
				}
				return elements;
			};

			if (runtimeManager) {
				const timelineRuntime = runtimeManager.getTimelineRuntime(
					toSceneTimelineRef(sceneId),
				);
				if (timelineRuntime) {
					const timelineState = timelineRuntime.timelineStore.getState();
					timelineState.setElements((prev) => {
						return appendElement(
							prev,
							timelineState.fps,
							timelineState.rippleEditingEnabled,
							timelineState.autoAttach,
						);
					});
					return;
				}
			}

			const nextElements = appendElement(
				targetScene.timeline.elements,
				targetScene.timeline.fps,
				targetScene.timeline.settings.rippleEditingEnabled,
				targetScene.timeline.settings.autoAttach,
			);
			if (nextElements === targetScene.timeline.elements) return;
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

	const isSidebarFocusMode = focusedNode?.type === "scene";
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
		const prevFocusedNodeId = prevFocusedNodeIdRef.current;
		const currentCamera = getCamera();
		if (!prevFocusedNodeId && focusedNodeId) {
			preFocusCameraRef.current = currentCamera;
		}
		if (prevFocusedNodeId && !focusedNodeId) {
			const previous = preFocusCameraRef.current;
			preFocusCameraRef.current = null;
			// 退出 focus 时总是尝试恢复，避免在首帧前退出导致旧 focus 动画继续到终点。
			if (previous) {
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

	const resolveNodeResizeConstraints = useCallback(
		(node: CanvasNode): ResolvedCanvasNodeResizeConstraints => {
			const definition = getCanvasNodeDefinition(node.type);
			const scene =
				node.type === "scene"
					? (currentProject?.scenes[node.sceneId] ?? null)
					: null;
			const asset =
				"assetId" in node
					? (currentProject?.assets.find((item) => item.id === node.assetId) ??
						null)
					: null;
			const constraints: CanvasNodeResizeConstraints =
				definition.resolveResizeConstraints?.({
					node,
					scene,
					asset,
				}) ?? {};
			const minWidth = resolvePositiveNumber(constraints.minWidth);
			const minHeight = resolvePositiveNumber(constraints.minHeight);
			const maxWidth = resolvePositiveNumber(constraints.maxWidth);
			const maxHeight = resolvePositiveNumber(constraints.maxHeight);
			const fallbackAspectRatio = resolvePositiveNumber(
				node.width / Math.max(node.height, CAMERA_ZOOM_EPSILON),
			);
			const requestedAspectRatio = resolvePositiveNumber(
				constraints.aspectRatio,
			);
			const lockAspectRatio =
				constraints.lockAspectRatio === true &&
				(requestedAspectRatio !== null || fallbackAspectRatio !== null);

			return {
				lockAspectRatio,
				aspectRatio: lockAspectRatio
					? (requestedAspectRatio ?? fallbackAspectRatio)
					: null,
				minWidth,
				minHeight,
				maxWidth,
				maxHeight,
			};
		},
		[currentProject],
	);

	const handleSkiaNodeResizeStart = useCallback(
		(
			node: CanvasNode,
			anchor: CanvasNodeResizeAnchor,
			event: CanvasNodeDragEvent,
		) => {
			if (event.button !== 0) return;
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			if (node.locked) {
				handleNodeActivate(node);
				return;
			}
			nodeDragSessionRef.current = null;
			suppressNextNodeClickRef.current = false;
			setActiveNode(node.id);
			nodeResizeSessionRef.current = {
				nodeId: node.id,
				anchor,
				startNodeX: node.x,
				startNodeY: node.y,
				startNodeWidth: node.width,
				startNodeHeight: node.height,
				fixedCornerX: anchor === "bottom-right" ? node.x : node.x + node.width,
				fixedCornerY: anchor === "bottom-right" ? node.y : node.y + node.height,
				before: pickLayout(node),
				moved: false,
				constraints: resolveNodeResizeConstraints(node),
			};
		},
		[
			focusedNodeId,
			handleNodeActivate,
			isCanvasInteractionLocked,
			resolveNodeResizeConstraints,
			setActiveNode,
		],
	);

	const handleSkiaNodeResize = useCallback(
		(
			node: CanvasNode,
			anchor: CanvasNodeResizeAnchor,
			event: CanvasNodeDragEvent,
		) => {
			const resizeSession = nodeResizeSessionRef.current;
			if (!resizeSession) return;
			if (resizeSession.nodeId !== node.id) return;
			if (resizeSession.anchor !== anchor) return;

			const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
			const deltaX = event.movementX / safeZoom;
			const deltaY = event.movementY / safeZoom;
			if (Math.abs(deltaX) + Math.abs(deltaY) < 1e-9) return;

			const draftWidth =
				anchor === "bottom-right"
					? resizeSession.startNodeWidth + deltaX
					: resizeSession.startNodeWidth - deltaX;
			const draftHeight =
				anchor === "bottom-right"
					? resizeSession.startNodeHeight + deltaY
					: resizeSession.startNodeHeight - deltaY;
			const globalMinSize = 32 / safeZoom;
			const minWidth = Math.max(
				globalMinSize,
				resizeSession.constraints.minWidth ?? 0,
			);
			const minHeight = Math.max(
				globalMinSize,
				resizeSession.constraints.minHeight ?? 0,
			);
			const maxWidth = resizeSession.constraints.maxWidth ?? undefined;
			const maxHeight = resizeSession.constraints.maxHeight ?? undefined;

			let nextWidth: number;
			let nextHeight: number;
			if (
				resizeSession.constraints.lockAspectRatio &&
				resizeSession.constraints.aspectRatio
			) {
				const aspectRatio = resizeSession.constraints.aspectRatio;
				const scaleX =
					draftWidth /
					Math.max(resizeSession.startNodeWidth, CAMERA_ZOOM_EPSILON);
				const scaleY =
					draftHeight /
					Math.max(resizeSession.startNodeHeight, CAMERA_ZOOM_EPSILON);
				let scale = (scaleX + scaleY) / 2;
				if (!Number.isFinite(scale) || scale <= 0) {
					scale =
						minWidth /
						Math.max(resizeSession.startNodeWidth, CAMERA_ZOOM_EPSILON);
				}
				const minWidthByHeight = minHeight * aspectRatio;
				const minWidthWithAspect = Math.max(minWidth, minWidthByHeight);
				const maxWidthByHeight =
					maxHeight !== undefined ? maxHeight * aspectRatio : undefined;
				const maxWidthWithAspect =
					maxWidthByHeight !== undefined
						? maxWidth !== undefined
							? Math.min(maxWidth, maxWidthByHeight)
							: maxWidthByHeight
						: maxWidth;
				nextWidth = clampSize(
					resizeSession.startNodeWidth * scale,
					minWidthWithAspect,
					maxWidthWithAspect,
				);
				nextHeight = nextWidth / aspectRatio;
			} else {
				nextWidth = clampSize(draftWidth, minWidth, maxWidth);
				nextHeight = clampSize(draftHeight, minHeight, maxHeight);
			}

			const nextX =
				anchor === "bottom-right"
					? resizeSession.fixedCornerX
					: resizeSession.fixedCornerX - nextWidth;
			const nextY =
				anchor === "bottom-right"
					? resizeSession.fixedCornerY
					: resizeSession.fixedCornerY - nextHeight;
			const didLayoutChange =
				Math.abs(nextX - resizeSession.startNodeX) > 1e-6 ||
				Math.abs(nextY - resizeSession.startNodeY) > 1e-6 ||
				Math.abs(nextWidth - resizeSession.startNodeWidth) > 1e-6 ||
				Math.abs(nextHeight - resizeSession.startNodeHeight) > 1e-6;

			resizeSession.moved = resizeSession.moved || didLayoutChange;
			updateCanvasNodeLayout(resizeSession.nodeId, {
				x: nextX,
				y: nextY,
				width: nextWidth,
				height: nextHeight,
			});
		},
		[camera.zoom, updateCanvasNodeLayout],
	);

	const handleSkiaNodeResizeEnd = useCallback(
		(node: CanvasNode, anchor: CanvasNodeResizeAnchor) => {
			const resizeSession = nodeResizeSessionRef.current;
			nodeResizeSessionRef.current = null;
			if (!resizeSession) return;
			if (resizeSession.nodeId !== node.id) return;
			if (resizeSession.anchor !== anchor) return;
			if (!resizeSession.moved) return;
			suppressNextNodeClickRef.current = true;
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const latestNode = latestProject.canvas.nodes.find(
				(item) => item.id === resizeSession.nodeId,
			);
			if (!latestNode) return;
			const after = pickLayout(latestNode);
			if (isLayoutEqual(resizeSession.before, after)) return;
			pushHistory({
				kind: "canvas.node-layout",
				nodeId: latestNode.id,
				before: resizeSession.before,
				after,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
		},
		[pushHistory],
	);

	const handleSkiaNodeDragStart = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (nodeResizeSessionRef.current) return;
			if (event.button !== 0) return;
			suppressNextNodeClickRef.current = false;
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			if (node.locked) {
				handleNodeActivate(node);
				return;
			}
			setActiveNode(node.id);
			nodeDragSessionRef.current = {
				nodeId: node.id,
				startNodeX: node.x,
				startNodeY: node.y,
				before: pickLayout(node),
				moved: false,
			};
		},
		[
			focusedNodeId,
			handleNodeActivate,
			isCanvasInteractionLocked,
			setActiveNode,
		],
	);

	const handleSkiaNodeDrag = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (nodeResizeSessionRef.current) return;
			const dragSession = nodeDragSessionRef.current;
			if (!dragSession) return;
			if (dragSession.nodeId !== node.id) return;
			const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
			const nextX = Math.round(
				dragSession.startNodeX + event.movementX / safeZoom,
			);
			const nextY = Math.round(
				dragSession.startNodeY + event.movementY / safeZoom,
			);
			dragSession.moved =
				dragSession.moved ||
				Math.abs(event.movementX) + Math.abs(event.movementY) > 2;
			updateCanvasNodeLayout(dragSession.nodeId, {
				x: nextX,
				y: nextY,
			});
		},
		[camera.zoom, updateCanvasNodeLayout],
	);

	const handleSkiaNodeDragEnd = useCallback(
		(node: CanvasNode) => {
			if (nodeResizeSessionRef.current) return;
			const dragSession = nodeDragSessionRef.current;
			nodeDragSessionRef.current = null;
			if (!dragSession) return;
			if (dragSession.nodeId !== node.id) return;
			if (!dragSession.moved) return;
			suppressNextNodeClickRef.current = true;
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const latestNode = latestProject.canvas.nodes.find(
				(item) => item.id === dragSession.nodeId,
			);
			if (!latestNode) return;
			const after = pickLayout(latestNode);
			if (isLayoutEqual(dragSession.before, after)) return;
			pushHistory({
				kind: "canvas.node-layout",
				nodeId: latestNode.id,
				before: dragSession.before,
				after,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
		},
		[pushHistory],
	);

	const handleSkiaNodeClick = useCallback(
		(node: CanvasNode) => {
			if (suppressNextNodeClickRef.current) {
				suppressNextNodeClickRef.current = false;
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
			if (isSidebarFocusMode) return;
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
			isSidebarFocusMode,
			stageSize.height,
			stageSize.width,
		],
	);

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

	const openNodeContextMenuAt = useCallback(
		(node: CanvasNode, clientX: number, clientY: number): boolean => {
			if (!currentProject) return false;
			const definition = getCanvasNodeDefinition(node.type);
			if (!definition.contextMenu) return false;
			const nodeActions = definition.contextMenu({
				node,
				project: currentProject,
				sceneOptions: contextMenuSceneOptions,
				onInsertNodeToScene: (sceneId) => {
					insertNodeToScene(node, sceneId);
				},
			});
			if (nodeActions.length === 0) return false;
			setContextMenuState({
				open: true,
				scope: "node",
				x: clientX,
				y: clientY,
				actions: toTimelineContextMenuActions(nodeActions),
			});
			return true;
		},
		[
			contextMenuSceneOptions,
			currentProject,
			insertNodeToScene,
			setContextMenuState,
		],
	);

	const handleCanvasClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if (suppressNextNodeClickRef.current) {
				suppressNextNodeClickRef.current = false;
				return;
			}
			if (!isCanvasSurfaceTarget(event.target)) return;
			if (isOverlayWheelTarget(event.target)) return;
			if (isCanvasInteractionLocked) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			const node = getTopHitNode(world.x, world.y);
			if (node) return;
			setActiveNode(null);
		},
		[
			getTopHitNode,
			isCanvasInteractionLocked,
			resolveWorldPoint,
			setActiveNode,
		],
	);

	const handleCanvasContextMenu = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if (!isCanvasSurfaceTarget(event.target)) return;
			if (isOverlayWheelTarget(event.target)) return;
			event.preventDefault();
			if (isCanvasInteractionLocked) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			const node = getTopHitNode(world.x, world.y);
			if (node && openNodeContextMenuAt(node, event.clientX, event.clientY)) {
				return;
			}
			openCanvasContextMenuAt(event.clientX, event.clientY);
		},
		[
			getTopHitNode,
			isCanvasInteractionLocked,
			openCanvasContextMenuAt,
			openNodeContextMenuAt,
			resolveWorldPoint,
		],
	);

	const closeContextMenu = useCallback(() => {
		setContextMenuState({ open: false });
	}, []);

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

			const resolveExternalFile = (
				file: File,
				kind: "video" | "audio" | "image",
			) => {
				return resolveExternalFileUri(
					file,
					kind,
					currentProjectId,
					resolveExternalVideoUri,
					writeAudioToOpfs,
					writeProjectFileToOpfs,
				);
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
						updateProjectAssetMeta,
						resolveExternalFileUri: resolveExternalFile,
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
			updateProjectAssetMeta,
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
			onClick={handleCanvasClick}
			onContextMenu={handleCanvasContextMenu}
			onDragOver={(event) => {
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
			}}
			onDrop={handleCanvasDrop}
		>
			<InfiniteSkiaCanvas
				width={stageSize.width}
				height={stageSize.height}
				camera={camera}
				nodes={sortedNodes}
				scenes={currentProject.scenes}
				assets={currentProject.assets}
				activeNodeId={activeNodeId}
				focusedNodeId={focusedNodeId}
				suspendHover={isCameraAnimating}
				onNodeDragStart={handleSkiaNodeDragStart}
				onNodeDrag={handleSkiaNodeDrag}
				onNodeDragEnd={handleSkiaNodeDragEnd}
				onNodeResizeStart={handleSkiaNodeResizeStart}
				onNodeResize={handleSkiaNodeResize}
				onNodeResizeEnd={handleSkiaNodeResizeEnd}
				onNodeClick={handleSkiaNodeClick}
				onNodeDoubleClick={handleSkiaNodeDoubleClick}
			/>

			<CanvasWorkspaceOverlay
				toolbarLeftOffset={toolbarLeftOffset}
				toolbarTopOffset={toolbarTopOffset}
				onCreateScene={handleCreateScene}
				onZoomIn={() => handleZoomByStep(1.1)}
				onZoomOut={() => handleZoomByStep(0.9)}
				onResetView={handleResetView}
				sidebarExpanded={sidebarExpanded}
				sidebarRect={overlayLayout.sidebarRect}
				expandButtonOffsetX={expandButtonOffsetX}
				expandButtonOffsetY={expandButtonOffsetY}
				sidebarTab={sidebarTab}
				onSidebarTabChange={setSidebarTab}
				onSidebarNodeSelect={handleSidebarNodeSelect}
				onCollapseSidebar={() => setSidebarExpanded(false)}
				onExpandSidebar={() => setSidebarExpanded(true)}
				rightPanelShouldRender={rightPanelShouldRender}
				rightPanelRect={overlayLayout.rightPanelRect}
				resolvedDrawer={resolvedDrawer}
				drawerIdentity={drawerIdentity}
				drawerRect={overlayLayout.drawerRect}
				drawerBottomOffset={drawerBottomOffset}
				onDrawerHeightChange={setVisibleDrawerHeight}
				onCloseDrawer={handleCloseDrawer}
				contextMenuOpen={contextMenuState.open}
				contextMenuX={contextMenuState.open ? contextMenuState.x : 0}
				contextMenuY={contextMenuState.open ? contextMenuState.y : 0}
				contextMenuActions={contextMenuActions}
				onCloseContextMenu={closeContextMenu}
			/>
		</div>
	);
};

export default CanvasWorkspace;
