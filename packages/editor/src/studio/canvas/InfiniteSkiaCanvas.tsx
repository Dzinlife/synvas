import { renderNodeToPicture } from "core/render-system/renderNodeSnapshot";
import type { TimelineAsset } from "core/timeline-system/types";
import type { CanvasNode, StudioProject } from "@/studio/project/types";
import type React from "react";
import {
	memo,
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
	Image,
	type Matrix4,
	makeMutable,
	markSkiaRuntimeActivity,
	Rect,
	type SharedValue,
	type SkImage,
	Skia,
	type SkPicture,
	Text,
	useDerivedValue,
	useFont,
	useSharedValue,
	withTiming,
} from "react-skia-lite";
import type { AssetHandle } from "@/assets/AssetStore";
import { acquireImageAsset, type ImageAsset } from "@/assets/imageAsset";
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
	resolveCanvasNodeLayoutWorldRect,
} from "./canvasNodeLabelUtils";
import type { CanvasNodeResizeAnchor } from "./canvasResizeAnchor";
import type { CanvasSnapGuidesScreen } from "./canvasSnapUtils";
import type { CameraState } from "./canvasWorkspaceUtils";
import type { CanvasNodeDragEvent } from "./NodeInteractionWrapper";
import { getCanvasNodeDefinition } from "@/node-system/registry";
import type {
	CanvasNodeFocusEditorBridgeProps,
	CanvasNodeFocusEditorLayerState,
	CanvasNodeSkiaRenderProps,
	CanvasNodeTilePictureCapability,
	CanvasNodeTilePictureCapabilityContext,
} from "@/node-system/types";
import {
	createTileAabb,
	StaticTileScheduler,
	TILE_CAMERA_EPSILON,
	TILE_PIXEL_SIZE,
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
	suspendHover?: boolean;
	tileDebugEnabled?: boolean;
	tileMaxTasksPerTick?: number;
	tileLodTransition?: TileLodTransition | null;
	onNodeResize?: (event: CanvasNodeResizeEvent) => void;
	onSelectionResize?: (event: CanvasSelectionResizeEvent) => void;
	onLabelHitTesterChange?: (tester: CanvasNodeLabelHitTester | null) => void;
}
const EMPTY_SNAP_GUIDES_SCREEN: CanvasSnapGuidesScreen = {
	vertical: [],
	horizontal: [],
};
const EMPTY_ANIMATED_LAYOUT_NODE_IDS: string[] = [];

const LAYOUT_EPSILON = 1e-6;
const TILE_AABB_EPSILON = 1e-4;
const TILE_PIPELINE_LISTENER_ID = 73001;
const TILE_DEBUG_COORD_LABEL_LIMIT = 96;
const TILE_DEBUG_FONT_URI = "/Roboto-Medium.ttf";
const TILE_DEBUG_FONT_SIZE_PX = 10;
const TILE_DEBUG_TEXT_COLOR = "rgba(255,255,255,0.96)";
const TILE_DEBUG_LABEL_OFFSET_X = 4;
const TILE_DEBUG_LABEL_OFFSET_Y = 4;
const TILE_DRAW_BLEED_TEXEL = 0.5;
const NODE_HUD_FADE_IN_DURATION_MS = 180;
const STATIC_TILE_FOCUS_FADE_DURATION_MS = 220;
const AUTO_LAYOUT_TIMING = {
	duration: 220,
	easing: Easing.out(Easing.cubic),
} as const;

interface RasterImageCacheEntry {
	uri: string;
	image: SkImage | null;
	width: number;
	height: number;
	handle: AssetHandle<ImageAsset> | null;
	loading: boolean;
}

interface TileInputCacheEntry {
	epoch: number;
	sourceSignature: string;
	mode: "raster" | "fallback-picture";
	rasterImage: SkImage | null;
	input: TileInput | null;
}

interface TileAsyncPictureCacheEntry {
	sourceSignature: string;
	status: "pending" | "ready" | "failed";
	picture: SkPicture | null;
	sourceWidth: number;
	sourceHeight: number;
	dispose: (() => void) | null;
	taskId: number;
}

interface TileAsyncPictureRequest {
	nodeId: string;
	sourceSignature: string;
	capability: CanvasNodeTilePictureCapability<CanvasNode>;
	context: CanvasNodeTilePictureCapabilityContext<CanvasNode>;
}

