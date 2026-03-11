import type { CanvasNode, StudioProject } from "core/studio/types";
import type React from "react";
import {
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useDrag } from "@use-gesture/react";
import {
	cancelAnimation,
	Canvas,
	type CanvasRef,
	Easing,
	Group,
	makeMutable,
	Rect,
	type SharedValue,
	type SkiaPointerEvent,
	useDerivedValue,
	useSharedValue,
	withTiming,
} from "react-skia-lite";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import { CanvasNodeLabelLayer } from "./CanvasNodeLabelLayer";
import { CanvasNodeOverlayLayer } from "./CanvasNodeOverlayLayer";
import {
	CanvasTriDotGridBackground,
	resolveDotGridUniforms,
} from "./CanvasTriDotGridBackground";
import type { CanvasSnapGuidesScreen } from "./canvasSnapUtils";
import type { CanvasNodeResizeAnchor } from "./canvasResizeAnchor";
import {
	type CanvasNodeDragEvent,
	type CanvasNodePointerEvent,
	NodeInteractionWrapper,
	resolvePointerEventMeta,
} from "./NodeInteractionWrapper";
import {
	type CanvasNodeLayoutState,
	resolveCanvasNodeLayoutWorldRect,
} from "./canvasNodeLabelUtils";
import { getCanvasNodeDefinition } from "./node-system/registry";
import type {
	CanvasNodeFocusEditorBridgeProps,
	CanvasNodeFocusEditorLayerState,
} from "./node-system/types";
import {
	CAMERA_SMOOTH_DURATION_MS,
} from "./canvasWorkspaceUtils";

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

interface InfiniteSkiaCanvasProps {
	width: number;
	height: number;
	camera: {
		x: number;
		y: number;
		zoom: number;
	};
	nodes: CanvasNode[];
	scenes: StudioProject["scenes"];
	assets: StudioProject["assets"];
	activeNodeId: string | null;
	selectedNodeIds: string[];
	focusedNodeId: string | null;
	snapGuidesScreen?: CanvasSnapGuidesScreen;
	suspendHover?: boolean;
	cameraAnimationKey?: number;
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
	onCameraAnimationComplete?: (
		animationKey: number,
		settledCamera: InfiniteSkiaCanvasProps["camera"],
	) => void;
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
const CAMERA_TIMING_CONFIG = {
	duration: CAMERA_SMOOTH_DURATION_MS,
	easing: Easing.out(Easing.cubic),
} as const;

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
	getNodeLayout: (
		nodeId: string,
	) => SharedValue<CanvasNodeLayoutState> | null,
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
	getNodeLayout: (
		nodeId: string,
	) => SharedValue<CanvasNodeLayoutState> | null;
	onDragStart?: (event: CanvasNodeDragEvent) => void;
	onDrag?: (event: CanvasNodeDragEvent) => void;
	onDragEnd?: (event: CanvasNodeDragEvent) => void;
}

const SelectionBoundsInteractionLayer: React.FC<
	SelectionBoundsInteractionLayerProps
