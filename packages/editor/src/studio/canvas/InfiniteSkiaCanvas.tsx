import { useDrag } from "@use-gesture/react";
import type { CanvasNode, SceneNode, StudioProject } from "core/studio/types";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	Canvas,
	type CanvasRef,
	Group,
	type SkiaPointerEvent,
} from "react-skia-lite";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import { CanvasNodeOverlayLayer } from "./CanvasNodeOverlayLayer";
import { CanvasTriDotGridBackground } from "./CanvasTriDotGridBackground";
import { FocusSceneLabelLayer } from "./FocusSceneLabelLayer";
import { FocusSceneSkiaLayer } from "./FocusSceneSkiaLayer";
import type {
	CanvasNodeResizeAnchor,
	CanvasNodeResizeAnchorState,
} from "./canvasResizeAnchor";
import { resolveCanvasResizeAnchorAtWorldPoint } from "./canvasResizeAnchor";
import {
	type CanvasNodeDragEvent,
	NodeInteractionWrapper,
} from "./NodeInteractionWrapper";
import { getCanvasNodeDefinition } from "./node-system/registry";
import { useFocusSceneSkiaInteractions } from "./useFocusSceneSkiaInteractions";
import { useFocusSceneTimelineElements } from "./useFocusSceneTimelineElements";

export type { CanvasNodeResizeAnchor } from "./canvasResizeAnchor";
export type { CanvasNodeDragEvent } from "./NodeInteractionWrapper";

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