const disposeTileAsyncPictureCacheEntry = (
	entry: TileAsyncPictureCacheEntry | null | undefined,
): void => {
	if (!entry?.dispose) return;
	try {
		entry.dispose();
	} catch {}
};

const EMPTY_STATIC_TILE_SNAPSHOT: {
	inputs: TileInput[];
	inputByNodeId: Map<string, TileInput>;
	asyncPictureRequests: TileAsyncPictureRequest[];
} = {
	inputs: [],
	inputByNodeId: new Map<string, TileInput>(),
	asyncPictureRequests: [],
};

const resolveTileNodeSourceSignature = (
	node: CanvasNode,
	scene: StudioProject["scenes"][string] | null,
	asset: TimelineAsset | null,
	thumbnailCapabilityEnabled: boolean,
): string => {
	const parts = [node.id, node.type, String(node.updatedAt)];
	if ("assetId" in node) {
		const sourceHash =
			typeof asset?.meta?.hash === "string" ? asset.meta.hash : "none";
		parts.push(node.assetId || "none", sourceHash);
	}
	if (thumbnailCapabilityEnabled) {
		parts.push(node.thumbnail?.sourceSignature ?? "none");
	}
	if (scene) {
		parts.push(String(scene.updatedAt));
	}
	return parts.join(":");
};

const hasThumbnailCapability = (node: CanvasNode): boolean => {
	const definition = getCanvasNodeDefinition(node.type);
	return Boolean(definition.thumbnail);
};

const resolveTilePictureCapability = (
	node: CanvasNode,
): CanvasNodeTilePictureCapability<CanvasNode> | null => {
	const definition = getCanvasNodeDefinition(node.type);
	return (
		(definition.tilePicture as CanvasNodeTilePictureCapability<CanvasNode>) ??
		null
	);
};

const resolveNodeScene = (
	node: CanvasNode,
	scenes: StudioProject["scenes"],
): StudioProject["scenes"][string] | null => {
	if (node.type !== "scene") return null;
	return scenes[node.sceneId] ?? null;
};

const resolveNodeAsset = (
	node: CanvasNode,
	assetById: Map<string, TimelineAsset>,
): TimelineAsset | null => {
	if (!("assetId" in node) || !node.assetId) return null;
	return assetById.get(node.assetId) ?? null;
};

const resolveSkImageSize = (
	image: SkImage,
	fallbackWidth: number,
	fallbackHeight: number,
): { width: number; height: number } => {
	const candidate = image as {
		width?: number | (() => number);
		height?: number | (() => number);
	};
	const width =
		typeof candidate.width === "function"
			? candidate.width()
			: (candidate.width ?? fallbackWidth);
	const height =
		typeof candidate.height === "function"
			? candidate.height()
			: (candidate.height ?? fallbackHeight);
	return {
		width: Math.max(1, Math.round(width)),
		height: Math.max(1, Math.round(height)),
	};
};

const disposeTileInput = (input: TileInput | null | undefined) => {
	if (!input) return;
	try {
		input.dispose?.();
	} catch {}
};

const isTileAabbEqual = (left: TileAabb, right: TileAabb): boolean => {
	return (
		Math.abs(left.left - right.left) < TILE_AABB_EPSILON &&
		Math.abs(left.top - right.top) < TILE_AABB_EPSILON &&
		Math.abs(left.right - right.right) < TILE_AABB_EPSILON &&
		Math.abs(left.bottom - right.bottom) < TILE_AABB_EPSILON
	);
};

const resolveNodeWorldAabb = (
	node: Pick<CanvasNode, "x" | "y" | "width" | "height">,
): TileAabb => {
	return createTileAabb(
		node.x,
		node.y,
		node.x + node.width,
		node.y + node.height,
	);
};

const intersectTileAabb = (
	left: TileAabb,
	right: TileAabb,
): TileAabb | null => {
	const nextLeft = Math.max(left.left, right.left);
	const nextTop = Math.max(left.top, right.top);
	const nextRight = Math.min(left.right, right.right);
	const nextBottom = Math.min(left.bottom, right.bottom);
	if (nextLeft >= nextRight || nextTop >= nextBottom) return null;
	return createTileAabb(nextLeft, nextTop, nextRight, nextBottom);
};

