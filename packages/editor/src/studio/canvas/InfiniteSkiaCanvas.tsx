import { useDrag } from "@use-gesture/react";
import type { CanvasNode, StudioProject } from "core/studio/types";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	Canvas,
	type CanvasRef,
	Group,
	Rect,
	type SkiaPointerEvent,
} from "react-skia-lite";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import { getCanvasNodeDefinition } from "./node-system/registry";

export interface CanvasNodeDragEvent {
	movementX: number;
	movementY: number;
	clientX: number;
	clientY: number;
	first: boolean;
	last: boolean;
	tap: boolean;
	button: number;
	buttons: number;
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
	onNodeClick?: (node: CanvasNode) => void;
	onNodeDoubleClick?: (node: CanvasNode) => void;
	onNodeDragStart?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onNodeDrag?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onNodeDragEnd?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
}

interface NodeInteractionWrapperProps {
	node: CanvasNode;
	isActive: boolean;
	isDimmed: boolean;
	isHovered: boolean;
	onPointerEnter: (nodeId: string) => void;
	onPointerLeave: (nodeId: string) => void;
	onDragStart?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onDrag?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onDragEnd?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onClick?: (node: CanvasNode) => void;
	onDoubleClick?: (node: CanvasNode) => void;
	children: React.ReactNode;
}

const resolvePointerField = (
	event: unknown,
	key: "button" | "buttons",
): number => {
	if (!event || typeof event !== "object") return 0;
	if (!(key in event)) return 0;
	const value = (event as Record<string, unknown>)[key];
	if (!Number.isFinite(value)) return 0;
	return Number(value);
};

const NodeInteractionWrapper: React.FC<NodeInteractionWrapperProps> = ({
	node,
	isActive,
	isDimmed,
	isHovered,
	onPointerEnter,
	onPointerLeave,
	onDragStart,
	onDrag,
	onDragEnd,
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
				movementX: mx,
				movementY: my,
				clientX,
				clientY,
				first,
				last,
				tap,
				button: resolvePointerField(event, "button"),
				buttons: resolvePointerField(event, "buttons"),
			};
			if (first) {
				onDragStart?.(node, dragEvent);
			}
			if (!last) {
				onDrag?.(node, dragEvent);
			}
			if (last) {
				onDragEnd?.(node, dragEvent);
			}
		},
		{
			pointer: { capture: false },
			keys: false,
			filterTaps: false,
			threshold: 0,
			triggerAllEvents: true,
		},
	);
	const dragHandlers = bindDrag() as {
		onPointerDown?: (event: SkiaPointerEvent) => void;
	};

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
				dragHandlers.onPointerDown?.(event);
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