const resolvePointerLocalPoint = (
	event: unknown,
): { x: number; y: number } | null => {
	if (!event || typeof event !== "object") return null;
	const x = (event as Record<string, unknown>).x;
	const y = (event as Record<string, unknown>).y;
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	return {
		x: Number(x),
		y: Number(y),
	};
};

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
	onNodeResizeStart?: (
		node: CanvasNode,
		anchor: CanvasNodeResizeAnchor,
		event: CanvasNodeDragEvent,
	) => void;
	onNodeResize?: (
		node: CanvasNode,
		anchor: CanvasNodeResizeAnchor,
		event: CanvasNodeDragEvent,
	) => void;
	onNodeResizeEnd?: (
		node: CanvasNode,
		anchor: CanvasNodeResizeAnchor,
		event: CanvasNodeDragEvent,
	) => void;
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
	onNodeResizeStart,
	onNodeResize,
	onNodeResizeEnd,
}) => {
	const runtimeManager = useStudioRuntimeManager();
	const canvasRef = useRef<CanvasRef>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const draggingNodeIdRef = useRef<string | null>(null);
	const resizingAnchorRef = useRef<CanvasNodeResizeAnchorState | null>(null);
	const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
	const [hoveredResizeAnchor, setHoveredResizeAnchor] =
		useState<CanvasNodeResizeAnchorState | null>(null);
	const [pressedResizeAnchor, setPressedResizeAnchor] =
		useState<CanvasNodeResizeAnchorState | null>(null);
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
		disabled:
			suspendHover ||
			!focusedSceneNode ||
			!focusRuntime,
	});
	const focusLayerEnabled = Boolean(focusedSceneNode && focusRuntime);
	const [hmrRenderVersion, setHmrRenderVersion] = useState(0);

	useLayoutEffect(() => {
		const hot = import.meta.hot;
		if (!hot) return;
		// 开发态 HMR 后强制触发一次重绘，避免样式改动需要手动刷新页面。
		const handleHmrUpdate = () => {
			setHmrRenderVersion((prev) => prev + 1);
		};
		hot.on("vite:afterUpdate", handleHmrUpdate);
		return () => {
			hot.off("vite:afterUpdate", handleHmrUpdate);
		};
	}, []);

	useLayoutEffect(() => {
		if (!suspendHover) return;
		setHoveredNodeId(null);
		setHoveredResizeAnchor(null);
		setPressedResizeAnchor(null);
	}, [suspendHover]);

	useLayoutEffect(() => {
		if (!disableBaseNodeInteraction) return;
		draggingNodeIdRef.current = null;
		resizingAnchorRef.current = null;
		setHoveredNodeId(null);
		setHoveredResizeAnchor(null);
		setPressedResizeAnchor(null);
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

	useLayoutEffect(() => {
		// 节点列表变化时，清理已失效的 anchor hover/pressed 引用
		if (hoveredResizeAnchor && !nodeIdSet.has(hoveredResizeAnchor.nodeId)) {
			setHoveredResizeAnchor(null);
		}
		if (pressedResizeAnchor && !nodeIdSet.has(pressedResizeAnchor.nodeId)) {
			setPressedResizeAnchor(null);
		}
		if (
			resizingAnchorRef.current &&
			!nodeIdSet.has(resizingAnchorRef.current.nodeId)
		) {
			resizingAnchorRef.current = null;
		}
	}, [hoveredResizeAnchor, nodeIdSet, pressedResizeAnchor]);

	useLayoutEffect(() => {
		// active 节点切换时，避免遗留旧 anchor 状态
		if (
			hoveredResizeAnchor &&
			(!activeNodeId || hoveredResizeAnchor.nodeId !== activeNodeId)
		) {
			setHoveredResizeAnchor(null);
		}
		if (
			pressedResizeAnchor &&
			(!activeNodeId || pressedResizeAnchor.nodeId !== activeNodeId)
		) {
			setPressedResizeAnchor(null);
		}
		if (
			resizingAnchorRef.current &&
			(!activeNodeId || resizingAnchorRef.current.nodeId !== activeNodeId)
		) {
			resizingAnchorRef.current = null;
		}
	}, [activeNodeId, hoveredResizeAnchor, pressedResizeAnchor]);

	const handlePointerEnter = useCallback((nodeId: string) => {
		if (suspendHover || disableBaseNodeInteraction) return;
		if (draggingNodeIdRef.current || resizingAnchorRef.current) return;
		setHoveredNodeId(nodeId);
	}, [disableBaseNodeInteraction, suspendHover]);

	const handlePointerLeave = useCallback((nodeId: string) => {
		if (suspendHover || disableBaseNodeInteraction) return;
		if (draggingNodeIdRef.current || resizingAnchorRef.current) return;
		setHoveredNodeId((prev) => {
			if (prev !== nodeId) return prev;
			return null;
		});
	}, [disableBaseNodeInteraction, suspendHover]);

	const handleNodeDragStart = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (disableBaseNodeInteraction) return;
			if (resizingAnchorRef.current) return;
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
			if (resizingAnchorRef.current) return;
			onNodeDrag?.(node, event);
		},
		[disableBaseNodeInteraction, onNodeDrag],
	);

	const handleNodeDragEnd = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (disableBaseNodeInteraction) return;
			if (resizingAnchorRef.current) return;
			if (draggingNodeIdRef.current === node.id) {
				draggingNodeIdRef.current = null;
			}
			onNodeDragEnd?.(node, event);
		},
		[disableBaseNodeInteraction, onNodeDragEnd],
	);

	const handleResizeAnchorPointerEnter = useCallback(
		(nodeId: string, anchor: CanvasNodeResizeAnchor) => {
			if (suspendHover || disableBaseNodeInteraction) return;
			if (draggingNodeIdRef.current || resizingAnchorRef.current) return;
			setHoveredResizeAnchor({
				nodeId,
				anchor,
			});
		},
		[disableBaseNodeInteraction, suspendHover],
	);

	const handleResizeAnchorPointerLeave = useCallback(
		(nodeId: string, anchor: CanvasNodeResizeAnchor) => {
			if (suspendHover || disableBaseNodeInteraction) return;
			if (draggingNodeIdRef.current || resizingAnchorRef.current) return;
			setHoveredResizeAnchor((prev) => {
				if (!prev) return prev;
				if (prev.nodeId !== nodeId || prev.anchor !== anchor) return prev;
				return null;
			});
		},
		[disableBaseNodeInteraction, suspendHover],
	);

	const handleResizeDragGesture = useCallback(
		(
			anchor: CanvasNodeResizeAnchor,
			state: {
				first: boolean;
				last: boolean;
				tap: boolean;
				movement: [number, number];
				xy: [number, number];
				event: unknown;
			},
		) => {
			if (disableBaseNodeInteraction) return;
			const node = activeNode;
			if (!node || node.locked) return;
			const dragEvent: CanvasNodeDragEvent = {
				movementX: state.movement[0],
				movementY: state.movement[1],
				clientX: state.xy[0],
				clientY: state.xy[1],
				first: state.first,
				last: state.last,
				tap: state.tap,
				button: resolvePointerField(state.event, "button"),
				buttons: resolvePointerField(state.event, "buttons"),
			};
			const anchorState: CanvasNodeResizeAnchorState = {
				nodeId: node.id,
				anchor,
			};

			if (state.first) {
				if (dragEvent.button !== 0) return;
				resizingAnchorRef.current = anchorState;
				setPressedResizeAnchor(anchorState);
				setHoveredResizeAnchor(anchorState);
				onNodeResizeStart?.(node, anchor, dragEvent);
			}

			const currentResize = resizingAnchorRef.current;
			if (
				!currentResize ||
				currentResize.nodeId !== node.id ||
				currentResize.anchor !== anchor
			) {
				return;
			}

			if (!state.last) {
				onNodeResize?.(node, anchor, dragEvent);
			}

			if (state.last) {
				resizingAnchorRef.current = null;
				setPressedResizeAnchor((prev) => {
					if (!prev) return prev;
					if (prev.nodeId !== node.id || prev.anchor !== anchor) return prev;
					return null;
				});
				const localPoint = resolvePointerLocalPoint(state.event);
				const [clientX, clientY] = state.xy;
				const containerRect = containerRef.current?.getBoundingClientRect();
				const pointerLocalX =
					localPoint?.x ??
					(containerRect ? clientX - containerRect.left : clientX);
				const pointerLocalY =
					localPoint?.y ??
					(containerRect ? clientY - containerRect.top : clientY);
				const safeZoom = Math.max(camera.zoom, 1e-6);
				const worldX = pointerLocalX / safeZoom - camera.x;
				const worldY = pointerLocalY / safeZoom - camera.y;
				const hoveredAnchor =
					!focusedNodeId && !node.locked
						? resolveCanvasResizeAnchorAtWorldPoint({
								node,
								worldX,
								worldY,
								cameraZoom: camera.zoom,
							})
						: null;
				setHoveredResizeAnchor(
					hoveredAnchor
						? {
								nodeId: node.id,
								anchor: hoveredAnchor,
							}
						: null,
				);
				onNodeResizeEnd?.(node, anchor, dragEvent);
			}
		},
		[
			activeNode,
			camera.x,
			camera.y,
			camera.zoom,
			disableBaseNodeInteraction,
			focusedNodeId,
			onNodeResize,
			onNodeResizeEnd,
			onNodeResizeStart,
		],
	);

	const bindTopLeftResizeDrag = useDrag(
		(state) => {
			handleResizeDragGesture("top-left", state);
		},
		{
			pointer: { capture: false },
			keys: false,
			filterTaps: false,
			threshold: 0,
			triggerAllEvents: true,
		},
	);
	const bindBottomRightResizeDrag = useDrag(
		(state) => {
			handleResizeDragGesture("bottom-right", state);
		},
		{
			pointer: { capture: false },
			keys: false,
			filterTaps: false,
			threshold: 0,
			triggerAllEvents: true,
		},
	);
	const topLeftResizeHandlers = bindTopLeftResizeDrag() as {
		onPointerDown?: (event: SkiaPointerEvent) => void;
	};
	const bottomRightResizeHandlers = bindBottomRightResizeDrag() as {
		onPointerDown?: (event: SkiaPointerEvent) => void;
	};

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
										showBorder={
											!disableBaseNodeInteraction && !isActive && !isHovered
										}
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
						{!disableBaseNodeInteraction &&
							CanvasNodeOverlayLayer({
								nodes,
								cameraZoom: camera.zoom,
								activeNodeId,
								focusedNodeId,
								hoveredNodeId,
								hoveredResizeAnchor,
								pressedResizeAnchor,
								onResizeAnchorPointerEnter: handleResizeAnchorPointerEnter,
								onResizeAnchorPointerLeave: handleResizeAnchorPointerLeave,
								onTopLeftResizePointerDown: topLeftResizeHandlers.onPointerDown,
								onBottomRightResizePointerDown:
									bottomRightResizeHandlers.onPointerDown,
							})}
					</Group>
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
			activeNodeId,
			assetById,
		camera.x,
			camera.y,
			camera.zoom,
			disableBaseNodeInteraction,
			handleNodeDrag,
			handleNodeDragEnd,
			handleNodeDragStart,
		handlePointerEnter,
		handlePointerLeave,
		handleResizeAnchorPointerEnter,
		handleResizeAnchorPointerLeave,
		bottomRightResizeHandlers,
		focusedNodeId,
		hoveredNodeId,
		hoveredResizeAnchor,
		nodes,
		onNodeClick,
		onNodeDoubleClick,
			pressedResizeAnchor,
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
			runtimeManager,
			scenes,
			suspendHover,
			topLeftResizeHandlers,
			width,
			height,
			hmrRenderVersion,
	]);

	if (width <= 0 || height <= 0) return null;

	return (
		<div
			ref={containerRef}
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