const resolveNodeAncestorClipAabbs = (
	node: CanvasNode,
	nodeById: Map<string, CanvasNode>,
): TileAabb[] => {
	const clipAabbs: TileAabb[] = [];
	const visitedNodeIds = new Set<string>();
	let parentId = node.parentId ?? null;
	while (parentId) {
		if (visitedNodeIds.has(parentId)) break;
		visitedNodeIds.add(parentId);
		const parentNode = nodeById.get(parentId);
		if (!parentNode) break;
		if (parentNode.type === "board") {
			clipAabbs.push(resolveNodeWorldAabb(parentNode));
		}
		parentId = parentNode.parentId ?? null;
	}
	return clipAabbs.reverse();
};

const resolveClippedTileInputAabb = (
	aabb: TileAabb,
	clipAabbs: TileAabb[],
): TileAabb | null => {
	let visibleAabb: TileAabb | null = aabb;
	for (const clipAabb of clipAabbs) {
		visibleAabb = intersectTileAabb(visibleAabb, clipAabb);
		if (!visibleAabb) return null;
	}
	return visibleAabb;
};

const resolveTileClipSignature = (
	clipAabbs: TileAabb[],
	visibleAabb: TileAabb | null,
): string => {
	if (clipAabbs.length === 0) return "none";
	const aabbToSignature = (aabb: TileAabb): string => {
		return [
			Math.round(aabb.left * 1000),
			Math.round(aabb.top * 1000),
			Math.round(aabb.right * 1000),
			Math.round(aabb.bottom * 1000),
		].join(",");
	};
	return [
		visibleAabb ? aabbToSignature(visibleAabb) : "empty",
		...clipAabbs.map(aabbToSignature),
	].join("|");
};

const resolveTileRasterAsset = (
	node: CanvasNode,
	assetById: Map<string, TimelineAsset>,
): TimelineAsset | null => {
	if ("assetId" in node) {
		const sourceAsset = assetById.get(node.assetId);
		if (sourceAsset?.kind === "image") {
			return sourceAsset;
		}
	}
	if (!hasThumbnailCapability(node)) return null;
	const thumbnailAssetId = node.thumbnail?.assetId ?? null;
	if (!thumbnailAssetId) return null;
	const thumbnailAsset = assetById.get(thumbnailAssetId);
	if (!thumbnailAsset || thumbnailAsset.kind !== "image") return null;
	return thumbnailAsset;
};

const createTilePictureFromNodeRenderer = ({
	node,
	scene,
	asset,
	runtimeManager,
}: {
	node: CanvasNode;
	scene: StudioProject["scenes"][string] | null;
	asset: TimelineAsset | null;
	runtimeManager: ReturnType<typeof useStudioRuntimeManager>;
}): { picture: SkPicture; dispose: () => void } | null => {
	const definition = getCanvasNodeDefinition(node.type);
	const Renderer = definition.skiaRenderer as React.ComponentType<
		CanvasNodeSkiaRenderProps<CanvasNode>
	>;
	const sourceWidth = Math.max(1, Math.round(Math.abs(node.width)));
	const sourceHeight = Math.max(1, Math.round(Math.abs(node.height)));
	const picture = renderNodeToPicture(
		<Renderer
			node={node}
			scene={scene}
			asset={asset}
			isActive={false}
			isFocused={false}
			runtimeManager={runtimeManager}
		/>,
		{
			width: sourceWidth,
			height: sourceHeight,
		},
	);
	if (!picture) return null;
	return {
		picture,
		dispose: () => {
			try {
				picture.dispose?.();
			} catch {}
		},
	};
};

const canUseTilePipeline = (): boolean => {
	const surfaceFactory = (
		Skia as unknown as { Surface?: { MakeOffscreen?: unknown } }
	).Surface?.MakeOffscreen;
	const paintFactory = (Skia as unknown as { Paint?: unknown }).Paint;
	return (
		typeof surfaceFactory === "function" && typeof paintFactory === "function"
	);
};

const resolveNodeLayoutState = (node: CanvasNode): CanvasNodeLayoutState => {
	return {
		x: node.x,
		y: node.y,
		width: node.width,
		height: node.height,
	};
};

const isNodeLayoutStateEqual = (
	left: CanvasNodeLayoutState,
	right: CanvasNodeLayoutState,
): boolean => {
	return (
		Math.abs(left.x - right.x) < LAYOUT_EPSILON &&
		Math.abs(left.y - right.y) < LAYOUT_EPSILON &&
		Math.abs(left.width - right.width) < LAYOUT_EPSILON &&
		Math.abs(left.height - right.height) < LAYOUT_EPSILON
	);
};