> = ({ selectedNodes, getNodeLayout, onDragStart, onDrag, onDragEnd }) => {
	const bindDrag = useDrag(
		({ first, last, tap, movement: [mx, my], xy: [clientX, clientY], event }) => {
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
		return [
			{ translateX: bounds.left },
			{ translateY: bounds.top },
		];
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

interface CanvasNodeSkiaItemProps {
	node: CanvasNode;
	layout: SharedValue<CanvasNodeLayoutState>;
	scene: StudioProject["scenes"][string] | null;
	asset: StudioProject["assets"][number] | null;
	isActive: boolean;
	isSelected: boolean;
	isFocused: boolean;
	isDimmed: boolean;
	isHovered: boolean;
	cameraZoom: SharedValue<number>;
	disabled: boolean;
	runtimeManager: ReturnType<typeof useStudioRuntimeManager>;
	onPointerEnter: (nodeId: string) => void;
	onPointerLeave: (nodeId: string) => void;
	onDragStart?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onDrag?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onDragEnd?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onClick?: (node: CanvasNode, event: CanvasNodePointerEvent) => void;
	onDoubleClick?: (node: CanvasNode, event: CanvasNodePointerEvent) => void;
}

const CanvasNodeSkiaItem = ({
	node,
	layout,
	scene,
	asset,
	isActive,
	isSelected,
	isFocused,
	isDimmed,
	isHovered,
	cameraZoom,
	disabled,
	runtimeManager,
	onPointerEnter,
	onPointerLeave,
	onDragStart,
	onDrag,
	onDragEnd,
	onClick,
	onDoubleClick,
}: CanvasNodeSkiaItemProps) => {
	const definition = getCanvasNodeDefinition(node.type);
	const Renderer = definition.skiaRenderer;
	const clip = useDerivedValue(() => {
		const worldRect = resolveCanvasNodeLayoutWorldRect(layout.value);
		return {
			x: worldRect.left,
			y: worldRect.top,
			width: worldRect.width,
			height: worldRect.height,
		};
	});
	const contentTransform = useDerivedValue(() => {
		const safeWidth = Math.max(Math.abs(node.width), LAYOUT_EPSILON);
		const safeHeight = Math.max(Math.abs(node.height), LAYOUT_EPSILON);
		return [
			{ scaleX: layout.value.width / safeWidth },
			{ scaleY: layout.value.height / safeHeight },
		];
	});

	return (
		<Group clip={clip}>
			<NodeInteractionWrapper
				node={node}
				layout={layout}
				isActive={isActive}
				isSelected={isSelected}
				isDimmed={isDimmed}
				isHovered={isHovered}
				cameraZoom={cameraZoom}
				showBorder={false}
				disabled={disabled}
				onPointerEnter={onPointerEnter}
				onPointerLeave={onPointerLeave}
				onDragStart={onDragStart}
				onDrag={onDrag}
				onDragEnd={onDragEnd}
				onClick={onClick}
				onDoubleClick={onDoubleClick}
			>
				<Group transform={contentTransform}>
					<Renderer
						node={node}
						scene={scene}
						asset={asset}
						isActive={isActive}
						isFocused={isFocused}
						isDimmed={isDimmed}
						runtimeManager={runtimeManager}
					/>
				</Group>
			</NodeInteractionWrapper>
		</Group>
	);
};

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

const resolveCameraTransform = (camera: InfiniteSkiaCanvasProps["camera"]) => {
	// 用显式矩阵固定为“先平移再缩放”的语义，避免 transform 序列语义差异带来的漂移。
	const tx = camera.x * camera.zoom;
	const ty = camera.y * camera.zoom;
	return [
		{
			matrix: [
				camera.zoom,
				0,
				0,
				tx,
				0,
				camera.zoom,
				0,
				ty,
				0,
				0,
				1,
				0,
				0,
				0,
				0,
				1,
			] as const,
		},
	];
};

const resolveCameraScreenOffset = (
	camera: InfiniteSkiaCanvasProps["camera"],
) => {
	return {
		x: camera.x * camera.zoom,
		y: camera.y * camera.zoom,
	};
};

const resolveCameraFromScreenOffset = (
	screenOffset: { x: number; y: number },
	zoom: number,
): InfiniteSkiaCanvasProps["camera"] => {
	const safeZoom = Math.max(zoom, 1e-6);
	return {
		x: screenOffset.x / safeZoom,
		y: screenOffset.y / safeZoom,
		zoom,
	};
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
	cameraAnimationKey = 0,
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
	onCameraAnimationComplete,
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
	const animatedCameraZoom = useSharedValue(camera.zoom);
	const animatedCameraScreenOffset = useSharedValue(
		resolveCameraScreenOffset(camera),
	);
	const cameraAnimationCompletionRef = useRef({
		key: cameraAnimationKey,
		remaining: 0,
		completed: false,
	});
	const animatedCamera = useDerivedValue(() => {
		return resolveCameraFromScreenOffset(
			animatedCameraScreenOffset.value,
			animatedCameraZoom.value,
		);
	});
	const animatedCameraTransform = useDerivedValue(() => {
		return resolveCameraTransform(animatedCamera.value);
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
	const assetById = useMemo(() => {
		return new Map(assets.map((asset) => [asset.id, asset]));
	}, [assets]);
	const nodeIdSet = useMemo(() => {
		return new Set(nodes.map((node) => node.id));
	}, [nodes]);
	const getNodeLayoutValue = useCallback((nodeId: string) => {
		return nodeLayoutValuesRef.current.get(nodeId) ?? null;
	}, []);
	const getLatestNodeById = useCallback((nodeId: string) => {
		return latestNodeByIdRef.current.get(nodeId) ?? null;
	}, []);
	const activeNode = useMemo(() => {
		if (!activeNodeId) return null;
		return renderNodes.find((node) => node.id === activeNodeId) ?? null;
	}, [activeNodeId, renderNodes]);
	const selectedNodeIdsKey = useMemo(() => {
		return selectedNodeIds.join(",");
	}, [selectedNodeIds]);
	const selectedNodeIdSet = useMemo(() => {
		return new Set(selectedNodeIds);
	}, [selectedNodeIdsKey]);
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

	useLayoutEffect(() => {
		const nextCamera = camera;
		const nextScreenOffset = resolveCameraScreenOffset(nextCamera);
		const resolveSettledCamera = () => {
			return resolveCameraFromScreenOffset(
				animatedCameraScreenOffset.value,
				animatedCameraZoom.value,
			);
		};
		if (suspendHover) {
			cameraAnimationCompletionRef.current = {
				key: cameraAnimationKey,
				remaining: 2,
				completed: false,
			};
			const markAnimationPartFinished = (finished: boolean) => {
				if (!finished) {
					return;
				}
				const completionState = cameraAnimationCompletionRef.current;
				if (
					completionState.key !== cameraAnimationKey ||
					completionState.completed
				) {
					return;
				}
				completionState.remaining -= 1;
				if (completionState.remaining > 0) {
					return;
				}
				completionState.completed = true;
				onCameraAnimationComplete?.(
					cameraAnimationKey,
					resolveSettledCamera(),
				);
			};
			animatedCameraZoom.value = withTiming(
				nextCamera.zoom,
				CAMERA_TIMING_CONFIG,
				(finished) => {
					markAnimationPartFinished(finished === true);
				},
			);
			animatedCameraScreenOffset.value = withTiming(
				nextScreenOffset,
				CAMERA_TIMING_CONFIG,
				(finished) => {
					markAnimationPartFinished(finished === true);
				},
			);
			return;
		}
		cameraAnimationCompletionRef.current = {
			key: cameraAnimationKey,
			remaining: 0,
			completed: false,
		};
		cancelAnimation(animatedCameraZoom);
		cancelAnimation(animatedCameraScreenOffset);
		animatedCameraZoom.value = nextCamera.zoom;
		animatedCameraScreenOffset.value = nextScreenOffset;
	}, [
		animatedCameraZoom,
		animatedCameraScreenOffset,
		camera,
		cameraAnimationKey,
		onCameraAnimationComplete,
		suspendHover,
	]);

	useLayoutEffect(() => {
		const root = canvasRef.current?.getRoot();
		if (!root) return;
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
							onDragStart={onSelectionDragStart}
							onDrag={onSelectionDrag}
							onDragEnd={onSelectionDragEnd}
						/>
					)}
					{renderNodes.map((node) => {
						const layout = getNodeLayoutValue(node.id);
						if (!layout) return null;
						const scene =
							node.type === "scene" ? (scenes[node.sceneId] ?? null) : null;
						const asset =
							"assetId" in node ? (assetById.get(node.assetId) ?? null) : null;
						const isFocused = node.id === focusedNodeId;
						const isActive = node.id === activeNodeId;
						const isSelected = selectedNodeIdSet.has(node.id);
						const isDimmed = Boolean(focusedNodeId) && !isFocused;
						const isHovered =
							!disableBaseNodeInteraction && node.id === hoveredNodeId;

						return (
							<CanvasNodeSkiaItem
								key={`canvas-node-skia-${node.id}`}
								node={node}
								layout={layout}
								scene={scene}
								asset={asset}
								isActive={isActive}
								isSelected={isSelected}
								isFocused={isFocused}
								isDimmed={isDimmed}
								isHovered={isHovered}
								cameraZoom={animatedCameraZoom}
								disabled={disableBaseNodeInteraction}
								runtimeManager={runtimeManager}
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
				<CanvasNodeLabelLayer
					width={width}
					height={height}
					camera={animatedCamera}
					getNodeLayout={getNodeLayoutValue}
					nodes={renderNodes}
					focusedNodeId={focusedNodeId}
				/>
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
		height,
		hoverNode,
		hoveredNodeId,
		onSelectionDrag,
		onSelectionDragEnd,
		onSelectionDragStart,
		onSelectionResize,
		renderNodes,
		snapGuidesScreen,
		runtimeManager,
		scenes,
		selectedNodeIdSet,
		selectedNodes,
		FocusEditorLayer,
		width,
		animatedCamera,
		animatedCameraTransform,
		animatedCameraZoom,
		animatedCameraScreenOffset,
		animatedGridUniforms,
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
					camera={camera}
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
