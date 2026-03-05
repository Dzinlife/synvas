import type { CanvasNode, StudioProject } from "core/studio/types";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, type CanvasRef, Group, Rect } from "react-skia-lite";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import {
	type CanvasNodeDragEvent,
	NodeInteractionWrapper,
	resolveNodeInteractionBorderStyle,
	resolveNodeInteractionStrokeWidth,
} from "./NodeInteractionWrapper";
import { CanvasTriDotGridBackground } from "./CanvasTriDotGridBackground";
import { getCanvasNodeDefinition } from "./node-system/registry";

export type { CanvasNodeDragEvent } from "./NodeInteractionWrapper";

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
	onNodeClick?: (node: CanvasNode) => void;
	onNodeDoubleClick?: (node: CanvasNode) => void;
	onNodeDragStart?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onNodeDrag?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onNodeDragEnd?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
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
	onNodeClick,
	onNodeDoubleClick,
	onNodeDragStart,
	onNodeDrag,
	onNodeDragEnd,
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
			if (draggingNodeIdRef.current) return;
			setHoveredNodeId(nodeId);
		},
		[],
	);

	const handlePointerLeave = useCallback(
		(nodeId: string) => {
			if (draggingNodeIdRef.current) return;
			setHoveredNodeId((prev) => {
				if (prev !== nodeId) return prev;
				return null;
			});
		},
		[],
	);

	const handleNodeDragStart = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (event.button === 0) {
				draggingNodeIdRef.current = node.id;
				// 拖拽中锁定 hover，避免掠过高层节点时边框跳闪
				setHoveredNodeId(node.id);
			}
			onNodeDragStart?.(node, event);
		},
		[onNodeDragStart],
	);

	const handleNodeDrag = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			onNodeDrag?.(node, event);
		},
		[onNodeDrag],
	);

	const handleNodeDragEnd = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (draggingNodeIdRef.current === node.id) {
				draggingNodeIdRef.current = null;
			}
			onNodeDragEnd?.(node, event);
		},
		[onNodeDragEnd],
	);

	useLayoutEffect(() => {
		const root = canvasRef.current?.getRoot();
		if (!root) return;
		root.render(
			<Group>
				<CanvasTriDotGridBackground width={width} height={height} camera={camera} />
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
						const isHovered = node.id === hoveredNodeId;

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
									showBorder={!isActive && !isHovered}
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
					<Group zIndex={1_000_000} pointerEvents="none">
						{nodes.map((node) => {
							const isFocused = node.id === focusedNodeId;
							const isActive = node.id === activeNodeId;
							const isDimmed = Boolean(focusedNodeId) && !isFocused;
							const isHovered = node.id === hoveredNodeId;
							if (!isActive && !isHovered) return null;
							const borderStyle = resolveNodeInteractionBorderStyle({
								isActive,
								isHovered,
							});
							const strokeWidth = resolveNodeInteractionStrokeWidth(
								borderStyle.baseStrokeWidthPx,
								camera.zoom,
							);

							return (
								<Group
									key={`canvas-node-outline-overlay-${node.id}`}
									clip={{
										x: node.x,
										y: node.y,
										width: node.width,
										height: node.height,
									}}
									opacity={isDimmed ? 0.35 : 1}
								>
									<Group transform={[{ translateX: node.x }, { translateY: node.y }]}>
										<Rect
											x={0}
											y={0}
											width={Math.max(1, node.width)}
											height={Math.max(1, node.height)}
											style="stroke"
											strokeWidth={strokeWidth}
											color={borderStyle.color}
										/>
									</Group>
								</Group>
							);
						})}
					</Group>
				</Group>
			</Group>,
		);
	}, [
		activeNodeId,
		assetById,
		camera.x,
		camera.y,
		camera.zoom,
		handleNodeDrag,
		handleNodeDragEnd,
		handleNodeDragStart,
		handlePointerEnter,
		handlePointerLeave,
		focusedNodeId,
		hoveredNodeId,
		nodes,
		onNodeClick,
		onNodeDoubleClick,
		runtimeManager,
		scenes,
		width,
		height,
	]);

	if (width <= 0 || height <= 0) return null;

	return (
		<div
			data-testid="infinite-skia-canvas"
			className="pointer-events-auto absolute inset-0 z-30"
		>
			<Canvas ref={canvasRef} style={{ width, height }} />
		</div>
	);
};

export default InfiniteSkiaCanvas;