const resolveNodeStructureSignature = (nodes: CanvasNode[]): string => {
	return JSON.stringify(
		nodes.map(({ x, y, width, height, updatedAt, ...rest }) => {
			void updatedAt;
			return rest;
		}),
	);
};

interface CanvasNodeRenderItemProps {
	node: CanvasNode;
	layout: SharedValue<CanvasNodeLayoutState>;
	scene: StudioProject["scenes"][string] | null;
	asset: StudioProject["assets"][number] | null;
	isActive: boolean;
	isFocused: boolean;
	runtimeManager: ReturnType<typeof useStudioRuntimeManager>;
}

const CanvasNodeRenderItemComponent = ({
	node,
	layout,
	scene,
	asset,
	isActive,
	isFocused,
	runtimeManager,
}: CanvasNodeRenderItemProps) => {
	const definition = getCanvasNodeDefinition(node.type);
	const Renderer = definition.skiaRenderer as React.ComponentType<
		CanvasNodeSkiaRenderProps<CanvasNode>
	>;
	const clip = useDerivedValue(() => {
		const worldRect = resolveCanvasNodeLayoutWorldRect(layout.value);
		return {
			x: worldRect.left,
			y: worldRect.top,
			width: worldRect.width,
			height: worldRect.height,
		};
	});
	const renderTransform = useDerivedValue(() => {
		const safeWidth = Math.max(Math.abs(node.width), LAYOUT_EPSILON);
		const safeHeight = Math.max(Math.abs(node.height), LAYOUT_EPSILON);
		const scaleX = layout.value.width / safeWidth;
		const scaleY = layout.value.height / safeHeight;
		const matrix: Matrix4 = [
			scaleX,
			0,
			0,
			layout.value.x,
			0,
			scaleY,
			0,
			layout.value.y,
			0,
			0,
			1,
			0,
			0,
			0,
			0,
			1,
		];
		return [
			{
				matrix,
			},
		];
	});

	return (
		<Group clip={clip}>
			<Group transform={renderTransform}>
				<Renderer
					node={node}
					scene={scene}
					asset={asset}
					isActive={isActive}
					isFocused={isFocused}
					runtimeManager={runtimeManager}
				/>
			</Group>
		</Group>
	);
};

const CanvasNodeRenderItem = memo(CanvasNodeRenderItemComponent);
CanvasNodeRenderItem.displayName = "CanvasNodeRenderItem";

const StaticTileLayerComponent = ({
	drawItems,
}: {
	drawItems: TileDrawItem[];
}) => {
	if (drawItems.length <= 0) return null;
	return (
		<Group pointerEvents="none">
			{drawItems.map((tile) => {
				// 按纹理 texel 轻微外扩，避免缩放/采样导致 tile 边界出现黑缝
				const bleed = (tile.size / TILE_PIXEL_SIZE) * TILE_DRAW_BLEED_TEXEL;
				const drawX = tile.left - bleed;
				const drawY = tile.top - bleed;
				const drawSize = tile.size + bleed * 2;
				return (
					<Image
						key={`tile-ready-${tile.key}`}
						image={tile.image}
						x={drawX}
						y={drawY}
						width={drawSize}
						height={drawSize}
						fit="fill"
						pointerEvents="none"
					/>
				);
			})}
		</Group>
	);
};
const StaticTileLayer = memo(StaticTileLayerComponent);
StaticTileLayer.displayName = "StaticTileLayer";

const resolveTileDebugStrokeColor = (state: TileDebugItem["state"]): string => {
	if (state === "READY") return "rgba(34,197,94,0.96)";
	if (state === "QUEUED") return "rgba(245,158,11,0.96)";
	if (state === "RENDERING") return "rgba(56,189,248,0.96)";
	if (state === "STALE") return "rgba(239,68,68,0.96)";
	return "rgba(156,163,175,0.96)";
};

const resolveTileDebugFillColor = (state: TileDebugItem["state"]): string => {
	if (state === "READY") return "rgba(34,197,94,0.12)";
	if (state === "QUEUED") return "rgba(245,158,11,0.12)";
	if (state === "RENDERING") return "rgba(56,189,248,0.12)";
	if (state === "STALE") return "rgba(239,68,68,0.12)";
	return "rgba(156,163,175,0.08)";
};

