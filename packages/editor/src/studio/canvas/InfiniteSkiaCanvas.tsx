import type { CanvasNode, StudioProject } from "core/studio/types";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, type CanvasRef, Group } from "react-skia-lite";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import {
	type CanvasNodeDragEvent,
	NodeInteractionWrapper,
} from "./NodeInteractionWrapper";
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
		const root = canvasRef.current?.getRoot();
		if (!root) return;
		root.render(
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
								onDragStart={onNodeDragStart}
								onDrag={onNodeDrag}
								onDragEnd={onNodeDragEnd}
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
			</Group>,
		);
	}, [
		activeNodeId,
		assetById,
		camera.x,
		camera.y,
		camera.zoom,
		focusedNodeId,
		hoveredNodeId,
		nodes,
		onNodeClick,
		onNodeDoubleClick,
		onNodeDrag,
		onNodeDragEnd,
		onNodeDragStart,
		runtimeManager,
		scenes,
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
