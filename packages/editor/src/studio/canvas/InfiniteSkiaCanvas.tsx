import { useDrag } from "@use-gesture/react";
import type { TimelineAsset } from "core/element/types";
import type { CanvasNode, StudioProject } from "core/studio/types";
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
	Group,
	Image,
	type Matrix4,
	makeMutable,
	Rect,
	type SharedValue,
	type SkImage,
	type SkPicture,
	Skia,
	type SkiaPointerEvent,
	useDerivedValue,
} from "react-skia-lite";
import type { AssetHandle } from "@/assets/AssetStore";
import { acquireImageAsset, type ImageAsset } from "@/assets/imageAsset";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import { useSkiaUiTextSprites } from "@/studio/canvas/skia-text";
import { CanvasNodeLabelLayer } from "./CanvasNodeLabelLayer";
import { CanvasNodeOverlayLayer } from "./CanvasNodeOverlayLayer";
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
import {
	type CanvasNodeDragEvent,
	type CanvasNodePointerEvent,
	NodeInteractionWrapper,
	resolvePointerEventMeta,
} from "./NodeInteractionWrapper";
import { getCanvasNodeDefinition } from "./node-system/registry";
import type {
	CanvasNodeFocusEditorBridgeProps,
	CanvasNodeFocusEditorLayerState,
	CanvasNodeSkiaRenderProps,
} from "./node-system/types";
import {
	createTileAabb,
	StaticTileScheduler,
	TILE_CAMERA_EPSILON,
	type TileAabb,
	type TileDebugItem,
	type TileDrawItem,
	type TileFrameResult,
	type TileInput,
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

export type TileInputMode = "raster" | "picture";

interface InfiniteSkiaCanvasProps {
	width: number;
	height: number;
	camera: SharedValue<CameraState>;
	nodes: CanvasNode[];
	scenes: StudioProject["scenes"];
	assets: StudioProject["assets"];
	activeNodeId: string | null;
	selectedNodeIds: string[];
	focusedNodeId: string | null;
	snapGuidesScreen?: CanvasSnapGuidesScreen;
	suspendHover?: boolean;
	tileDebugEnabled?: boolean;
	tileInputMode?: TileInputMode;
	onNodeClick?: (node: CanvasNode, event: CanvasNodePointerEvent) => void;
	onNodeDoubleClick?: (node: CanvasNode, event: CanvasNodePointerEvent) => void;
	onNodeDragStart?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onNodeDrag?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onNodeDragEnd?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onNodeResize?: (event: CanvasNodeResizeEvent) => void;
	onSelectionDragStart?: (event: CanvasNodeDragEvent) => void;
	onSelectionDrag?: (event: CanvasNodeDragEvent) => void;
	onSelectionDragEnd?: (event: CanvasNodeDragEvent) => void;
	onSelectionResize?: (event: CanvasSelectionResizeEvent) => void;
}

const SELECTION_DRAG_CONFIG = {
	pointer: { capture: false },
	keys: false,
	filterTaps: false,
	threshold: 0,
	triggerAllEvents: true,
} as const;
const EMPTY_SNAP_GUIDES_SCREEN: CanvasSnapGuidesScreen = {
	vertical: [],
	horizontal: [],
};

const LAYOUT_EPSILON = 1e-6;
const TILE_AABB_EPSILON = 1e-4;
const TILE_PIPELINE_LISTENER_ID = 73001;
const TILE_DEBUG_COORD_LABEL_LIMIT = 96;
const TILE_DEBUG_TEXT_STYLE = {
	fontFamily:
		'-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
	fontSizePx: 10,
	fontWeight: 600,
	lineHeightPx: 12,
	color: "rgba(255,255,255,0.96)",
	paddingPx: 0,
};

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
	mode: TileInputMode;
	rasterImage: SkImage | null;
	input: TileInput | null;
}

interface DragProxyState {
	active: boolean;
	worldDx: number;
	worldDy: number;
}

interface DragProxyDrawItem {
	nodeId: string;
	image: SkImage;
	x: number;
	y: number;
	width: number;
	height: number;
}

const EMPTY_DRAG_PROXY_STATE: DragProxyState = {
	active: false,
	worldDx: 0,
	worldDy: 0,
};

const EMPTY_STATIC_TILE_SNAPSHOT: {
	inputs: TileInput[];
	inputByNodeId: Map<string, TileInput>;
} = {
	inputs: [],
	inputByNodeId: new Map<string, TileInput>(),
};

const isTileRasterNodeType = (node: CanvasNode): boolean => {
	return (
		node.type === "scene" || node.type === "image" || node.type === "video"
	);
};

