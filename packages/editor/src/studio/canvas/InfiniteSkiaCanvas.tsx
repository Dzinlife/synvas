import type { CanvasNode, StudioProject } from "core/studio/types";
import type React from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, type CanvasRef, Group } from "react-skia-lite";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import { CanvasNodeOverlayLayer } from "./CanvasNodeOverlayLayer";
import { CanvasTriDotGridBackground } from "./CanvasTriDotGridBackground";
import type { CanvasNodeResizeAnchor } from "./canvasResizeAnchor";
import {
	type CanvasNodeDragEvent,
	NodeInteractionWrapper,
} from "./NodeInteractionWrapper";
import { getCanvasNodeDefinition } from "./node-system/registry";
import type {
	CanvasNodeFocusEditorBridgeProps,
	CanvasNodeFocusEditorLayerState,
} from "./node-system/types";

export type { CanvasNodeResizeAnchor } from "./canvasResizeAnchor";
export type { CanvasNodeDragEvent } from "./NodeInteractionWrapper";

export interface CanvasNodeResizeEvent {
	phase: "start" | "move" | "end";
	node: CanvasNode;
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
	focusedNodeId: string | null;
	suspendHover?: boolean;
	onNodeClick?: (node: CanvasNode) => void;
	onNodeDoubleClick?: (node: CanvasNode) => void;
	onNodeDragStart?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onNodeDrag?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onNodeDragEnd?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onNodeResize?: (event: CanvasNodeResizeEvent) => void;
}

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
	focusedNodeId,
	suspendHover = false,
	onNodeClick,
	onNodeDoubleClick,
	onNodeDragStart,
	onNodeDrag,
	onNodeDragEnd,
	onNodeResize,
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
		setFocusEditorLayerState({
			enabled: false,
			layerProps: null,
		});
	}, [focusedNodeId, focusEditorLayer, focusEditorBridge]);

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
					{nodes.map((node) => {
						const definition = getCanvasNodeDefinition(node.type);
						const Renderer = definition.skiaRenderer;
						const scene =
							node.type === "scene" ? (scenes[node.sceneId] ?? null) : null;
						const asset =
							"assetId" in node ? (assetById.get(node.assetId) ?? null) : null;
						const isFocused = node.id === focusedNodeId;
						const isActive = node.id === activeNodeId;
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
				{!disableBaseNodeInteraction && !focusedNodeId && (
					<CanvasNodeOverlayLayer
						activeNode={activeNode}
						hoverNode={hoverNode}
						camera={camera}
						onNodeResize={onNodeResize}
					/>
				)}
				{focusLayerEnabled && FocusEditorLayer && focusEditorLayerState.layerProps && (
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
		focusEditorLayerState.enabled,
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
		runtimeManager,
		scenes,
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
