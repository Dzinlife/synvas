import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TimelineContextMenuAction } from "@/scene-editor/components/TimelineContextMenu";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import { CANVAS_NODE_DRAWER_DEFAULT_HEIGHT } from "@/studio/canvas/CanvasNodeDrawerShell";
import { getCanvasNodeDefinition } from "@/node-system/registry";
import type { CanvasNodeResizeConstraints } from "@/node-system/types";
import {
	type CanvasNodeLayoutBatchEntry,
	type CanvasNodeLayoutPatch,
	useProjectStore,
} from "@/projects/projectStore";
import type { CanvasNodeLayoutSnapshot } from "@/studio/history/studioHistoryStore";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import { resolveDeletedSceneIdsToRetain } from "@/studio/scene/sceneComposition";
import type { CanvasNode, SceneNode } from "@/studio/project/types";
import {
	collectCanvasAncestorBoardIds,
	collectCanvasDescendantNodeIds,
	expandCanvasNodeIdsWithDescendants,
	isCanvasWorldRectFullyContained,
	resolveCanvasBoardExpandToFitPatches,
	resolveCanvasNodeWorldRect,
	resolveCanvasWorldRectFromPoints,
	resolveInnermostContainingBoardId,
	resolvePointerContainingBoardId,
} from "./canvasBoardUtils";
import {
	type CanvasBoardAutoLayoutPatch,
	collectCanvasAutoLayoutAncestorBoardIds,
	isCanvasBoardAutoLayoutNode,
	resolveCanvasBoardAutoLayoutCascadePatches,
	resolveCanvasBoardAutoLayoutInsertion,
} from "./canvasBoardAutoLayout";
import { useCanvasInteractionStore } from "./canvasInteractionStore";
import {
	resolveCanvasResizeAnchorAtRectWorldPoint,
	resolveCanvasResizeAnchorAtWorldPoint,
} from "./canvasResizeAnchor";
import {
	type CanvasSnapGuidesWorld,
	type CanvasSnapGuideValues,
	collectCanvasSnapGuideValues,
	EMPTY_CANVAS_SNAP_GUIDES_SCREEN,
	projectCanvasSnapGuidesToScreen,
	resolveCanvasRectSnap,
	resolveCanvasSnapThresholdWorld,
} from "./canvasSnapUtils";
import {
	compareCanvasSpatialHitPriority,
	compareCanvasSpatialPaintOrder,
} from "./canvasSpatialIndex";
import { isCanvasToolModeEnabled, type CanvasToolMode } from "./canvasToolMode";
import {
	buildNodeFitCamera,
	buildNodePanCamera,
	CAMERA_ZOOM_EPSILON,
	type CameraState,
	clampZoom,
	DEFAULT_CAMERA,
	isCameraAlmostEqual,
	isCanvasSurfaceTarget,
	isLayoutEqual,
	isOverlayWheelTarget,
	isWorldPointInBounds,
	isWorldPointInNode,
	pickLayout,
	resolveCanvasNodeBounds,
	SIDEBAR_VIEW_PADDING_PX,
	toTimelineContextMenuActions,
} from "./canvasWorkspaceUtils";
import {
	BOARD_AUTO_FIT_PADDING_WORLD,
	BOARD_AUTO_LAYOUT_ANIMATION_RESET_MS,
	BOARD_CREATE_MIN_SIZE_PX,
	type CanvasBasePointerSession,
	type CanvasBoardBodyHitMode,
	type CanvasGraphHistoryEntry,
	type CanvasMarqueeRect,
	type CanvasMarqueeSession,
	type CanvasPointerTapMeta,
	type CanvasTapRecord,
	CANVAS_MARQUEE_ACTIVATION_PX,
	CANVAS_ORTHOGONAL_DRAG_LOCK_THRESHOLD_PX,
	DOUBLE_TAP_MAX_DELAY_MS,
	DOUBLE_TAP_MAX_DISTANCE_PX,
	EMPTY_STRING_ARRAY,
	ENABLE_CANVAS_SPATIAL_INDEX_VALIDATION,
	FOCUS_EXIT_MIN_ZOOM_RATIO,
	FOCUS_TILE_LOD_TRANSITION,
	type NodeDragSession,
	type PendingCameraCullUpdateKind,
	type PendingCanvasClickSuppression,
	type ResolvedCanvasNodeResizeConstraints,
	type SmoothCameraApplyOptions,
	TAP_MOVE_THRESHOLD_PX,
	appendCanvasAutoLayoutRowsByBoardId,
	applyResizeSnapDeltaToBox,
	areNodeIdsEqual,
	buildCameraByWorldCenter,
	canBoardBodyReceivePointHit,
	clampSize,
	getPrimarySelectedNodeId,
	isBottomResizeAnchor,
	isEditableKeyboardTarget,
	isNodeIntersectRect,
	isRightResizeAnchor,
	normalizeSelectedNodeIds,
	removeCanvasAutoLayoutRowNodeIds,
	resolveCameraCenterWorld,
	resolveCanvasAutoLayoutFrozenNodeIds,
	resolveCanvasAutoLayoutFrozenNodeIdsForResize,
	resolveCanvasAutoLayoutRowsByBoardId,
	resolveCanvasLayoutHistoryEntries,
	resolveCanvasResizeCursor,
	resolveCanvasSelectionResizeFrozenNodeIds,
	resolveConstrainedResizeLayout,
	resolvePositiveNumber,
	resolveTopHitNodeByLinearScan,
	selectCornerResizeSnap,
	toggleSelectedNodeIds,
	warnCanvasSpatialIndexMismatch,
} from "./canvasWorkspaceModel";
import type {
	CanvasNodeDragEvent,
	CanvasNodeResizeAnchor,
	CanvasNodeResizeEvent,
	CanvasSelectionResizeEvent,
} from "./InfiniteSkiaCanvas";
import {
	allocateBatchInsertSiblingOrder,
	allocateInsertSiblingOrder,
	LAYER_ORDER_REBALANCE_STEP,
	resolveLayerSiblingCount,
	sortByTreePaintOrder,
} from "./layerOrderCoordinator";
import type { TileLodTransition } from "./tile";
import {
	TILE_MAX_TASKS_PER_TICK,
	TILE_MAX_TASKS_PER_TICK_DRAG,
} from "./tile/constants";
import { useCanvasBoardLayoutMode } from "./useCanvasBoardLayoutMode";
import { useCanvasExternalFileDrop } from "./useCanvasExternalFileDrop";
import type { useCanvasSceneGraph } from "./useCanvasSceneGraph";
import { useCanvasSceneTimelineInsertion } from "./useCanvasSceneTimelineInsertion";
import { useCanvasSidebarHandlers } from "./useCanvasSidebarHandlers";
import { useCanvasTimelineClipboardBridge } from "./useCanvasTimelineClipboardBridge";
import { useCanvasWorkspaceOverlayState } from "./useCanvasWorkspaceOverlayState";

type CanvasProject = NonNullable<
	ReturnType<typeof useProjectStore.getState>["currentProject"]
>;
type StoreRef<T> = { current: T };

const createStoreRef = <T>(
	getValue: () => T,
	setValue: (value: T) => void,
): StoreRef<T> => {
	return Object.defineProperty({} as StoreRef<T>, "current", {
		get: getValue,
		set: setValue,
	});
};

export interface UseCanvasInteractionControllerParams {
	currentProject: CanvasProject | null;
	currentProjectId: string | null;
	activeSceneId: string | null;
	activeNodeId: string | null;
	focusedNodeId: string | null;
	canvasSnapEnabled: boolean;
	isCanvasInteractionLocked: boolean;
	runtimeManager: StudioRuntimeManager | null;
	containerRef: RefObject<HTMLDivElement | null>;
	getCamera: () => CameraState;
	applyInstantCameraWithCullIntent: (
		nextCamera: CameraState,
		kind: Exclude<PendingCameraCullUpdateKind, "smooth">,
	) => void;
	applySmoothCameraWithCullLock: (
		nextCamera: CameraState,
		options?: SmoothCameraApplyOptions,
	) => void;
	tileLodTransition: TileLodTransition | null;
	sceneGraph: ReturnType<typeof useCanvasSceneGraph>;
}

