import type { CanvasNode, StudioProject } from "core/studio/types";
import { useEffect, useMemo, useState } from "react";
import { Canvas, Group, Rect, type SkiaPointerEvent } from "react-skia-lite";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import { getCanvasNodeDefinition } from "./node-system/registry";

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
	onNodePointerDown?: (node: CanvasNode, event: SkiaPointerEvent) => void;
}

interface NodeInteractionWrapperProps {
	node: CanvasNode;
	isActive: boolean;
	isDimmed: boolean;
	isHovered: boolean;
	onPointerEnter: (nodeId: string) => void;
	onPointerLeave: (nodeId: string) => void;
	onPointerDown?: (node: CanvasNode, event: SkiaPointerEvent) => void;
	onClick?: (node: CanvasNode) => void;
	onDoubleClick?: (node: CanvasNode) => void;
	children: React.ReactNode;
}

const NodeInteractionWrapper: React.FC<NodeInteractionWrapperProps> = ({
	node,
	isActive,
	isDimmed,
	isHovered,
	onPointerEnter,
	onPointerLeave,
	onPointerDown,
	onClick,
	onDoubleClick,
	children,
}) => {
	const borderColor = isActive
		? "rgba(251,146,60,1)"
		: isHovered
			? "rgba(56,189,248,0.95)"
			: "rgba(255,255,255,0.2)";
	const borderWidth = isActive || isHovered ? 2 : 1;

	return (
		<Group
			transform={[{ translateX: node.x }, { translateY: node.y }]}
			opacity={isDimmed ? 0.35 : 1}
			hitRect={{
				x: 0,
				y: 0,
				width: Math.max(1, node.width),
				height: Math.max(1, node.height),
			}}
			onPointerEnter={() => {
				onPointerEnter(node.id);
			}}
			onPointerLeave={() => {
				onPointerLeave(node.id);
			}}
			onPointerDown={(event) => {
				onPointerDown?.(node, event);
			}}
			onClick={() => {
				onClick?.(node);
			}}
			onDoubleClick={() => {
				onDoubleClick?.(node);
			}}
		>
			{children}
			<Rect
				x={0}
				y={0}
				width={Math.max(1, node.width)}
				height={Math.max(1, node.height)}
				style="stroke"
				strokeWidth={borderWidth}
				color={borderColor}
			/>
		</Group>
	);
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
	onNodeClick,
	onNodeDoubleClick,
	onNodePointerDown,
}) => {
	const runtimeManager = useStudioRuntimeManager();
	const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
	const assetById = useMemo(() => {
		return new Map(assets.map((asset) => [asset.id, asset]));
	}, [assets]);
	const nodeIdSet = useMemo(() => {
		return new Set(nodes.map((node) => node.id));
	}, [nodes]);

	useEffect(() => {
		// 节点列表变化时，清理已失效的 hover 引用
		if (hoveredNodeId && !nodeIdSet.has(hoveredNodeId)) {
			setHoveredNodeId(null);
		}
	}, [hoveredNodeId, nodeIdSet]);

	if (width <= 0 || height <= 0) return null;

	return (
		<div
			data-testid="infinite-skia-canvas"
			className="pointer-events-auto absolute inset-0 z-30"
		>
			<Canvas style={{ width, height }}>
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
									onPointerEnter={setHoveredNodeId}
									onPointerLeave={(nodeId) => {
										setHoveredNodeId((prev) => {
											if (prev !== nodeId) return prev;
											return null;
										});
									}}
									onPointerDown={onNodePointerDown}
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
			</Canvas>
		</div>
	);
};

export default InfiniteSkiaCanvas;
