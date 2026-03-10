import type { CanvasNode, StudioProject } from "core/studio/types";
import type React from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDrag } from "@use-gesture/react";
import { Canvas, type CanvasRef, Group, Rect, type SkiaPointerEvent } from "react-skia-lite";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import { CanvasNodeLabelLayer } from "./CanvasNodeLabelLayer";
import { CanvasNodeOverlayLayer } from "./CanvasNodeOverlayLayer";
import { CanvasTriDotGridBackground } from "./CanvasTriDotGridBackground";
import type { CanvasNodeResizeAnchor } from "./canvasResizeAnchor";
import { resolveCanvasNodeBounds } from "./canvasWorkspaceUtils";
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
} from "./node-system/types";

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
	suspendHover?: boolean;
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

interface SelectionBoundsInteractionLayerProps {
	bounds: {
		left: number;
		top: number;
		width: number;
		height: number;
	};
	onDragStart?: (event: CanvasNodeDragEvent) => void;
	onDrag?: (event: CanvasNodeDragEvent) => void;
	onDragEnd?: (event: CanvasNodeDragEvent) => void;
}

const SelectionBoundsInteractionLayer: React.FC<
	SelectionBoundsInteractionLayerProps
> = ({ bounds, onDragStart, onDrag, onDragEnd }) => {
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

	return (
		<Group
			transform={[
				{ translateX: bounds.left },
				{ translateY: bounds.top },
			]}
			hitRect={{
				x: 0,
				y: 0,
				width: Math.max(1, bounds.width),
				height: Math.max(1, bounds.height),
			}}
			pointerEvents="auto"
			onPointerDown={(event) => {
				dragHandlers.onPointerDown?.(event);
			}}
		>
			<Rect
				x={0}
				y={0}
				width={Math.max(1, bounds.width)}
				height={Math.max(1, bounds.height)}
				color="rgba(255,255,255,0.001)"
			/>
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
	suspendHover = false,
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
	const activeNode = useMemo(() => {
		if (!activeNodeId) return null;
		return nodes.find((node) => node.id === activeNodeId) ?? null;
	}, [activeNodeId, nodes]);
	const selectedNodeIdSet = useMemo(() => {
		return new Set(selectedNodeIds);
	}, [selectedNodeIds]);
	const selectedNodes = useMemo(() => {
		if (selectedNodeIdSet.size === 0) return [];
		return nodes.filter((node) => selectedNodeIdSet.has(node.id));
	}, [nodes, selectedNodeIdSet]);
	const selectionBounds = useMemo(() => {
		if (selectedNodes.length <= 1) return null;
		return resolveCanvasNodeBounds(selectedNodes);
	}, [selectedNodes]);
	const hoverNode = useMemo(() => {
		if (!hoveredNodeId) return null;
		return nodes.find((node) => node.id === hoveredNodeId) ?? null;
	}, [hoveredNodeId, nodes]);
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
			if (event.button === 0) {
				draggingNodeIdRef.current = node.id;
				// 拖拽中锁定 hover，避免掠过高层节点时边框跳闪
				setHoveredNodeId(node.id);
			}
			onNodeDragStart?.(node, event);
		},
		[disableBaseNodeInteraction, onNodeDragStart],
	);

	const handleNodeDrag = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (disableBaseNodeInteraction) return;
			onNodeDrag?.(node, event);
		},
		[disableBaseNodeInteraction, onNodeDrag],
	);

	const handleNodeDragEnd = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (disableBaseNodeInteraction) return;
			if (draggingNodeIdRef.current === node.id) {
				draggingNodeIdRef.current = null;
			}
			onNodeDragEnd?.(node, event);
		},
		[disableBaseNodeInteraction, onNodeDragEnd],
	);

	useLayoutEffect(() => {
		const root = canvasRef.current?.getRoot();
		if (!root) return;
		root.render(
			<Group>
				<CanvasTriDotGridBackground
					width={width}
					height={height}
					camera={camera}
				/>
				<Group
					transform={[
						{ scale: camera.zoom },
						{ translateX: camera.x },
						{ translateY: camera.y },
					]}
				>
					{selectionBounds && !disableBaseNodeInteraction && (
						<SelectionBoundsInteractionLayer
							bounds={selectionBounds}
							onDragStart={onSelectionDragStart}
							onDrag={onSelectionDrag}
							onDragEnd={onSelectionDragEnd}
						/>
					)}
					{nodes.map((node) => {
						const definition = getCanvasNodeDefinition(node.type);
						const Renderer = definition.skiaRenderer;
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
							<Group
								key={`canvas-node-skia-${node.id}`}
								clip={{
									x: node.x,
									y: node.y,
									width: node.width,
									height: node.height,
								}}
							>
								<NodeInteractionWrapper
									node={node}
									isActive={isActive}
									isSelected={isSelected}
									isDimmed={isDimmed}
									isHovered={isHovered}
									cameraZoom={camera.zoom}
									showBorder={false}
									disabled={disableBaseNodeInteraction}
									onPointerEnter={handlePointerEnter}
									onPointerLeave={handlePointerLeave}
									onDragStart={handleNodeDragStart}
									onDrag={handleNodeDrag}
									onDragEnd={handleNodeDragEnd}
									onClick={onNodeClick}
									onDoubleClick={onNodeDoubleClick}
								>
									<Renderer
										node={node}
										scene={scene}
										asset={asset}
										isActive={isActive}
										isFocused={isFocused}
										isDimmed={isDimmed}
										runtimeManager={runtimeManager}
									/>
								</NodeInteractionWrapper>
							</Group>
						);
					})}
				</Group>
				<CanvasNodeLabelLayer
					width={width}
					height={height}
					camera={camera}
					nodes={nodes}
					focusedNodeId={focusedNodeId}
				/>
				{!disableBaseNodeInteraction && !focusedNodeId && (
					<CanvasNodeOverlayLayer
						activeNode={activeNode}
						selectedNodes={selectedNodes}
						hoverNode={hoverNode}
						camera={camera}
						onNodeResize={onNodeResize}
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
		camera,
		disableBaseNodeInteraction,
		focusedNodeId,
		focusEditorLayerState.layerProps,
		focusLayerEnabled,
		handleNodeDrag,
		handleNodeDragEnd,
		handleNodeDragStart,
		handlePointerEnter,
		handlePointerLeave,
		height,
		hoverNode,
		hoveredNodeId,
		nodes,
		onNodeClick,
		onNodeDoubleClick,
		onNodeResize,
		onSelectionDrag,
		onSelectionDragEnd,
		onSelectionDragStart,
		onSelectionResize,
		runtimeManager,
		scenes,
		selectionBounds,
		selectedNodeIdSet,
		selectedNodes,
		FocusEditorLayer,
		width,
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
			{focusedNode && FocusEditorBridge && (
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