export const useCanvasInteractionController = ({
	currentProject,
	currentProjectId,
	activeSceneId,
	activeNodeId,
	focusedNodeId,
	canvasSnapEnabled,
	isCanvasInteractionLocked,
	runtimeManager,
	containerRef,
	getCamera,
	applyInstantCameraWithCullIntent,
	applySmoothCameraWithCullLock,
	tileLodTransition,
	sceneGraph,
}: UseCanvasInteractionControllerParams) => {
	const createCanvasNode = useProjectStore((state) => state.createCanvasNode);
	const updateCanvasNodeLayout = useProjectStore(
		(state) => state.updateCanvasNodeLayout,
	);
	const updateCanvasNodeLayoutBatch = useProjectStore(
		(state) => state.updateCanvasNodeLayoutBatch,
	);
	const updateSceneTimeline = useProjectStore(
		(state) => state.updateSceneTimeline,
	);
	const setFocusedNode = useProjectStore((state) => state.setFocusedNode);
	const setActiveScene = useProjectStore((state) => state.setActiveScene);
	const setActiveNode = useProjectStore((state) => state.setActiveNode);
	const appendCanvasGraphBatch = useProjectStore(
		(state) => state.appendCanvasGraphBatch,
	);
	const removeCanvasGraphBatch = useProjectStore(
		(state) => state.removeCanvasGraphBatch,
	);
	const removeCanvasNodeForHistory = useProjectStore(
		(state) => state.removeCanvasNodeForHistory,
	);
	const removeSceneGraphForHistory = useProjectStore(
		(state) => state.removeSceneGraphForHistory,
	);
	const removeSceneNodeForHistory = useProjectStore(
		(state) => state.removeSceneNodeForHistory,
	);
	const pushHistory = useStudioHistoryStore((state) => state.push);
	const stageSize = useCanvasInteractionStore((state) => state.stageSize);
	const canvasToolMode = useCanvasInteractionStore(
		(state) => state.canvasToolMode,
	);
	const visibleDrawerHeight = useCanvasInteractionStore(
		(state) => state.visibleDrawerHeight,
	);
	const contextMenuState = useCanvasInteractionStore(
		(state) => state.contextMenuState,
	);
	const selectedNodeIds = useCanvasInteractionStore(
		(state) => state.selectedNodeIds,
	);
	const hoveredNodeId = useCanvasInteractionStore(
		(state) => state.hoveredNodeId,
	);
	const canvasResizeCursor = useCanvasInteractionStore(
		(state) => state.canvasResizeCursor,
	);
	const marqueeRect = useCanvasInteractionStore((state) => state.marqueeRect);
	const snapGuidesScreen = useCanvasInteractionStore(
		(state) => state.snapGuidesScreen,
	);
	const boardAutoLayoutIndicator = useCanvasInteractionStore(
		(state) => state.boardAutoLayoutIndicator,
	);
	const autoLayoutAnimatedNodeIds = useCanvasInteractionStore(
		(state) => state.autoLayoutAnimatedNodeIds,
	);
	const autoLayoutFrozenNodeIds = useCanvasInteractionStore(
		(state) => state.autoLayoutFrozenNodeIds,
	);
	const selectionResizeFrozenNodeIds = useCanvasInteractionStore(
		(state) => state.selectionResizeFrozenNodeIds,
	);
	const sidebarExpanded = useCanvasInteractionStore(
		(state) => state.sidebarExpanded,
	);
	const tileDebugEnabled = useCanvasInteractionStore(
		(state) => state.tileDebugEnabled,
	);
	const isTileTaskBoostActive = useCanvasInteractionStore(
		(state) => state.isTileTaskBoostActive,
	);
	const setStageSize = useCanvasInteractionStore((state) => state.setStageSize);
	const setCanvasToolMode = useCanvasInteractionStore(
		(state) => state.setCanvasToolMode,
	);
	const setVisibleDrawerHeight = useCanvasInteractionStore(
		(state) => state.setVisibleDrawerHeight,
	);
	const setContextMenuState = useCanvasInteractionStore(
		(state) => state.setContextMenuState,
	);
	const commitSelection = useCanvasInteractionStore(
		(state) => state.commitSelection,
	);
	const setSelectedNodeIds = useCanvasInteractionStore(
		(state) => state.setSelectedNodeIds,
	);
	const setHoveredNodeId = useCanvasInteractionStore(
		(state) => state.setHoveredNodeId,
	);
	const setCanvasResizeCursor = useCanvasInteractionStore(
		(state) => state.setCanvasResizeCursor,
	);
	const setMarqueeRect = useCanvasInteractionStore(
		(state) => state.setMarqueeRect,
	);
	const setSnapGuidesScreen = useCanvasInteractionStore(
		(state) => state.setSnapGuidesScreen,
	);
	const setBoardAutoLayoutIndicator = useCanvasInteractionStore(
		(state) => state.setBoardAutoLayoutIndicator,
	);
	const setAutoLayoutAnimatedNodeIds = useCanvasInteractionStore(
		(state) => state.setAutoLayoutAnimatedNodeIds,
	);
	const setAutoLayoutFrozenNodeIds = useCanvasInteractionStore(
		(state) => state.setAutoLayoutFrozenNodeIds,
	);
	const setSelectionResizeFrozenNodeIds = useCanvasInteractionStore(
		(state) => state.setSelectionResizeFrozenNodeIds,
	);
	const setSidebarExpanded = useCanvasInteractionStore(
		(state) => state.setSidebarExpanded,
	);
	const setTileDebugEnabled = useCanvasInteractionStore(
		(state) => state.setTileDebugEnabled,
	);
	const setIsTileTaskBoostActive = useCanvasInteractionStore(
		(state) => state.setIsTileTaskBoostActive,
	);
	const resetProjectScopedInteraction = useCanvasInteractionStore(
		(state) => state.resetProjectScopedInteraction,
	);
	const resetWorkspaceInteraction = useCanvasInteractionStore(
		(state) => state.resetWorkspaceInteraction,
	);
	const {
		compareCanvasNodeHitPriority,
		currentNodeIdSet,
		focusedNode,
		activeNode,
		labelHitTesterRef,
		nodeById,
		normalizedSelectedNodeIds,
		sortedNodes,
		spatialIndex,
	} = sceneGraph;
	const autoLayoutAnimationResetTimerRef = useRef<number | null>(null);
	const selectionResizeFrozenResetTimerRef = useRef<number | null>(null);
	const marqueeRectRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().marqueeRect,
				useCanvasInteractionStore.getState().setMarqueeRect,
			),
		[],
	);
	const preFocusCameraRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().focusRestore.preFocusCamera,
				(value: CameraState | null) =>
					useCanvasInteractionStore
						.getState()
						.setFocusRestore({ preFocusCamera: value }),
			),
		[],
	);
	const preFocusCameraCenterRef = useMemo(
		() =>
			createStoreRef(
				() =>
					useCanvasInteractionStore.getState().focusRestore
						.preFocusCameraCenter,
				(value: { x: number; y: number } | null) =>
					useCanvasInteractionStore
						.getState()
						.setFocusRestore({ preFocusCameraCenter: value }),
			),
		[],
	);
	const focusCameraZoomRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().focusRestore.focusCameraZoom,
				(value: number | null) =>
					useCanvasInteractionStore
						.getState()
						.setFocusRestore({ focusCameraZoom: value }),
			),
		[],
	);
	const prevFocusedNodeIdRef = useMemo(
		() =>
			createStoreRef(
				() =>
					useCanvasInteractionStore.getState().focusRestore.prevFocusedNodeId,
				(value: string | null) =>
					useCanvasInteractionStore
						.getState()
						.setFocusRestore({ prevFocusedNodeId: value }),
			),
		[],
	);
	const activeDrawerAutoPanNodeKeyRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().activeDrawerAutoPan.nodeKey,
				(value: string | null) =>
					useCanvasInteractionStore
						.getState()
						.setActiveDrawerAutoPan({ nodeKey: value }),
			),
		[],
	);
	const activeDrawerAutoPanSignatureRef = useMemo(
		() =>
			createStoreRef(
				() =>
					useCanvasInteractionStore.getState().activeDrawerAutoPan.signature,
				(value: string | null) =>
					useCanvasInteractionStore
						.getState()
						.setActiveDrawerAutoPan({ signature: value }),
			),
		[],
	);
	const nodeDragSessionRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().nodeDragSession,
				useCanvasInteractionStore.getState().setNodeDragSession,
			),
		[],
	);
	const nodeResizeSessionRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().nodeResizeSession,
				useCanvasInteractionStore.getState().setNodeResizeSession,
			),
		[],
	);
	const selectionResizeSessionRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().selectionResizeSession,
				useCanvasInteractionStore.getState().setSelectionResizeSession,
			),
		[],
	);
	const marqueeSessionRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().marqueeSession,
				useCanvasInteractionStore.getState().setMarqueeSession,
			),
		[],
	);
	const boardCreateSessionRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().boardCreateSession,
				useCanvasInteractionStore.getState().setBoardCreateSession,
			),
		[],
	);
	const pendingClickSuppressionRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().pendingClickSuppression,
				useCanvasInteractionStore.getState().setPendingClickSuppression,
			),
		[],
	);
	const pointerSessionRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().pointerSession,
				useCanvasInteractionStore.getState().setPointerSession,
			),
		[],
	);
	const lastTapRecordRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().lastTapRecord,
				useCanvasInteractionStore.getState().setLastTapRecord,
			),
		[],
	);
	const lastPointerClientRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().lastPointerClient,
				useCanvasInteractionStore.getState().setLastPointerClient,
			),
		[],
	);
	const lastCanvasPointerWorldRef = useMemo(
		() =>
			createStoreRef(
				() => useCanvasInteractionStore.getState().lastCanvasPointerWorld,
				useCanvasInteractionStore.getState().setLastCanvasPointerWorld,
			),
		[],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: 项目切换时重置交互状态，focusedNodeId 只需要读取当下快照。
	useEffect(() => {
		resetProjectScopedInteraction(
			useProjectStore.getState().currentProject?.ui.focusedNodeId ?? null,
		);
	}, [currentProjectId, resetProjectScopedInteraction]);

	useEffect(() => {
		return () => {
			resetWorkspaceInteraction();
		};
	}, [resetWorkspaceInteraction]);

	const selectedNodes = useMemo(() => {
		if (!currentProject || normalizedSelectedNodeIds.length === 0) return [];
		return normalizedSelectedNodeIds
			.map(
				(nodeId) =>
					currentProject.canvas.nodes.find((node) => node.id === nodeId) ??
					null,
			)
			.filter((node): node is CanvasNode => Boolean(node));
	}, [currentProject, normalizedSelectedNodeIds]);
	const selectedBounds = useMemo(() => {
		if (selectedNodes.length <= 1) return null;
		return resolveCanvasNodeBounds(selectedNodes);
	}, [selectedNodes]);
	const isSingleSelection = useMemo(() => {
		return (
			Boolean(activeNode) &&
			(selectedNodes.length === 0 ||
				(selectedNodes.length === 1 && selectedNodes[0]?.id === activeNode?.id))
		);
	}, [activeNode, selectedNodes]);

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

	const insertNodeToScene = useCanvasSceneTimelineInsertion({
		runtimeManager,
		updateSceneTimeline,
	});

	const isAutoLayoutAnimationActive = autoLayoutAnimatedNodeIds.length > 0;
	const tileMaxTasksPerTick =
		isTileTaskBoostActive || isAutoLayoutAnimationActive
			? TILE_MAX_TASKS_PER_TICK_DRAG
			: TILE_MAX_TASKS_PER_TICK;

	const {
		cameraSafeInsets,
		drawerDefaultHeight,
		drawerIdentity,
		dynamicMinZoom,
		isSidebarFocusMode,
		overlayLayout,
		resolvedDrawer,
		resolvedDrawerTarget,
		rightPanelShouldRender,
	} = useCanvasWorkspaceOverlayState({
		project: currentProject,
		focusedNode,
		activeNode,
		stageSize,
		sidebarExpanded,
		visibleDrawerHeight,
	});

	const resolveWorldPoint = useCallback(
		(clientX: number, clientY: number) => {
			const container = containerRef.current;
			if (!container) return { x: 0, y: 0 };
			const rect = container.getBoundingClientRect();
			const safeClientX = Number.isFinite(clientX) ? clientX : rect.left;
			const safeClientY = Number.isFinite(clientY) ? clientY : rect.top;
			const localX = safeClientX - rect.left;
			const localY = safeClientY - rect.top;
			const currentCamera = getCamera();
			const safeZoom = Math.max(currentCamera.zoom, CAMERA_ZOOM_EPSILON);
			return {
				x: localX / safeZoom - currentCamera.x,
				y: localY / safeZoom - currentCamera.y,
			};
		},
		[getCamera, containerRef.current],
	);
	const resolveLocalPoint = useCallback(
		(clientX: number, clientY: number) => {
			const container = containerRef.current;
			if (!container) return { x: 0, y: 0 };
			const rect = container.getBoundingClientRect();
			return {
				x: clientX - rect.left,
				y: clientY - rect.top,
			};
		},
		[containerRef.current],
	);
	const updateMarqueeRectState = useCallback(
		(nextRect: CanvasMarqueeRect) => {
			marqueeRectRef.current = nextRect;
			setMarqueeRect(nextRect);
		},
		[marqueeRectRef, setMarqueeRect],
	);
	const clearCanvasSnapGuides = useCallback(() => {
		setSnapGuidesScreen(EMPTY_CANVAS_SNAP_GUIDES_SCREEN);
	}, [setSnapGuidesScreen]);
	const clearBoardAutoLayoutIndicator = useCallback(() => {
		setBoardAutoLayoutIndicator(null);
	}, [setBoardAutoLayoutIndicator]);
	const clearSelectionResizeFrozenResetTimer = useCallback(() => {
		if (selectionResizeFrozenResetTimerRef.current === null) return;
		window.clearTimeout(selectionResizeFrozenResetTimerRef.current);
		selectionResizeFrozenResetTimerRef.current = null;
	}, []);
	const clearSelectionResizeFrozenNodeIds = useCallback(() => {
		clearSelectionResizeFrozenResetTimer();
		setSelectionResizeFrozenNodeIds([]);
	}, [clearSelectionResizeFrozenResetTimer, setSelectionResizeFrozenNodeIds]);
	const deferClearSelectionResizeFrozenNodeIds = useCallback(() => {
		clearSelectionResizeFrozenResetTimer();
		selectionResizeFrozenResetTimerRef.current = window.setTimeout(() => {
			selectionResizeFrozenResetTimerRef.current = null;
			setSelectionResizeFrozenNodeIds([]);
		}, BOARD_AUTO_LAYOUT_ANIMATION_RESET_MS);
	}, [clearSelectionResizeFrozenResetTimer, setSelectionResizeFrozenNodeIds]);
	const commitCanvasAutoLayoutEntries = useCallback(
		(
			entries: CanvasBoardAutoLayoutPatch[],
			options?: { frozenNodeIds?: string[] },
		) => {
			if (entries.length === 0) return;
			const animatedNodeIds = entries.map((entry) => entry.nodeId);
			setAutoLayoutAnimatedNodeIds(animatedNodeIds);
			setAutoLayoutFrozenNodeIds(options?.frozenNodeIds ?? []);
			updateCanvasNodeLayoutBatch(
				entries.map((entry) => ({
					nodeId: entry.nodeId,
					patch: entry.patch,
				})),
			);
			if (autoLayoutAnimationResetTimerRef.current !== null) {
				window.clearTimeout(autoLayoutAnimationResetTimerRef.current);
			}
			autoLayoutAnimationResetTimerRef.current = window.setTimeout(() => {
				autoLayoutAnimationResetTimerRef.current = null;
				setAutoLayoutAnimatedNodeIds([]);
				setAutoLayoutFrozenNodeIds([]);
			}, BOARD_AUTO_LAYOUT_ANIMATION_RESET_MS);
		},
		[
			updateCanvasNodeLayoutBatch,
			setAutoLayoutAnimatedNodeIds,
			setAutoLayoutFrozenNodeIds,
		],
	);
	const setCanvasSnapGuides = useCallback(
		(guidesWorld: CanvasSnapGuidesWorld) => {
			if (
				guidesWorld.vertical.length === 0 &&
				guidesWorld.horizontal.length === 0
			) {
				clearCanvasSnapGuides();
				return;
			}
			setSnapGuidesScreen(
				projectCanvasSnapGuidesToScreen(guidesWorld, getCamera()),
			);
		},
		[clearCanvasSnapGuides, getCamera, setSnapGuidesScreen],
	);
	const resolveCanvasGuideValues = useCallback(
		(excludeNodeIds: string[]): CanvasSnapGuideValues => {
			const latestProject =
				useProjectStore.getState().currentProject ?? currentProject;
			return collectCanvasSnapGuideValues({
				nodes: latestProject?.canvas.nodes ?? [],
				excludeNodeIds,
			});
		},
		[currentProject],
	);
	const clearCanvasMarquee = useCallback(() => {
		marqueeSessionRef.current = null;
		updateMarqueeRectState({
			visible: false,
			x1: marqueeRectRef.current.x1,
			y1: marqueeRectRef.current.y1,
			x2: marqueeRectRef.current.x2,
			y2: marqueeRectRef.current.y2,
		});
	}, [
		updateMarqueeRectState,
		marqueeRectRef.current.x1,
		marqueeRectRef.current.x2,
		marqueeRectRef.current.y1,
		marqueeRectRef.current.y2,
		marqueeSessionRef,
	]);
	const clearBoardCreatePreview = useCallback(() => {
		boardCreateSessionRef.current = null;
		updateMarqueeRectState({
			visible: false,
			x1: marqueeRectRef.current.x1,
			y1: marqueeRectRef.current.y1,
			x2: marqueeRectRef.current.x2,
			y2: marqueeRectRef.current.y2,
		});
	}, [
		updateMarqueeRectState,
		boardCreateSessionRef,
		marqueeRectRef.current.x1,
		marqueeRectRef.current.x2,
		marqueeRectRef.current.y1,
		marqueeRectRef.current.y2,
	]);
	const clearPendingClickSuppression = useCallback(() => {
		pendingClickSuppressionRef.current = null;
	}, [pendingClickSuppressionRef]);
	const setPendingClickSuppression = useCallback(
		(nextSuppression: PendingCanvasClickSuppression) => {
			pendingClickSuppressionRef.current = nextSuppression;
		},
		[pendingClickSuppressionRef],
	);
	const resolvePendingClickSuppression = useCallback(() => {
		const pendingSuppression = pendingClickSuppressionRef.current;
		if (!pendingSuppression) return null;
		clearPendingClickSuppression();
		// 只有没被新的 mousedown 打断时，才把它视为上一轮手势的尾随 click。
		return pendingSuppression;
	}, [clearPendingClickSuppression, pendingClickSuppressionRef.current]);
	const commitHoveredNodeId = useCallback(
		(nextNodeId: string | null) => {
			if (useCanvasInteractionStore.getState().hoveredNodeId === nextNodeId) {
				return;
			}
			setHoveredNodeId(nextNodeId);
		},
		[setHoveredNodeId],
	);
	const clearHoveredNode = useCallback(() => {
		commitHoveredNodeId(null);
	}, [commitHoveredNodeId]);
	const commitCanvasResizeCursor = useCallback(
		(nextCursor: "nwse-resize" | "nesw-resize" | null) => {
			if (
				useCanvasInteractionStore.getState().canvasResizeCursor === nextCursor
			) {
				return;
			}
			setCanvasResizeCursor(nextCursor);
		},
		[setCanvasResizeCursor],
	);
	const commitCanvasResizeCursorByAnchor = useCallback(
		(anchor: CanvasNodeResizeAnchor | null) => {
			commitCanvasResizeCursor(
				anchor ? resolveCanvasResizeCursor(anchor) : null,
			);
		},
		[commitCanvasResizeCursor],
	);
	const resolvePointerTapMeta = useCallback(
		(event: React.PointerEvent<HTMLDivElement>): CanvasPointerTapMeta => {
			return {
				target: event.target,
				clientX: event.clientX,
				clientY: event.clientY,
				button: event.button,
				buttons: event.buttons,
				shiftKey: event.shiftKey,
				altKey: event.altKey,
				metaKey: event.metaKey,
				ctrlKey: event.ctrlKey,
				pointerType: event.pointerType || "mouse",
				timestampMs:
					typeof event.timeStamp === "number" &&
					Number.isFinite(event.timeStamp)
						? event.timeStamp
						: performance.now(),
			};
		},
		[],
	);
	const isPointerTapWithinThreshold = useCallback(
		(session: CanvasBasePointerSession, clientX: number, clientY: number) => {
			return (
				Math.abs(clientX - session.startClientX) <= TAP_MOVE_THRESHOLD_PX &&
				Math.abs(clientY - session.startClientY) <= TAP_MOVE_THRESHOLD_PX
			);
		},
		[],
	);
	const isDoubleTapRecordMatch = useCallback(
		(previous: CanvasTapRecord | null, current: CanvasTapRecord) => {
			if (!previous) return false;
			if (previous.nodeId !== current.nodeId) return false;
			if (previous.pointerType !== current.pointerType) return false;
			const deltaTime = current.timestampMs - previous.timestampMs;
			if (deltaTime < 0 || deltaTime > DOUBLE_TAP_MAX_DELAY_MS) return false;
			const deltaX = current.clientX - previous.clientX;
			const deltaY = current.clientY - previous.clientY;
			return Math.hypot(deltaX, deltaY) <= DOUBLE_TAP_MAX_DISTANCE_PX;
		},
		[],
	);

	useEffect(() => {
		if (canvasSnapEnabled) return;
		clearCanvasSnapGuides();
	}, [canvasSnapEnabled, clearCanvasSnapGuides]);
	useEffect(() => {
		if (isCanvasInteractionLocked) {
			clearHoveredNode();
			commitCanvasResizeCursor(null);
		}
	}, [clearHoveredNode, commitCanvasResizeCursor, isCanvasInteractionLocked]);
	const resolveResizeAnchorAtWorldPoint = useCallback(
		(worldX: number, worldY: number) => {
			const currentZoom = getCamera().zoom;
			if (activeNode && !activeNode.locked && isSingleSelection) {
				const hitAnchor = resolveCanvasResizeAnchorAtWorldPoint({
					node: activeNode,
					worldX,
					worldY,
					cameraZoom: currentZoom,
				});
				if (hitAnchor) return hitAnchor;
			}
			if (
				selectedBounds &&
				selectedNodes.length > 1 &&
				selectedNodes.some((node) => !node.locked)
			) {
				const hitAnchor = resolveCanvasResizeAnchorAtRectWorldPoint({
					x: selectedBounds.left,
					y: selectedBounds.top,
					width: selectedBounds.width,
					height: selectedBounds.height,
					worldX,
					worldY,
					cameraZoom: currentZoom,
				});
				if (hitAnchor) return hitAnchor;
			}
			return null;
		},
		[getCamera, activeNode, isSingleSelection, selectedBounds, selectedNodes],
	);
	const isResizeAnchorHitAtWorldPoint = useCallback(
		(worldX: number, worldY: number) => {
			return resolveResizeAnchorAtWorldPoint(worldX, worldY) !== null;
		},
		[resolveResizeAnchorAtWorldPoint],
	);

	const normalizeSelectionByLatestProject = useCallback(
		(nextSelectedNodeIds: string[]) => {
			const latestProject =
				useProjectStore.getState().currentProject ?? currentProject;
			const latestNodeIdSet = new Set(
				latestProject?.canvas.nodes.map((node) => node.id) ?? [],
			);
			return {
				latestProject,
				normalized: normalizeSelectedNodeIds(
					nextSelectedNodeIds,
					latestNodeIdSet,
				),
			};
		},
		[currentProject],
	);

	const commitSelectedNodeIds = useCallback(
		(nextSelectedNodeIds: string[]) => {
			const { latestProject, normalized } =
				normalizeSelectionByLatestProject(nextSelectedNodeIds);
			const nextPrimaryNodeId = getPrimarySelectedNodeId(normalized);
			const primaryNode =
				nextPrimaryNodeId && latestProject
					? (latestProject.canvas.nodes.find(
							(node) => node.id === nextPrimaryNodeId,
						) ?? null)
					: null;
			commitSelection(normalized, {
				primaryNodeId: nextPrimaryNodeId,
				primarySceneId:
					primaryNode?.type === "scene" ? primaryNode.sceneId : null,
				onActiveNodeChange: setActiveNode,
				onActiveSceneChange: setActiveScene,
			});
		},
		[
			commitSelection,
			normalizeSelectionByLatestProject,
			setActiveNode,
			setActiveScene,
		],
	);

	const commitMarqueeSelectedNodeIds = useCallback(
		(nextSelectedNodeIds: string[], isFinalize = false) => {
			const { latestProject, normalized } =
				normalizeSelectionByLatestProject(nextSelectedNodeIds);
			if (
				isFinalize &&
				!latestProject?.ui.activeNodeId &&
				normalized.length === 1
			) {
				setActiveNode(normalized[0] ?? null);
				setSelectedNodeIds([]);
				return;
			}
			setSelectedNodeIds(normalized);
		},
		[normalizeSelectionByLatestProject, setActiveNode, setSelectedNodeIds],
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
	}, [containerRef.current, setStageSize]);

	useEffect(() => {
		if (focusedNodeId) {
			const nextSelected = currentNodeIdSet.has(focusedNodeId)
				? [focusedNodeId]
				: [];
			if (!areNodeIdsEqual(nextSelected, normalizedSelectedNodeIds)) {
				setSelectedNodeIds(nextSelected);
			}
			return;
		}
		const filteredSelected = normalizeSelectedNodeIds(
			selectedNodeIds,
			currentNodeIdSet,
		);
		if (!areNodeIdsEqual(filteredSelected, selectedNodeIds)) {
			setSelectedNodeIds(filteredSelected);
		}
	}, [
		currentNodeIdSet,
		focusedNodeId,
		normalizedSelectedNodeIds,
		selectedNodeIds,
		setSelectedNodeIds,
	]);

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
	}, [focusedNodeId, setVisibleDrawerHeight]);

	useEffect(() => {
		if (!drawerIdentity) return;
		setVisibleDrawerHeight(drawerDefaultHeight);
	}, [drawerDefaultHeight, drawerIdentity, setVisibleDrawerHeight]);

	useEffect(() => {
		const prevFocusedNodeId = prevFocusedNodeIdRef.current;
		const currentCamera = getCamera();
		if (!prevFocusedNodeId && focusedNodeId) {
			preFocusCameraRef.current = currentCamera;
			preFocusCameraCenterRef.current =
				stageSize.width > 0 && stageSize.height > 0
					? resolveCameraCenterWorld(
							currentCamera,
							stageSize.width,
							stageSize.height,
						)
					: null;
		}
		if (prevFocusedNodeId && !focusedNodeId) {
			const previous = preFocusCameraRef.current;
			const previousCenterWorld = preFocusCameraCenterRef.current;
			const focusZoom = focusCameraZoomRef.current;
			preFocusCameraRef.current = null;
			preFocusCameraCenterRef.current = null;
			focusCameraZoomRef.current = null;
			// 退出 focus 时总是尝试恢复，避免在首帧前退出导致旧 focus 动画继续到终点。
			if (previous) {
				let nextCamera = previous;
				let nextLodTransition: TileLodTransition = { mode: "freeze" };
				const focusZoomValue = focusZoom ?? Number.NaN;
				if (
					Number.isFinite(focusZoomValue) &&
					focusZoomValue > 0 &&
					previous.zoom > focusZoomValue * FOCUS_EXIT_MIN_ZOOM_RATIO
				) {
					const nextZoom = focusZoomValue * FOCUS_EXIT_MIN_ZOOM_RATIO;
					const worldCenter =
						previousCenterWorld ??
						(stageSize.width > 0 && stageSize.height > 0
							? resolveCameraCenterWorld(
									previous,
									stageSize.width,
									stageSize.height,
								)
							: null);
					nextCamera =
						worldCenter && stageSize.width > 0 && stageSize.height > 0
							? buildCameraByWorldCenter(
									worldCenter,
									nextZoom,
									stageSize.width,
									stageSize.height,
								)
							: {
									...previous,
									zoom: nextZoom,
								};
					nextLodTransition = {
						mode: "snap",
						zoom: nextZoom,
					};
				}
				if (!isCameraAlmostEqual(currentCamera, nextCamera)) {
					applySmoothCameraWithCullLock(nextCamera, {
						tileLodTransition: nextLodTransition,
						cameraStoreSync: "settle",
					});
				}
			}
		}
		prevFocusedNodeIdRef.current = focusedNodeId;
	}, [
		applySmoothCameraWithCullLock,
		focusedNodeId,
		getCamera,
		stageSize.height,
		stageSize.width,
		focusCameraZoomRef,
		preFocusCameraCenterRef,
		preFocusCameraRef,
		prevFocusedNodeIdRef,
	]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: getCamera 是 Effect Event，加入依赖会让 focus 动画反复触发。
	useEffect(() => {
		if (!focusedNodeId) return;
		if (!focusedNode) return;
		if (stageSize.width <= 0 || stageSize.height <= 0) return;
		const nextCamera = buildNodeFitCamera({
			node: focusedNode,
			stageWidth: stageSize.width,
			stageHeight: stageSize.height,
			safeInsets: cameraSafeInsets,
			minZoom: dynamicMinZoom,
		});
		focusCameraZoomRef.current = nextCamera.zoom;
		const currentCamera = getCamera();
		if (isCameraAlmostEqual(currentCamera, nextCamera)) return;
		applySmoothCameraWithCullLock(nextCamera, {
			tileLodTransition: { mode: "freeze" },
			cameraStoreSync: "settle",
		});
	}, [
		applySmoothCameraWithCullLock,
		cameraSafeInsets,
		dynamicMinZoom,
		focusedNode,
		focusedNodeId,
		stageSize.height,
		stageSize.width,
	]);

	useEffect(() => {
		if (!activeNode) {
			activeDrawerAutoPanNodeKeyRef.current = null;
			activeDrawerAutoPanSignatureRef.current = null;
			return;
		}
		const activeDrawerTarget = resolvedDrawerTarget;
		if (
			!activeDrawerTarget ||
			activeDrawerTarget.trigger !== "active" ||
			activeDrawerTarget.node.id !== activeNode.id
		) {
			activeDrawerAutoPanNodeKeyRef.current = null;
			activeDrawerAutoPanSignatureRef.current = null;
			return;
		}
		if (stageSize.width <= 0 || stageSize.height <= 0) return;
		const drawerKey = `${activeNode.id}:${activeDrawerTarget.trigger}`;
		const drawerSignature = `${drawerKey}:${cameraSafeInsets.bottom}`;
		if (activeDrawerAutoPanSignatureRef.current === drawerSignature) {
			return;
		}
		activeDrawerAutoPanSignatureRef.current = drawerSignature;
		const currentCamera = getCamera();
		const nextCamera = buildNodePanCamera({
			node: activeNode,
			camera: currentCamera,
			stageWidth: stageSize.width,
			stageHeight: stageSize.height,
			safeInsets: cameraSafeInsets,
			paddingPx: SIDEBAR_VIEW_PADDING_PX,
		});
		if (isCameraAlmostEqual(currentCamera, nextCamera)) return;
		if (activeDrawerAutoPanNodeKeyRef.current !== drawerKey) {
			activeDrawerAutoPanNodeKeyRef.current = drawerKey;
			applySmoothCameraWithCullLock(nextCamera);
			return;
		}
		applyInstantCameraWithCullIntent(nextCamera, "pan");
	}, [
		activeNode,
		applyInstantCameraWithCullIntent,
		applySmoothCameraWithCullLock,
		cameraSafeInsets,
		getCamera,
		resolvedDrawerTarget,
		stageSize.height,
		stageSize.width,
		activeDrawerAutoPanNodeKeyRef,
		activeDrawerAutoPanSignatureRef,
	]);

	const handleToolModeChange = useCallback(
		(mode: CanvasToolMode) => {
			if (!isCanvasToolModeEnabled(mode)) return;
			if (mode === canvasToolMode) return;
			if (pointerSessionRef.current?.gesture === "board-create") {
				pointerSessionRef.current = null;
			}
			clearBoardCreatePreview();
			clearCanvasMarquee();
			clearCanvasSnapGuides();
			setCanvasToolMode(mode);
		},
		[
			canvasToolMode,
			clearCanvasMarquee,
			clearCanvasSnapGuides,
			clearBoardCreatePreview,
			pointerSessionRef,
			setCanvasToolMode,
		],
	);

	useEffect(() => {
		if (canvasToolMode !== "move") {
			clearHoveredNode();
			commitCanvasResizeCursor(null);
		}
	}, [canvasToolMode, clearHoveredNode, commitCanvasResizeCursor]);

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

	const handleCreateHdrTestNode = useCallback(() => {
		const hdrTestNodeDefinition = getCanvasNodeDefinition("hdr-test");
		const input = hdrTestNodeDefinition.create();
		const width = input.width ?? 560;
		const height = input.height ?? 320;
		const center = resolveCameraCenterWorld(
			getCamera(),
			stageSize.width,
			stageSize.height,
		);
		const nodeId = createCanvasNode({
			...input,
			x: center.x - width / 2,
			y: center.y - height / 2,
		});
		const latestProject = useProjectStore.getState().currentProject;
		if (!latestProject) return;
		const node = latestProject.canvas.nodes.find((item) => item.id === nodeId);
		if (!node) return;
		pushHistory({
			kind: "canvas.node-create",
			node,
			focusNodeId: latestProject.ui.focusedNodeId,
		});
	}, [
		createCanvasNode,
		getCamera,
		pushHistory,
		stageSize.height,
		stageSize.width,
	]);

	const handleZoomByStep = useCallback(
		(multiplier: number) => {
			const currentCamera = getCamera();
			const nextZoom = clampZoom(currentCamera.zoom * multiplier, {
				minZoom: dynamicMinZoom,
			});
			if (nextZoom === currentCamera.zoom) return;
			const safeCurrentZoom = Math.max(currentCamera.zoom, CAMERA_ZOOM_EPSILON);
			const safeNextZoom = Math.max(nextZoom, CAMERA_ZOOM_EPSILON);
			const anchorX = stageSize.width > 0 ? stageSize.width / 2 : 0;
			const anchorY = stageSize.height > 0 ? stageSize.height / 2 : 0;
			const anchorWorldX = anchorX / safeCurrentZoom - currentCamera.x;
			const anchorWorldY = anchorY / safeCurrentZoom - currentCamera.y;
			applyInstantCameraWithCullIntent(
				{
					x: anchorX / safeNextZoom - anchorWorldX,
					y: anchorY / safeNextZoom - anchorWorldY,
					zoom: nextZoom,
				},
				"immediate",
			);
		},
		[
			applyInstantCameraWithCullIntent,
			dynamicMinZoom,
			getCamera,
			stageSize.height,
			stageSize.width,
		],
	);

	const handleResetView = useCallback(() => {
		applySmoothCameraWithCullLock(DEFAULT_CAMERA);
	}, [applySmoothCameraWithCullLock]);

	const handleContainerWheel = useCallback(
		(event: WheelEvent) => {
			if (isOverlayWheelTarget(event.target)) return;
			if (focusedNodeId) return;
			event.preventDefault();
			const currentCamera = getCamera();
			if (event.ctrlKey || event.metaKey) {
				const oldZoom = Math.max(currentCamera.zoom, CAMERA_ZOOM_EPSILON);
				const zoomDelta = event.deltaY > 0 ? 0.92 : 1.08;
				const nextZoom = clampZoom(oldZoom * zoomDelta, {
					minZoom: dynamicMinZoom,
				});
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
				applyInstantCameraWithCullIntent(
					{
						x: pointerX / safeNextZoom - worldPoint.x,
						y: pointerY / safeNextZoom - worldPoint.y,
						zoom: nextZoom,
					},
					"pan",
				);
				return;
			}
			const safeZoom = Math.max(currentCamera.zoom, CAMERA_ZOOM_EPSILON);
			applyInstantCameraWithCullIntent(
				{
					x: currentCamera.x - event.deltaX / safeZoom,
					y: currentCamera.y - event.deltaY / safeZoom,
					zoom: currentCamera.zoom,
				},
				"pan",
			);
		},
		[
			applyInstantCameraWithCullIntent,
			dynamicMinZoom,
			focusedNodeId,
			getCamera,
			containerRef.current,
		],
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
	}, [handleContainerWheel, containerRef.current]);

	const getTopHitNode = useCallback(
		(input: {
			worldX: number;
			worldY: number;
			localX: number;
			localY: number;
			liveCamera: CameraState;
			boardBodyHitMode?: CanvasBoardBodyHitMode;
		}): CanvasNode | null => {
			const {
				worldX,
				worldY,
				localX,
				localY,
				liveCamera,
				boardBodyHitMode = "include",
			} = input;
			const indexedHitNodes = [...spatialIndex.queryPoint(worldX, worldY)]
				.sort(compareCanvasSpatialHitPriority)
				.map((item) => nodeById.get(item.nodeId) ?? null)
				.filter((node): node is CanvasNode => Boolean(node))
				.filter((node) => {
					if (node.hidden) return false;
					const canInteractNode =
						!isCanvasInteractionLocked || node.id === focusedNodeId;
					if (!canInteractNode) return false;
					if (
						node.type === "board" &&
						!canBoardBodyReceivePointHit(
							node.id,
							boardBodyHitMode,
							normalizedSelectedNodeIds,
						)
					) {
						return false;
					}
					return isWorldPointInNode(node, worldX, worldY);
				})
				.sort(compareCanvasNodeHitPriority);
			const indexedTopHit = indexedHitNodes[0] ?? null;
			if (ENABLE_CANVAS_SPATIAL_INDEX_VALIDATION) {
				const legacyTopHit = resolveTopHitNodeByLinearScan(
					sortedNodes,
					worldX,
					worldY,
					isCanvasInteractionLocked,
					focusedNodeId,
					boardBodyHitMode,
					normalizedSelectedNodeIds,
				);
				warnCanvasSpatialIndexMismatch(
					"point-hit",
					legacyTopHit ? [legacyTopHit.id] : [],
					indexedTopHit ? [indexedTopHit.id] : [],
				);
			}
			const labelHitTester = labelHitTesterRef.current;
			if (!labelHitTester) return indexedTopHit;
			const labelHitNodeIds = labelHitTester.hitTest(
				localX,
				localY,
				liveCamera,
			);
			if (labelHitNodeIds.length <= 0) return indexedTopHit;
			const labelHitNodes = labelHitNodeIds
				.map((nodeId) => nodeById.get(nodeId) ?? null)
				.filter((node): node is CanvasNode => Boolean(node))
				.filter((node) => {
					if (node.hidden) return false;
					const canInteractNode =
						!isCanvasInteractionLocked || node.id === focusedNodeId;
					return canInteractNode;
				})
				.sort(compareCanvasNodeHitPriority);
			if (labelHitNodes.length <= 0) return indexedTopHit;
			const topBoardLabelHitNode =
				labelHitNodes.find((node) => node.type === "board") ?? null;
			if (topBoardLabelHitNode) {
				return topBoardLabelHitNode;
			}
			// label 与 body 命中并行参与，统一按现有优先级选 top。
			const mergedHitNodes = [...indexedHitNodes, ...labelHitNodes]
				.filter((node, index, list) => {
					return list.findIndex((item) => item.id === node.id) === index;
				})
				.sort(compareCanvasNodeHitPriority);
			return mergedHitNodes[0] ?? null;
		},
		[
			compareCanvasNodeHitPriority,
			focusedNodeId,
			isCanvasInteractionLocked,
			nodeById,
			normalizedSelectedNodeIds,
			spatialIndex,
			labelHitTesterRef.current,
			sortedNodes,
		],
	);

	const handleNodeActivate = useCallback(
		(node: CanvasNode) => {
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			commitSelectedNodeIds([node.id]);
		},
		[commitSelectedNodeIds, focusedNodeId, isCanvasInteractionLocked],
	);

	const handleToggleNodeSelection = useCallback(
		(node: CanvasNode) => {
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			commitSelectedNodeIds(
				toggleSelectedNodeIds(normalizedSelectedNodeIds, node.id),
			);
		},
		[
			commitSelectedNodeIds,
			focusedNodeId,
			isCanvasInteractionLocked,
			normalizedSelectedNodeIds,
		],
	);

	const collectIntersectedNodeIds = useCallback(
		(rect: CanvasMarqueeRect): string[] => {
			const currentCamera = getCamera();
			const safeZoom = Math.max(currentCamera.zoom, CAMERA_ZOOM_EPSILON);
			const left = Math.min(rect.x1, rect.x2) / safeZoom - currentCamera.x;
			const right = Math.max(rect.x1, rect.x2) / safeZoom - currentCamera.x;
			const top = Math.min(rect.y1, rect.y2) / safeZoom - currentCamera.y;
			const bottom = Math.max(rect.y1, rect.y2) / safeZoom - currentCamera.y;
			const queryRect = {
				left,
				right,
				top,
				bottom,
			};
			const indexedNodeIds: string[] = [];
			const seen = new Set<string>();
			const indexedItems = [...spatialIndex.queryRect(queryRect)].sort(
				compareCanvasSpatialPaintOrder,
			);
			for (const item of indexedItems) {
				const node = nodeById.get(item.nodeId);
				if (!node || node.hidden || seen.has(node.id)) continue;
				if (node.type === "board") continue;
				if (!isNodeIntersectRect(node, queryRect)) continue;
				seen.add(node.id);
				indexedNodeIds.push(node.id);
			}
			if (ENABLE_CANVAS_SPATIAL_INDEX_VALIDATION) {
				const legacyNodeIds = sortedNodes
					.filter((node) => node.type !== "board")
					.filter((node) =>
						isNodeIntersectRect(node, {
							left,
							right,
							top,
							bottom,
						}),
					)
					.map((node) => node.id);
				warnCanvasSpatialIndexMismatch(
					"marquee",
					legacyNodeIds,
					indexedNodeIds,
				);
			}
			return indexedNodeIds;
		},
		[getCamera, nodeById, spatialIndex, sortedNodes.filter],
	);

	const applyMarqueeSelection = useCallback(
		(
			rect: CanvasMarqueeRect,
			options?: {
				isFinalize?: boolean;
				marqueeSession?: CanvasMarqueeSession | null;
			},
		) => {
			const isFinalize = options?.isFinalize ?? false;
			const marqueeSession =
				options?.marqueeSession ?? marqueeSessionRef.current;
			if (!marqueeSession) return;
			const hitNodeIds = collectIntersectedNodeIds(rect);
			if (marqueeSession.additive) {
				let nextSelectedNodeIds = [...marqueeSession.initialSelectedNodeIds];
				for (const nodeId of hitNodeIds) {
					nextSelectedNodeIds = toggleSelectedNodeIds(
						nextSelectedNodeIds,
						nodeId,
					);
				}
				commitMarqueeSelectedNodeIds(nextSelectedNodeIds, isFinalize);
				return;
			}
			commitMarqueeSelectedNodeIds(hitNodeIds, isFinalize);
		},
		[
			collectIntersectedNodeIds,
			commitMarqueeSelectedNodeIds,
			marqueeSessionRef.current,
		],
	);
	const resolveExpandedNodeIdsWithDescendants = useCallback(
		(nodeIds: string[]): string[] => {
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject || nodeIds.length === 0) return [];
			return expandCanvasNodeIdsWithDescendants(
				latestProject.canvas.nodes,
				nodeIds,
			);
		},
		[],
	);

	const resolveBoardCreateReparentChanges = useCallback(
		(
			nodes: CanvasNode[],
			createdBoardId: string,
		): Array<{
			nodeId: string;
			beforeParentId: string | null;
			beforeSiblingOrder: number;
		}> => {
			const createdBoard = nodes.find(
				(node) => node.id === createdBoardId && node.type === "board",
			);
			if (!createdBoard) return [];
			const createdBoardRect = resolveCanvasNodeWorldRect(createdBoard);
			const reparentChanges: Array<{
				nodeId: string;
				beforeParentId: string | null;
				beforeSiblingOrder: number;
			}> = [];
			for (const node of nodes) {
				if (node.id === createdBoardId) continue;
				const nodeRect = resolveCanvasNodeWorldRect(node);
				if (!isCanvasWorldRectFullyContained(nodeRect, createdBoardRect)) {
					continue;
				}
				const targetParentId = resolveInnermostContainingBoardId(
					nodes,
					nodeRect,
					{
						excludeNodeIds: new Set([node.id]),
					},
				);
				if (targetParentId !== createdBoardId) continue;
				const beforeParentId = node.parentId ?? null;
				if (beforeParentId === createdBoardId) continue;
				reparentChanges.push({
					nodeId: node.id,
					beforeParentId,
					beforeSiblingOrder: node.siblingOrder,
				});
			}
			return reparentChanges;
		},
		[],
	);

	const commitBoardCreateFromSession = useCallback((): boolean => {
		const boardSession = boardCreateSessionRef.current;
		if (!boardSession) return false;
		const currentZoom = getCamera().zoom;
		const minWorldSize =
			BOARD_CREATE_MIN_SIZE_PX / Math.max(currentZoom, CAMERA_ZOOM_EPSILON);
		const boardRect = resolveCanvasWorldRectFromPoints(
			boardSession.startWorldX,
			boardSession.startWorldY,
			boardSession.currentWorldX,
			boardSession.currentWorldY,
		);
		if (boardRect.width < minWorldSize || boardRect.height < minWorldSize) {
			return false;
		}
		const latestProject = useProjectStore.getState().currentProject;
		if (!latestProject) return false;
		const boardParentId = resolveInnermostContainingBoardId(
			latestProject.canvas.nodes,
			boardRect,
		);
		const boardId = createCanvasNode({
			type: "board",
			x: boardRect.left,
			y: boardRect.top,
			width: boardRect.width,
			height: boardRect.height,
			parentId: boardParentId,
		});
		const projectAfterCreate = useProjectStore.getState().currentProject;
		if (!projectAfterCreate) return false;
		const createdBoard =
			projectAfterCreate.canvas.nodes.find(
				(node) => node.id === boardId && node.type === "board",
			) ?? null;
		if (!createdBoard) return false;
		const reparentChanges = resolveBoardCreateReparentChanges(
			projectAfterCreate.canvas.nodes,
			createdBoard.id,
		);
		let finalizedReparentChanges: Array<{
			nodeId: string;
			beforeParentId: string | null;
			afterParentId: string | null;
			beforeSiblingOrder: number;
			afterSiblingOrder: number;
		}> = [];
		if (reparentChanges.length > 0) {
			const beforeChangeByNodeId = new Map(
				reparentChanges.map((change) => [change.nodeId, change]),
			);
			let workingNodes = [...projectAfterCreate.canvas.nodes];
			const layoutPatchByNodeId = new Map<
				string,
				{ parentId?: string | null; siblingOrder?: number }
			>();
			const orderedChangeIds = sortByTreePaintOrder(
				reparentChanges
					.map((change) => {
						return (
							workingNodes.find((node) => node.id === change.nodeId) ?? null
						);
					})
					.filter((node): node is CanvasNode => Boolean(node)),
			).map((node) => node.id);
			for (const nodeId of orderedChangeIds) {
				const currentNode = workingNodes.find((node) => node.id === nodeId);
				if (!currentNode) continue;
				const siblingInsertIndex = resolveLayerSiblingCount(
					workingNodes,
					createdBoard.id,
					[nodeId],
				);
				const { siblingOrder, rebalancePatches } = allocateInsertSiblingOrder(
					workingNodes,
					{
						parentId: createdBoard.id,
						index: siblingInsertIndex,
						movingNodeIds: [nodeId],
					},
				);
				if (rebalancePatches.length > 0) {
					const rebalancePatchByNodeId = new Map(
						rebalancePatches.map((patch) => [patch.nodeId, patch.siblingOrder]),
					);
					workingNodes = workingNodes.map((node) => {
						const nextZIndex = rebalancePatchByNodeId.get(node.id);
						if (nextZIndex === undefined || nextZIndex === node.siblingOrder) {
							return node;
						}
						const nextPatch = layoutPatchByNodeId.get(node.id) ?? {};
						layoutPatchByNodeId.set(node.id, {
							...nextPatch,
							siblingOrder: nextZIndex,
						});
						return {
							...node,
							siblingOrder: nextZIndex,
						};
					});
				}
				workingNodes = workingNodes.map((node) => {
					if (node.id !== nodeId) return node;
					const nextPatch = layoutPatchByNodeId.get(node.id) ?? {};
					layoutPatchByNodeId.set(node.id, {
						...nextPatch,
						parentId: createdBoard.id,
						siblingOrder,
					});
					return {
						...node,
						parentId: createdBoard.id,
						siblingOrder,
					};
				});
			}
			const childZIndices = orderedChangeIds
				.map(
					(nodeId) =>
						workingNodes.find((node) => node.id === nodeId)?.siblingOrder,
				)
				.filter((siblingOrder): siblingOrder is number =>
					Number.isFinite(siblingOrder),
				);
			if (childZIndices.length > 0) {
				const boardNode = workingNodes.find(
					(node) => node.id === createdBoard.id,
				);
				const boardZIndex =
					boardNode?.siblingOrder ?? createdBoard.siblingOrder;
				const nextBoardZIndex =
					Math.min(...childZIndices) - LAYER_ORDER_REBALANCE_STEP;
				if (nextBoardZIndex !== boardZIndex) {
					workingNodes = workingNodes.map((node) => {
						if (node.id !== createdBoard.id) return node;
						const nextPatch = layoutPatchByNodeId.get(node.id) ?? {};
						layoutPatchByNodeId.set(node.id, {
							...nextPatch,
							siblingOrder: nextBoardZIndex,
						});
						return {
							...node,
							siblingOrder: nextBoardZIndex,
						};
					});
				}
			}
			if (layoutPatchByNodeId.size > 0) {
				updateCanvasNodeLayoutBatch(
					[...layoutPatchByNodeId.entries()].map(([nodeId, patch]) => ({
						nodeId,
						patch,
					})),
				);
			}
			finalizedReparentChanges = orderedChangeIds
				.map((nodeId) => {
					const before = beforeChangeByNodeId.get(nodeId);
					if (!before) return null;
					const afterNode =
						workingNodes.find((node) => node.id === nodeId) ?? null;
					if (!afterNode) return null;
					return {
						nodeId,
						beforeParentId: before.beforeParentId,
						afterParentId: afterNode.parentId ?? null,
						beforeSiblingOrder: before.beforeSiblingOrder,
						afterSiblingOrder: afterNode.siblingOrder,
					};
				})
				.filter(
					(
						change,
					): change is {
						nodeId: string;
						beforeParentId: string | null;
						afterParentId: string | null;
						beforeSiblingOrder: number;
						afterSiblingOrder: number;
					} => {
						if (!change) return false;
						return (
							change.beforeParentId !== change.afterParentId ||
							change.beforeSiblingOrder !== change.afterSiblingOrder
						);
					},
				);
		}
		const projectAfterReparent = useProjectStore.getState().currentProject;
		if (!projectAfterReparent) return false;
		const historyBoardNode =
			projectAfterReparent.canvas.nodes.find(
				(node) => node.id === createdBoard.id && node.type === "board",
			) ?? createdBoard;
		pushHistory({
			kind: "canvas.board-create",
			createdBoard: historyBoardNode,
			reparentChanges: finalizedReparentChanges,
			focusNodeId: projectAfterReparent.ui.focusedNodeId,
		});
		commitSelectedNodeIds([historyBoardNode.id]);
		return true;
	}, [
		commitSelectedNodeIds,
		createCanvasNode,
		getCamera,
		pushHistory,
		resolveBoardCreateReparentChanges,
		updateCanvasNodeLayoutBatch,
		boardCreateSessionRef.current,
	]);

	const resolveRootNodeIdsFromMovedSet = useCallback(
		(nodes: CanvasNode[], movedNodeIds: string[]): string[] => {
			const movedNodeIdSet = new Set(movedNodeIds);
			return movedNodeIds.filter((nodeId) => {
				const node = nodes.find((item) => item.id === nodeId);
				const parentId = node?.parentId ?? null;
				return !parentId || !movedNodeIdSet.has(parentId);
			});
		},
		[],
	);

	const resolvePointerBoardReparentEntries = useCallback(
		(
			nodes: CanvasNode[],
			movedNodeIds: string[],
			worldX: number,
			worldY: number,
		): CanvasNodeLayoutBatchEntry[] => {
			const rootNodeIds = resolveRootNodeIdsFromMovedSet(nodes, movedNodeIds);
			if (rootNodeIds.length === 0) return [];
			const orderedRootNodes = sortByTreePaintOrder(
				rootNodeIds
					.map((nodeId) => nodes.find((node) => node.id === nodeId) ?? null)
					.filter((node): node is CanvasNode => Boolean(node)),
			);
			if (orderedRootNodes.length === 0) return [];
			const orderedRootNodeIds = orderedRootNodes.map((node) => node.id);
			const movingRootNodeIdSet = new Set(orderedRootNodeIds);
			const excludedNodeIds = new Set<string>([
				...orderedRootNodeIds,
				...collectCanvasDescendantNodeIds(nodes, orderedRootNodeIds),
			]);
			const nextParentId = resolvePointerContainingBoardId(
				nodes,
				worldX,
				worldY,
				{
					excludeNodeIds: excludedNodeIds,
				},
			);
			const shouldReparent = orderedRootNodes.some(
				(node) => (node.parentId ?? null) !== nextParentId,
			);
			if (!shouldReparent) return [];
			const destinationIndex = resolveLayerSiblingCount(
				nodes,
				nextParentId,
				movingRootNodeIdSet,
			);
			const { assignments } = allocateBatchInsertSiblingOrder(nodes, {
				parentId: nextParentId,
				index: destinationIndex,
				nodeIds: orderedRootNodeIds,
				movingNodeIds: movingRootNodeIdSet,
			});
			const assignmentByNodeId = new Map(
				assignments.map((assignment) => [
					assignment.nodeId,
					assignment.siblingOrder,
				]),
			);
			const entries: CanvasNodeLayoutBatchEntry[] = [];
			for (const node of orderedRootNodes) {
				const patch: CanvasNodeLayoutPatch = {};
				if ((node.parentId ?? null) !== nextParentId) {
					patch.parentId = nextParentId;
				}
				const assignedSiblingOrder = assignmentByNodeId.get(node.id);
				if (
					assignedSiblingOrder !== undefined &&
					node.siblingOrder !== assignedSiblingOrder
				) {
					patch.siblingOrder = assignedSiblingOrder;
				}
				if (Object.keys(patch).length === 0) continue;
				entries.push({
					nodeId: node.id,
					patch,
				});
			}
			return entries;
		},
		[resolveRootNodeIdsFromMovedSet],
	);

	const resolveBoardAutoFitEntriesAfterDrag = useCallback(
		(
			nodes: CanvasNode[],
			movedNodeIds: string[],
		): CanvasNodeLayoutBatchEntry[] => {
			const rootNodeIds = resolveRootNodeIdsFromMovedSet(nodes, movedNodeIds);
			if (rootNodeIds.length === 0) return [];
			const boardIds = rootNodeIds.flatMap((nodeId) => {
				const node = nodes.find((item) => item.id === nodeId) ?? null;
				if (!node) return [];
				return collectCanvasAncestorBoardIds(nodes, node.parentId ?? null);
			});
			const freeBoardIds = boardIds.filter((boardId) => {
				const board = nodes.find((item) => item.id === boardId) ?? null;
				return !isCanvasBoardAutoLayoutNode(board);
			});
			if (freeBoardIds.length === 0) return [];
			return resolveCanvasBoardExpandToFitPatches(
				nodes,
				freeBoardIds,
				BOARD_AUTO_FIT_PADDING_WORLD,
			);
		},
		[resolveRootNodeIdsFromMovedSet],
	);
	const resolveAutoLayoutEntriesForChangedNodes = useCallback(
		(
			nodes: CanvasNode[],
			changedNodeIds: string[],
			options?: {
				rowsByBoardId?: Map<string, string[][]>;
				extraBoardIds?: string[];
			},
		): CanvasBoardAutoLayoutPatch[] => {
			const boardIds = [
				...(options?.extraBoardIds ?? []),
				...collectCanvasAutoLayoutAncestorBoardIds(nodes, changedNodeIds),
			];
			if (boardIds.length === 0) return [];
			return resolveCanvasBoardAutoLayoutCascadePatches(nodes, boardIds, {
				rowsByBoardId: options?.rowsByBoardId,
			});
		},
		[],
	);
	const commitAutoLayoutForBoardIds = useCallback(
		(boardIds: string[], beforeNodes?: CanvasNode[]) => {
			if (boardIds.length === 0) return;
			const projectBeforeLayout = useProjectStore.getState().currentProject;
			if (!projectBeforeLayout) return;
			const autoLayoutEntries = resolveCanvasBoardAutoLayoutCascadePatches(
				projectBeforeLayout.canvas.nodes,
				boardIds,
			);
			if (autoLayoutEntries.length === 0) return;
			const beforeNodeById = new Map(
				(beforeNodes ?? projectBeforeLayout.canvas.nodes).map((node) => [
					node.id,
					node,
				]),
			);
			const beforeByNodeId = new Map(
				autoLayoutEntries.map((entry) => {
					const node =
						beforeNodeById.get(entry.nodeId) ??
						projectBeforeLayout.canvas.nodes.find(
							(candidate) => candidate.id === entry.nodeId,
						) ??
						null;
					return [entry.nodeId, node ? pickLayout(node) : null] as const;
				}),
			);
			commitCanvasAutoLayoutEntries(autoLayoutEntries);
			const projectAfterLayout = useProjectStore.getState().currentProject;
			if (!projectAfterLayout) return;
			const historyEntries = autoLayoutEntries
				.map((entry) => {
					const before = beforeByNodeId.get(entry.nodeId);
					const afterNode =
						projectAfterLayout.canvas.nodes.find(
							(candidate) => candidate.id === entry.nodeId,
						) ?? null;
					if (!before || !afterNode) return null;
					const after = pickLayout(afterNode);
					if (isLayoutEqual(before, after)) return null;
					return {
						nodeId: entry.nodeId,
						before,
						after,
					};
				})
				.filter(
					(
						entry,
					): entry is {
						nodeId: string;
						before: CanvasNodeLayoutSnapshot;
						after: CanvasNodeLayoutSnapshot;
					} => Boolean(entry),
				);
			if (historyEntries.length === 0) return;
			pushHistory({
				kind: "canvas.node-layout.batch",
				entries: historyEntries,
				focusNodeId: projectAfterLayout.ui.focusedNodeId,
			});
		},
		[commitCanvasAutoLayoutEntries, pushHistory],
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

	const {
		buildCanvasCopyEntries,
		canPasteClipboardPayloadToCanvas,
		commitCanvasTimelineDrop,
		copyNodeIdsToClipboard,
		copySelectedNodesToClipboard,
		handleDropTimelineElementsToCanvas,
		handleRestoreSceneReferenceToCanvas,
		pasteFromClipboardToCanvasAt,
		resolveCanvasNodeTimelineDropTarget,
		resolveCanvasPasteWorldPoint,
		resolvePointerTimelineDropTarget,
		startCanvasTimelineDropPreview,
		stopCanvasTimelineDropPreview,
		updateCanvasTimelineDropPreview,
	} = useCanvasTimelineClipboardBridge({
		runtimeManager,
		normalizedSelectedNodeIds,
		containerRef,
		lastPointerClientRef,
		lastCanvasPointerWorldRef,
		getCamera,
		resolveWorldPoint,
		resolveExpandedNodeIdsWithDescendants,
		commitSelectedNodeIds,
		commitAutoLayoutForBoardIds,
		setContextMenuState,
	});

	const resetCanvasDragSession = useCallback(
		(dragSession: NodeDragSession) => {
			if (dragSession.copyEntries.length > 0) {
				removeCanvasGraphBatch(dragSession.copyEntries);
				for (const copyNodeId of dragSession.copyEntries.map(
					(entry) => entry.node.id,
				)) {
					delete dragSession.snapshots[copyNodeId];
				}
				dragSession.copyEntries = [];
				dragSession.copyMode = false;
			}
			const latestProject = useProjectStore.getState().currentProject;
			const rollbackEntries = (latestProject?.canvas.nodes ?? [])
				.map((node) => {
					const before = dragSession.layoutBeforeByNodeId[node.id];
					if (!before) return null;
					if (isLayoutEqual(pickLayout(node), before)) return null;
					return {
						nodeId: node.id,
						patch: before,
					};
				})
				.filter(
					(
						entry,
					): entry is {
						nodeId: string;
						patch: CanvasNodeLayoutSnapshot;
					} => Boolean(entry),
				);
			if (rollbackEntries.length > 0) {
				updateCanvasNodeLayoutBatch(rollbackEntries);
			}
			dragSession.activated = false;
			dragSession.moved = false;
			dragSession.axisLock = null;
			dragSession.autoLayoutInsertion = null;
			dragSession.guideValuesCache = null;
			setAutoLayoutFrozenNodeIds([]);
			clearCanvasSnapGuides();
			clearBoardAutoLayoutIndicator();
		},
		[
			clearBoardAutoLayoutIndicator,
			clearCanvasSnapGuides,
			removeCanvasGraphBatch,
			updateCanvasNodeLayoutBatch,
			setAutoLayoutFrozenNodeIds,
		],
	);

	const handleSkiaNodeResizeStart = useCallback(
		(
			node: CanvasNode,
			anchor: CanvasNodeResizeAnchor,
			event: CanvasNodeDragEvent,
		) => {
			if (event.button !== 0) return;
			if (normalizedSelectedNodeIds.length > 1) return;
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			commitCanvasResizeCursorByAnchor(anchor);
			clearCanvasMarquee();
			clearCanvasSnapGuides();
			clearHoveredNode();
			if (node.locked) {
				commitCanvasResizeCursor(null);
				handleNodeActivate(node);
				return;
			}
			nodeDragSessionRef.current = null;
			clearPendingClickSuppression();
			commitSelectedNodeIds([node.id]);
			const latestNodes =
				useProjectStore.getState().currentProject?.canvas.nodes ?? [];
			const autoLayoutBoardIds = collectCanvasAutoLayoutAncestorBoardIds(
				latestNodes,
				[node.id],
			);
			nodeResizeSessionRef.current = {
				nodeId: node.id,
				anchor,
				startNodeX: node.x,
				startNodeY: node.y,
				startNodeWidth: node.width,
				startNodeHeight: node.height,
				fixedCornerX:
					anchor === "top-right" || anchor === "bottom-right"
						? node.x
						: node.x + node.width,
				fixedCornerY:
					anchor === "bottom-left" || anchor === "bottom-right"
						? node.y
						: node.y + node.height,
				before: pickLayout(node),
				moved: false,
				constraints: resolveNodeResizeConstraints(node),
				guideValues: null,
				autoLayoutRowsByBoardId: resolveCanvasAutoLayoutRowsByBoardId(
					latestNodes,
					autoLayoutBoardIds,
				),
			};
		},
		[
			commitCanvasResizeCursor,
			commitCanvasResizeCursorByAnchor,
			clearPendingClickSuppression,
			clearCanvasMarquee,
			clearCanvasSnapGuides,
			clearHoveredNode,
			focusedNodeId,
			commitSelectedNodeIds,
			handleNodeActivate,
			isCanvasInteractionLocked,
			normalizedSelectedNodeIds.length,
			resolveNodeResizeConstraints,
			nodeDragSessionRef,
			nodeResizeSessionRef,
		],
	);

	const handleSkiaNodeResizeMove = useCallback(
		(
			node: CanvasNode,
			anchor: CanvasNodeResizeAnchor,
			event: CanvasNodeDragEvent,
		) => {
			const resizeSession = nodeResizeSessionRef.current;
			if (!resizeSession) return;
			if (resizeSession.nodeId !== node.id) return;
			if (resizeSession.anchor !== anchor) return;
			commitCanvasResizeCursorByAnchor(anchor);

			const currentZoom = getCamera().zoom;
			const safeZoom = Math.max(currentZoom, CAMERA_ZOOM_EPSILON);
			const deltaX = event.movementX / safeZoom;
			const deltaY = event.movementY / safeZoom;
			if (Math.abs(deltaX) + Math.abs(deltaY) < 1e-9) return;
			const isRightAnchor = isRightResizeAnchor(anchor);
			const isBottomAnchor = isBottomResizeAnchor(anchor);

			const draftWidth = isRightAnchor
				? resizeSession.startNodeWidth + deltaX
				: resizeSession.startNodeWidth - deltaX;
			const draftHeight = isBottomAnchor
				? resizeSession.startNodeHeight + deltaY
				: resizeSession.startNodeHeight - deltaY;
			const globalMinSize = 32 / safeZoom;
			let nextLayout = resolveConstrainedResizeLayout({
				anchor,
				fixedCornerX: resizeSession.fixedCornerX,
				fixedCornerY: resizeSession.fixedCornerY,
				startWidth: resizeSession.startNodeWidth,
				startHeight: resizeSession.startNodeHeight,
				draftWidth,
				draftHeight,
				constraints: resizeSession.constraints,
				globalMinSize,
			});
			if (canvasSnapEnabled) {
				if (!resizeSession.guideValues) {
					resizeSession.guideValues = resolveCanvasGuideValues([
						resizeSession.nodeId,
					]);
				}
				const guideValues = resizeSession.guideValues;
				const snapThreshold = resolveCanvasSnapThresholdWorld(currentZoom);
				const candidateBox = {
					x: nextLayout.x,
					y: nextLayout.y,
					width: nextLayout.width,
					height: nextLayout.height,
				};
				const snapResult = resolveCanvasRectSnap({
					guideValues,
					threshold: snapThreshold,
					movingX: [
						isRightAnchor
							? candidateBox.x + candidateBox.width
							: candidateBox.x,
					],
					movingY: [
						isBottomAnchor
							? candidateBox.y + candidateBox.height
							: candidateBox.y,
					],
				});
				const selectedSnap = selectCornerResizeSnap({
					deltaX: snapResult.deltaX,
					deltaY: snapResult.deltaY,
					guidesWorld: snapResult.guidesWorld,
					preferSingleAxis: resizeSession.constraints.lockAspectRatio,
				});
				if (selectedSnap.deltaX !== 0 || selectedSnap.deltaY !== 0) {
					const snappedBox = applyResizeSnapDeltaToBox(
						candidateBox,
						anchor,
						selectedSnap.deltaX,
						selectedSnap.deltaY,
					);
					nextLayout = resolveConstrainedResizeLayout({
						anchor,
						fixedCornerX: resizeSession.fixedCornerX,
						fixedCornerY: resizeSession.fixedCornerY,
						startWidth: resizeSession.startNodeWidth,
						startHeight: resizeSession.startNodeHeight,
						draftWidth: snappedBox.width,
						draftHeight: snappedBox.height,
						constraints: resizeSession.constraints,
						globalMinSize,
						preferredAxis:
							selectedSnap.deltaX !== 0
								? "x"
								: selectedSnap.deltaY !== 0
									? "y"
									: null,
					});
					setCanvasSnapGuides(selectedSnap.guidesWorld);
				} else {
					clearCanvasSnapGuides();
				}
			} else {
				clearCanvasSnapGuides();
			}
			const didLayoutChange =
				Math.abs(nextLayout.x - resizeSession.startNodeX) > 1e-6 ||
				Math.abs(nextLayout.y - resizeSession.startNodeY) > 1e-6 ||
				Math.abs(nextLayout.width - resizeSession.startNodeWidth) > 1e-6 ||
				Math.abs(nextLayout.height - resizeSession.startNodeHeight) > 1e-6;

			resizeSession.moved = resizeSession.moved || didLayoutChange;
			updateCanvasNodeLayout(resizeSession.nodeId, nextLayout);
		},
		[
			canvasSnapEnabled,
			clearCanvasSnapGuides,
			commitCanvasResizeCursorByAnchor,
			getCamera,
			resolveCanvasGuideValues,
			setCanvasSnapGuides,
			updateCanvasNodeLayout,
			nodeResizeSessionRef.current,
		],
	);

	const handleSkiaNodeResizeEnd = useCallback(
		(
			node: CanvasNode,
			anchor: CanvasNodeResizeAnchor,
			_event: CanvasNodeDragEvent,
		) => {
			const resizeSession = nodeResizeSessionRef.current;
			nodeResizeSessionRef.current = null;
			clearCanvasSnapGuides();
			const lastPointerWorld = lastCanvasPointerWorldRef.current;
			commitCanvasResizeCursorByAnchor(
				lastPointerWorld
					? resolveResizeAnchorAtWorldPoint(
							lastPointerWorld.x,
							lastPointerWorld.y,
						)
					: null,
			);
			if (!resizeSession) return;
			if (resizeSession.nodeId !== node.id) return;
			if (resizeSession.anchor !== anchor) return;
			if (!resizeSession.moved) return;
			let latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const projectBeforeAutoLayout = latestProject;
			const autoLayoutBoardIds = [
				...resizeSession.autoLayoutRowsByBoardId.keys(),
			];
			const autoLayoutEntries = resolveAutoLayoutEntriesForChangedNodes(
				latestProject.canvas.nodes,
				[resizeSession.nodeId],
				{
					rowsByBoardId: resizeSession.autoLayoutRowsByBoardId,
				},
			);
			if (autoLayoutEntries.length > 0) {
				commitCanvasAutoLayoutEntries(autoLayoutEntries, {
					frozenNodeIds: resolveCanvasAutoLayoutFrozenNodeIdsForResize(
						latestProject.canvas.nodes,
						autoLayoutBoardIds,
						[resizeSession.nodeId],
					),
				});
				latestProject = useProjectStore.getState().currentProject;
				if (!latestProject) return;
			}
			const beforeByNodeId = new Map<string, CanvasNodeLayoutSnapshot>([
				[resizeSession.nodeId, resizeSession.before],
			]);
			const beforeNodeById = new Map(
				projectBeforeAutoLayout.canvas.nodes.map((item) => [item.id, item]),
			);
			for (const entry of autoLayoutEntries) {
				if (beforeByNodeId.has(entry.nodeId)) continue;
				const beforeNode = beforeNodeById.get(entry.nodeId);
				if (!beforeNode) continue;
				beforeByNodeId.set(entry.nodeId, pickLayout(beforeNode));
			}
			const historyEntries = resolveCanvasLayoutHistoryEntries(
				beforeByNodeId,
				latestProject.canvas.nodes,
			);
			if (historyEntries.length === 0) return;
			if (historyEntries.length === 1) {
				const entry = historyEntries[0];
				pushHistory({
					kind: "canvas.node-layout",
					nodeId: entry.nodeId,
					before: entry.before,
					after: entry.after,
					focusNodeId: latestProject.ui.focusedNodeId,
				});
				return;
			}
			pushHistory({
				kind: "canvas.node-layout.batch",
				entries: historyEntries,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
		},
		[
			clearCanvasSnapGuides,
			commitCanvasAutoLayoutEntries,
			commitCanvasResizeCursorByAnchor,
			pushHistory,
			resolveAutoLayoutEntriesForChangedNodes,
			resolveResizeAnchorAtWorldPoint,
			lastCanvasPointerWorldRef.current,
			nodeResizeSessionRef,
		],
	);

	const handleSkiaNodeResize = useCallback(
		(resizeEvent: CanvasNodeResizeEvent) => {
			const { phase, node, anchor, event } = resizeEvent;
			if (phase === "start") {
				handleSkiaNodeResizeStart(node, anchor, event);
				return;
			}
			if (phase === "move") {
				handleSkiaNodeResizeMove(node, anchor, event);
				return;
			}
			handleSkiaNodeResizeEnd(node, anchor, event);
		},
		[
			handleSkiaNodeResizeEnd,
			handleSkiaNodeResizeMove,
			handleSkiaNodeResizeStart,
		],
	);

	const beginCanvasDragSession = useCallback(
		(input: {
			origin: "node" | "selection";
			anchorNodeId: string | null;
			pendingSelectedNodeIds: string[];
			copyMode: boolean;
		}) => {
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return false;
			const expandableBoardNodeIds = input.pendingSelectedNodeIds
				.map((nodeId) => {
					return (
						latestProject.canvas.nodes.find((node) => node.id === nodeId) ??
						null
					);
				})
				.filter((node): node is CanvasNode => Boolean(node))
				.filter((node) => node.type === "board" && !node.locked)
				.map((node) => node.id);
			const expandedNodeIds = new Set([
				...input.pendingSelectedNodeIds,
				...expandCanvasNodeIdsWithDescendants(
					latestProject.canvas.nodes,
					expandableBoardNodeIds,
				),
			]);
			const forcedNodeIds = collectCanvasDescendantNodeIds(
				latestProject.canvas.nodes,
				expandableBoardNodeIds,
			);
			const dragNodes = [...expandedNodeIds]
				.map(
					(nodeId) =>
						latestProject.canvas.nodes.find((item) => item.id === nodeId) ??
						null,
				)
				.filter((item): item is CanvasNode => Boolean(item))
				.filter((item) => !item.locked || forcedNodeIds.has(item.id));
			if (dragNodes.length === 0) return false;
			const initialBounds = resolveCanvasNodeBounds(dragNodes);
			if (!initialBounds) return false;
			const autoLayoutBoardIds = collectCanvasAutoLayoutAncestorBoardIds(
				latestProject.canvas.nodes,
				dragNodes.map((node) => node.id),
			);
			nodeDragSessionRef.current = {
				origin: input.origin,
				anchorNodeId: input.anchorNodeId,
				pendingSelectedNodeIds: input.pendingSelectedNodeIds,
				dragNodeIds: dragNodes.map((item) => item.id),
				initialBounds: {
					x: initialBounds.left,
					y: initialBounds.top,
					width: initialBounds.width,
					height: initialBounds.height,
				},
				snapshots: Object.fromEntries(
					dragNodes.map((dragNode) => [
						dragNode.id,
						{
							nodeId: dragNode.id,
							startNodeX: dragNode.x,
							startNodeY: dragNode.y,
							before: pickLayout(dragNode),
						},
					]),
				),
				layoutBeforeByNodeId: Object.fromEntries(
					latestProject.canvas.nodes.map((node) => [node.id, pickLayout(node)]),
				),
				copyEntries: [],
				activated: false,
				moved: false,
				axisLock: null,
				copyMode: input.copyMode,
				timelineDropMode: false,
				timelineDropTarget: null,
				autoLayoutInsertion: null,
				autoLayoutRowsByBoardId: resolveCanvasAutoLayoutRowsByBoardId(
					latestProject.canvas.nodes,
					autoLayoutBoardIds,
				),
				globalDragStarted: false,
				guideValuesCache: null,
			};
			return true;
		},
		[nodeDragSessionRef],
	);

	const applyCanvasDragEvent = useCallback(
		(event: CanvasNodeDragEvent) => {
			const dragSession = nodeDragSessionRef.current;
			if (!dragSession) return;
			const pointerX = Number.isFinite(event.clientX)
				? event.clientX
				: (lastPointerClientRef.current?.x ?? 0);
			const pointerY = Number.isFinite(event.clientY)
				? event.clientY
				: (lastPointerClientRef.current?.y ?? 0);
			if (dragSession.timelineDropMode) {
				const timelineDropTarget = resolveCanvasNodeTimelineDropTarget(
					dragSession,
					pointerX,
					pointerY,
				);
				if (timelineDropTarget?.zone === "timeline") {
					dragSession.timelineDropTarget = timelineDropTarget;
					updateCanvasTimelineDropPreview(
						pointerX,
						pointerY,
						timelineDropTarget,
					);
					return;
				}
				const pointerTarget =
					typeof document.elementFromPoint === "function"
						? document.elementFromPoint(pointerX, pointerY)
						: null;
				const isPointerOnCanvasSurface =
					isCanvasSurfaceTarget(pointerTarget) &&
					!isOverlayWheelTarget(pointerTarget);
				if (!isPointerOnCanvasSurface) {
					const resolvedDropTarget = {
						zone: "none",
						canDrop: false,
					} as const;
					dragSession.timelineDropTarget = resolvedDropTarget;
					updateCanvasTimelineDropPreview(
						pointerX,
						pointerY,
						resolvedDropTarget,
					);
					return;
				}
				stopCanvasTimelineDropPreview(dragSession);
				dragSession.timelineDropMode = false;
				dragSession.timelineDropTarget = null;
			}
			if (
				Math.abs(event.movementX) + Math.abs(event.movementY) <
				CANVAS_MARQUEE_ACTIVATION_PX
			) {
				return;
			}
			clearPendingClickSuppression();
			const timelineDropTarget = resolveCanvasNodeTimelineDropTarget(
				dragSession,
				pointerX,
				pointerY,
			);
			if (timelineDropTarget?.zone === "timeline") {
				resetCanvasDragSession(dragSession);
				dragSession.timelineDropMode = true;
				dragSession.timelineDropTarget = timelineDropTarget;
				startCanvasTimelineDropPreview(dragSession, pointerX, pointerY);
				updateCanvasTimelineDropPreview(pointerX, pointerY, timelineDropTarget);
				return;
			}
			if (!dragSession.activated) {
				dragSession.activated = true;
				if (dragSession.copyMode) {
					const copyEntries = buildCanvasCopyEntries(dragSession.dragNodeIds);
					if (copyEntries.length > 0) {
						appendCanvasGraphBatch(copyEntries);
						dragSession.copyEntries = copyEntries;
						for (const entry of copyEntries) {
							dragSession.snapshots[entry.node.id] = {
								nodeId: entry.node.id,
								startNodeX: entry.node.x,
								startNodeY: entry.node.y,
								before: pickLayout(entry.node),
							};
						}
					}
				}
			}
			const targetNodeIds =
				dragSession.copyEntries.length > 0
					? dragSession.copyEntries.map((entry) => entry.node.id)
					: dragSession.dragNodeIds;
			if (targetNodeIds.length === 0) return;
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const latestNodeById = new Map(
				latestProject.canvas.nodes.map((node) => [node.id, node]),
			);
			const initialRootTargetNodeIds = resolveRootNodeIdsFromMovedSet(
				latestProject.canvas.nodes,
				targetNodeIds,
			);
			const shouldDisableCanvasSnapForAutoLayoutDrag =
				initialRootTargetNodeIds.length > 0 &&
				initialRootTargetNodeIds.some((nodeId) => {
					const node = latestNodeById.get(nodeId) ?? null;
					const parent = node?.parentId
						? (latestNodeById.get(node.parentId) ?? null)
						: null;
					return isCanvasBoardAutoLayoutNode(parent);
				});
			const currentZoom = getCamera().zoom;
			const safeZoom = Math.max(currentZoom, CAMERA_ZOOM_EPSILON);
			let deltaX = event.movementX / safeZoom;
			let deltaY = event.movementY / safeZoom;
			if (
				dragSession.axisLock === null &&
				event.shiftKey &&
				(Math.abs(event.movementX) >=
					CANVAS_ORTHOGONAL_DRAG_LOCK_THRESHOLD_PX ||
					Math.abs(event.movementY) >= CANVAS_ORTHOGONAL_DRAG_LOCK_THRESHOLD_PX)
			) {
				dragSession.axisLock =
					Math.abs(event.movementX) >= Math.abs(event.movementY) ? "x" : "y";
			}
			if (dragSession.axisLock === "x") {
				deltaY = 0;
			}
			if (dragSession.axisLock === "y") {
				deltaX = 0;
			}
			if (canvasSnapEnabled && !shouldDisableCanvasSnapForAutoLayoutDrag) {
				const guideCacheKey = [...targetNodeIds].sort().join(",");
				if (
					!dragSession.guideValuesCache ||
					dragSession.guideValuesCache.key !== guideCacheKey
				) {
					dragSession.guideValuesCache = {
						key: guideCacheKey,
						values: resolveCanvasGuideValues(targetNodeIds),
					};
				}
				const guideValues = dragSession.guideValuesCache.values;
				const snapThreshold = resolveCanvasSnapThresholdWorld(currentZoom);
				const movingBox = {
					x: dragSession.initialBounds.x + deltaX,
					y: dragSession.initialBounds.y + deltaY,
					width: dragSession.initialBounds.width,
					height: dragSession.initialBounds.height,
				};
				const snapResult = resolveCanvasRectSnap({
					guideValues,
					threshold: snapThreshold,
					movingX:
						dragSession.axisLock === "y"
							? []
							: [
									movingBox.x,
									movingBox.x + movingBox.width / 2,
									movingBox.x + movingBox.width,
								],
					movingY:
						dragSession.axisLock === "x"
							? []
							: [
									movingBox.y,
									movingBox.y + movingBox.height / 2,
									movingBox.y + movingBox.height,
								],
				});
				deltaX += snapResult.deltaX;
				deltaY += snapResult.deltaY;
				setCanvasSnapGuides(snapResult.guidesWorld);
			} else {
				clearCanvasSnapGuides();
			}
			let didMove = false;
			let workingNodes = latestProject.canvas.nodes;
			const layoutEntryByNodeId = new Map<string, CanvasNodeLayoutPatch>();
			for (const targetNodeId of targetNodeIds) {
				const snapshot = dragSession.snapshots[targetNodeId];
				if (!snapshot) continue;
				const nextX = Math.round(snapshot.startNodeX + deltaX);
				const nextY = Math.round(snapshot.startNodeY + deltaY);
				if (nextX !== snapshot.startNodeX || nextY !== snapshot.startNodeY) {
					didMove = true;
				}
				layoutEntryByNodeId.set(targetNodeId, {
					x: nextX,
					y: nextY,
				});
			}
			if (layoutEntryByNodeId.size > 0) {
				workingNodes = workingNodes.map((node) => {
					const patch = layoutEntryByNodeId.get(node.id);
					if (!patch) return node;
					return {
						...node,
						...patch,
					};
				});
			}
			const pointerWorld = resolveWorldPoint(pointerX, pointerY);
			for (const entry of resolvePointerBoardReparentEntries(
				workingNodes,
				targetNodeIds,
				pointerWorld.x,
				pointerWorld.y,
			)) {
				const patch = layoutEntryByNodeId.get(entry.nodeId) ?? {};
				layoutEntryByNodeId.set(entry.nodeId, {
					...patch,
					...entry.patch,
				});
				if (Object.keys(entry.patch).length > 0) {
					didMove = true;
				}
			}
			if (layoutEntryByNodeId.size > 0) {
				workingNodes = workingNodes.map((node) => {
					const patch = layoutEntryByNodeId.get(node.id);
					if (!patch) return node;
					return {
						...node,
						...patch,
					};
				});
			}
			const rootTargetNodeIds = resolveRootNodeIdsFromMovedSet(
				workingNodes,
				targetNodeIds,
			);
			const targetAutoBoardIds = [
				...new Set(
					rootTargetNodeIds
						.map((nodeId) => {
							const node =
								workingNodes.find((item) => item.id === nodeId) ?? null;
							const parent = node?.parentId
								? (workingNodes.find((item) => item.id === node.parentId) ??
									null)
								: null;
							return isCanvasBoardAutoLayoutNode(parent) ? parent.id : null;
						})
						.filter((boardId): boardId is string => Boolean(boardId)),
				),
			];
			const autoLayoutInsertion =
				targetAutoBoardIds.length === 1
					? resolveCanvasBoardAutoLayoutInsertion(
							workingNodes,
							targetAutoBoardIds[0] ?? "",
							rootTargetNodeIds,
							pointerWorld,
							{
								originalRows: dragSession.autoLayoutRowsByBoardId.get(
									targetAutoBoardIds[0] ?? "",
								),
							},
						)
					: null;
			dragSession.autoLayoutInsertion = autoLayoutInsertion;
			const nextFrozenNodeIds =
				targetAutoBoardIds.length === 1
					? resolveCanvasAutoLayoutFrozenNodeIds(
							workingNodes,
							targetAutoBoardIds,
							{
								excludeNodeIds: activeNodeId
									? new Set([activeNodeId])
									: undefined,
							},
						)
					: [];
			const currentFrozenNodeIds =
				useCanvasInteractionStore.getState().autoLayoutFrozenNodeIds;
			if (
				currentFrozenNodeIds.length !== nextFrozenNodeIds.length ||
				currentFrozenNodeIds.some(
					(nodeId, index) => nodeId !== nextFrozenNodeIds[index],
				)
			) {
				setAutoLayoutFrozenNodeIds(nextFrozenNodeIds);
			}
			setBoardAutoLayoutIndicator(autoLayoutInsertion?.indicator ?? null);
			const nextLayoutEntries = [...layoutEntryByNodeId.entries()].map(
				([nodeId, patch]) => ({
					nodeId,
					patch,
				}),
			);
			if (nextLayoutEntries.length > 0) {
				updateCanvasNodeLayoutBatch(nextLayoutEntries);
			}
			dragSession.moved = dragSession.moved || didMove;
		},
		[
			appendCanvasGraphBatch,
			buildCanvasCopyEntries,
			canvasSnapEnabled,
			clearCanvasSnapGuides,
			clearPendingClickSuppression,
			getCamera,
			resetCanvasDragSession,
			resolveCanvasNodeTimelineDropTarget,
			resolveCanvasGuideValues,
			resolvePointerBoardReparentEntries,
			resolveRootNodeIdsFromMovedSet,
			resolveWorldPoint,
			activeNodeId,
			startCanvasTimelineDropPreview,
			stopCanvasTimelineDropPreview,
			setCanvasSnapGuides,
			updateCanvasNodeLayoutBatch,
			updateCanvasTimelineDropPreview,
			lastPointerClientRef.current?.x,
			lastPointerClientRef.current?.y,
			nodeDragSessionRef.current,
			setAutoLayoutFrozenNodeIds,
			setBoardAutoLayoutIndicator,
		],
	);

	const finishCanvasDragSession = useCallback(
		(_event: CanvasNodeDragEvent) => {
			const dragSession = nodeDragSessionRef.current;
			nodeDragSessionRef.current = null;
			clearCanvasSnapGuides();
			clearBoardAutoLayoutIndicator();
			if (!dragSession) return;
			if (dragSession.timelineDropMode) {
				stopCanvasTimelineDropPreview(dragSession);
				resetCanvasDragSession(dragSession);
				setPendingClickSuppression({
					suppressNode: true,
					suppressCanvas: true,
				});
				commitCanvasTimelineDrop(dragSession);
				return;
			}
			if (!dragSession.activated || !dragSession.moved) {
				if (dragSession.copyEntries.length > 0) {
					removeCanvasGraphBatch(dragSession.copyEntries);
				}
				setAutoLayoutFrozenNodeIds([]);
				return;
			}
			let latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const movedTargetNodeIds =
				dragSession.copyEntries.length > 0
					? dragSession.copyEntries.map((entry) => entry.node.id)
					: dragSession.dragNodeIds;
			if (dragSession.copyEntries.length > 0) {
				const copyHistoryProject = latestProject;
				const nextEntries = dragSession.copyEntries
					.map((entry) => {
						const latestNode =
							copyHistoryProject.canvas.nodes.find(
								(item) => item.id === entry.node.id,
							) ?? null;
						if (!latestNode) return null;
						return {
							node: latestNode,
							scene:
								latestNode.type === "scene"
									? (copyHistoryProject.scenes[latestNode.sceneId] ??
										entry.scene)
									: undefined,
						};
					})
					.filter((entry): entry is CanvasGraphHistoryEntry => entry !== null);
				if (nextEntries.length === 0) return;
				pushHistory({
					kind: "canvas.node-create.batch",
					entries: nextEntries,
					focusNodeId: copyHistoryProject.ui.focusedNodeId,
				});
				commitAutoLayoutForBoardIds(
					collectCanvasAutoLayoutAncestorBoardIds(
						copyHistoryProject.canvas.nodes,
						nextEntries.map((entry) => entry.node.id),
					),
					copyHistoryProject.canvas.nodes,
				);
				setAutoLayoutFrozenNodeIds([]);
				return;
			}
			const projectBeforeBoardLayout = latestProject;
			const movedTargetNodeIdSet = new Set(movedTargetNodeIds);
			const movedRootNodeIds = movedTargetNodeIds.filter((nodeId) => {
				const beforeParentId =
					dragSession.layoutBeforeByNodeId[nodeId]?.parentId ?? null;
				return !beforeParentId || !movedTargetNodeIdSet.has(beforeParentId);
			});
			const movedRootNodeIdSet = new Set(movedRootNodeIds);
			if (
				dragSession.autoLayoutInsertion &&
				!dragSession.autoLayoutInsertion.changesRows
			) {
				const nodeById = new Map(
					projectBeforeBoardLayout.canvas.nodes.map((node) => [node.id, node]),
				);
				const restoreEntries = movedTargetNodeIds
					.map((nodeId) => {
						const before = dragSession.layoutBeforeByNodeId[nodeId];
						const node = nodeById.get(nodeId) ?? null;
						if (!before || !node) return null;
						if (isLayoutEqual(before, pickLayout(node))) return null;
						return {
							nodeId,
							patch: before,
						};
					})
					.filter(
						(
							entry,
						): entry is {
							nodeId: string;
							patch: CanvasNodeLayoutSnapshot;
						} => Boolean(entry),
					);
				if (restoreEntries.length > 0) {
					updateCanvasNodeLayoutBatch(restoreEntries);
				}
				setAutoLayoutFrozenNodeIds([]);
				return;
			}
			const sourceAutoBoardIds = [
				...new Set(
					movedRootNodeIds
						.map((nodeId) => {
							const beforeParentId =
								dragSession.layoutBeforeByNodeId[nodeId]?.parentId ?? null;
							const beforeParent = beforeParentId
								? (projectBeforeBoardLayout.canvas.nodes.find(
										(node) => node.id === beforeParentId,
									) ?? null)
								: null;
							return isCanvasBoardAutoLayoutNode(beforeParent)
								? beforeParent.id
								: null;
						})
						.filter((boardId): boardId is string => Boolean(boardId)),
				),
			];
			const changedAutoLayoutBoardIds = collectCanvasAutoLayoutAncestorBoardIds(
				projectBeforeBoardLayout.canvas.nodes,
				movedRootNodeIds,
			);
			const autoLayoutRowsByBoardId = new Map<string, string[][]>();
			if (dragSession.autoLayoutInsertion?.changesRows) {
				autoLayoutRowsByBoardId.set(
					dragSession.autoLayoutInsertion.boardId,
					dragSession.autoLayoutInsertion.rows,
				);
			}
			for (const boardId of sourceAutoBoardIds) {
				if (boardId === dragSession.autoLayoutInsertion?.boardId) continue;
				const originalRows = dragSession.autoLayoutRowsByBoardId.get(boardId);
				if (!originalRows) continue;
				autoLayoutRowsByBoardId.set(
					boardId,
					removeCanvasAutoLayoutRowNodeIds(originalRows, movedRootNodeIdSet),
				);
			}
			appendCanvasAutoLayoutRowsByBoardId(
				autoLayoutRowsByBoardId,
				projectBeforeBoardLayout.canvas.nodes,
				changedAutoLayoutBoardIds,
			);
			const autoLayoutExtraBoardIds = [
				...new Set([
					...(dragSession.autoLayoutInsertion?.changesRows
						? [dragSession.autoLayoutInsertion.boardId]
						: []),
					...sourceAutoBoardIds,
					...changedAutoLayoutBoardIds,
				]),
			];
			const autoLayoutEntries = resolveAutoLayoutEntriesForChangedNodes(
				projectBeforeBoardLayout.canvas.nodes,
				movedRootNodeIds,
				{
					rowsByBoardId:
						autoLayoutRowsByBoardId.size > 0
							? autoLayoutRowsByBoardId
							: undefined,
					extraBoardIds: autoLayoutExtraBoardIds,
				},
			);
			if (autoLayoutEntries.length > 0) {
				commitCanvasAutoLayoutEntries(autoLayoutEntries, {
					frozenNodeIds: resolveCanvasAutoLayoutFrozenNodeIds(
						projectBeforeBoardLayout.canvas.nodes,
						autoLayoutExtraBoardIds,
						{
							excludeNodeIds:
								activeNodeId && !movedTargetNodeIds.includes(activeNodeId)
									? new Set([activeNodeId])
									: undefined,
						},
					),
				});
				latestProject = useProjectStore.getState().currentProject;
				if (!latestProject) return;
			} else {
				setAutoLayoutFrozenNodeIds([]);
				const boardAutoFitEntries = resolveBoardAutoFitEntriesAfterDrag(
					projectBeforeBoardLayout.canvas.nodes,
					movedTargetNodeIds,
				);
				if (boardAutoFitEntries.length > 0) {
					const boardAutoFitNodeIds = boardAutoFitEntries.map(
						(entry) => entry.nodeId,
					);
					const boardAutoFitAutoLayoutBoardIds =
						collectCanvasAutoLayoutAncestorBoardIds(
							projectBeforeBoardLayout.canvas.nodes,
							boardAutoFitNodeIds,
						);
					const boardAutoFitRowsByBoardId = new Map(autoLayoutRowsByBoardId);
					appendCanvasAutoLayoutRowsByBoardId(
						boardAutoFitRowsByBoardId,
						projectBeforeBoardLayout.canvas.nodes,
						boardAutoFitAutoLayoutBoardIds,
					);
					updateCanvasNodeLayoutBatch(boardAutoFitEntries);
					latestProject = useProjectStore.getState().currentProject;
					if (!latestProject) return;
					const boardAutoFitAutoLayoutEntries =
						resolveAutoLayoutEntriesForChangedNodes(
							latestProject.canvas.nodes,
							boardAutoFitNodeIds,
							{
								rowsByBoardId:
									boardAutoFitRowsByBoardId.size > 0
										? boardAutoFitRowsByBoardId
										: undefined,
								extraBoardIds: boardAutoFitAutoLayoutBoardIds,
							},
						);
					if (boardAutoFitAutoLayoutEntries.length > 0) {
						commitCanvasAutoLayoutEntries(boardAutoFitAutoLayoutEntries, {
							frozenNodeIds: resolveCanvasAutoLayoutFrozenNodeIds(
								latestProject.canvas.nodes,
								boardAutoFitAutoLayoutBoardIds,
								{
									excludeNodeIds:
										activeNodeId && !movedTargetNodeIds.includes(activeNodeId)
											? new Set([activeNodeId])
											: undefined,
								},
							),
						});
						latestProject = useProjectStore.getState().currentProject;
						if (!latestProject) return;
					}
				}
			}
			const historyEntries = latestProject.canvas.nodes
				.map((node) => {
					const before = dragSession.layoutBeforeByNodeId[node.id];
					if (!before) return null;
					const after = pickLayout(node);
					if (isLayoutEqual(before, after)) return null;
					return {
						nodeId: node.id,
						before,
						after,
					};
				})
				.filter(
					(
						entry,
					): entry is {
						nodeId: string;
						before: CanvasNodeLayoutSnapshot;
						after: CanvasNodeLayoutSnapshot;
					} => Boolean(entry),
				);
			if (historyEntries.length === 0) return;
			if (historyEntries.length === 1) {
				const entry = historyEntries[0];
				pushHistory({
					kind: "canvas.node-layout",
					nodeId: entry.nodeId,
					before: entry.before,
					after: entry.after,
					focusNodeId: latestProject.ui.focusedNodeId,
				});
				return;
			}
			pushHistory({
				kind: "canvas.node-layout.batch",
				entries: historyEntries,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
		},
		[
			commitCanvasAutoLayoutEntries,
			commitAutoLayoutForBoardIds,
			clearBoardAutoLayoutIndicator,
			clearCanvasSnapGuides,
			commitCanvasTimelineDrop,
			activeNodeId,
			pushHistory,
			removeCanvasGraphBatch,
			resolveAutoLayoutEntriesForChangedNodes,
			resolveBoardAutoFitEntriesAfterDrag,
			resetCanvasDragSession,
			setPendingClickSuppression,
			stopCanvasTimelineDropPreview,
			updateCanvasNodeLayoutBatch,
			nodeDragSessionRef,
			setAutoLayoutFrozenNodeIds,
		],
	);

	const handleSelectionResizeStart = useCallback(
		(anchor: CanvasNodeResizeAnchor, event: CanvasNodeDragEvent) => {
			if (nodeResizeSessionRef.current || nodeDragSessionRef.current) return;
			if (event.button !== 0) return;
			if (isCanvasInteractionLocked) return;
			if (!selectedBounds || selectedNodes.length <= 1) return;
			commitCanvasResizeCursorByAnchor(anchor);
			clearCanvasMarquee();
			clearCanvasSnapGuides();
			clearHoveredNode();
			const resizeNodes = selectedNodes.filter((node) => !node.locked);
			if (resizeNodes.length === 0) return;
			setPendingClickSuppression({
				suppressNode: false,
				suppressCanvas: true,
			});
			const latestNodes =
				useProjectStore.getState().currentProject?.canvas.nodes ?? [];
			const resizeNodeIds = resizeNodes.map((node) => node.id);
			clearSelectionResizeFrozenResetTimer();
			setSelectionResizeFrozenNodeIds(
				resolveCanvasSelectionResizeFrozenNodeIds(latestNodes, resizeNodeIds),
			);
			const autoLayoutBoardIds = collectCanvasAutoLayoutAncestorBoardIds(
				latestNodes,
				resizeNodeIds,
			);
			selectionResizeSessionRef.current = {
				anchor,
				startBoundsLeft: selectedBounds.left,
				startBoundsTop: selectedBounds.top,
				startBoundsWidth: selectedBounds.width,
				startBoundsHeight: selectedBounds.height,
				fixedCornerX:
					anchor === "top-right" || anchor === "bottom-right"
						? selectedBounds.left
						: selectedBounds.right,
				fixedCornerY:
					anchor === "bottom-left" || anchor === "bottom-right"
						? selectedBounds.top
						: selectedBounds.bottom,
				snapshots: Object.fromEntries(
					resizeNodes.map((node) => [
						node.id,
						{
							nodeId: node.id,
							startNodeX: node.x,
							startNodeY: node.y,
							startNodeWidth: node.width,
							startNodeHeight: node.height,
							before: pickLayout(node),
							constraints: resolveNodeResizeConstraints(node),
						},
					]),
				),
				moved: false,
				guideValues: null,
				autoLayoutRowsByBoardId: resolveCanvasAutoLayoutRowsByBoardId(
					latestNodes,
					autoLayoutBoardIds,
				),
			};
		},
		[
			commitCanvasResizeCursorByAnchor,
			clearCanvasMarquee,
			clearCanvasSnapGuides,
			clearHoveredNode,
			clearSelectionResizeFrozenResetTimer,
			isCanvasInteractionLocked,
			resolveNodeResizeConstraints,
			selectedBounds,
			selectedNodes,
			setPendingClickSuppression,
			nodeDragSessionRef.current,
			nodeResizeSessionRef.current,
			selectionResizeSessionRef,
			setSelectionResizeFrozenNodeIds,
		],
	);

	const handleSelectionResizeMove = useCallback(
		(anchor: CanvasNodeResizeAnchor, event: CanvasNodeDragEvent) => {
			const resizeSession = selectionResizeSessionRef.current;
			if (!resizeSession) return;
			if (resizeSession.anchor !== anchor) return;
			commitCanvasResizeCursorByAnchor(anchor);
			const currentZoom = getCamera().zoom;
			const safeZoom = Math.max(currentZoom, CAMERA_ZOOM_EPSILON);
			const deltaX = event.movementX / safeZoom;
			const deltaY = event.movementY / safeZoom;
			if (Math.abs(deltaX) + Math.abs(deltaY) < 1e-9) return;
			const isRightAnchor = isRightResizeAnchor(anchor);
			const isBottomAnchor = isBottomResizeAnchor(anchor);
			const globalMinSize = 32 / safeZoom;
			const draftWidth = clampSize(
				isRightAnchor
					? resizeSession.startBoundsWidth + deltaX
					: resizeSession.startBoundsWidth - deltaX,
				globalMinSize,
			);
			const draftHeight = clampSize(
				isBottomAnchor
					? resizeSession.startBoundsHeight + deltaY
					: resizeSession.startBoundsHeight - deltaY,
				globalMinSize,
			);
			const groupAspectRatio = resolvePositiveNumber(
				resizeSession.startBoundsWidth /
					Math.max(resizeSession.startBoundsHeight, CAMERA_ZOOM_EPSILON),
			);
			const groupResizeConstraints: ResolvedCanvasNodeResizeConstraints = {
				lockAspectRatio: groupAspectRatio !== null,
				aspectRatio: groupAspectRatio,
				minWidth: null,
				minHeight: null,
				maxWidth: null,
				maxHeight: null,
			};
			let preferredResizeAxis: "x" | "y" | null = null;
			let nextBoundsBox = resolveConstrainedResizeLayout({
				anchor,
				fixedCornerX: resizeSession.fixedCornerX,
				fixedCornerY: resizeSession.fixedCornerY,
				startWidth: resizeSession.startBoundsWidth,
				startHeight: resizeSession.startBoundsHeight,
				draftWidth,
				draftHeight,
				constraints: groupResizeConstraints,
				globalMinSize,
			});
			if (canvasSnapEnabled) {
				if (!resizeSession.guideValues) {
					resizeSession.guideValues = resolveCanvasGuideValues(
						Object.keys(resizeSession.snapshots),
					);
				}
				const guideValues = resizeSession.guideValues;
				const snapThreshold = resolveCanvasSnapThresholdWorld(currentZoom);
				const snapResult = resolveCanvasRectSnap({
					guideValues,
					threshold: snapThreshold,
					movingX: [
						isRightAnchor
							? nextBoundsBox.x + nextBoundsBox.width
							: nextBoundsBox.x,
					],
					movingY: [
						isBottomAnchor
							? nextBoundsBox.y + nextBoundsBox.height
							: nextBoundsBox.y,
					],
				});
				const selectedSnap = selectCornerResizeSnap({
					deltaX: snapResult.deltaX,
					deltaY: snapResult.deltaY,
					guidesWorld: snapResult.guidesWorld,
					preferSingleAxis: groupResizeConstraints.lockAspectRatio,
				});
				if (selectedSnap.deltaX !== 0 || selectedSnap.deltaY !== 0) {
					const snappedBoundsBox = applyResizeSnapDeltaToBox(
						nextBoundsBox,
						anchor,
						selectedSnap.deltaX,
						selectedSnap.deltaY,
					);
					preferredResizeAxis =
						selectedSnap.deltaX !== 0
							? "x"
							: selectedSnap.deltaY !== 0
								? "y"
								: preferredResizeAxis;
					nextBoundsBox = resolveConstrainedResizeLayout({
						anchor,
						fixedCornerX: resizeSession.fixedCornerX,
						fixedCornerY: resizeSession.fixedCornerY,
						startWidth: resizeSession.startBoundsWidth,
						startHeight: resizeSession.startBoundsHeight,
						draftWidth: snappedBoundsBox.width,
						draftHeight: snappedBoundsBox.height,
						constraints: groupResizeConstraints,
						globalMinSize,
						preferredAxis: preferredResizeAxis,
					});
					setCanvasSnapGuides(selectedSnap.guidesWorld);
				} else {
					clearCanvasSnapGuides();
				}
			} else {
				clearCanvasSnapGuides();
			}
			const nextLeft = nextBoundsBox.x;
			const nextTop = nextBoundsBox.y;
			const safeStartWidth = Math.max(
				resizeSession.startBoundsWidth,
				CAMERA_ZOOM_EPSILON,
			);
			const safeStartHeight = Math.max(
				resizeSession.startBoundsHeight,
				CAMERA_ZOOM_EPSILON,
			);
			const scaleX = nextBoundsBox.width / safeStartWidth;
			const scaleY = nextBoundsBox.height / safeStartHeight;
			let didMove = false;
			const nextLayoutEntries: Array<{
				nodeId: string;
				patch: {
					x: number;
					y: number;
					width: number;
					height: number;
				};
			}> = [];
			for (const snapshot of Object.values(resizeSession.snapshots)) {
				const candidateNodeX =
					nextLeft +
					(snapshot.startNodeX - resizeSession.startBoundsLeft) * scaleX;
				const candidateNodeY =
					nextTop +
					(snapshot.startNodeY - resizeSession.startBoundsTop) * scaleY;
				const candidateNodeWidth = Math.max(
					CAMERA_ZOOM_EPSILON,
					snapshot.startNodeWidth * scaleX,
				);
				const candidateNodeHeight = Math.max(
					CAMERA_ZOOM_EPSILON,
					snapshot.startNodeHeight * scaleY,
				);
				const candidateFixedCornerX = isRightAnchor
					? candidateNodeX
					: candidateNodeX + candidateNodeWidth;
				const candidateFixedCornerY = isBottomAnchor
					? candidateNodeY
					: candidateNodeY + candidateNodeHeight;
				const nextLayout = resolveConstrainedResizeLayout({
					anchor,
					fixedCornerX: candidateFixedCornerX,
					fixedCornerY: candidateFixedCornerY,
					startWidth: snapshot.startNodeWidth,
					startHeight: snapshot.startNodeHeight,
					draftWidth: candidateNodeWidth,
					draftHeight: candidateNodeHeight,
					constraints: snapshot.constraints,
					globalMinSize,
				});
				if (
					Math.abs(nextLayout.x - snapshot.startNodeX) > 1e-6 ||
					Math.abs(nextLayout.y - snapshot.startNodeY) > 1e-6 ||
					Math.abs(nextLayout.width - snapshot.startNodeWidth) > 1e-6 ||
					Math.abs(nextLayout.height - snapshot.startNodeHeight) > 1e-6
				) {
					didMove = true;
				}
				nextLayoutEntries.push({
					nodeId: snapshot.nodeId,
					patch: nextLayout,
				});
			}
			if (nextLayoutEntries.length > 0) {
				updateCanvasNodeLayoutBatch(nextLayoutEntries);
			}
			resizeSession.moved = resizeSession.moved || didMove;
		},
		[
			canvasSnapEnabled,
			clearCanvasSnapGuides,
			commitCanvasResizeCursorByAnchor,
			getCamera,
			resolveCanvasGuideValues,
			setCanvasSnapGuides,
			updateCanvasNodeLayoutBatch,
			selectionResizeSessionRef.current,
		],
	);

	const handleSelectionResizeEnd = useCallback(
		(_event: CanvasNodeDragEvent) => {
			const resizeSession = selectionResizeSessionRef.current;
			selectionResizeSessionRef.current = null;
			clearCanvasSnapGuides();
			const lastPointerWorld = lastCanvasPointerWorldRef.current;
			commitCanvasResizeCursorByAnchor(
				lastPointerWorld
					? resolveResizeAnchorAtWorldPoint(
							lastPointerWorld.x,
							lastPointerWorld.y,
						)
					: null,
			);
			if (!resizeSession) {
				clearSelectionResizeFrozenNodeIds();
				return;
			}
			if (!resizeSession.moved) {
				clearSelectionResizeFrozenNodeIds();
				return;
			}
			let latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) {
				clearSelectionResizeFrozenNodeIds();
				return;
			}
			const projectBeforeAutoLayout = latestProject;
			const resizedNodeIds = Object.keys(resizeSession.snapshots);
			const autoLayoutBoardIds = [
				...resizeSession.autoLayoutRowsByBoardId.keys(),
			];
			const resizedFrozenNodeIds = resolveCanvasSelectionResizeFrozenNodeIds(
				latestProject.canvas.nodes,
				resizedNodeIds,
			);
			const autoLayoutEntries = resolveAutoLayoutEntriesForChangedNodes(
				latestProject.canvas.nodes,
				resizedNodeIds,
				{
					rowsByBoardId: resizeSession.autoLayoutRowsByBoardId,
				},
			);
			if (autoLayoutEntries.length > 0) {
				commitCanvasAutoLayoutEntries(autoLayoutEntries, {
					frozenNodeIds: [
						...new Set([
							...resolveCanvasAutoLayoutFrozenNodeIdsForResize(
								latestProject.canvas.nodes,
								autoLayoutBoardIds,
								resizedNodeIds,
							),
							...resizedFrozenNodeIds,
						]),
					],
				});
				latestProject = useProjectStore.getState().currentProject;
				if (!latestProject) {
					clearSelectionResizeFrozenNodeIds();
					return;
				}
			}
			const beforeByNodeId = new Map<string, CanvasNodeLayoutSnapshot>(
				Object.values(resizeSession.snapshots).map((snapshot) => [
					snapshot.nodeId,
					snapshot.before,
				]),
			);
			const beforeNodeById = new Map(
				projectBeforeAutoLayout.canvas.nodes.map((node) => [node.id, node]),
			);
			for (const entry of autoLayoutEntries) {
				if (beforeByNodeId.has(entry.nodeId)) continue;
				const beforeNode = beforeNodeById.get(entry.nodeId);
				if (!beforeNode) continue;
				beforeByNodeId.set(entry.nodeId, pickLayout(beforeNode));
			}
			const nextEntries = resolveCanvasLayoutHistoryEntries(
				beforeByNodeId,
				latestProject.canvas.nodes,
			);
			if (nextEntries.length === 0) {
				deferClearSelectionResizeFrozenNodeIds();
				return;
			}
			if (nextEntries.length === 1) {
				const entry = nextEntries[0];
				pushHistory({
					kind: "canvas.node-layout",
					nodeId: entry.nodeId,
					before: entry.before,
					after: entry.after,
					focusNodeId: latestProject.ui.focusedNodeId,
				});
				deferClearSelectionResizeFrozenNodeIds();
				return;
			}
			pushHistory({
				kind: "canvas.node-layout.batch",
				entries: nextEntries,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
			deferClearSelectionResizeFrozenNodeIds();
		},
		[
			clearCanvasSnapGuides,
			clearSelectionResizeFrozenNodeIds,
			commitCanvasAutoLayoutEntries,
			commitCanvasResizeCursorByAnchor,
			deferClearSelectionResizeFrozenNodeIds,
			pushHistory,
			resolveAutoLayoutEntriesForChangedNodes,
			resolveResizeAnchorAtWorldPoint,
			lastCanvasPointerWorldRef.current,
			selectionResizeSessionRef,
		],
	);

	const handleSelectionResize = useCallback(
		(resizeEvent: CanvasSelectionResizeEvent) => {
			const { phase, anchor, event } = resizeEvent;
			if (phase === "start") {
				handleSelectionResizeStart(anchor, event);
				return;
			}
			if (phase === "move") {
				handleSelectionResizeMove(anchor, event);
				return;
			}
			handleSelectionResizeEnd(event);
		},
		[
			handleSelectionResizeEnd,
			handleSelectionResizeMove,
			handleSelectionResizeStart,
		],
	);

	const handleNodeTapSelection = useCallback(
		(node: CanvasNode, event: CanvasPointerTapMeta) => {
			if (event.shiftKey) {
				handleToggleNodeSelection(node);
				return;
			}
			handleNodeActivate(node);
		},
		[handleNodeActivate, handleToggleNodeSelection],
	);

	const handleNodeDoubleActivate = useCallback(
		(node: CanvasNode) => {
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			commitSelectedNodeIds([node.id]);
			if (getCanvasNodeDefinition(node.type).focusable ?? false) {
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
				minZoom: dynamicMinZoom,
			});
			const currentCamera = getCamera();
			if (isCameraAlmostEqual(currentCamera, nextCamera)) return;
			applySmoothCameraWithCullLock(nextCamera);
		},
		[
			applySmoothCameraWithCullLock,
			cameraSafeInsets,
			commitSelectedNodeIds,
			dynamicMinZoom,
			focusedNodeId,
			getCamera,
			isCanvasInteractionLocked,
			setFocusedNode,
			stageSize.height,
			stageSize.width,
			containerRef.current,
		],
	);

	const { handleSidebarNodeReorder, handleSidebarNodeSelect } =
		useCanvasSidebarHandlers({
			isSidebarFocusMode,
			isCanvasInteractionLocked,
			focusedNodeId,
			normalizedSelectedNodeIds,
			stageSize,
			cameraSafeInsets,
			getCamera,
			applySmoothCameraWithCullLock,
			handleNodeActivate,
			commitSelectedNodeIds,
			resolveRootNodeIdsFromMovedSet,
		});
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
		[resolveWorldPoint, setContextMenuState],
	);

	const deleteCanvasNodes = useCallback(
		(nodeIds: string[]) => {
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const normalizedTargetIds = normalizeSelectedNodeIds(
				nodeIds,
				new Set(latestProject.canvas.nodes.map((node) => node.id)),
			);
			const targetIds =
				resolveExpandedNodeIdsWithDescendants(normalizedTargetIds);
			if (targetIds.length === 0) return;
			const retainedSceneIdSet = resolveDeletedSceneIdsToRetain(
				latestProject,
				targetIds
					.map((nodeId) => {
						const node = latestProject.canvas.nodes.find(
							(candidate): candidate is SceneNode =>
								candidate.id === nodeId && candidate.type === "scene",
						);
						return node?.sceneId ?? null;
					})
					.filter((sceneId): sceneId is string => Boolean(sceneId)),
			);
			const entries = targetIds
				.map((nodeId) => {
					const node =
						latestProject.canvas.nodes.find(
							(candidate) => candidate.id === nodeId,
						) ?? null;
					if (!node) return null;
					return {
						node,
						scene:
							node.type === "scene"
								? retainedSceneIdSet.has(node.sceneId)
									? undefined
									: (latestProject.scenes[node.sceneId] ?? undefined)
								: undefined,
					};
				})
				.filter((entry): entry is CanvasGraphHistoryEntry => entry !== null);
			if (entries.length === 0) return;
			const beforeDeleteNodes = latestProject.canvas.nodes;
			const autoLayoutBoardIdsAfterDelete =
				collectCanvasAutoLayoutAncestorBoardIds(beforeDeleteNodes, targetIds);
			const commitAutoLayoutAfterDelete = () => {
				commitAutoLayoutForBoardIds(
					autoLayoutBoardIdsAfterDelete,
					beforeDeleteNodes,
				);
			};
			if (entries.length === 1) {
				const entry = entries[0];
				pushHistory({
					kind: "canvas.node-delete",
					node: entry.node,
					scene: entry.scene,
					focusNodeId: latestProject.ui.focusedNodeId,
				});
				if (entry.node.type === "scene") {
					if (entry.scene) {
						removeSceneGraphForHistory(entry.scene.id, entry.node.id);
						commitAutoLayoutAfterDelete();
						return;
					}
					removeSceneNodeForHistory(entry.node.sceneId, entry.node.id);
					commitAutoLayoutAfterDelete();
					return;
				}
				removeCanvasNodeForHistory(entry.node.id);
				commitAutoLayoutAfterDelete();
				return;
			}
			pushHistory({
				kind: "canvas.node-delete.batch",
				entries,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
			removeCanvasGraphBatch(entries);
			commitAutoLayoutAfterDelete();
		},
		[
			commitAutoLayoutForBoardIds,
			pushHistory,
			removeCanvasGraphBatch,
			removeCanvasNodeForHistory,
			removeSceneGraphForHistory,
			removeSceneNodeForHistory,
			resolveExpandedNodeIdsWithDescendants,
		],
	);

	const openDeleteContextMenuAt = useCallback(
		(targetNodeIds: string[], clientX: number, clientY: number) => {
			setContextMenuState({
				open: true,
				scope: "node",
				x: clientX,
				y: clientY,
				actions: [
					{
						key: "delete",
						label: "删除",
						danger: true,
						onSelect: () => {
							deleteCanvasNodes(targetNodeIds);
						},
					},
				],
			});
		},
		[deleteCanvasNodes, setContextMenuState],
	);

	const openNodeContextMenuAt = useCallback(
		(node: CanvasNode, clientX: number, clientY: number): boolean => {
			if (!currentProject) return false;
			const nextSelectedNodeIds =
				normalizedSelectedNodeIds.includes(node.id) &&
				normalizedSelectedNodeIds.length > 0
					? normalizedSelectedNodeIds
					: [node.id];
			commitSelectedNodeIds(nextSelectedNodeIds);
			const targetNodeIds = nextSelectedNodeIds;
			const definition = getCanvasNodeDefinition(node.type);
			const nodeActions = definition.contextMenu
				? definition.contextMenu({
						node,
						project: currentProject,
						sceneOptions: contextMenuSceneOptions,
						onInsertNodeToScene: (sceneId) => {
							insertNodeToScene(node, sceneId);
						},
					})
				: [];
			const actions = [
				...toTimelineContextMenuActions(nodeActions),
				{
					key: "copy",
					label: "复制",
					disabled: targetNodeIds.length === 0,
					onSelect: () => {
						copyNodeIdsToClipboard(targetNodeIds);
					},
				},
				{
					key: "cut",
					label: "剪切",
					disabled: targetNodeIds.length === 0,
					onSelect: () => {
						const didCopy = copyNodeIdsToClipboard(targetNodeIds);
						if (!didCopy) return;
						deleteCanvasNodes(targetNodeIds);
					},
				},
				{
					key: "delete",
					label: "删除",
					danger: true,
					onSelect: () => {
						deleteCanvasNodes(targetNodeIds);
					},
				},
			];
			if (actions.length === 0) return false;
			setContextMenuState({
				open: true,
				scope: "node",
				x: clientX,
				y: clientY,
				actions,
			});
			return true;
		},
		[
			commitSelectedNodeIds,
			copyNodeIdsToClipboard,
			contextMenuSceneOptions,
			currentProject,
			deleteCanvasNodes,
			insertNodeToScene,
			normalizedSelectedNodeIds,
			setContextMenuState,
		],
	);

	const finishCanvasMarquee = useCallback((): boolean => {
		const marqueeSession = marqueeSessionRef.current;
		if (!marqueeSession) return false;
		marqueeSessionRef.current = null;
		if (!marqueeSession.activated) {
			updateMarqueeRectState({
				visible: false,
				x1: marqueeRectRef.current.x1,
				y1: marqueeRectRef.current.y1,
				x2: marqueeRectRef.current.x2,
				y2: marqueeRectRef.current.y2,
			});
			return false;
		}
		applyMarqueeSelection(marqueeRectRef.current, {
			isFinalize: true,
			marqueeSession,
		});
		updateMarqueeRectState({
			visible: false,
			x1: marqueeRectRef.current.x1,
			y1: marqueeRectRef.current.y1,
			x2: marqueeRectRef.current.x2,
			y2: marqueeRectRef.current.y2,
		});
		return true;
	}, [
		applyMarqueeSelection,
		updateMarqueeRectState,
		marqueeRectRef.current,
		marqueeSessionRef,
	]);

	const resolveCanvasDragEventFromPointer = useCallback(
		(
			session: CanvasBasePointerSession,
			event: React.PointerEvent<HTMLDivElement>,
			last: boolean,
		): CanvasNodeDragEvent => {
			return {
				clientX: event.clientX,
				clientY: event.clientY,
				button: event.button,
				buttons: last ? 0 : event.buttons,
				shiftKey: event.shiftKey,
				altKey: event.altKey,
				metaKey: event.metaKey,
				ctrlKey: event.ctrlKey,
				movementX: event.clientX - session.startClientX,
				movementY: event.clientY - session.startClientY,
				first: false,
				last,
				tap: isPointerTapWithinThreshold(session, event.clientX, event.clientY),
			};
		},
		[isPointerTapWithinThreshold],
	);

	const handleCanvasSurfaceTap = useCallback(
		(tapMeta: CanvasPointerTapMeta) => {
			const pendingSuppression = resolvePendingClickSuppression();
			if (!isCanvasSurfaceTarget(tapMeta.target)) return;
			if (isOverlayWheelTarget(tapMeta.target)) return;
			if (isCanvasInteractionLocked) {
				lastTapRecordRef.current = null;
				return;
			}
			const world = resolveWorldPoint(tapMeta.clientX, tapMeta.clientY);
			const local = resolveLocalPoint(tapMeta.clientX, tapMeta.clientY);
			lastCanvasPointerWorldRef.current = world;
			if (isResizeAnchorHitAtWorldPoint(world.x, world.y)) {
				lastTapRecordRef.current = null;
				return;
			}
			const node = getTopHitNode({
				worldX: world.x,
				worldY: world.y,
				localX: local.x,
				localY: local.y,
				liveCamera: getCamera(),
				boardBodyHitMode: "include",
			});
			const keepMultiSelectionBounds = Boolean(
				selectedBounds &&
					normalizedSelectedNodeIds.length > 1 &&
					isWorldPointInBounds(selectedBounds, world.x, world.y) &&
					(!node || !normalizedSelectedNodeIds.includes(node.id)),
			);
			if (keepMultiSelectionBounds) {
				lastTapRecordRef.current = null;
				return;
			}
			if (node) {
				if (pendingSuppression?.suppressNode) return;
				handleNodeTapSelection(node, tapMeta);
				if (tapMeta.shiftKey) {
					lastTapRecordRef.current = null;
					return;
				}
				const currentTap: CanvasTapRecord = {
					nodeId: node.id,
					pointerType: tapMeta.pointerType,
					clientX: tapMeta.clientX,
					clientY: tapMeta.clientY,
					timestampMs: tapMeta.timestampMs,
				};
				if (isDoubleTapRecordMatch(lastTapRecordRef.current, currentTap)) {
					handleNodeDoubleActivate(node);
					lastTapRecordRef.current = null;
					return;
				}
				lastTapRecordRef.current = currentTap;
				return;
			}
			lastTapRecordRef.current = null;
			if (pendingSuppression?.suppressCanvas) return;
			if (tapMeta.shiftKey) return;
			commitSelectedNodeIds([]);
		},
		[
			commitSelectedNodeIds,
			getTopHitNode,
			getCamera,
			handleNodeDoubleActivate,
			handleNodeTapSelection,
			isDoubleTapRecordMatch,
			isCanvasInteractionLocked,
			isResizeAnchorHitAtWorldPoint,
			normalizedSelectedNodeIds,
			resolveLocalPoint,
			resolvePendingClickSuppression,
			resolveWorldPoint,
			selectedBounds,
			lastCanvasPointerWorldRef,
			lastTapRecordRef,
		],
	);

	const updateHoverFromPointer = useCallback(
		(target: EventTarget | null, clientX: number, clientY: number) => {
			if (isCanvasInteractionLocked) {
				clearHoveredNode();
				return;
			}
			if (
				nodeResizeSessionRef.current ||
				selectionResizeSessionRef.current ||
				nodeDragSessionRef.current ||
				pointerSessionRef.current
			) {
				clearHoveredNode();
				return;
			}
			if (!isCanvasSurfaceTarget(target) || isOverlayWheelTarget(target)) {
				clearHoveredNode();
				return;
			}
			const world = resolveWorldPoint(clientX, clientY);
			const local = resolveLocalPoint(clientX, clientY);
			const node = getTopHitNode({
				worldX: world.x,
				worldY: world.y,
				localX: local.x,
				localY: local.y,
				liveCamera: getCamera(),
				boardBodyHitMode: "include",
			});
			commitHoveredNodeId(node?.id ?? null);
		},
		[
			clearHoveredNode,
			commitHoveredNodeId,
			getCamera,
			getTopHitNode,
			isCanvasInteractionLocked,
			resolveLocalPoint,
			resolveWorldPoint,
			nodeDragSessionRef.current,
			nodeResizeSessionRef.current,
			pointerSessionRef.current,
			selectionResizeSessionRef.current,
		],
	);

	const handleCanvasPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			lastPointerClientRef.current = {
				x: event.clientX,
				y: event.clientY,
			};
			const world = resolveWorldPoint(event.clientX, event.clientY);
			lastCanvasPointerWorldRef.current = world;
			clearCanvasSnapGuides();
			if (event.button !== 0 || !event.isPrimary) return;
			if (!isCanvasSurfaceTarget(event.target)) return;
			if (isOverlayWheelTarget(event.target)) return;
			if (pointerSessionRef.current) return;
			if (canvasToolMode === "board") {
				if (isCanvasInteractionLocked) {
					clearHoveredNode();
					commitCanvasResizeCursor(null);
					return;
				}
				const canvasSurface = event.currentTarget;
				try {
					canvasSurface.setPointerCapture(event.pointerId);
				} catch {}
				clearCanvasMarquee();
				clearCanvasSnapGuides();
				clearHoveredNode();
				commitCanvasResizeCursor(null);
				clearPendingClickSuppression();
				const local = resolveLocalPoint(event.clientX, event.clientY);
				boardCreateSessionRef.current = {
					startWorldX: world.x,
					startWorldY: world.y,
					startLocalX: local.x,
					startLocalY: local.y,
					activated: false,
					currentWorldX: world.x,
					currentWorldY: world.y,
					currentLocalX: local.x,
					currentLocalY: local.y,
				};
				updateMarqueeRectState({
					visible: false,
					x1: local.x,
					y1: local.y,
					x2: local.x,
					y2: local.y,
				});
				pointerSessionRef.current = {
					pointerId: event.pointerId,
					pointerType: event.pointerType || "mouse",
					gesture: "board-create",
					startClientX: event.clientX,
					startClientY: event.clientY,
					startNodeId: null,
					startTarget: event.target,
				};
				return;
			}
			if (isCanvasInteractionLocked) {
				clearHoveredNode();
				commitCanvasResizeCursor(null);
				return;
			}
			const canvasSurface = event.currentTarget;
			try {
				canvasSurface.setPointerCapture(event.pointerId);
			} catch {}
			const hitResizeAnchor = resolveResizeAnchorAtWorldPoint(world.x, world.y);
			if (hitResizeAnchor) {
				commitCanvasResizeCursorByAnchor(hitResizeAnchor);
				clearHoveredNode();
				pointerSessionRef.current = {
					pointerId: event.pointerId,
					pointerType: event.pointerType || "mouse",
					gesture: "tap",
					startClientX: event.clientX,
					startClientY: event.clientY,
					startNodeId: null,
					startTarget: event.target,
				};
				return;
			}
			commitCanvasResizeCursor(null);
			const local = resolveLocalPoint(event.clientX, event.clientY);
			const node = getTopHitNode({
				worldX: world.x,
				worldY: world.y,
				localX: local.x,
				localY: local.y,
				liveCamera: getCamera(),
				boardBodyHitMode: "selected-only",
			});
			const isInSelectionBounds = Boolean(
				selectedBounds &&
					normalizedSelectedNodeIds.length > 1 &&
					isWorldPointInBounds(selectedBounds, world.x, world.y),
			);
			clearCanvasMarquee();
			let gesture: CanvasBasePointerSession["gesture"] = "tap";
			if (isInSelectionBounds) {
				const didStartSelectionDrag = beginCanvasDragSession({
					origin: "selection",
					anchorNodeId: null,
					pendingSelectedNodeIds: normalizedSelectedNodeIds,
					copyMode: event.altKey,
				});
				if (didStartSelectionDrag) {
					const existingSuppression = pendingClickSuppressionRef.current;
					setPendingClickSuppression({
						suppressNode: existingSuppression?.suppressNode ?? false,
						suppressCanvas: true,
					});
					setIsTileTaskBoostActive(true);
					gesture = "selection-drag";
				}
			} else if (node && !node.locked) {
				const isNodeSelected = normalizedSelectedNodeIds.includes(node.id);
				const pendingSelectedNodeIds = isNodeSelected
					? normalizedSelectedNodeIds
					: event.shiftKey
						? [...normalizedSelectedNodeIds, node.id]
						: [node.id];
				const didStartDrag = beginCanvasDragSession({
					origin: "node",
					anchorNodeId: node.id,
					pendingSelectedNodeIds,
					copyMode: event.altKey,
				});
				if (didStartDrag) {
					setIsTileTaskBoostActive(true);
					gesture = "node-drag";
				}
			} else if (node?.locked) {
				if (!event.shiftKey) {
					handleNodeActivate(node);
				}
			} else if (!node) {
				const local = resolveLocalPoint(event.clientX, event.clientY);
				marqueeSessionRef.current = {
					additive: event.shiftKey,
					initialSelectedNodeIds: normalizedSelectedNodeIds,
					startLocalX: local.x,
					startLocalY: local.y,
					activated: false,
				};
				updateMarqueeRectState({
					visible: false,
					x1: local.x,
					y1: local.y,
					x2: local.x,
					y2: local.y,
				});
				gesture = "marquee";
			}
			if (gesture === "node-drag" && node) {
				commitHoveredNodeId(node.id);
			}
			pointerSessionRef.current = {
				pointerId: event.pointerId,
				pointerType: event.pointerType || "mouse",
				gesture,
				startClientX: event.clientX,
				startClientY: event.clientY,
				startNodeId: isInSelectionBounds ? null : (node?.id ?? null),
				startTarget: event.target,
			};
		},
		[
			beginCanvasDragSession,
			clearCanvasMarquee,
			clearCanvasSnapGuides,
			clearHoveredNode,
			clearPendingClickSuppression,
			commitHoveredNodeId,
			commitCanvasResizeCursor,
			commitCanvasResizeCursorByAnchor,
			getCamera,
			getTopHitNode,
			handleNodeActivate,
			isCanvasInteractionLocked,
			canvasToolMode,
			normalizedSelectedNodeIds,
			resolveResizeAnchorAtWorldPoint,
			resolveLocalPoint,
			resolveWorldPoint,
			selectedBounds,
			setPendingClickSuppression,
			updateMarqueeRectState,
			boardCreateSessionRef,
			lastCanvasPointerWorldRef,
			lastPointerClientRef,
			marqueeSessionRef,
			pendingClickSuppressionRef.current,
			pointerSessionRef,
			setIsTileTaskBoostActive,
		],
	);

	const handleCanvasPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			lastPointerClientRef.current = {
				x: event.clientX,
				y: event.clientY,
			};
			const world = resolveWorldPoint(event.clientX, event.clientY);
			lastCanvasPointerWorldRef.current = world;
			const pointerSession = pointerSessionRef.current;
			if (pointerSession && pointerSession.pointerId === event.pointerId) {
				if (isCanvasInteractionLocked) {
					clearHoveredNode();
					commitCanvasResizeCursor(null);
					return;
				}
				if (nodeResizeSessionRef.current) {
					clearHoveredNode();
					commitCanvasResizeCursorByAnchor(nodeResizeSessionRef.current.anchor);
					return;
				}
				if (selectionResizeSessionRef.current) {
					clearHoveredNode();
					commitCanvasResizeCursorByAnchor(
						selectionResizeSessionRef.current.anchor,
					);
					return;
				}
				if (
					pointerSession.gesture === "node-drag" ||
					pointerSession.gesture === "selection-drag"
				) {
					const dragSession = nodeDragSessionRef.current;
					if (dragSession) {
						applyCanvasDragEvent(
							resolveCanvasDragEventFromPointer(pointerSession, event, false),
						);
					}
					if (
						dragSession &&
						!dragSession.activated &&
						!dragSession.timelineDropMode
					) {
						if (
							pointerSession.gesture === "node-drag" &&
							pointerSession.startNodeId
						) {
							commitHoveredNodeId(pointerSession.startNodeId);
						}
					} else {
						clearHoveredNode();
					}
					commitCanvasResizeCursor(null);
					return;
				}
				if (pointerSession.gesture === "marquee") {
					const marqueeSession = marqueeSessionRef.current;
					if (!marqueeSession) {
						clearHoveredNode();
						commitCanvasResizeCursor(null);
						return;
					}
					const local = resolveLocalPoint(event.clientX, event.clientY);
					const deltaX = local.x - marqueeSession.startLocalX;
					const deltaY = local.y - marqueeSession.startLocalY;
					const hasActivated =
						marqueeSession.activated ||
						Math.abs(deltaX) >= CANVAS_MARQUEE_ACTIVATION_PX ||
						Math.abs(deltaY) >= CANVAS_MARQUEE_ACTIVATION_PX;
					marqueeSession.activated = hasActivated;
					if (hasActivated) {
						clearPendingClickSuppression();
					}
					const nextRect: CanvasMarqueeRect = {
						visible: hasActivated,
						x1: marqueeSession.startLocalX,
						y1: marqueeSession.startLocalY,
						x2: local.x,
						y2: local.y,
					};
					updateMarqueeRectState(nextRect);
					if (hasActivated) {
						applyMarqueeSelection(nextRect);
						clearHoveredNode();
					}
					commitCanvasResizeCursor(null);
					return;
				}
				if (pointerSession.gesture === "board-create") {
					const boardSession = boardCreateSessionRef.current;
					if (!boardSession) {
						clearHoveredNode();
						commitCanvasResizeCursor(null);
						return;
					}
					const local = resolveLocalPoint(event.clientX, event.clientY);
					const deltaX = local.x - boardSession.startLocalX;
					const deltaY = local.y - boardSession.startLocalY;
					const hasActivated =
						boardSession.activated ||
						Math.abs(deltaX) >= CANVAS_MARQUEE_ACTIVATION_PX ||
						Math.abs(deltaY) >= CANVAS_MARQUEE_ACTIVATION_PX;
					boardSession.activated = hasActivated;
					boardSession.currentWorldX = world.x;
					boardSession.currentWorldY = world.y;
					boardSession.currentLocalX = local.x;
					boardSession.currentLocalY = local.y;
					const nextRect: CanvasMarqueeRect = {
						visible: hasActivated,
						x1: boardSession.startLocalX,
						y1: boardSession.startLocalY,
						x2: local.x,
						y2: local.y,
					};
					updateMarqueeRectState(nextRect);
					clearHoveredNode();
					commitCanvasResizeCursor(null);
					return;
				}
			}
			if (canvasToolMode === "board") {
				clearHoveredNode();
				commitCanvasResizeCursor(null);
				return;
			}
			if (
				!isCanvasSurfaceTarget(event.target) ||
				isOverlayWheelTarget(event.target) ||
				isCanvasInteractionLocked
			) {
				commitCanvasResizeCursor(null);
				return;
			}
			updateHoverFromPointer(event.target, event.clientX, event.clientY);
			commitCanvasResizeCursorByAnchor(
				resolveResizeAnchorAtWorldPoint(world.x, world.y),
			);
		},
		[
			applyCanvasDragEvent,
			applyMarqueeSelection,
			canvasToolMode,
			clearHoveredNode,
			clearPendingClickSuppression,
			commitHoveredNodeId,
			commitCanvasResizeCursor,
			commitCanvasResizeCursorByAnchor,
			isCanvasInteractionLocked,
			resolveCanvasDragEventFromPointer,
			resolveLocalPoint,
			resolveResizeAnchorAtWorldPoint,
			resolveWorldPoint,
			updateHoverFromPointer,
			updateMarqueeRectState,
			boardCreateSessionRef.current,
			lastCanvasPointerWorldRef,
			lastPointerClientRef,
			marqueeSessionRef.current,
			nodeDragSessionRef.current,
			nodeResizeSessionRef.current,
			pointerSessionRef.current,
			selectionResizeSessionRef.current,
		],
	);

	const handleCanvasPointerUp = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			lastPointerClientRef.current = {
				x: event.clientX,
				y: event.clientY,
			};
			const world = resolveWorldPoint(event.clientX, event.clientY);
			const local = resolveLocalPoint(event.clientX, event.clientY);
			lastCanvasPointerWorldRef.current = world;
			const pointerSession = pointerSessionRef.current;
			if (!pointerSession || pointerSession.pointerId !== event.pointerId) {
				setIsTileTaskBoostActive(false);
				updateHoverFromPointer(event.target, event.clientX, event.clientY);
				commitCanvasResizeCursorByAnchor(
					!isCanvasInteractionLocked &&
						isCanvasSurfaceTarget(event.target) &&
						!isOverlayWheelTarget(event.target)
						? resolveResizeAnchorAtWorldPoint(world.x, world.y)
						: null,
				);
				return;
			}
			pointerSessionRef.current = null;
			try {
				if (event.currentTarget.hasPointerCapture(event.pointerId)) {
					event.currentTarget.releasePointerCapture(event.pointerId);
				}
			} catch {}
			const tapMeta = {
				...resolvePointerTapMeta(event),
				target: pointerSession.startTarget,
			};
			const isTap = isPointerTapWithinThreshold(
				pointerSession,
				event.clientX,
				event.clientY,
			);
			if (pointerSession.gesture === "board-create") {
				const didCreateBoard = commitBoardCreateFromSession();
				clearBoardCreatePreview();
				if (didCreateBoard) {
					setCanvasToolMode("move");
				}
				clearHoveredNode();
				commitCanvasResizeCursor(null);
				return;
			}
			if (
				pointerSession.gesture === "node-drag" ||
				pointerSession.gesture === "selection-drag"
			) {
				setIsTileTaskBoostActive(false);
				const dragSession = nodeDragSessionRef.current;
				const shouldResolveTap =
					isTap &&
					Boolean(
						dragSession &&
							!dragSession.timelineDropMode &&
							!dragSession.moved &&
							dragSession.origin ===
								(pointerSession.gesture === "node-drag" ? "node" : "selection"),
					);
				if (dragSession) {
					finishCanvasDragSession(
						resolveCanvasDragEventFromPointer(pointerSession, event, true),
					);
				}
				if (
					shouldResolveTap &&
					(pointerSession.gesture !== "node-drag" ||
						(pointerSession.startNodeId &&
							getTopHitNode({
								worldX: world.x,
								worldY: world.y,
								localX: local.x,
								localY: local.y,
								liveCamera: getCamera(),
								boardBodyHitMode: "selected-only",
							})?.id === pointerSession.startNodeId))
				) {
					handleCanvasSurfaceTap(tapMeta);
				}
				updateHoverFromPointer(event.target, event.clientX, event.clientY);
				commitCanvasResizeCursorByAnchor(
					!isCanvasInteractionLocked &&
						isCanvasSurfaceTarget(event.target) &&
						!isOverlayWheelTarget(event.target)
						? resolveResizeAnchorAtWorldPoint(world.x, world.y)
						: null,
				);
				return;
			}
			if (pointerSession.gesture === "marquee") {
				const didCommitMarquee = finishCanvasMarquee();
				if (!didCommitMarquee && isTap) {
					handleCanvasSurfaceTap(tapMeta);
				}
				updateHoverFromPointer(event.target, event.clientX, event.clientY);
				commitCanvasResizeCursorByAnchor(
					!isCanvasInteractionLocked &&
						isCanvasSurfaceTarget(event.target) &&
						!isOverlayWheelTarget(event.target)
						? resolveResizeAnchorAtWorldPoint(world.x, world.y)
						: null,
				);
				return;
			}
			if (isTap) {
				handleCanvasSurfaceTap(tapMeta);
			}
			updateHoverFromPointer(event.target, event.clientX, event.clientY);
			commitCanvasResizeCursorByAnchor(
				!isCanvasInteractionLocked &&
					isCanvasSurfaceTarget(event.target) &&
					!isOverlayWheelTarget(event.target)
					? resolveResizeAnchorAtWorldPoint(world.x, world.y)
					: null,
			);
		},
		[
			clearBoardCreatePreview,
			clearHoveredNode,
			commitCanvasResizeCursor,
			commitCanvasResizeCursorByAnchor,
			commitBoardCreateFromSession,
			finishCanvasDragSession,
			finishCanvasMarquee,
			getTopHitNode,
			handleCanvasSurfaceTap,
			isCanvasInteractionLocked,
			isPointerTapWithinThreshold,
			resolveCanvasDragEventFromPointer,
			resolvePointerTapMeta,
			resolveResizeAnchorAtWorldPoint,
			resolveLocalPoint,
			resolveWorldPoint,
			updateHoverFromPointer,
			getCamera,
			lastCanvasPointerWorldRef,
			lastPointerClientRef,
			nodeDragSessionRef.current,
			pointerSessionRef,
			setCanvasToolMode,
			setIsTileTaskBoostActive,
		],
	);

	const handleCanvasPointerCancel = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const pointerSession = pointerSessionRef.current;
			if (!pointerSession || pointerSession.pointerId !== event.pointerId) {
				setIsTileTaskBoostActive(false);
				clearHoveredNode();
				commitCanvasResizeCursor(null);
				return;
			}
			pointerSessionRef.current = null;
			lastTapRecordRef.current = null;
			try {
				if (event.currentTarget.hasPointerCapture(event.pointerId)) {
					event.currentTarget.releasePointerCapture(event.pointerId);
				}
			} catch {}
			if (
				pointerSession.gesture === "node-drag" ||
				pointerSession.gesture === "selection-drag"
			) {
				setIsTileTaskBoostActive(false);
				if (nodeDragSessionRef.current) {
					finishCanvasDragSession(
						resolveCanvasDragEventFromPointer(pointerSession, event, true),
					);
				}
				clearHoveredNode();
				commitCanvasResizeCursor(null);
				return;
			}
			if (pointerSession.gesture === "board-create") {
				clearBoardCreatePreview();
				clearHoveredNode();
				commitCanvasResizeCursor(null);
				return;
			}
			if (pointerSession.gesture === "marquee") {
				finishCanvasMarquee();
			}
			clearHoveredNode();
			commitCanvasResizeCursor(null);
		},
		[
			clearBoardCreatePreview,
			clearHoveredNode,
			commitCanvasResizeCursor,
			finishCanvasDragSession,
			finishCanvasMarquee,
			resolveCanvasDragEventFromPointer,
			lastTapRecordRef,
			nodeDragSessionRef.current,
			pointerSessionRef,
			setIsTileTaskBoostActive,
		],
	);

	const handleCanvasPointerLeave = useCallback(() => {
		clearHoveredNode();
		commitCanvasResizeCursor(null);
	}, [clearHoveredNode, commitCanvasResizeCursor]);

	const handleCanvasContextMenu = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			lastPointerClientRef.current = {
				x: event.clientX,
				y: event.clientY,
			};
			if (!isCanvasSurfaceTarget(event.target)) return;
			if (isOverlayWheelTarget(event.target)) return;
			if (isCanvasInteractionLocked) return;
			event.preventDefault();
			const world = resolveWorldPoint(event.clientX, event.clientY);
			const local = resolveLocalPoint(event.clientX, event.clientY);
			lastCanvasPointerWorldRef.current = world;
			const node = getTopHitNode({
				worldX: world.x,
				worldY: world.y,
				localX: local.x,
				localY: local.y,
				liveCamera: getCamera(),
				boardBodyHitMode: "include",
			});
			if (
				normalizedSelectedNodeIds.length > 1 &&
				selectedBounds &&
				isWorldPointInBounds(selectedBounds, world.x, world.y)
			) {
				if (!node || !normalizedSelectedNodeIds.includes(node.id)) {
					openDeleteContextMenuAt(
						normalizedSelectedNodeIds,
						event.clientX,
						event.clientY,
					);
					return;
				}
			}
			if (node && openNodeContextMenuAt(node, event.clientX, event.clientY)) {
				return;
			}
			if (
				normalizedSelectedNodeIds.length > 1 &&
				selectedBounds &&
				isWorldPointInBounds(selectedBounds, world.x, world.y)
			) {
				openDeleteContextMenuAt(
					normalizedSelectedNodeIds,
					event.clientX,
					event.clientY,
				);
				return;
			}
			openCanvasContextMenuAt(event.clientX, event.clientY);
		},
		[
			getTopHitNode,
			isCanvasInteractionLocked,
			normalizedSelectedNodeIds,
			openDeleteContextMenuAt,
			openCanvasContextMenuAt,
			openNodeContextMenuAt,
			getCamera,
			resolveLocalPoint,
			resolveWorldPoint,
			selectedBounds,
			lastCanvasPointerWorldRef,
			lastPointerClientRef,
		],
	);

	const closeContextMenu = useCallback(() => {
		setContextMenuState({ open: false });
	}, [setContextMenuState]);

	useEffect(() => {
		const handleGlobalKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (isEditableKeyboardTarget(event.target)) return;
			const activeTimelineState = runtimeManager
				?.getActiveEditTimelineRuntime()
				?.timelineStore.getState();
			const timelineHasPriority = Boolean(
				activeTimelineState?.isTimelineEditorMounted &&
					(activeTimelineState.selectedIds.length > 0 ||
						activeTimelineState.isTimelineEditorHovered),
			);
			const isModifier = event.metaKey || event.ctrlKey;
			if (isModifier && !event.altKey) {
				const key = event.key.toLowerCase();
				if (key === "c") {
					if (timelineHasPriority) return;
					if (normalizedSelectedNodeIds.length === 0) return;
					const didCopy = copySelectedNodesToClipboard();
					if (!didCopy) return;
					event.preventDefault();
					closeContextMenu();
					return;
				}
				if (key === "v") {
					if (resolvePointerTimelineDropTarget()) {
						return;
					}
					const didPaste = pasteFromClipboardToCanvasAt(
						resolveCanvasPasteWorldPoint(),
					);
					if (!didPaste) return;
					event.preventDefault();
					return;
				}
			}
			if (event.key !== "Delete" && event.key !== "Backspace") return;
			if (event.repeat) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (normalizedSelectedNodeIds.length === 0) return;
			if (timelineHasPriority) {
				return;
			}
			event.preventDefault();
			deleteCanvasNodes(normalizedSelectedNodeIds);
			closeContextMenu();
		};
		window.addEventListener("keydown", handleGlobalKeyDown);
		return () => {
			window.removeEventListener("keydown", handleGlobalKeyDown);
		};
	}, [
		closeContextMenu,
		copySelectedNodesToClipboard,
		deleteCanvasNodes,
		normalizedSelectedNodeIds,
		pasteFromClipboardToCanvasAt,
		resolveCanvasPasteWorldPoint,
		resolvePointerTimelineDropTarget,
		runtimeManager,
	]);

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

	const handleCanvasDrop = useCanvasExternalFileDrop({
		currentProjectId,
		scenes: currentProject?.scenes ?? {},
		activeSceneId,
		resolveWorldPoint,
	});
	const handleCloseDrawer = useCallback(() => {
		if (focusedNodeId) {
			setFocusedNode(null);
			return;
		}
		if (activeNodeId) {
			setActiveNode(null);
		}
	}, [activeNodeId, focusedNodeId, setActiveNode, setFocusedNode]);
	const handleBoardLayoutModeChange = useCanvasBoardLayoutMode({
		commitCanvasAutoLayoutEntries,
		resolveAutoLayoutEntriesForChangedNodes,
	});
	const handleEditorMouseOverCapture = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			event.stopPropagation();
			event.nativeEvent.stopImmediatePropagation?.();
		},
		[],
	);

	const contextMenuActions = useMemo<TimelineContextMenuAction[]>(() => {
		if (!contextMenuState.open) return [];
		if (contextMenuState.scope === "node") {
			return contextMenuState.actions;
		}
		if (focusedNodeId) return [];
		const canPaste = canPasteClipboardPayloadToCanvas();
		return [
			{
				key: "paste",
				label: "粘贴",
				disabled: !canPaste,
				onSelect: () => {
					if (!canPaste) return;
					pasteFromClipboardToCanvasAt({
						x: contextMenuState.worldX,
						y: contextMenuState.worldY,
					});
				},
			},
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
	}, [
		canPasteClipboardPayloadToCanvas,
		contextMenuState,
		focusedNodeId,
		handleCreateTextNodeAt,
		pasteFromClipboardToCanvasAt,
	]);

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
	const shouldFreezeTileLodForFocus = Boolean(
		focusedNodeId || prevFocusedNodeIdRef.current,
	);
	const effectiveTileLodTransition =
		tileLodTransition ??
		(shouldFreezeTileLodForFocus ? FOCUS_TILE_LOD_TRANSITION : null);
	const resolvedCanvasCursor =
		canvasToolMode === "board" ? "crosshair" : canvasResizeCursor;
	const frozenCanvasNodeIds =
		autoLayoutFrozenNodeIds.length === 0 &&
		autoLayoutAnimatedNodeIds.length === 0 &&
		selectionResizeFrozenNodeIds.length === 0
			? EMPTY_STRING_ARRAY
			: [
					...new Set([
						...autoLayoutFrozenNodeIds,
						...autoLayoutAnimatedNodeIds,
						...selectionResizeFrozenNodeIds,
					]),
				];
	const forceLiveCanvasNodeIds =
		activeNodeId &&
		(autoLayoutFrozenNodeIds.includes(activeNodeId) ||
			autoLayoutAnimatedNodeIds.includes(activeNodeId))
			? [activeNodeId]
			: EMPTY_STRING_ARRAY;
	return {
		autoLayoutAnimatedNodeIds,
		boardAutoLayoutIndicator,
		canvasToolMode,
		contextMenuActions,
		contextMenuState,
		closeContextMenu,
		drawerBottomOffset,
		drawerIdentity,
		effectiveTileLodTransition,
		expandButtonOffsetX,
		expandButtonOffsetY,
		forceLiveCanvasNodeIds,
		frozenCanvasNodeIds,
		handleBoardLayoutModeChange,
		handleCanvasContextMenu,
		handleCanvasDrop,
		handleCanvasPointerCancel,
		handleCanvasPointerDown,
		handleCanvasPointerLeave,
		handleCanvasPointerMove,
		handleCanvasPointerUp,
		handleCloseDrawer,
		handleCreateHdrTestNode,
		handleCreateScene,
		handleDropTimelineElementsToCanvas,
		handleEditorMouseOverCapture,
		handleRestoreSceneReferenceToCanvas,
		handleResetView,
		handleSelectionResize,
		handleSidebarNodeReorder,
		handleSidebarNodeSelect,
		handleSkiaNodeResize,
		handleToolModeChange,
		handleZoomByStep,
		hoveredNodeId,
		marqueeRect,
		normalizedSelectedNodeIds,
		overlayLayout,
		resolvedCanvasCursor,
		resolvedDrawer,
		rightPanelShouldRender,
		setSidebarExpanded,
		setTileDebugEnabled,
		setVisibleDrawerHeight,
		sidebarExpanded,
		snapGuidesScreen,
		stageSize,
		tileDebugEnabled,
		tileMaxTasksPerTick,
		toolbarLeftOffset,
		toolbarTopOffset,
	};
};