const resolveTileDebugLabel = (
	item: TileDebugItem,
	includeCoord: boolean,
): string => {
	const parts = [
		`L${item.lod}`,
		item.state,
		item.queued ? "Q1" : "Q0",
		item.hasImage ? "I1" : "I0",
		item.coverMode,
		`E${item.lastRenderedEpoch}`,
	];
	if (item.coverSourceLod !== null) {
		parts.push(`S${item.coverSourceLod}`);
	}
	if (item.isFallback) {
		parts.push("FB1");
	}
	if (includeCoord) {
		parts.unshift(`${item.tx},${item.ty}`);
	}
	return parts.join(" ");
};

const resolveTileDebugTextTransform = (
	left: number,
	top: number,
	inverseZoom: number,
): Array<{ matrix: Matrix4 }> => {
	const matrix: Matrix4 = [
		inverseZoom,
		0,
		0,
		left + TILE_DEBUG_LABEL_OFFSET_X * inverseZoom,
		0,
		inverseZoom,
		0,
		top + (TILE_DEBUG_LABEL_OFFSET_Y + TILE_DEBUG_FONT_SIZE_PX) * inverseZoom,
		0,
		0,
		1,
		0,
		0,
		0,
		0,
		1,
	];
	return [{ matrix }];
};

const TileDebugLayerComponent = ({
	debugItems,
	cameraZoom,
}: {
	debugItems: TileDebugItem[];
	cameraZoom: number;
}) => {
	const labeledItems = useMemo(() => {
		const includeCoord = debugItems.length <= TILE_DEBUG_COORD_LABEL_LIMIT;
		return debugItems.map((item) => {
			return {
				item,
				label: resolveTileDebugLabel(item, includeCoord),
			};
		});
	}, [debugItems]);
	const tileDebugFont = useFont(TILE_DEBUG_FONT_URI, TILE_DEBUG_FONT_SIZE_PX);
	const safeZoom = Math.max(cameraZoom, TILE_CAMERA_EPSILON);
	const inverseZoom = 1 / safeZoom;

	if (labeledItems.length <= 0) return null;
	return (
		<Group pointerEvents="none">
			{labeledItems.map(({ item, label }) => {
				return (
					<Group key={`tile-debug-${item.key}`} pointerEvents="none">
						<Rect
							x={item.left}
							y={item.top}
							width={item.size}
							height={item.size}
							color={resolveTileDebugFillColor(item.state)}
							pointerEvents="none"
						/>
						<Rect
							x={item.left}
							y={item.top}
							width={item.size}
							height={item.size}
							style="stroke"
							strokeWidth={1}
							color={resolveTileDebugStrokeColor(item.state)}
							pointerEvents="none"
						/>
						{tileDebugFont && (
							<Group
								transform={resolveTileDebugTextTransform(
									item.left,
									item.top,
									inverseZoom,
								)}
								pointerEvents="none"
							>
								<Text
									text={label}
									x={0}
									y={0}
									font={tileDebugFont}
									color={TILE_DEBUG_TEXT_COLOR}
									pointerEvents="none"
								/>
							</Group>
						)}
					</Group>
				);
			})}
		</Group>
	);
};
const TileDebugLayer = memo(TileDebugLayerComponent);
TileDebugLayer.displayName = "TileDebugLayer";

