import type { CanvasNode, StudioProject } from "@/studio/project/types";
import type React from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Canvas,
	type CanvasRef,
	Easing,
	flushSkiaDisposals,
	Group,
	makeMutable,
	markSkiaRuntimeActivity,
	type SkiaWebCanvasColorSpace,
	type SkiaWebCanvasDynamicRange,
	type SharedValue,
	useDerivedValue,
	useSharedValue,
	withTiming,
} from "react-skia-lite";
import { acquireImageAsset } from "@/assets/imageAsset";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import {
	type CanvasNodeLabelHitTester,
	CanvasNodeLabelLayer,
} from "./CanvasNodeLabelLayer";
import { CanvasNodeOverlayLayer } from "./CanvasNodeOverlayLayer";
import type { CanvasBoardAutoLayoutIndicator } from "./canvasBoardAutoLayout";
import {
	CanvasTriDotGridBackground,
	resolveDotGridUniforms,
} from "./CanvasTriDotGridBackground";
import {
	type CanvasNodeLayoutState,
	resolveCanvasCameraTransformMatrix,
} from "./canvasNodeLabelUtils";
import type { CanvasNodeResizeAnchor } from "./canvasResizeAnchor";
import type { CanvasSnapGuidesScreen } from "./canvasSnapUtils";
import type { CameraState } from "./canvasWorkspaceUtils";
import {
	CanvasNodeFrozenRenderItem,
	CanvasNodeRenderItem,
	StaticTileLayer,
	TileDebugLayer,
} from "./InfiniteSkiaCanvasRenderLayers";
import {
	type FrozenNodeRasterSnapshot,
	type RasterImageCacheEntry,
	type TileAsyncPictureCacheEntry,
	type TileAsyncPictureRequest,
	type TileInputCacheEntry,
	canCreateFrozenSnapshotFromCompositedTiles,
	canUseTilePipeline,
	createFrozenNodeRasterSnapshot,
	createFrozenNodeRasterSnapshotFromTiles,
	disposeFrozenNodeRasterSnapshot,
	disposeTileAsyncPictureCacheEntry,
	disposeTileInput,
	EMPTY_STATIC_TILE_SNAPSHOT,
	hasThumbnailCapability,
	isStaticTileFrameFullyReady,
	isTileAabbEqual,
	resolveClippedTileInputAabb,
	resolveNodeAncestorClipAabbs,
	resolveNodeAsset,
	resolveNodeScene,
	resolveNodeWorldAabb,
	resolveSkImageSize,
	resolveTileClipSignature,
	resolveTileNodeSourceSignature,
	resolveTilePictureCapability,
	resolveTileRasterAsset,
} from "./infiniteSkiaCanvasTilePipeline";
import {
	isLayerValueEqual,
	isNodeLayoutStateEqual,
	resolveNodeLayoutState,
	resolveNodeStructureSignature,
} from "./infiniteSkiaCanvasNodeUtils";
import { useInfiniteSkiaCanvasRenderRetention } from "./useInfiniteSkiaCanvasRenderRetention";
import type { CanvasNodeDragEvent } from "./NodeInteractionWrapper";
import { getCanvasNodeDefinition } from "@/node-system/registry";
import type {
	CanvasNodeFocusEditorBridgeProps,
	CanvasNodeFocusEditorLayerState,
	CanvasNodeTilePictureCapabilityContext,
} from "@/node-system/types";
import {
	StaticTileScheduler,
	type TileAabb,
	type TileDebugItem,
	type TileDrawItem,
	type TileFrameResult,
	type TileInput,
	type TileLodTransition,
} from "./tile";

export type { CanvasNodeResizeAnchor } from "./canvasResizeAnchor";
export type {
	CanvasNodeDragEvent,
	CanvasNodePointerEvent,
} from "./NodeInteractionWrapper";

export interface CanvasNodeResizeEvent {
	phase: "start" | "move" | "end";
	node: CanvasNode;
	anchor: CanvasNodeResizeAnchor;
	event: CanvasNodeDragEvent;
}

export interface CanvasSelectionResizeEvent {
	phase: "start" | "move" | "end";
	anchor: CanvasNodeResizeAnchor;
	event: CanvasNodeDragEvent;
}

