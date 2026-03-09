import type { CanvasNode, SceneNode, StudioProject } from "core/studio/types";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, type CanvasRef, Group } from "react-skia-lite";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import { CanvasNodeOverlayLayer } from "./CanvasNodeOverlayLayer";
import { CanvasTriDotGridBackground } from "./CanvasTriDotGridBackground";
import type { CanvasNodeResizeAnchor } from "./canvasResizeAnchor";
import { FocusSceneLabelLayer } from "./FocusSceneLabelLayer";
import { FocusSceneSkiaLayer } from "./FocusSceneSkiaLayer";
import {
	type CanvasNodeDragEvent,
	NodeInteractionWrapper,
} from "./NodeInteractionWrapper";
import { getCanvasNodeDefinition } from "./node-system/registry";
import { useFocusSceneSkiaInteractions } from "./useFocusSceneSkiaInteractions";
import { useFocusSceneTimelineElements } from "./useFocusSceneTimelineElements";

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
	const focusedSceneNode = useMemo<SceneNode | null>(() => {
		if (!focusedNodeId) return null;
		const focusedNode = nodes.find((node) => node.id === focusedNodeId);
		if (!focusedNode || focusedNode.type !== "scene") return null;
		return focusedNode;
	}, [focusedNodeId, nodes]);
	const disableBaseNodeInteraction = Boolean(focusedSceneNode);
	const {
		runtime: focusRuntime,
		renderElements: focusRenderElements,
		renderElementsRef: focusRenderElementsRef,
		sourceWidth: focusSourceWidth,
		sourceHeight: focusSourceHeight,
	} = useFocusSceneTimelineElements({
		runtimeManager,
		sceneId: focusedSceneNode?.sceneId ?? null,
	});
	const focusInteractions = useFocusSceneSkiaInteractions({
		width,
		height,
		camera,
		focusedNode: focusedSceneNode,
		sourceWidth: focusSourceWidth,
		sourceHeight: focusSourceHeight,
		renderElements: focusRenderElements,
		renderElementsRef: focusRenderElementsRef,
		timelineStore: focusRuntime?.timelineStore ?? null,
		disabled: suspendHover || !focusedSceneNode || !focusRuntime,
	});
	const focusLayerEnabled = Boolean(focusedSceneNode && focusRuntime);

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
				{focusLayerEnabled && (
					<FocusSceneSkiaLayer
						width={width}
						height={height}
						elements={focusInteractions.elementLayouts}
						selectedIds={focusInteractions.selectedIds}
						hoveredId={focusInteractions.hoveredId}
						draggingId={focusInteractions.draggingId}
						selectionRectScreen={focusInteractions.selectionRectScreen}
						snapGuidesScreen={focusInteractions.snapGuidesScreen}
						selectionFrameScreen={focusInteractions.selectionFrameScreen}
						handleItems={focusInteractions.handleItems}
						activeHandle={focusInteractions.activeHandle}
						disabled={suspendHover}
						onLayerPointerDown={focusInteractions.onLayerPointerDown}
						onLayerPointerMove={focusInteractions.onLayerPointerMove}
						onLayerPointerUp={focusInteractions.onLayerPointerUp}
						onLayerPointerLeave={focusInteractions.onLayerPointerLeave}
					/>
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
		focusInteractions.activeHandle,
		focusInteractions.draggingId,
		focusInteractions.elementLayouts,
		focusInteractions.handleItems,
		focusInteractions.hoveredId,
		focusInteractions.onLayerPointerDown,
		focusInteractions.onLayerPointerLeave,
		focusInteractions.onLayerPointerMove,
		focusInteractions.onLayerPointerUp,
		focusInteractions.selectedIds,
		focusInteractions.selectionFrameScreen,
		focusInteractions.selectionRectScreen,
		focusInteractions.snapGuidesScreen,
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
		suspendHover,
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
			{focusLayerEnabled && (
				<FocusSceneLabelLayer labels={focusInteractions.labelItems} />
			)}
		</div>
	);
};

export default InfiniteSkiaCanvas;