const isLayerValueEqual = (left: unknown, right: unknown): boolean => {
	if (left === right) return true;
	if (typeof left !== typeof right) return false;
	if (left === null || right === null) return left === right;
	if (Array.isArray(left) && Array.isArray(right)) {
		if (left.length !== right.length) return false;
		for (let index = 0; index < left.length; index += 1) {
			if (!isLayerValueEqual(left[index], right[index])) return false;
		}
		return true;
	}
	if (
		typeof left === "object" &&
		typeof right === "object" &&
		!Array.isArray(left) &&
		!Array.isArray(right)
	) {
		const leftRecord = left as Record<string, unknown>;
		const rightRecord = right as Record<string, unknown>;
		const leftKeys = Object.keys(leftRecord);
		const rightKeys = Object.keys(rightRecord);
		if (leftKeys.length !== rightKeys.length) return false;
		for (const key of leftKeys) {
			if (!(key in rightRecord)) return false;
			if (!isLayerValueEqual(leftRecord[key], rightRecord[key])) return false;
		}
		return true;
	}
	return false;
};

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
	suspendHover = false,
	tileDebugEnabled = false,
	tileMaxTasksPerTick,
	tileLodTransition = null,
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
			for (const entry of tileAsyncPictureCacheRef.current.values()) {
				disposeTileAsyncPictureCacheEntry(entry);
			}
			rasterCacheRef.current.clear();
			nodeRasterUriRef.current.clear();
			tileNodeAabbRef.current.clear();
			tileNodeSourceSignatureRef.current.clear();
			tileInputEpochRef.current.clear();
			tileInputCacheRef.current.clear();
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
		return activeNode.id;
	}, [activeNode]);
	const liveRenderNodes = useMemo(() => {
		const liveNodeIds = new Set(animatedLayoutNodeIds);
		if (activeLiveNodeId) {
			liveNodeIds.add(activeLiveNodeId);
		}
		if (liveNodeIds.size === 0) return [];
		return renderNodes.filter((node) => liveNodeIds.has(node.id));
	}, [activeLiveNodeId, animatedLayoutNodeIds, renderNodes]);
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
			if (latestNode.id === activeLiveNodeId) {
				nextNodeRasterUri.set(latestNode.id, null);
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
		activeLiveNodeId,
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
			if (node.id === activeLiveNodeId) {
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
		activeLiveNodeId,
		assetById,
		scenes,
		scheduleTileTick,
		supportsTilePipeline,
		latestNodeById,
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
		for (const node of tileNodes) {
			// 这里直接使用当帧 tileNodes，避免 undo/redo 与拖拽时 tile 输入落后一帧。
			const latestNode = node;
			if (latestNode.id === activeLiveNodeId) {
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
			const fallbackToNodeRendererPicture =
				!image && !thumbnailCapabilityEnabled;
			const tilePictureCapability = fallbackToNodeRendererPicture
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
			const sourceKey = fallbackToNodeRendererPicture
				? tilePictureCapability
					? // 当 capability 提供专用签名时，不再混入 updatedAt（拖拽位移也会变化），
						// 避免位置拖拽触发 picture 缓存抖动导致闪烁。
						tilePictureSourceSignature !== null
						? `fallback-picture:async:${tilePictureSourceSignature}`
						: `${sourceSignature}:fallback-picture:async:none`
					: `${sourceSignature}:fallback-picture:sync`
				: sourceSignature;
			const inputSourceKey = `${sourceKey}:clip:${clipSignature}`;
			const modeKey: TileInputCacheEntry["mode"] = fallbackToNodeRendererPicture
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
			} else if (fallbackToNodeRendererPicture) {
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
					const pictureInput = createTilePictureFromNodeRenderer({
						node: latestNode,
						scene,
						asset,
						runtimeManager,
					});
					if (pictureInput) {
						input = {
							kind: "picture",
							id: inputId,
							nodeId: latestNode.id,
							picture: pictureInput.picture,
							aabb,
							...(clipAabbs.length > 0 ? { visibleAabb, clipAabbs } : {}),
							sourceWidth,
							sourceHeight,
							epoch,
							dispose: pictureInput.dispose,
						};
					}
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
		activeLiveNodeId,
		assetById,
		latestNodeById,
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
			} else {
				const previousFrameResult = latestTileFrameResultRef.current;
				if (previousFrameResult) {
					staticTileDrawItems = previousFrameResult.drawItems;
					tileDebugItems = previousFrameResult.debugItems;
				}
			}
		}
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
					{liveRenderNodes.map((node) => {
						const layout = getNodeLayoutValue(node.id);
						if (!layout) return null;
						const latestNode = getLatestNodeById(node.id) ?? node;
						const renderNode = latestNode;
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
								scene={scene}
								asset={asset}
								isActive={node.id === activeNodeId}
								isFocused={node.id === focusedNodeId}
								runtimeManager={runtimeManager}
							/>
						);
					})}
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
	}, [
		activeNode,
		activeNodeId,
		assetById,
		boardAutoLayoutIndicator,
		getNodeLayoutValue,
		focusedNodeId,
		focusEditorLayerState.layerProps,
		focusLayerEnabled,
		handleOverlayNodeResize,
		height,
		hoverNode,
		onSelectionResize,
		onLabelHitTesterChange,
		liveRenderNodes,
		marqueeRectScreen,
		scheduleTileTick,
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
			<Canvas ref={canvasRef} style={{ width, height }} />
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