export interface CanvasMarqueeRectScreen {
	visible: boolean;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

interface InfiniteSkiaCanvasProps {
	width: number;
	height: number;
	camera: SharedValue<CameraState>;
	nodes: CanvasNode[];
	tileSourceNodes?: CanvasNode[];
	scenes: StudioProject["scenes"];
	assets: StudioProject["assets"];
	activeNodeId: string | null;
	selectedNodeIds: string[];
	focusedNodeId: string | null;
	hoveredNodeId?: string | null;
	marqueeRectScreen?: CanvasMarqueeRectScreen | null;
	snapGuidesScreen?: CanvasSnapGuidesScreen;
	boardAutoLayoutIndicator?: CanvasBoardAutoLayoutIndicator | null;
	animatedLayoutNodeIds?: string[];
	frozenNodeIds?: string[];
	forceLiveNodeIds?: string[];
	suspendHover?: boolean;
	tileDebugEnabled?: boolean;
	tileMaxTasksPerTick?: number;
	tileLodTransition?: TileLodTransition | null;
	colorSpace?: SkiaWebCanvasColorSpace;
	dynamicRange?: SkiaWebCanvasDynamicRange;
	onNodeResize?: (event: CanvasNodeResizeEvent) => void;
	onSelectionResize?: (event: CanvasSelectionResizeEvent) => void;
	onLabelHitTesterChange?: (tester: CanvasNodeLabelHitTester | null) => void;
}
const EMPTY_SNAP_GUIDES_SCREEN: CanvasSnapGuidesScreen = {
	vertical: [],
	horizontal: [],
};
const EMPTY_ANIMATED_LAYOUT_NODE_IDS: string[] = [];
const EMPTY_FROZEN_NODE_IDS: string[] = [];
const EMPTY_FORCE_LIVE_NODE_IDS: string[] = [];
const EMPTY_NODE_ID_SET = new Set<string>();

const TILE_PIPELINE_LISTENER_ID = 73001;
const NODE_HUD_FADE_IN_DURATION_MS = 180;
const STATIC_TILE_FOCUS_FADE_DURATION_MS = 220;
const AUTO_LAYOUT_TIMING = {
	duration: 220,
	easing: Easing.out(Easing.cubic),
} as const;

const InfiniteSkiaCanvas: React.FC<InfiniteSkiaCanvasProps> = ({
	width,
	height,
	camera,
	nodes,
	tileSourceNodes,
	scenes,
	assets,
	activeNodeId,
	selectedNodeIds,
	focusedNodeId,
	hoveredNodeId,
	marqueeRectScreen = null,
	snapGuidesScreen = EMPTY_SNAP_GUIDES_SCREEN,
	boardAutoLayoutIndicator = null,
	animatedLayoutNodeIds = EMPTY_ANIMATED_LAYOUT_NODE_IDS,
	frozenNodeIds = EMPTY_FROZEN_NODE_IDS,
	forceLiveNodeIds = EMPTY_FORCE_LIVE_NODE_IDS,
	suspendHover = false,
	tileDebugEnabled = false,
	tileMaxTasksPerTick,
	tileLodTransition = null,
	colorSpace,
	dynamicRange,
	onNodeResize,
	onSelectionResize,
	onLabelHitTesterChange,
}) => {
	const runtimeManager = useStudioRuntimeManager();
	const canvasRef = useRef<CanvasRef>(null);
	const tileNodes = tileSourceNodes ?? nodes;
	const animatedLayoutNodeIdSet = useMemo(() => {
		return new Set(animatedLayoutNodeIds);
	}, [animatedLayoutNodeIds]);
	const frozenNodeIdSet = useMemo(() => {
		if (frozenNodeIds.length === 0 && animatedLayoutNodeIds.length === 0) {
			return EMPTY_NODE_ID_SET;
		}
		return new Set([...frozenNodeIds, ...animatedLayoutNodeIds]);
	}, [animatedLayoutNodeIds, frozenNodeIds]);
	const forceLiveNodeIdSet = useMemo(() => {
		if (forceLiveNodeIds.length === 0) return EMPTY_NODE_ID_SET;
		return new Set(forceLiveNodeIds);
	}, [forceLiveNodeIds]);
	const isFocusMode = Boolean(focusedNodeId);
	const latestNodeById = useMemo(() => {
		return new Map(tileNodes.map((node) => [node.id, node]));
	}, [tileNodes]);
	const latestNodeByIdRef = useRef(new Map<string, CanvasNode>());
	const nodeLayoutValuesRef = useRef(
		new Map<string, SharedValue<CanvasNodeLayoutState>>(),
	);
	useLayoutEffect(() => {
		latestNodeByIdRef.current = latestNodeById;
	}, [latestNodeById]);
	const nodeStructureSignature = useMemo(() => {
		return resolveNodeStructureSignature(nodes);
	}, [nodes]);
	const renderNodesRef = useRef({
		signature: nodeStructureSignature,
		nodes,
	});
	if (renderNodesRef.current.signature !== nodeStructureSignature) {
		renderNodesRef.current = {
			signature: nodeStructureSignature,
			nodes,
		};
	}
	const renderNodes = renderNodesRef.current.nodes;
	const animatedCamera = camera;
	const animatedCameraTransform = useDerivedValue(() => {
		// 使用显式矩阵，确保世界层与 overlay 的 world->screen 公式严格一致。
		return resolveCanvasCameraTransformMatrix(animatedCamera.value);
	});
	const animatedGridUniforms = useDerivedValue(() => {
		return resolveDotGridUniforms(width, height, animatedCamera.value);
	});
	const [focusEditorLayerState, setFocusEditorLayerState] =
		useState<CanvasNodeFocusEditorLayerState>({
			enabled: false,
			layerProps: null,
		});
	const [tileTick, setTileTick] = useState(0);
	const [tileAsyncPictureVersion, setTileAsyncPictureVersion] = useState(0);
	const [rasterCacheVersion, setRasterCacheVersion] = useState(0);
	const assetById = useMemo(() => {
		return new Map(assets.map((asset) => [asset.id, asset]));
	}, [assets]);
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const supportsTilePipeline = useMemo(() => {
		return canUseTilePipeline();
	}, []);
	const tileSchedulerRef = useRef<StaticTileScheduler | null>(null);
	const rasterCacheRef = useRef(new Map<string, RasterImageCacheEntry>());
	const nodeRasterUriRef = useRef(new Map<string, string | null>());
	const tileNodeAabbRef = useRef(new Map<string, TileAabb>());
	const tileNodeSourceSignatureRef = useRef(new Map<string, string>());
	const tileInputEpochRef = useRef(new Map<string, number>());
	const tileInputCacheRef = useRef(new Map<string, TileInputCacheEntry>());
	const frozenNodeSnapshotRef = useRef(
		new Map<string, FrozenNodeRasterSnapshot>(),
	);
	const tileAsyncPictureCacheRef = useRef(
		new Map<string, TileAsyncPictureCacheEntry>(),
	);
	const tileAsyncPictureTaskIdRef = useRef(0);
	const tileInputIdRef = useRef(new Map<string, number>());
	const nextTileInputIdRef = useRef(1);
	const tileTickRafRef = useRef<number | null>(null);
	const tileListenerIdRef = useRef(
		TILE_PIPELINE_LISTENER_ID + Math.floor(Math.random() * 100000),
	);
	const tilePipelineDisposedRef = useRef(false);
	const tileTickPausedRef = useRef(isFocusMode);
	const latestTileFrameResultRef = useRef<TileFrameResult | null>(null);
	const previousTileProjectIdRef = useRef<string | null>(currentProjectId);
	const resetTilePipelineResources = useCallback(
		(options?: { flushDisposals?: boolean }) => {
			tileSchedulerRef.current?.reset({ disposeTiming: "immediate" });
			for (const entry of rasterCacheRef.current.values()) {
				entry.handle?.release();
			}
			for (const entry of tileInputCacheRef.current.values()) {
				disposeTileInput(entry.input);
			}
			for (const snapshot of frozenNodeSnapshotRef.current.values()) {
				disposeFrozenNodeRasterSnapshot(snapshot);
			}
			for (const entry of tileAsyncPictureCacheRef.current.values()) {
				disposeTileAsyncPictureCacheEntry(entry);
			}
			rasterCacheRef.current.clear();
			nodeRasterUriRef.current.clear();
			tileNodeAabbRef.current.clear();
			tileNodeSourceSignatureRef.current.clear();
			tileInputEpochRef.current.clear();
			tileInputCacheRef.current.clear();
			frozenNodeSnapshotRef.current.clear();
			tileAsyncPictureCacheRef.current.clear();
			tileAsyncPictureTaskIdRef.current = 0;
			tileInputIdRef.current.clear();
			nextTileInputIdRef.current = 1;
			latestTileFrameResultRef.current = null;
			if (options?.flushDisposals === false) return;
			// 切项目允许同步做重回收，避免旧项目资源跨项目滞留。
			flushSkiaDisposals();
		},
		[],
	);
	const getNodeLayoutValue = useCallback((nodeId: string) => {
		return nodeLayoutValuesRef.current.get(nodeId) ?? null;
	}, []);
	const getLatestNodeById = useCallback((nodeId: string) => {
		return latestNodeByIdRef.current.get(nodeId) ?? null;
	}, []);
	const resolveTileInputId = useCallback((nodeId: string): number => {
		const existing = tileInputIdRef.current.get(nodeId);
		if (existing) return existing;
		const nextId = nextTileInputIdRef.current;
		nextTileInputIdRef.current += 1;
		tileInputIdRef.current.set(nodeId, nextId);
		return nextId;
	}, []);
	const scheduleTileTick = useCallback(() => {
		if (!supportsTilePipeline) return;
		if (tilePipelineDisposedRef.current) return;
		if (tileTickPausedRef.current) return;
		if (tileTickRafRef.current !== null) return;
		tileTickRafRef.current = requestAnimationFrame(() => {
			tileTickRafRef.current = null;
			if (tilePipelineDisposedRef.current) return;
			if (tileTickPausedRef.current) return;
			setTileTick((prev) => prev + 1);
		});
	}, [supportsTilePipeline]);
	const resolveNodeRasterUri = useCallback(
		(node: CanvasNode): string | null => {
			const rasterAsset = resolveTileRasterAsset(node, assetById);
			if (!rasterAsset) return null;
			return (
				resolveAssetPlayableUri(rasterAsset, {
					projectId: currentProjectId,
				}) ?? null
			);
		},
		[assetById, currentProjectId],
	);
	const activeNode = useMemo(() => {
		if (!activeNodeId) return null;
		return renderNodes.find((node) => node.id === activeNodeId) ?? null;
	}, [activeNodeId, renderNodes]);
	const selectedNodeIdSet = useMemo(() => {
		return new Set(selectedNodeIds);
	}, [selectedNodeIds]);
	const selectedNodes = useMemo(() => {
		if (selectedNodeIdSet.size === 0) return [];
		return renderNodes.filter((node) => selectedNodeIdSet.has(node.id));
	}, [renderNodes, selectedNodeIdSet]);
	const hoverNode = useMemo(() => {
		if (!hoveredNodeId) return null;
		return renderNodes.find((node) => node.id === hoveredNodeId) ?? null;
	}, [hoveredNodeId, renderNodes]);
	const focusedNode = useMemo<CanvasNode | null>(() => {
		if (!focusedNodeId) return null;
		return nodes.find((node) => node.id === focusedNodeId) ?? null;
	}, [focusedNodeId, nodes]);
	const activeLiveNodeId = useMemo(() => {
		if (!activeNode || activeNode.type === "board") return null;
		if (
			frozenNodeIdSet.has(activeNode.id) &&
			!forceLiveNodeIdSet.has(activeNode.id)
		) {
			return null;
		}
		return activeNode.id;
	}, [activeNode, forceLiveNodeIdSet, frozenNodeIdSet]);
	const forcedLiveRenderableNodeIdSet = useMemo(() => {
		if (forceLiveNodeIdSet.size === 0) {
			return EMPTY_NODE_ID_SET;
		}
		const liveNodeIds = new Set<string>();
		for (const nodeId of forceLiveNodeIdSet) {
			const node = latestNodeById.get(nodeId);
			if (!node || node.type === "board") continue;
			liveNodeIds.add(nodeId);
		}
		if (liveNodeIds.size === 0) return EMPTY_NODE_ID_SET;
		return liveNodeIds;
	}, [forceLiveNodeIdSet, latestNodeById]);
	const liveNodeIdSet = useMemo(() => {
		if (!activeLiveNodeId && forcedLiveRenderableNodeIdSet.size === 0) {
			return EMPTY_NODE_ID_SET;
		}
		const liveNodeIds = new Set(forcedLiveRenderableNodeIdSet);
		if (activeLiveNodeId) {
			liveNodeIds.add(activeLiveNodeId);
		}
		return liveNodeIds;
	}, [activeLiveNodeId, forcedLiveRenderableNodeIdSet]);
	const {
		effectiveFrozenNodeIdSet,
		renderFrozenNodeIdSet,
		retainedFrozenNodeIdSet,
		retainedLiveNodeIdSet,
		staticTileExcludedNodeIdSet,
		releaseRetainedNodesAfterRender,
		shouldDropRetainedFrozenNodesForZoom,
	} = useInfiniteSkiaCanvasRenderRetention({
		supportsTilePipeline,
		activeNodeId,
		latestNodeById,
		liveNodeIdSet,
		frozenNodeIdSet,
		forceLiveNodeIdSet,
		cameraZoom: camera.value.zoom,
	});
	const retainedLiveRenderNodes = useMemo(() => {
		if (isFocusMode || retainedLiveNodeIdSet.size === 0) return [];
		return renderNodes.filter((node) => {
			if (effectiveFrozenNodeIdSet.has(node.id)) return false;
			return retainedLiveNodeIdSet.has(node.id);
		});
	}, [
		effectiveFrozenNodeIdSet,
		isFocusMode,
		renderNodes,
		retainedLiveNodeIdSet,
	]);
	const liveRenderNodes = useMemo(() => {
		if (liveNodeIdSet.size === 0) return [];
		return renderNodes.filter((node) => {
			if (effectiveFrozenNodeIdSet.has(node.id)) return false;
			return liveNodeIdSet.has(node.id);
		});
	}, [effectiveFrozenNodeIdSet, liveNodeIdSet, renderNodes]);
	const frozenLayoutRenderNodes = useMemo(() => {
		if (renderFrozenNodeIdSet.size === 0) return [];
		return renderNodes.filter((node) => renderFrozenNodeIdSet.has(node.id));
	}, [renderFrozenNodeIdSet, renderNodes]);
	const focusedNodeDefinition = useMemo(() => {
		if (!focusedNode) return null;
		return getCanvasNodeDefinition(focusedNode.type);
	}, [focusedNode]);
	const focusEditorLayer = focusedNodeDefinition?.focusEditorLayer ?? null;
	const focusEditorBridge = focusedNodeDefinition?.focusEditorBridge ?? null;
	const FocusEditorLayer = focusEditorLayer as React.ComponentType<
		Record<string, unknown>
	> | null;
	const FocusEditorBridge = focusEditorBridge as React.ComponentType<
		CanvasNodeFocusEditorBridgeProps<CanvasNode>
	> | null;
	const disableBaseNodeInteraction = Boolean(
		focusedNode && (focusEditorLayer || focusEditorBridge),
	);
	const focusLayerResetKey = `${focusedNodeId ?? ""}:${focusEditorLayer ? "1" : "0"}:${focusEditorBridge ? "1" : "0"}`;
	const focusLayerEnabled = Boolean(
		FocusEditorLayer &&
			focusEditorLayerState.enabled &&
			focusEditorLayerState.layerProps,
	);
	const shouldRenderNodeLabels =
		!focusedNodeId && (tileLodTransition?.mode ?? "follow") === "follow";
	const shouldRenderNodeOverlay =
		shouldRenderNodeLabels && !disableBaseNodeInteraction;
	const staticTileOpacity = useSharedValue(isFocusMode ? 0 : 1);
	const previousFocusModeRef = useRef(isFocusMode);
	useEffect(() => {
		const previous = previousFocusModeRef.current;
		previousFocusModeRef.current = isFocusMode;
		if (previous === isFocusMode) return;
		staticTileOpacity.value = withTiming(isFocusMode ? 0 : 1, {
			duration: STATIC_TILE_FOCUS_FADE_DURATION_MS,
		});
	}, [isFocusMode, staticTileOpacity]);
	useEffect(() => {
		tileTickPausedRef.current = isFocusMode;
		if (isFocusMode) {
			if (tileTickRafRef.current !== null) {
				cancelAnimationFrame(tileTickRafRef.current);
				tileTickRafRef.current = null;
			}
			return;
		}
		scheduleTileTick();
	}, [isFocusMode, scheduleTileTick]);
	const nodeHudOpacity = useSharedValue(shouldRenderNodeLabels ? 1 : 0);
	useEffect(() => {
		if (!shouldRenderNodeLabels) {
			nodeHudOpacity.value = 0;
			return;
		}
		nodeHudOpacity.value = 0;
		nodeHudOpacity.value = withTiming(1, {
			duration: NODE_HUD_FADE_IN_DURATION_MS,
		});
	}, [nodeHudOpacity, shouldRenderNodeLabels]);
	useEffect(() => {
		if (shouldRenderNodeLabels) return;
		onLabelHitTesterChange?.(null);
	}, [onLabelHitTesterChange, shouldRenderNodeLabels]);

	const handleFocusLayerChange = useCallback(
		(next: CanvasNodeFocusEditorLayerState) => {
			setFocusEditorLayerState((prev) => {
				if (
					prev.enabled === next.enabled &&
					isLayerValueEqual(prev.layerProps, next.layerProps)
				) {
					return prev;
				}
				return next;
			});
		},
		[],
	);

	useLayoutEffect(() => {
		void focusLayerResetKey;
		setFocusEditorLayerState({
			enabled: false,
			layerProps: null,
		});
	}, [focusLayerResetKey]);

	useEffect(() => {
		tilePipelineDisposedRef.current = false;
		return () => {
			tilePipelineDisposedRef.current = true;
		};
	}, []);

	useEffect(() => {
		if (!supportsTilePipeline) return;
		const scheduler = new StaticTileScheduler();
		tileSchedulerRef.current = scheduler;
		scheduleTileTick();
		return () => {
			scheduler.dispose();
			tileSchedulerRef.current = null;
			latestTileFrameResultRef.current = null;
		};
	}, [scheduleTileTick, supportsTilePipeline]);

	useEffect(() => {
		return () => {
			if (tileTickRafRef.current !== null) {
				cancelAnimationFrame(tileTickRafRef.current);
				tileTickRafRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		if (!supportsTilePipeline) return;
		const addListener = camera.addListener;
		const removeListener = camera.removeListener;
		if (
			typeof addListener !== "function" ||
			typeof removeListener !== "function"
		) {
			return;
		}
		const listenerId = tileListenerIdRef.current;
		addListener(listenerId, () => {
			markSkiaRuntimeActivity();
			scheduleTileTick();
		});
		return () => {
			removeListener(listenerId);
		};
	}, [camera, scheduleTileTick, supportsTilePipeline]);

	useEffect(() => {
		if (!supportsTilePipeline) return;
		const previousProjectId = previousTileProjectIdRef.current;
		previousTileProjectIdRef.current = currentProjectId;
		if (!previousProjectId || !currentProjectId) return;
		if (previousProjectId === currentProjectId) return;
		resetTilePipelineResources();
		setRasterCacheVersion((prev) => prev + 1);
		if (!tileTickPausedRef.current) {
			scheduleTileTick();
		}
	}, [
		currentProjectId,
		resetTilePipelineResources,
		scheduleTileTick,
		supportsTilePipeline,
	]);

	useEffect(() => {
		if (!supportsTilePipeline) return;
		const nextNodeRasterUri = new Map<string, string | null>();
		const requiredUris = new Set<string>();
		for (const node of tileNodes) {
			// 这里直接使用当帧 tileNodes，避免读取 ref 带来一帧滞后。
			const latestNode = node;
			if (staticTileExcludedNodeIdSet.has(latestNode.id)) {
				const uri = resolveNodeRasterUri(latestNode);
				nextNodeRasterUri.set(latestNode.id, uri);
				if (uri) {
					requiredUris.add(uri);
				}
				continue;
			}
			const uri = resolveNodeRasterUri(latestNode);
			nextNodeRasterUri.set(latestNode.id, uri);
			if (uri) {
				requiredUris.add(uri);
			}
		}
		nodeRasterUriRef.current = nextNodeRasterUri;
		for (const [uri, entry] of rasterCacheRef.current.entries()) {
			if (requiredUris.has(uri)) continue;
			entry.handle?.release();
			rasterCacheRef.current.delete(uri);
		}
		let disposed = false;
		for (const uri of requiredUris) {
			const existing = rasterCacheRef.current.get(uri);
			if (existing) continue;
			const nextEntry: RasterImageCacheEntry = {
				uri,
				image: null,
				width: 1,
				height: 1,
				handle: null,
				loading: true,
			};
			rasterCacheRef.current.set(uri, nextEntry);
			void (async () => {
				try {
					const handle = await acquireImageAsset(uri);
					if (disposed || tilePipelineDisposedRef.current) {
						handle.release();
						return;
					}
					const current = rasterCacheRef.current.get(uri);
					if (current !== nextEntry) {
						handle.release();
						return;
					}
					const image = handle.asset.image;
					const imageSize = resolveSkImageSize(image, 1, 1);
					nextEntry.handle = handle;
					nextEntry.image = image;
					nextEntry.width = imageSize.width;
					nextEntry.height = imageSize.height;
					nextEntry.loading = false;
					if (tilePipelineDisposedRef.current) {
						handle.release();
						return;
					}
					setRasterCacheVersion((prev) => prev + 1);
					scheduleTileTick();
				} catch {
					if (disposed || tilePipelineDisposedRef.current) return;
					const current = rasterCacheRef.current.get(uri);
					if (current !== nextEntry) return;
					nextEntry.loading = false;
					setRasterCacheVersion((prev) => prev + 1);
				}
			})();
		}
		return () => {
			disposed = true;
		};
	}, [
		staticTileExcludedNodeIdSet,
		tileNodes,
		resolveNodeRasterUri,
		scheduleTileTick,
		supportsTilePipeline,
	]);

	useEffect(() => {
		return () => {
			resetTilePipelineResources({ flushDisposals: false });
		};
	}, [resetTilePipelineResources]);

	useLayoutEffect(() => {
		const nextNodeIds = new Set<string>();
		for (const node of tileNodes) {
			nextNodeIds.add(node.id);
			const nextLayout = resolveNodeLayoutState(node);
			const currentLayout = nodeLayoutValuesRef.current.get(node.id);
			if (!currentLayout) {
				nodeLayoutValuesRef.current.set(node.id, makeMutable(nextLayout));
				continue;
			}
			if (isNodeLayoutStateEqual(currentLayout.value, nextLayout)) {
				continue;
			}
			currentLayout.value = animatedLayoutNodeIdSet.has(node.id)
				? withTiming(nextLayout, AUTO_LAYOUT_TIMING)
				: nextLayout;
		}
		for (const nodeId of nodeLayoutValuesRef.current.keys()) {
			if (nextNodeIds.has(nodeId)) continue;
			nodeLayoutValuesRef.current.delete(nodeId);
		}
	}, [animatedLayoutNodeIdSet, tileNodes]);

	useEffect(() => {
		for (const [nodeId, snapshot] of frozenNodeSnapshotRef.current.entries()) {
			if (renderFrozenNodeIdSet.has(nodeId)) continue;
			disposeFrozenNodeRasterSnapshot(snapshot);
			frozenNodeSnapshotRef.current.delete(nodeId);
		}
	}, [renderFrozenNodeIdSet]);

	useLayoutEffect(() => {
		if (!supportsTilePipeline) return;
		const scheduler = tileSchedulerRef.current;
		if (!scheduler) return;
		let shouldTick = false;
		const nextTileNodeIdSet = new Set<string>();
		for (const node of tileNodes) {
			nextTileNodeIdSet.add(node.id);
			const nextAabb = resolveNodeWorldAabb(node);
			const clipAabbs = resolveNodeAncestorClipAabbs(node, latestNodeById);
			const visibleAabb = resolveClippedTileInputAabb(nextAabb, clipAabbs);
			const clipSignature = resolveTileClipSignature(clipAabbs, visibleAabb);
			const oldAabb = tileNodeAabbRef.current.get(node.id) ?? null;
			if (staticTileExcludedNodeIdSet.has(node.id)) {
				if (!oldAabb || !isTileAabbEqual(oldAabb, nextAabb)) {
					scheduler.markDirtyUnion(oldAabb, nextAabb);
					tileNodeAabbRef.current.set(node.id, nextAabb);
					shouldTick = true;
				}
				tileNodeSourceSignatureRef.current.delete(node.id);
				continue;
			}
			const scene = resolveNodeScene(node, scenes);
			const asset = resolveNodeAsset(node, assetById);
			const sourceSignature = `${resolveTileNodeSourceSignature(
				node,
				scene,
				asset,
				hasThumbnailCapability(node),
			)}:clip:${clipSignature}`;
			if (!oldAabb || !isTileAabbEqual(oldAabb, nextAabb)) {
				scheduler.markDirtyUnion(oldAabb, nextAabb);
				tileNodeAabbRef.current.set(node.id, nextAabb);
				shouldTick = true;
			}
			const prevSignature = tileNodeSourceSignatureRef.current.get(node.id);
			if (prevSignature !== sourceSignature) {
				tileNodeSourceSignatureRef.current.set(node.id, sourceSignature);
				scheduler.markDirtyRect(nextAabb);
				shouldTick = true;
			}
		}
		for (const nodeId of [...tileNodeAabbRef.current.keys()]) {
			if (nextTileNodeIdSet.has(nodeId)) continue;
			const oldAabb = tileNodeAabbRef.current.get(nodeId) ?? null;
			if (oldAabb) {
				scheduler.markDirtyRect(oldAabb);
				shouldTick = true;
			}
			tileNodeAabbRef.current.delete(nodeId);
			tileNodeSourceSignatureRef.current.delete(nodeId);
		}
		if (shouldTick) {
			scheduleTileTick();
		}
	}, [
		assetById,
		scenes,
		scheduleTileTick,
		supportsTilePipeline,
		latestNodeById,
		staticTileExcludedNodeIdSet,
		tileNodes,
	]);

	const handleOverlayNodeResize = useCallback(
		(event: CanvasNodeResizeEvent) => {
			const latestNode = getLatestNodeById(event.node.id);
			if (!latestNode) return;
			onNodeResize?.({
				...event,
				node: latestNode,
			});
		},
		[getLatestNodeById, onNodeResize],
	);

	const staticTileSnapshot = useMemo(() => {
		void rasterCacheVersion;
		void tileAsyncPictureVersion;
		if (!supportsTilePipeline) {
			return EMPTY_STATIC_TILE_SNAPSHOT;
		}
		const inputs: TileInput[] = [];
		const inputByNodeId = new Map<string, TileInput>();
		const asyncPictureRequests: TileAsyncPictureRequest[] = [];
		const visitedNodeIds = new Set<string>();
		const createFrozenNodeSnapshotInput = (
			latestNode: CanvasNode,
		): TileInput | null => {
			const aabb = resolveNodeWorldAabb(latestNode);
			const clipAabbs = resolveNodeAncestorClipAabbs(
				latestNode,
				latestNodeById,
			);
			const visibleAabb = resolveClippedTileInputAabb(aabb, clipAabbs);
			if (!visibleAabb) return null;
			const scene = resolveNodeScene(latestNode, scenes);
			const asset = resolveNodeAsset(latestNode, assetById);
			const thumbnailCapabilityEnabled = hasThumbnailCapability(latestNode);
			const uri =
				nodeRasterUriRef.current.get(latestNode.id) ??
				resolveNodeRasterUri(latestNode);
			const rasterEntry = uri
				? (rasterCacheRef.current.get(uri) ?? null)
				: null;
			const image = rasterEntry?.image ?? null;
			const sourceWidth =
				rasterEntry?.width ??
				Math.max(1, Math.round(Math.abs(latestNode.width)));
			const sourceHeight =
				rasterEntry?.height ??
				Math.max(1, Math.round(Math.abs(latestNode.height)));
			const inputId = resolveTileInputId(latestNode.id);
			if (image) {
				return {
					kind: "raster",
					id: inputId,
					nodeId: latestNode.id,
					image,
					aabb,
					...(clipAabbs.length > 0 ? { visibleAabb, clipAabbs } : {}),
					sourceWidth,
					sourceHeight,
					epoch: 0,
				};
			}
			if (thumbnailCapabilityEnabled) return null;
			const tilePictureCapability = resolveTilePictureCapability(latestNode);
			if (!tilePictureCapability) return null;
			const tilePictureContext: CanvasNodeTilePictureCapabilityContext<CanvasNode> =
				{
					node: latestNode,
					scene,
					asset,
					runtimeManager,
				};
			const tilePictureCapabilitySourceSignature =
				tilePictureCapability.getSourceSignature?.(tilePictureContext) ?? null;
			const tilePictureSourceSignature =
				typeof tilePictureCapabilitySourceSignature === "string"
					? tilePictureCapabilitySourceSignature
					: null;
			const sourceSignature = resolveTileNodeSourceSignature(
				latestNode,
				scene,
				asset,
				thumbnailCapabilityEnabled,
			);
			const sourceKey =
				tilePictureSourceSignature !== null
					? `fallback-picture:async:${tilePictureSourceSignature}`
					: `${sourceSignature}:fallback-picture:async:none`;
			const asyncPictureEntry =
				tileAsyncPictureCacheRef.current.get(latestNode.id) ?? null;
			if (asyncPictureEntry?.sourceSignature !== sourceKey) {
				asyncPictureRequests.push({
					nodeId: latestNode.id,
					sourceSignature: sourceKey,
					capability: tilePictureCapability,
					context: tilePictureContext,
				});
			}
			if (!asyncPictureEntry?.picture) return null;
			return {
				kind: "picture",
				id: inputId,
				nodeId: latestNode.id,
				picture: asyncPictureEntry.picture,
				aabb,
				...(clipAabbs.length > 0 ? { visibleAabb, clipAabbs } : {}),
				sourceWidth: Math.max(1, asyncPictureEntry.sourceWidth),
				sourceHeight: Math.max(1, asyncPictureEntry.sourceHeight),
				epoch: 0,
				dispose: null,
			};
		};
		for (const node of tileNodes) {
			// 这里直接使用当帧 tileNodes，避免 undo/redo 与拖拽时 tile 输入落后一帧。
			const latestNode = node;
			if (effectiveFrozenNodeIdSet.has(latestNode.id)) {
				const cachedInput =
					tileInputCacheRef.current.get(latestNode.id)?.input ?? null;
				if (!frozenNodeSnapshotRef.current.has(latestNode.id)) {
					let transientInput: TileInput | null = null;
					if (!cachedInput) {
						transientInput = createFrozenNodeSnapshotInput(latestNode);
					}
					const snapshotInput = cachedInput ?? transientInput;
					const snapshot =
						(cachedInput &&
						canCreateFrozenSnapshotFromCompositedTiles(latestNode)
							? createFrozenNodeRasterSnapshotFromTiles(
									cachedInput,
									latestTileFrameResultRef.current?.drawItems ?? [],
								)
							: null) ??
						(snapshotInput
							? createFrozenNodeRasterSnapshot(snapshotInput, camera.value.zoom)
							: null);
					if (snapshot) {
						frozenNodeSnapshotRef.current.set(latestNode.id, snapshot);
					}
					if (transientInput) {
						disposeTileInput(transientInput);
					}
				}
				// frozen 节点优先复用上一帧 static tile 纹理，保证 drag start 不换采样质量。
				visitedNodeIds.add(latestNode.id);
				continue;
			}
			if (liveNodeIdSet.has(latestNode.id)) {
				// 拖拽中的 live 节点保留上一帧 tile input，drop 后的布局动画会复用它。
				visitedNodeIds.add(latestNode.id);
				continue;
			}
			visitedNodeIds.add(latestNode.id);
			const aabb = resolveNodeWorldAabb(latestNode);
			const clipAabbs = resolveNodeAncestorClipAabbs(
				latestNode,
				latestNodeById,
			);
			const visibleAabb = resolveClippedTileInputAabb(aabb, clipAabbs);
			const clipSignature = resolveTileClipSignature(clipAabbs, visibleAabb);
			const scene = resolveNodeScene(latestNode, scenes);
			const asset = resolveNodeAsset(latestNode, assetById);
			const thumbnailCapabilityEnabled = hasThumbnailCapability(latestNode);
			const uri =
				nodeRasterUriRef.current.get(latestNode.id) ??
				resolveNodeRasterUri(latestNode);
			const rasterEntry = uri
				? (rasterCacheRef.current.get(uri) ?? null)
				: null;
			const image = rasterEntry?.image ?? null;
			const sourceSignature = resolveTileNodeSourceSignature(
				latestNode,
				scene,
				asset,
				thumbnailCapabilityEnabled,
			);
			const cachedEntry = tileInputCacheRef.current.get(latestNode.id);
			const sourceWidth =
				rasterEntry?.width ??
				Math.max(1, Math.round(Math.abs(latestNode.width)));
			const sourceHeight =
				rasterEntry?.height ??
				Math.max(1, Math.round(Math.abs(latestNode.height)));
			const shouldUsePictureFallback = !image && !thumbnailCapabilityEnabled;
			const tilePictureCapability = shouldUsePictureFallback
				? resolveTilePictureCapability(latestNode)
				: null;
			const tilePictureContext: CanvasNodeTilePictureCapabilityContext<CanvasNode> =
				{
					node: latestNode,
					scene,
					asset,
					runtimeManager,
				};
			const tilePictureCapabilitySourceSignature =
				tilePictureCapability?.getSourceSignature?.(tilePictureContext) ?? null;
			const tilePictureSourceSignature =
				typeof tilePictureCapabilitySourceSignature === "string"
					? tilePictureCapabilitySourceSignature
					: null;
			const sourceKey = shouldUsePictureFallback
				? tilePictureCapability
					? // 当 capability 提供专用签名时，不再混入 updatedAt（拖拽位移也会变化），
						// 避免位置拖拽触发 picture 缓存抖动导致闪烁。
						tilePictureSourceSignature !== null
						? `fallback-picture:async:${tilePictureSourceSignature}`
						: `${sourceSignature}:fallback-picture:async:none`
					: `${sourceSignature}:fallback-picture:disabled`
				: sourceSignature;
			const inputSourceKey = `${sourceKey}:clip:${clipSignature}`;
			const modeKey: TileInputCacheEntry["mode"] = shouldUsePictureFallback
				? "fallback-picture"
				: "raster";
			let epoch = cachedEntry?.epoch ?? 0;
			const sourceChanged = cachedEntry?.sourceSignature !== inputSourceKey;
			const modeChanged = cachedEntry?.mode !== modeKey;
			const imageChanged = cachedEntry?.rasterImage !== image;
			if (!cachedEntry || sourceChanged || modeChanged || imageChanged) {
				epoch += 1;
			}
			const inputId = resolveTileInputId(latestNode.id);
			let input: TileInput | null = null;
			if (!visibleAabb) {
				disposeTileInput(cachedEntry?.input);
			} else if (image) {
				if (cachedEntry?.input?.kind === "picture") {
					disposeTileInput(cachedEntry.input);
				}
				input = {
					kind: "raster",
					id: inputId,
					nodeId: latestNode.id,
					image,
					aabb,
					...(clipAabbs.length > 0 ? { visibleAabb, clipAabbs } : {}),
					sourceWidth,
					sourceHeight,
					epoch,
				};
			} else if (shouldUsePictureFallback) {
				if (tilePictureCapability) {
					const asyncPictureEntry =
						tileAsyncPictureCacheRef.current.get(latestNode.id) ?? null;
					const hasMatchingAsyncPictureSource =
						asyncPictureEntry?.sourceSignature === sourceKey;
					const shouldQueueAsyncPictureRequest = !hasMatchingAsyncPictureSource;
					if (shouldQueueAsyncPictureRequest) {
						asyncPictureRequests.push({
							nodeId: latestNode.id,
							sourceSignature: sourceKey,
							capability: tilePictureCapability,
							context: tilePictureContext,
						});
					}
					if (asyncPictureEntry?.picture) {
						input = {
							kind: "picture",
							id: inputId,
							nodeId: latestNode.id,
							picture: asyncPictureEntry.picture,
							aabb,
							...(clipAabbs.length > 0 ? { visibleAabb, clipAabbs } : {}),
							sourceWidth: Math.max(1, asyncPictureEntry.sourceWidth),
							sourceHeight: Math.max(1, asyncPictureEntry.sourceHeight),
							epoch,
							dispose: null,
						};
					} else {
						disposeTileInput(cachedEntry?.input);
					}
				} else {
					disposeTileInput(cachedEntry?.input);
					// 通用 renderer -> picture fallback 目前会让部分节点的 static tile
					// 不稳定，必须显式提供 tilePicture capability 后才进入 tile 层。
				}
			} else {
				disposeTileInput(cachedEntry?.input);
			}
			tileInputCacheRef.current.set(latestNode.id, {
				epoch,
				sourceSignature: inputSourceKey,
				mode: modeKey,
				rasterImage: image,
				input,
			});
			if (!input) continue;
			inputs.push(input);
			inputByNodeId.set(latestNode.id, input);
		}
		for (const nodeId of [...tileInputCacheRef.current.keys()]) {
			if (visitedNodeIds.has(nodeId)) continue;
			const removedEntry = tileInputCacheRef.current.get(nodeId);
			disposeTileInput(removedEntry?.input);
			tileInputCacheRef.current.delete(nodeId);
			tileInputIdRef.current.delete(nodeId);
		}
		for (const nodeId of [...tileAsyncPictureCacheRef.current.keys()]) {
			if (visitedNodeIds.has(nodeId)) continue;
			const removedEntry = tileAsyncPictureCacheRef.current.get(nodeId);
			disposeTileAsyncPictureCacheEntry(removedEntry);
			tileAsyncPictureCacheRef.current.delete(nodeId);
		}
		return {
			inputs,
			inputByNodeId,
			asyncPictureRequests,
		};
	}, [
		assetById,
		camera,
		effectiveFrozenNodeIdSet,
		latestNodeById,
		liveNodeIdSet,
		rasterCacheVersion,
		resolveNodeRasterUri,
		resolveTileInputId,
		runtimeManager,
		scenes,
		supportsTilePipeline,
		tileAsyncPictureVersion,
		tileNodes,
	]);

	useEffect(() => {
		if (!supportsTilePipeline) return;
		if (staticTileSnapshot.asyncPictureRequests.length <= 0) return;
		for (const request of staticTileSnapshot.asyncPictureRequests) {
			const existingEntry =
				tileAsyncPictureCacheRef.current.get(request.nodeId) ?? null;
			if (
				existingEntry &&
				existingEntry.sourceSignature === request.sourceSignature &&
				(existingEntry.status === "pending" || existingEntry.status === "ready")
			) {
				continue;
			}
			const taskId = tileAsyncPictureTaskIdRef.current + 1;
			tileAsyncPictureTaskIdRef.current = taskId;
			const fallbackPicture = existingEntry?.picture ?? null;
			const fallbackDispose = existingEntry?.dispose ?? null;
			tileAsyncPictureCacheRef.current.set(request.nodeId, {
				sourceSignature: request.sourceSignature,
				status: "pending",
				picture: fallbackPicture,
				sourceWidth: Math.max(
					1,
					Math.round(
						Math.abs(existingEntry?.sourceWidth ?? request.context.node.width),
					),
				),
				sourceHeight: Math.max(
					1,
					Math.round(
						Math.abs(
							existingEntry?.sourceHeight ?? request.context.node.height,
						),
					),
				),
				dispose: fallbackDispose,
				taskId,
			});
			void Promise.resolve(request.capability.generate(request.context))
				.then((result) => {
					const latestEntry =
						tileAsyncPictureCacheRef.current.get(request.nodeId) ?? null;
					if (
						!latestEntry ||
						latestEntry.taskId !== taskId ||
						latestEntry.sourceSignature !== request.sourceSignature
					) {
						try {
							result?.dispose?.();
							result?.picture?.dispose?.();
						} catch {}
						return;
					}
					if (!result?.picture) {
						latestEntry.status = "failed";
						setTileAsyncPictureVersion((prev) => prev + 1);
						scheduleTileTick();
						return;
					}
					const previousDispose = latestEntry.dispose;
					if (previousDispose) {
						try {
							previousDispose();
						} catch {}
					}
					latestEntry.status = "ready";
					latestEntry.picture = result.picture;
					latestEntry.sourceWidth = Math.max(
						1,
						Math.round(result.sourceWidth || latestEntry.sourceWidth),
					);
					latestEntry.sourceHeight = Math.max(
						1,
						Math.round(result.sourceHeight || latestEntry.sourceHeight),
					);
					latestEntry.dispose = () => {
						try {
							result.dispose?.();
						} finally {
							try {
								result.picture.dispose?.();
							} catch {}
						}
					};
					setTileAsyncPictureVersion((prev) => prev + 1);
					scheduleTileTick();
				})
				.catch(() => {
					const latestEntry =
						tileAsyncPictureCacheRef.current.get(request.nodeId) ?? null;
					if (
						!latestEntry ||
						latestEntry.taskId !== taskId ||
						latestEntry.sourceSignature !== request.sourceSignature
					) {
						return;
					}
					latestEntry.status = "failed";
					setTileAsyncPictureVersion((prev) => prev + 1);
					scheduleTileTick();
				});
		}
	}, [
		scheduleTileTick,
		staticTileSnapshot.asyncPictureRequests,
		supportsTilePipeline,
	]);

	useLayoutEffect(() => {
		if (!supportsTilePipeline) return;
		const scheduler = tileSchedulerRef.current;
		if (!scheduler) return;
		let shouldTick = false;
		const nextInputNodeIdSet = new Set<string>();
		for (const input of staticTileSnapshot.inputs) {
			nextInputNodeIdSet.add(input.nodeId);
			const prevEpoch = tileInputEpochRef.current.get(input.nodeId);
			if (prevEpoch !== input.epoch) {
				// 输入纹理晚到或替换时，强制重建覆盖区域，避免复用旧 tile 内容。
				scheduler.markDirtyRect(input.aabb);
				shouldTick = true;
			}
			tileInputEpochRef.current.set(input.nodeId, input.epoch);
		}
		for (const nodeId of [...tileInputEpochRef.current.keys()]) {
			if (nextInputNodeIdSet.has(nodeId)) continue;
			tileInputEpochRef.current.delete(nodeId);
		}
		if (shouldTick) {
			scheduleTileTick();
		}
	}, [scheduleTileTick, staticTileSnapshot.inputs, supportsTilePipeline]);

	useLayoutEffect(() => {
		void tileTick;
		const root = canvasRef.current?.getRoot();
		if (!root) return;
		let staticTileDrawItems: TileDrawItem[] = [];
		let tileDebugItems: TileDebugItem[] = [];
		let shouldReleaseRetainedFrozenNodes = false;
		let shouldReleaseRetainedLiveNodes = false;
		const shouldDropRetainedFrozenNodes = shouldDropRetainedFrozenNodesForZoom(
			camera.value.zoom,
		);
		const scheduler = supportsTilePipeline ? tileSchedulerRef.current : null;
		if (scheduler) {
			if (!isFocusMode) {
				scheduler.setInputs(staticTileSnapshot.inputs);
				const frameResult = scheduler.beginFrame({
					camera: camera.value,
					stageWidth: width,
					stageHeight: height,
					nowMs:
						typeof performance !== "undefined" ? performance.now() : Date.now(),
					debugEnabled: tileDebugEnabled,
					maxTasksPerTick: tileMaxTasksPerTick,
					lodTransitionMode: tileLodTransition?.mode,
					lodAnchorZoom: tileLodTransition?.zoom,
				});
				latestTileFrameResultRef.current = frameResult;
				staticTileDrawItems = frameResult.drawItems;
				tileDebugItems = frameResult.debugItems;
				if (frameResult.hasPendingWork) {
					scheduleTileTick();
				}
				shouldReleaseRetainedFrozenNodes =
					retainedFrozenNodeIdSet.size > 0 &&
					isStaticTileFrameFullyReady(frameResult);
				shouldReleaseRetainedLiveNodes =
					retainedLiveNodeIdSet.size > 0 &&
					isStaticTileFrameFullyReady(frameResult);
			} else {
				const previousFrameResult = latestTileFrameResultRef.current;
				if (previousFrameResult) {
					staticTileDrawItems = previousFrameResult.drawItems;
					tileDebugItems = previousFrameResult.debugItems;
				}
			}
		}
		const renderLiveNodeItem = (node: CanvasNode) => {
			const layout = getNodeLayoutValue(node.id);
			if (!layout) return null;
			const latestNode = getLatestNodeById(node.id) ?? node;
			const renderNode = latestNode;
			const ancestorClipAabbs = resolveNodeAncestorClipAabbs(
				latestNode,
				latestNodeById,
			);
			const scene =
				latestNode.type === "scene"
					? (scenes[latestNode.sceneId] ?? null)
					: null;
			const asset =
				"assetId" in latestNode
					? (assetById.get(latestNode.assetId) ?? null)
					: null;
			return (
				<CanvasNodeRenderItem
					key={`canvas-node-render-${node.id}`}
					node={renderNode}
					layout={layout}
					ancestorClipAabbs={ancestorClipAabbs}
					scene={scene}
					asset={asset}
					isActive={node.id === activeNodeId}
					isFocused={node.id === focusedNodeId}
					runtimeManager={runtimeManager}
				/>
			);
		};
		root.render(
			<Group>
				<CanvasTriDotGridBackground
					width={width}
					height={height}
					uniforms={animatedGridUniforms}
				/>
				<Group transform={animatedCameraTransform}>
					<Group opacity={staticTileOpacity}>
						<StaticTileLayer drawItems={staticTileDrawItems} />
					</Group>
					{tileDebugEnabled && (
						<TileDebugLayer
							debugItems={tileDebugItems}
							cameraZoom={camera.value.zoom}
						/>
					)}
					{frozenLayoutRenderNodes.map((node) => {
						if (
							(shouldReleaseRetainedFrozenNodes ||
								shouldDropRetainedFrozenNodes) &&
							retainedFrozenNodeIdSet.has(node.id) &&
							!effectiveFrozenNodeIdSet.has(node.id)
						) {
							return null;
						}
						const layout = getNodeLayoutValue(node.id);
						if (!layout) return null;
						const latestNode = getLatestNodeById(node.id) ?? node;
						const snapshot = frozenNodeSnapshotRef.current.get(node.id) ?? null;
						if (!snapshot) return null;
						const ancestorClipAabbs = resolveNodeAncestorClipAabbs(
							latestNode,
							latestNodeById,
						);
						return (
							<CanvasNodeFrozenRenderItem
								key={`canvas-node-frozen-render-${node.id}`}
								node={latestNode}
								layout={layout}
								ancestorClipAabbs={ancestorClipAabbs}
								snapshot={snapshot}
							/>
						);
					})}
					{retainedLiveRenderNodes.map(renderLiveNodeItem)}
					{liveRenderNodes.map(renderLiveNodeItem)}
				</Group>
				{shouldRenderNodeLabels && (
					<Group opacity={nodeHudOpacity}>
						<CanvasNodeLabelLayer
							width={width}
							height={height}
							camera={animatedCamera}
							getNodeLayout={getNodeLayoutValue}
							nodes={renderNodes}
							focusedNodeId={focusedNodeId}
							onHitTesterChange={onLabelHitTesterChange}
						/>
						{shouldRenderNodeOverlay && (
							<CanvasNodeOverlayLayer
								width={width}
								height={height}
								activeNode={activeNode}
								getNodeLayout={getNodeLayoutValue}
								selectedNodes={selectedNodes}
								hoverNode={hoverNode}
								marqueeRectScreen={marqueeRectScreen}
								snapGuidesScreen={snapGuidesScreen}
								boardAutoLayoutIndicator={boardAutoLayoutIndicator}
								camera={animatedCamera}
								onNodeResize={handleOverlayNodeResize}
								onSelectionResize={onSelectionResize}
							/>
						)}
					</Group>
				)}
				{focusLayerEnabled &&
					FocusEditorLayer &&
					focusEditorLayerState.layerProps && (
						<FocusEditorLayer {...focusEditorLayerState.layerProps} />
					)}
			</Group>,
		);
		releaseRetainedNodesAfterRender({
			releaseRetainedFrozenNodes: shouldReleaseRetainedFrozenNodes,
			dropRetainedFrozenNodesForZoom: shouldDropRetainedFrozenNodes,
			releaseRetainedLiveNodes: shouldReleaseRetainedLiveNodes,
		});
	}, [
		activeNode,
		activeNodeId,
		assetById,
		boardAutoLayoutIndicator,
		getNodeLayoutValue,
		focusedNodeId,
		frozenLayoutRenderNodes,
		focusEditorLayerState.layerProps,
		focusLayerEnabled,
		handleOverlayNodeResize,
		height,
		hoverNode,
		onSelectionResize,
		onLabelHitTesterChange,
		liveRenderNodes,
		latestNodeById,
		marqueeRectScreen,
		effectiveFrozenNodeIdSet,
		retainedFrozenNodeIdSet,
		retainedLiveRenderNodes,
		retainedLiveNodeIdSet,
		releaseRetainedNodesAfterRender,
		scheduleTileTick,
		shouldDropRetainedFrozenNodesForZoom,
		snapGuidesScreen,
		staticTileSnapshot,
		supportsTilePipeline,
		isFocusMode,
		tileTick,
		tileDebugEnabled,
		tileLodTransition,
		tileMaxTasksPerTick,
		runtimeManager,
		scenes,
		shouldRenderNodeOverlay,
		shouldRenderNodeLabels,
		selectedNodes,
		FocusEditorLayer,
		width,
		animatedCamera,
		animatedCameraTransform,
		animatedGridUniforms,
		camera,
		getLatestNodeById,
		nodeHudOpacity,
		staticTileOpacity,
		renderNodes,
	]);

	if (width <= 0 || height <= 0) return null;

	return (
		<div
			data-testid="infinite-skia-canvas"
			data-canvas-surface="true"
			className={`absolute inset-0 ${
				suspendHover ? "pointer-events-none" : "pointer-events-auto"
			}`}
		>
			<Canvas
				ref={canvasRef}
				style={{ width, height }}
				colorSpace={colorSpace}
				dynamicRange={dynamicRange}
			/>
			{!suspendHover && focusedNode && FocusEditorBridge && (
				<FocusEditorBridge
					width={width}
					height={height}
					camera={camera.value}
					runtimeManager={runtimeManager}
					focusedNode={focusedNode}
					suspendHover={suspendHover}
					onLayerChange={handleFocusLayerChange}
				/>
			)}
		</div>
	);
};

export default InfiniteSkiaCanvas;