const isAlwaysLiveNodeType = (node: CanvasNode): boolean => {
	return node.type === "text" || node.type === "audio";
};

const resolveTileNodeSourceSignature = (
	node: CanvasNode,
	scene: StudioProject["scenes"][string] | null,
): string => {
	if (node.type === "scene") {
		return `scene:${node.sceneId}:${scene?.updatedAt ?? "none"}:${node.thumbnail?.sourceSignature ?? "none"}`;
	}
	if (node.type === "image") {
		return `image:${node.assetId}:${node.thumbnail?.sourceSignature ?? "none"}`;
	}
	if (node.type === "video") {
		return `video:${node.assetId}:${node.thumbnail?.sourceSignature ?? "none"}`;
	}
	return `${node.type}:${node.id}`;
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

const createTilePictureFromImage = (
	image: SkImage,
	sourceWidth: number,
	sourceHeight: number,
): { picture: SkPicture; dispose: () => void } | null => {
	try {
		const safeWidth = Math.max(1, Math.round(sourceWidth));
		const safeHeight = Math.max(1, Math.round(sourceHeight));
		const recorder = Skia.PictureRecorder();
		const canvas = recorder.beginRecording({
			x: 0,
			y: 0,
			width: safeWidth,
			height: safeHeight,
		});
		const imageSize = resolveSkImageSize(image, safeWidth, safeHeight);
		canvas.save();
		canvas.scale(
			safeWidth / Math.max(1, imageSize.width),
			safeHeight / Math.max(1, imageSize.height),
		);
		canvas.drawImage(image, 0, 0);
		canvas.restore();
		const picture = recorder.finishRecordingAsPicture();
		return {
			picture,
			dispose: () => {
				try {
					picture.dispose?.();
				} catch {}
			},
		};
	} catch {
		return null;
	}
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

const resolveTileRasterAsset = (
	node: CanvasNode,
	assetById: Map<string, TimelineAsset>,
): TimelineAsset | null => {
	if (node.type === "image") {
		const sourceAsset = assetById.get(node.assetId);
		if (sourceAsset?.kind === "image") {
			return sourceAsset;
		}
	}
	const thumbnailAssetId = node.thumbnail?.assetId ?? null;
	if (!thumbnailAssetId) return null;
	const thumbnailAsset = assetById.get(thumbnailAssetId);
	if (!thumbnailAsset || thumbnailAsset.kind !== "image") return null;
	return thumbnailAsset;
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

const resolveSelectedNodeBounds = (
	selectedNodes: CanvasNode[],
	getNodeLayout: (nodeId: string) => SharedValue<CanvasNodeLayoutState> | null,
) => {
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const node of selectedNodes) {
		const layout = getNodeLayout(node.id)?.value ?? node;
		const worldRect = resolveCanvasNodeLayoutWorldRect(layout);
		left = Math.min(left, worldRect.left);
		top = Math.min(top, worldRect.top);
		right = Math.max(right, worldRect.right);
		bottom = Math.max(bottom, worldRect.bottom);
	}
	if (
		!Number.isFinite(left) ||
		!Number.isFinite(top) ||
		!Number.isFinite(right) ||
		!Number.isFinite(bottom)
	) {
		return {
			left: 0,
			top: 0,
			width: 1,
			height: 1,
		};
	}
	return {
		left,
		top,
		width: Math.max(1, right - left),
		height: Math.max(1, bottom - top),
	};
};

interface SelectionBoundsInteractionLayerProps {
	selectedNodes: CanvasNode[];
	getNodeLayout: (nodeId: string) => SharedValue<CanvasNodeLayoutState> | null;
	onDragStart?: (event: CanvasNodeDragEvent) => void;
	onDrag?: (event: CanvasNodeDragEvent) => void;
	onDragEnd?: (event: CanvasNodeDragEvent) => void;
}

const SelectionBoundsInteractionLayer: React.FC<
	SelectionBoundsInteractionLayerProps
> = ({ selectedNodes, getNodeLayout, onDragStart, onDrag, onDragEnd }) => {
	const bindDrag = useDrag(
		({
			first,
			last,
			tap,
			movement: [mx, my],
			xy: [clientX, clientY],
			event,
		}) => {
			const dragEvent: CanvasNodeDragEvent = {
				...resolvePointerEventMeta(event, clientX, clientY),
				movementX: mx,
				movementY: my,
				first,
				last,
				tap,
			};
			if (first) {
				onDragStart?.(dragEvent);
			}
			if (!last) {
				onDrag?.(dragEvent);
			}
			if (last) {
				onDragEnd?.(dragEvent);
			}
		},
		SELECTION_DRAG_CONFIG,
	);
	const dragHandlers = bindDrag() as {
		onPointerDown?: (event: SkiaPointerEvent) => void;
	};
	const transform = useDerivedValue(() => {
		const bounds = resolveSelectedNodeBounds(selectedNodes, getNodeLayout);
		return [{ translateX: bounds.left }, { translateY: bounds.top }];
	});
	const hitRect = useDerivedValue(() => {
		const bounds = resolveSelectedNodeBounds(selectedNodes, getNodeLayout);
		return {
			x: 0,
			y: 0,
			width: Math.max(1, bounds.width),
			height: Math.max(1, bounds.height),
		};
	});
	const rectWidth = useDerivedValue(() => {
		return resolveSelectedNodeBounds(selectedNodes, getNodeLayout).width;
	});
	const rectHeight = useDerivedValue(() => {
		return resolveSelectedNodeBounds(selectedNodes, getNodeLayout).height;
	});

	return (
		<Group
			transform={transform}
			hitRect={hitRect}
			pointerEvents="auto"
			onPointerDown={(event) => {
				dragHandlers.onPointerDown?.(event);
			}}
		>
			<Rect
				x={0}
				y={0}
				width={rectWidth}
				height={rectHeight}
				color="rgba(255,255,255,0.001)"
			/>
		</Group>
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

interface CanvasNodeInteractionItemProps {
	node: CanvasNode;
	layout: SharedValue<CanvasNodeLayoutState>;
	disabled: boolean;
	onPointerEnter: (nodeId: string) => void;
	onPointerLeave: (nodeId: string) => void;
	onDragStart?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onDrag?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onDragEnd?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onClick?: (node: CanvasNode, event: CanvasNodePointerEvent) => void;
	onDoubleClick?: (node: CanvasNode, event: CanvasNodePointerEvent) => void;
}

const CanvasNodeInteractionItemComponent = ({
	node,
	layout,
	disabled,
	onPointerEnter,
	onPointerLeave,
	onDragStart,
	onDrag,
	onDragEnd,
	onClick,
	onDoubleClick,
}: CanvasNodeInteractionItemProps) => {
	return (
		<NodeInteractionWrapper
			node={node}
			layout={layout}
			disabled={disabled}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
			onDragStart={onDragStart}
			onDrag={onDrag}
			onDragEnd={onDragEnd}
			onClick={onClick}
			onDoubleClick={onDoubleClick}
		/>
	);
};
const CanvasNodeInteractionItem = memo(CanvasNodeInteractionItemComponent);
CanvasNodeInteractionItem.displayName = "CanvasNodeInteractionItem";

const StaticTileLayerComponent = ({
	drawItems,
}: {
	drawItems: TileDrawItem[];
}) => {
	if (drawItems.length <= 0) return null;
	return (
		<Group pointerEvents="none">
			{drawItems.map((tile) => {
				return (
					<Image
						key={`tile-ready-${tile.key}`}
						image={tile.image}
						x={tile.left}
						y={tile.top}
						width={tile.size}
						height={tile.size}
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

const DragProxyLayerComponent = ({
	drawItems,
}: {
	drawItems: DragProxyDrawItem[];
}) => {
	if (drawItems.length <= 0) return null;
	return (
		<Group pointerEvents="none">
			{drawItems.map((item) => {
				return (
					<Image
						key={`drag-proxy-${item.nodeId}`}
						image={item.image}
						x={item.x}
						y={item.y}
						width={item.width}
						height={item.height}
						fit="fill"
						pointerEvents="none"
					/>
				);
			})}
		</Group>
	);
};
const DragProxyLayer = memo(DragProxyLayerComponent);
DragProxyLayer.displayName = "DragProxyLayer";

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

const TileDebugLayerComponent = ({
	debugItems,
}: {
	debugItems: TileDebugItem[];
}) => {
	const requests = useMemo(() => {
		const includeCoord = debugItems.length <= TILE_DEBUG_COORD_LABEL_LIMIT;
		return debugItems.map((item) => {
			return {
				text: resolveTileDebugLabel(item, includeCoord),
				maxWidthPx: Math.max(48, Math.floor(item.size) - 10),
				slotKey: `tile-debug-${item.key}`,
				style: TILE_DEBUG_TEXT_STYLE,
			};
		});
	}, [debugItems]);
	const sprites = useSkiaUiTextSprites(requests);

	if (debugItems.length <= 0) return null;
	return (
		<Group pointerEvents="none">
			{debugItems.map((item, index) => {
				const sprite = sprites[index];
				const spriteImage = sprite?.image ?? null;
				const spriteWidth = Math.min(
					Math.max(1, sprite?.textWidth ?? 1),
					Math.max(1, Math.floor(item.size) - 8),
				);
				const spriteHeight = Math.max(1, sprite?.textHeight ?? 1);
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
						{spriteImage && (
							<Image
								image={spriteImage}
								x={item.left + 4}
								y={item.top + 4}
								width={spriteWidth}
								height={spriteHeight}
								fit="fill"
								pointerEvents="none"
							/>
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
	scenes,
	assets,
	activeNodeId,
	selectedNodeIds,
	focusedNodeId,
	snapGuidesScreen = EMPTY_SNAP_GUIDES_SCREEN,
	suspendHover = false,
	tileDebugEnabled = false,
	tileInputMode = "raster",
	onNodeClick,
	onNodeDoubleClick,
	onNodeDragStart,
	onNodeDrag,
	onNodeDragEnd,
	onNodeResize,
	onSelectionDragStart,
	onSelectionDrag,
	onSelectionDragEnd,
	onSelectionResize,
}) => {
	const runtimeManager = useStudioRuntimeManager();
	const canvasRef = useRef<CanvasRef>(null);
	const draggingNodeIdRef = useRef<string | null>(null);
	const latestNodeByIdRef = useRef(new Map<string, CanvasNode>());
	const nodeLayoutValuesRef = useRef(
		new Map<string, SharedValue<CanvasNodeLayoutState>>(),
	);
	latestNodeByIdRef.current = new Map(nodes.map((node) => [node.id, node]));
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
	const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
	const [focusEditorLayerState, setFocusEditorLayerState] =
		useState<CanvasNodeFocusEditorLayerState>({
			enabled: false,
			layerProps: null,
		});
	const [tileTick, setTileTick] = useState(0);
	const [rasterCacheVersion, setRasterCacheVersion] = useState(0);
	const [selectionDragProxy, setSelectionDragProxy] = useState<DragProxyState>(
		EMPTY_DRAG_PROXY_STATE,
	);
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
	const tileInputIdRef = useRef(new Map<string, number>());
	const nextTileInputIdRef = useRef(1);
	const tileTickRafRef = useRef<number | null>(null);
	const tileListenerIdRef = useRef(
		TILE_PIPELINE_LISTENER_ID + Math.floor(Math.random() * 100000),
	);
	const tilePipelineDisposedRef = useRef(false);
	const latestTileFrameResultRef = useRef<TileFrameResult | null>(null);
	const dragProxyBaseNodeRectRef = useRef(
		new Map<string, { x: number; y: number; width: number; height: number }>(),
	);
	const nodeIdSet = useMemo(() => {
		return new Set(nodes.map((node) => node.id));
	}, [nodes]);
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
		if (tileTickRafRef.current !== null) return;
		tileTickRafRef.current = requestAnimationFrame(() => {
			tileTickRafRef.current = null;
			if (tilePipelineDisposedRef.current) return;
			setTileTick((prev) => prev + 1);
		});
	}, [supportsTilePipeline]);
	const resolveNodeRasterUri = useCallback(
		(node: CanvasNode): string | null => {
			if (!isTileRasterNodeType(node)) return null;
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

	useLayoutEffect(() => {
		if (!suspendHover) return;
		setHoveredNodeId(null);
	}, [suspendHover]);

	useLayoutEffect(() => {
		if (!disableBaseNodeInteraction) return;
		draggingNodeIdRef.current = null;
		setHoveredNodeId(null);
	}, [disableBaseNodeInteraction]);

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
		addListener(listenerId, scheduleTileTick);
		return () => {
			removeListener(listenerId);
		};
	}, [camera, scheduleTileTick, supportsTilePipeline]);

	useEffect(() => {
		if (!supportsTilePipeline) return;
		const nextNodeRasterUri = new Map<string, string | null>();
		const requiredUris = new Set<string>();
		for (const node of renderNodes) {
			const latestNode = getLatestNodeById(node.id) ?? node;
			if (!isTileRasterNodeType(latestNode) || latestNode.id === activeNodeId) {
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
		activeNodeId,
		getLatestNodeById,
		renderNodes,
		resolveNodeRasterUri,
		scheduleTileTick,
		supportsTilePipeline,
	]);

	useEffect(() => {
		return () => {
			for (const entry of rasterCacheRef.current.values()) {
				entry.handle?.release();
			}
			for (const entry of tileInputCacheRef.current.values()) {
				disposeTileInput(entry.input);
			}
			rasterCacheRef.current.clear();
			nodeRasterUriRef.current.clear();
			tileNodeAabbRef.current.clear();
			tileNodeSourceSignatureRef.current.clear();
			tileInputEpochRef.current.clear();
			tileInputCacheRef.current.clear();
			tileInputIdRef.current.clear();
		};
	}, []);

	useLayoutEffect(() => {
		const nextNodeIds = new Set<string>();
		for (const node of nodes) {
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
			currentLayout.value = nextLayout;
		}
		for (const nodeId of nodeLayoutValuesRef.current.keys()) {
			if (nextNodeIds.has(nodeId)) continue;
			nodeLayoutValuesRef.current.delete(nodeId);
		}
	}, [nodes]);

	useLayoutEffect(() => {
		if (!supportsTilePipeline) return;
		const scheduler = tileSchedulerRef.current;
		if (!scheduler) return;
		let shouldTick = false;
		for (const node of nodes) {
			if (!isTileRasterNodeType(node) || node.id === activeNodeId) {
				const oldAabb = tileNodeAabbRef.current.get(node.id) ?? null;
				if (oldAabb) {
					scheduler.markDirtyRect(oldAabb);
					tileNodeAabbRef.current.delete(node.id);
					tileNodeSourceSignatureRef.current.delete(node.id);
					shouldTick = true;
				}
				continue;
			}
			const scene =
				node.type === "scene" ? (scenes[node.sceneId] ?? null) : null;
			const sourceSignature = resolveTileNodeSourceSignature(node, scene);
			const nextAabb = resolveNodeWorldAabb(node);
			const oldAabb = tileNodeAabbRef.current.get(node.id) ?? null;
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
		if (shouldTick) {
			scheduleTileTick();
		}
	}, [activeNodeId, nodes, scenes, scheduleTileTick, supportsTilePipeline]);

	useLayoutEffect(() => {
		// 节点列表变化时，清理已失效的 hover 引用
		if (hoveredNodeId && !nodeIdSet.has(hoveredNodeId)) {
			setHoveredNodeId(null);
		}
	}, [hoveredNodeId, nodeIdSet]);

	useLayoutEffect(() => {
		// 节点列表变化时，清理已失效的 drag 引用
		if (
			draggingNodeIdRef.current &&
			!nodeIdSet.has(draggingNodeIdRef.current)
		) {
			draggingNodeIdRef.current = null;
		}
	}, [nodeIdSet]);

	useLayoutEffect(() => {
		if (!selectionDragProxy.active) return;
		if (disableBaseNodeInteraction || selectedNodes.length <= 1) {
			setSelectionDragProxy(EMPTY_DRAG_PROXY_STATE);
			dragProxyBaseNodeRectRef.current.clear();
		}
	}, [
		disableBaseNodeInteraction,
		selectionDragProxy.active,
		selectedNodes.length,
	]);

	const handlePointerEnter = useCallback(
		(nodeId: string) => {
			if (suspendHover || disableBaseNodeInteraction) return;
			if (draggingNodeIdRef.current) return;
			setHoveredNodeId(nodeId);
		},
		[disableBaseNodeInteraction, suspendHover],
	);

	const handlePointerLeave = useCallback(
		(nodeId: string) => {
			if (suspendHover || disableBaseNodeInteraction) return;
			if (draggingNodeIdRef.current) return;
			setHoveredNodeId((prev) => {
				if (prev !== nodeId) return prev;
				return null;
			});
		},
		[disableBaseNodeInteraction, suspendHover],
	);

	const handleNodeDragStart = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (disableBaseNodeInteraction) return;
			const latestNode = getLatestNodeById(node.id) ?? node;
			if (event.button === 0) {
				draggingNodeIdRef.current = node.id;
				// 拖拽中锁定 hover，避免掠过高层节点时边框跳闪
				setHoveredNodeId(node.id);
			}
			onNodeDragStart?.(latestNode, event);
		},
		[disableBaseNodeInteraction, getLatestNodeById, onNodeDragStart],
	);

	const handleNodeDrag = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (disableBaseNodeInteraction) return;
			onNodeDrag?.(getLatestNodeById(node.id) ?? node, event);
		},
		[disableBaseNodeInteraction, getLatestNodeById, onNodeDrag],
	);

	const handleNodeDragEnd = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (disableBaseNodeInteraction) return;
			const latestNode = getLatestNodeById(node.id) ?? node;
			if (draggingNodeIdRef.current === node.id) {
				draggingNodeIdRef.current = null;
			}
			onNodeDragEnd?.(latestNode, event);
		},
		[disableBaseNodeInteraction, getLatestNodeById, onNodeDragEnd],
	);

	const handleNodeClick = useCallback(
		(node: CanvasNode, event: CanvasNodePointerEvent) => {
			onNodeClick?.(getLatestNodeById(node.id) ?? node, event);
		},
		[getLatestNodeById, onNodeClick],
	);

	const handleNodeDoubleClick = useCallback(
		(node: CanvasNode, event: CanvasNodePointerEvent) => {
			onNodeDoubleClick?.(getLatestNodeById(node.id) ?? node, event);
		},
		[getLatestNodeById, onNodeDoubleClick],
	);

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

	const handleSelectionBoundsDragStart = useCallback(
		(event: CanvasNodeDragEvent) => {
			if (!disableBaseNodeInteraction && selectedNodes.length > 1) {
				dragProxyBaseNodeRectRef.current.clear();
				for (const node of selectedNodes) {
					if (node.id === activeNodeId) continue;
					const layout = getNodeLayoutValue(node.id)?.value ?? node;
					dragProxyBaseNodeRectRef.current.set(node.id, {
						x: layout.x,
						y: layout.y,
						width: layout.width,
						height: layout.height,
					});
				}
				if (dragProxyBaseNodeRectRef.current.size > 0) {
					setSelectionDragProxy({
						active: true,
						worldDx: 0,
						worldDy: 0,
					});
				}
			}
			onSelectionDragStart?.(event);
		},
		[
			activeNodeId,
			disableBaseNodeInteraction,
			getNodeLayoutValue,
			onSelectionDragStart,
			selectedNodes,
		],
	);

	const handleSelectionBoundsDrag = useCallback(
		(event: CanvasNodeDragEvent) => {
			if (
				selectionDragProxy.active &&
				dragProxyBaseNodeRectRef.current.size > 0 &&
				!disableBaseNodeInteraction
			) {
				const safeZoom = Math.max(camera.value.zoom, TILE_CAMERA_EPSILON);
				const nextWorldDx = event.movementX / safeZoom;
				const nextWorldDy = event.movementY / safeZoom;
				setSelectionDragProxy((prev) => {
					if (
						!prev.active ||
						Math.abs(prev.worldDx - nextWorldDx) > LAYOUT_EPSILON ||
						Math.abs(prev.worldDy - nextWorldDy) > LAYOUT_EPSILON
					) {
						return {
							active: true,
							worldDx: nextWorldDx,
							worldDy: nextWorldDy,
						};
					}
					return prev;
				});
			}
			onSelectionDrag?.(event);
		},
		[
			camera,
			disableBaseNodeInteraction,
			onSelectionDrag,
			selectionDragProxy.active,
		],
	);

	const handleSelectionBoundsDragEnd = useCallback(
		(event: CanvasNodeDragEvent) => {
			if (selectionDragProxy.active) {
				setSelectionDragProxy(EMPTY_DRAG_PROXY_STATE);
			}
			dragProxyBaseNodeRectRef.current.clear();
			onSelectionDragEnd?.(event);
		},
		[onSelectionDragEnd, selectionDragProxy.active],
	);

	const staticTileSnapshot = useMemo(() => {
		void nodes;
		void rasterCacheVersion;
		if (!supportsTilePipeline) {
			return EMPTY_STATIC_TILE_SNAPSHOT;
		}
		const inputs: TileInput[] = [];
		const inputByNodeId = new Map<string, TileInput>();
		const visitedNodeIds = new Set<string>();
		for (const node of renderNodes) {
			const latestNode = getLatestNodeById(node.id) ?? node;
			if (!isTileRasterNodeType(latestNode) || latestNode.id === activeNodeId) {
				continue;
			}
			visitedNodeIds.add(latestNode.id);
			const uri =
				nodeRasterUriRef.current.get(latestNode.id) ??
				resolveNodeRasterUri(latestNode);
			const rasterEntry = uri
				? (rasterCacheRef.current.get(uri) ?? null)
				: null;
			const image = rasterEntry?.image ?? null;
			const sourceSignature =
				tileNodeSourceSignatureRef.current.get(latestNode.id) ??
				resolveTileNodeSourceSignature(
					latestNode,
					latestNode.type === "scene"
						? (scenes[latestNode.sceneId] ?? null)
						: null,
				);
			const cachedEntry = tileInputCacheRef.current.get(latestNode.id);
			if (!image) {
				disposeTileInput(cachedEntry?.input);
				tileInputCacheRef.current.set(latestNode.id, {
					epoch: cachedEntry?.epoch ?? 0,
					sourceSignature,
					mode: tileInputMode,
					rasterImage: null,
					input: null,
				});
				continue;
			}
			const sourceWidth =
				rasterEntry?.width ?? Math.max(1, Math.round(Math.abs(latestNode.width)));
			const sourceHeight =
				rasterEntry?.height ??
				Math.max(1, Math.round(Math.abs(latestNode.height)));
			let epoch = cachedEntry?.epoch ?? 0;
			const sourceChanged = cachedEntry?.sourceSignature !== sourceSignature;
			const modeChanged = cachedEntry?.mode !== tileInputMode;
			const imageChanged = cachedEntry?.rasterImage !== image;
			if (!cachedEntry || sourceChanged || modeChanged || imageChanged) {
				epoch += 1;
			}
			const inputId = resolveTileInputId(latestNode.id);
			const aabb = resolveNodeWorldAabb(latestNode);
			let input: TileInput;
			if (tileInputMode === "picture") {
				const canReusePicture =
					Boolean(cachedEntry) &&
					!sourceChanged &&
					!modeChanged &&
					!imageChanged &&
					cachedEntry?.input?.kind === "picture";
				if (canReusePicture && cachedEntry?.input?.kind === "picture") {
					input = {
						kind: "picture",
						id: inputId,
						nodeId: latestNode.id,
						picture: cachedEntry.input.picture,
						aabb,
						sourceWidth,
						sourceHeight,
						epoch,
						dispose: cachedEntry.input.dispose,
					};
				} else {
					const pictureInput = createTilePictureFromImage(
						image,
						sourceWidth,
						sourceHeight,
					);
					if (cachedEntry?.input?.kind === "picture") {
						disposeTileInput(cachedEntry.input);
					}
					if (pictureInput) {
						input = {
							kind: "picture",
							id: inputId,
							nodeId: latestNode.id,
							picture: pictureInput.picture,
							aabb,
							sourceWidth,
							sourceHeight,
							epoch,
							dispose: pictureInput.dispose,
						};
					} else {
						input = {
							kind: "raster",
							id: inputId,
							nodeId: latestNode.id,
							image,
							aabb,
							sourceWidth,
							sourceHeight,
							epoch,
						};
					}
				}
			} else {
				if (cachedEntry?.input?.kind === "picture") {
					disposeTileInput(cachedEntry.input);
				}
				input = {
					kind: "raster",
					id: inputId,
					nodeId: latestNode.id,
					image,
					aabb,
					sourceWidth,
					sourceHeight,
					epoch,
				};
			}
			tileInputCacheRef.current.set(latestNode.id, {
				epoch,
				sourceSignature,
				mode: tileInputMode,
				rasterImage: image,
				input,
			});
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
		return {
			inputs,
			inputByNodeId,
		};
	}, [
		activeNodeId,
		getLatestNodeById,
		nodes,
		rasterCacheVersion,
		renderNodes,
		resolveNodeRasterUri,
		resolveTileInputId,
		scenes,
		supportsTilePipeline,
		tileInputMode,
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
		const fallbackLiveNodeIdSet = new Set<string>();
		const scheduler = supportsTilePipeline ? tileSchedulerRef.current : null;
		if (scheduler) {
			scheduler.setInputs(staticTileSnapshot.inputs);
			const frameResult = scheduler.beginFrame({
				camera: camera.value,
				stageWidth: width,
				stageHeight: height,
				nowMs:
					typeof performance !== "undefined" ? performance.now() : Date.now(),
				debugEnabled: tileDebugEnabled,
			});
			latestTileFrameResultRef.current = frameResult;
			staticTileDrawItems = frameResult.drawItems;
			tileDebugItems = frameResult.debugItems;
			for (const nodeId of frameResult.fallbackNodeIds) {
				fallbackLiveNodeIdSet.add(nodeId);
			}
			if (frameResult.hasPendingWork) {
				scheduleTileTick();
			}
		}
		const liveNodeIdSet = new Set<string>();
		for (const node of renderNodes) {
			const latestNode = getLatestNodeById(node.id) ?? node;
			const isAlwaysLive =
				latestNode.id === activeNodeId || isAlwaysLiveNodeType(latestNode);
			const hasStaticInput = staticTileSnapshot.inputByNodeId.has(
				latestNode.id,
			);
			if (
				isAlwaysLive ||
				!hasStaticInput ||
				fallbackLiveNodeIdSet.has(node.id)
			) {
				liveNodeIdSet.add(node.id);
			}
		}
		const dragProxyDrawItems: DragProxyDrawItem[] = [];
		if (selectionDragProxy.active && selectedNodes.length > 1) {
			for (const node of renderNodes) {
				if (!selectedNodeIdSet.has(node.id) || node.id === activeNodeId)
					continue;
				const input = staticTileSnapshot.inputByNodeId.get(node.id);
				let proxyImage: SkImage | null = null;
				if (input?.kind === "raster") {
					proxyImage = input.image;
				} else {
					const latestNode = getLatestNodeById(node.id) ?? node;
					const uri =
						nodeRasterUriRef.current.get(node.id) ??
						resolveNodeRasterUri(latestNode);
					const rasterEntry = uri
						? (rasterCacheRef.current.get(uri) ?? null)
						: null;
					proxyImage = rasterEntry?.image ?? null;
				}
				if (!proxyImage) continue;
				const baseRect = dragProxyBaseNodeRectRef.current.get(node.id);
				if (!baseRect) continue;
				dragProxyDrawItems.push({
					nodeId: node.id,
					image: proxyImage,
					x: baseRect.x + selectionDragProxy.worldDx,
					y: baseRect.y + selectionDragProxy.worldDy,
					width: baseRect.width,
					height: baseRect.height,
				});
				liveNodeIdSet.delete(node.id);
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
					{selectedNodes.length > 1 && !disableBaseNodeInteraction && (
						<SelectionBoundsInteractionLayer
							selectedNodes={selectedNodes}
							getNodeLayout={getNodeLayoutValue}
							onDragStart={handleSelectionBoundsDragStart}
							onDrag={handleSelectionBoundsDrag}
							onDragEnd={handleSelectionBoundsDragEnd}
						/>
					)}
					<StaticTileLayer drawItems={staticTileDrawItems} />
					{tileDebugEnabled && (
						<TileDebugLayer debugItems={tileDebugItems} />
					)}
					<DragProxyLayer drawItems={dragProxyDrawItems} />
					{renderNodes.map((node) => {
						if (!liveNodeIdSet.has(node.id)) return null;
						const layout = getNodeLayoutValue(node.id);
						if (!layout) return null;
						const latestNode = getLatestNodeById(node.id) ?? node;
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
								node={node}
								layout={layout}
								scene={scene}
								asset={asset}
								isActive={node.id === activeNodeId}
								isFocused={node.id === focusedNodeId}
								runtimeManager={runtimeManager}
							/>
						);
					})}
					{renderNodes.map((node) => {
						const layout = getNodeLayoutValue(node.id);
						if (!layout) return null;
						return (
							<CanvasNodeInteractionItem
								key={`canvas-node-interaction-${node.id}`}
								node={node}
								layout={layout}
								disabled={disableBaseNodeInteraction}
								onPointerEnter={handlePointerEnter}
								onPointerLeave={handlePointerLeave}
								onDragStart={handleNodeDragStart}
								onDrag={handleNodeDrag}
								onDragEnd={handleNodeDragEnd}
								onClick={handleNodeClick}
								onDoubleClick={handleNodeDoubleClick}
							/>
						);
					})}
				</Group>
				{/* <CanvasNodeLabelLayer
					width={width}
					height={height}
					camera={animatedCamera}
					getNodeLayout={getNodeLayoutValue}
					nodes={renderNodes}
					focusedNodeId={focusedNodeId}
				/> */}
				{!disableBaseNodeInteraction && !focusedNodeId && (
					<CanvasNodeOverlayLayer
						width={width}
						height={height}
						activeNode={activeNode}
						getNodeLayout={getNodeLayoutValue}
						selectedNodes={selectedNodes}
						hoverNode={hoverNode}
						snapGuidesScreen={snapGuidesScreen}
						camera={animatedCamera}
						onNodeResize={handleOverlayNodeResize}
						onSelectionResize={onSelectionResize}
					/>
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
		disableBaseNodeInteraction,
		getNodeLayoutValue,
		handleNodeClick,
		handleNodeDoubleClick,
		focusedNodeId,
		focusEditorLayerState.layerProps,
		focusLayerEnabled,
		handleNodeDrag,
		handleNodeDragEnd,
		handleOverlayNodeResize,
		handleNodeDragStart,
		handlePointerEnter,
		handlePointerLeave,
		handleSelectionBoundsDrag,
		handleSelectionBoundsDragEnd,
		handleSelectionBoundsDragStart,
		height,
		hoverNode,
		onSelectionResize,
		renderNodes,
		scheduleTileTick,
		selectionDragProxy.active,
		selectionDragProxy.worldDx,
		selectionDragProxy.worldDy,
		snapGuidesScreen,
		staticTileSnapshot,
		supportsTilePipeline,
		tileTick,
		tileDebugEnabled,
		runtimeManager,
		scenes,
		selectedNodeIdSet,
		selectedNodes,
		FocusEditorLayer,
		width,
		animatedCamera,
		animatedCameraTransform,
		animatedGridUniforms,
		camera,
		getLatestNodeById,
		resolveNodeRasterUri,
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
