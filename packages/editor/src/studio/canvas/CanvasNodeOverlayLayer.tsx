import { useDrag } from "@use-gesture/react";
import type { CanvasNode } from "core/studio/types";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Group, Path, Rect, type SkiaPointerEvent } from "react-skia-lite";
import {
	resolveCanvasNodeScreenFrame,
	resolveCanvasWorldRectScreenFrame,
} from "./canvasNodeLabelUtils";
import type { CanvasNodeResizeAnchor } from "./canvasResizeAnchor";
import {
	CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
	CANVAS_RESIZE_ANCHOR_LEG_PX,
	CANVAS_RESIZE_ANCHOR_OFFSET_PX,
	CANVAS_RESIZE_ANCHOR_STROKE_PX,
	resolveCanvasResizeAnchorAtRectWorldPoint,
	resolveCanvasResizeAnchorAtWorldPoint,
} from "./canvasResizeAnchor";
import { resolveCanvasNodeBounds } from "./canvasWorkspaceUtils";
import type { CanvasNodeDragEvent } from "./NodeInteractionWrapper";
import {
	resolveNodeInteractionBorderStyle,
	resolvePointerEventMeta,
} from "./NodeInteractionWrapper";

const RESIZE_ANCHOR_ENTER_OFFSET_PX = 8;
const RESIZE_ANCHOR_ENTER_TRANSITION = {
	duration: 200,
	easing: "easeOutCubic",
} as const;

const RESIZE_DRAG_CONFIG = {
	pointer: { capture: false },
	keys: false,
	filterTaps: false,
	threshold: 0,
	triggerAllEvents: true,
} as const;

const buildTopLeftAnchorPath = (offsetPx: number, legPx: number): string => {
	const cornerX = -offsetPx;
	const cornerY = -offsetPx;
	return `M ${cornerX + legPx} ${cornerY} L ${cornerX} ${cornerY} L ${cornerX} ${cornerY + legPx}`;
};

const buildTopRightAnchorPath = (
	width: number,
	offsetPx: number,
	legPx: number,
): string => {
	const cornerX = width + offsetPx;
	const cornerY = -offsetPx;
	return `M ${cornerX - legPx} ${cornerY} L ${cornerX} ${cornerY} L ${cornerX} ${cornerY + legPx}`;
};

const buildBottomRightAnchorPath = (
	width: number,
	height: number,
	offsetPx: number,
	legPx: number,
): string => {
	const cornerX = width + offsetPx;
	const cornerY = height + offsetPx;
	return `M ${cornerX - legPx} ${cornerY} L ${cornerX} ${cornerY} L ${cornerX} ${cornerY - legPx}`;
};

const buildBottomLeftAnchorPath = (
	height: number,
	offsetPx: number,
	legPx: number,
): string => {
	const cornerX = -offsetPx;
	const cornerY = height + offsetPx;
	return `M ${cornerX + legPx} ${cornerY} L ${cornerX} ${cornerY} L ${cornerX} ${cornerY - legPx}`;
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

const resolveAnchorOpacity = (
	anchor: CanvasNodeResizeAnchor,
	hoveredResizeAnchor: CanvasNodeResizeAnchor | null,
	pressedResizeAnchor: CanvasNodeResizeAnchor | null,
): number => {
	if (hoveredResizeAnchor === anchor || pressedResizeAnchor === anchor) {
		return 1;
	}
	return 0.3;
};

interface CanvasNodeOverlayLayerProps {
	activeNode: CanvasNode | null;
	selectedNodes: CanvasNode[];
	hoverNode: CanvasNode | null;
	camera: {
		x: number;
		y: number;
		zoom: number;
	};
	onNodeResize?: (event: {
		phase: "start" | "move" | "end";
		node: CanvasNode;
		anchor: CanvasNodeResizeAnchor;
		event: CanvasNodeDragEvent;
	}) => void;
	onSelectionResize?: (event: {
		phase: "start" | "move" | "end";
		anchor: CanvasNodeResizeAnchor;
		event: CanvasNodeDragEvent;
	}) => void;
}

export const CanvasNodeOverlayLayer = ({
	activeNode,
	selectedNodes,
	hoverNode,
	camera,
	onNodeResize,
	onSelectionResize,
}: CanvasNodeOverlayLayerProps) => {
	const resizingAnchorRef = useRef<CanvasNodeResizeAnchor | null>(null);
	const previousResizeTargetKeyRef = useRef<string | null>(null);
	const [hoveredResizeAnchor, setHoveredResizeAnchor] =
		useState<CanvasNodeResizeAnchor | null>(null);
	const [pressedResizeAnchor, setPressedResizeAnchor] =
		useState<CanvasNodeResizeAnchor | null>(null);

	const selectedNodeIdSet = useRef(new Set<string>());
	selectedNodeIdSet.current = new Set(selectedNodes.map((node) => node.id));
	const isSingleSelection =
		Boolean(activeNode) &&
		(selectedNodes.length === 0 ||
			(selectedNodes.length === 1 && selectedNodes[0]?.id === activeNode?.id));
	const activeNodeScreenFrame = activeNode
		? resolveCanvasNodeScreenFrame(activeNode, camera)
		: null;
	const selectionBounds =
		selectedNodes.length > 1 ? resolveCanvasNodeBounds(selectedNodes) : null;
	const selectionScreenFrame = selectionBounds
		? resolveCanvasWorldRectScreenFrame(selectionBounds, camera)
		: null;
	const isNodeResizeEnabled = Boolean(
		activeNode && !activeNode.locked && isSingleSelection && activeNodeScreenFrame,
	);
	const isSelectionResizeEnabled = Boolean(
		selectionBounds &&
			selectionScreenFrame &&
			selectedNodes.length > 1 &&
			selectedNodes.some((node) => !node.locked),
	);
	const resizeTarget = isNodeResizeEnabled
		? {
				kind: "node" as const,
				key: `node:${activeNode?.id ?? ""}`,
				frame: activeNodeScreenFrame,
				worldRect: activeNode
					? {
							x: activeNode.x,
							y: activeNode.y,
							width: activeNode.width,
							height: activeNode.height,
					  }
					: null,
		  }
		: isSelectionResizeEnabled && selectionBounds && selectionScreenFrame
			? {
					kind: "selection" as const,
					key: `selection:${selectedNodes.map((node) => node.id).join(",")}`,
					frame: selectionScreenFrame,
					worldRect: {
						x: selectionBounds.left,
						y: selectionBounds.top,
						width: selectionBounds.width,
						height: selectionBounds.height,
					},
			  }
			: null;
	const isResizeEnabled = Boolean(resizeTarget?.frame && resizeTarget.worldRect);

	useLayoutEffect(() => {
		// resize 目标切换后清理旧的 anchor 交互状态
		const resizeTargetKey = resizeTarget?.key ?? null;
		if (previousResizeTargetKeyRef.current === resizeTargetKey) return;
		previousResizeTargetKeyRef.current = resizeTargetKey;
		resizingAnchorRef.current = null;
		setHoveredResizeAnchor(null);
		setPressedResizeAnchor(null);
	}, [resizeTarget?.key]);

	useLayoutEffect(() => {
		if (isResizeEnabled) return;
		resizingAnchorRef.current = null;
		setHoveredResizeAnchor(null);
		setPressedResizeAnchor(null);
	}, [isResizeEnabled]);

	const handleResizeAnchorPointerEnter = useCallback(
		(anchor: CanvasNodeResizeAnchor) => {
			if (!isResizeEnabled) return;
			if (resizingAnchorRef.current) return;
			setHoveredResizeAnchor(anchor);
		},
		[isResizeEnabled],
	);

	const handleResizeAnchorPointerLeave = useCallback(
		(anchor: CanvasNodeResizeAnchor) => {
			if (!isResizeEnabled) return;
			if (resizingAnchorRef.current) return;
			setHoveredResizeAnchor((prev) => {
				if (prev !== anchor) return prev;
				return null;
			});
		},
		[isResizeEnabled],
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
			if (!isResizeEnabled || !resizeTarget || !resizeTarget.worldRect) return;

			const dragEvent: CanvasNodeDragEvent = {
				...resolvePointerEventMeta(state.event, state.xy[0], state.xy[1]),
				movementX: state.movement[0],
				movementY: state.movement[1],
				first: state.first,
				last: state.last,
				tap: state.tap,
			};

			if (state.first) {
				if (dragEvent.button !== 0) return;
				resizingAnchorRef.current = anchor;
				setPressedResizeAnchor(anchor);
				setHoveredResizeAnchor(anchor);
				if (resizeTarget.kind === "node" && activeNode) {
					onNodeResize?.({
						phase: "start",
						node: activeNode,
						anchor,
						event: dragEvent,
					});
				} else {
					onSelectionResize?.({
						phase: "start",
						anchor,
						event: dragEvent,
					});
				}
			}

			if (resizingAnchorRef.current !== anchor) return;

			if (!state.last) {
				if (resizeTarget.kind === "node" && activeNode) {
					onNodeResize?.({
						phase: "move",
						node: activeNode,
						anchor,
						event: dragEvent,
					});
				} else {
					onSelectionResize?.({
						phase: "move",
						anchor,
						event: dragEvent,
					});
				}
			}

			if (!state.last) return;

			resizingAnchorRef.current = null;
			setPressedResizeAnchor(null);
			const localPoint = resolvePointerLocalPoint(state.event);
			if (!localPoint) {
				setHoveredResizeAnchor(null);
			} else {
				const safeZoom = Math.max(camera.zoom, 1e-6);
				const worldX = localPoint.x / safeZoom - camera.x;
				const worldY = localPoint.y / safeZoom - camera.y;
				setHoveredResizeAnchor(
					resizeTarget.kind === "node" && activeNode
						? resolveCanvasResizeAnchorAtWorldPoint({
								node: activeNode,
								worldX,
								worldY,
								cameraZoom: camera.zoom,
						  })
						: resolveCanvasResizeAnchorAtRectWorldPoint({
								x: resizeTarget.worldRect.x,
								y: resizeTarget.worldRect.y,
								width: resizeTarget.worldRect.width,
								height: resizeTarget.worldRect.height,
								worldX,
								worldY,
								cameraZoom: camera.zoom,
						  }),
				);
			}
			if (resizeTarget.kind === "node" && activeNode) {
				onNodeResize?.({
					phase: "end",
					node: activeNode,
					anchor,
					event: dragEvent,
				});
			} else {
				onSelectionResize?.({
					phase: "end",
					anchor,
					event: dragEvent,
				});
			}
		},
		[
			activeNode,
			camera.x,
			camera.y,
			camera.zoom,
			isResizeEnabled,
			onNodeResize,
			onSelectionResize,
			resizeTarget,
		],
	);

	const bindTopLeftResizeDrag = useDrag((state) => {
		handleResizeDragGesture("top-left", state);
	}, RESIZE_DRAG_CONFIG);
	const bindTopRightResizeDrag = useDrag((state) => {
		handleResizeDragGesture("top-right", state);
	}, RESIZE_DRAG_CONFIG);
	const bindBottomRightResizeDrag = useDrag((state) => {
		handleResizeDragGesture("bottom-right", state);
	}, RESIZE_DRAG_CONFIG);
	const bindBottomLeftResizeDrag = useDrag((state) => {
		handleResizeDragGesture("bottom-left", state);
	}, RESIZE_DRAG_CONFIG);

	const topLeftResizeHandlers = bindTopLeftResizeDrag() as {
		onPointerDown?: (event: SkiaPointerEvent) => void;
	};
	const topRightResizeHandlers = bindTopRightResizeDrag() as {
		onPointerDown?: (event: SkiaPointerEvent) => void;
	};
	const bottomRightResizeHandlers = bindBottomRightResizeDrag() as {
		onPointerDown?: (event: SkiaPointerEvent) => void;
	};
	const bottomLeftResizeHandlers = bindBottomLeftResizeDrag() as {
		onPointerDown?: (event: SkiaPointerEvent) => void;
	};

	const selectedNodeScreenFrames = selectedNodes
		.filter((node) => node.id !== activeNode?.id)
		.map((node) => ({
			node,
			frame: resolveCanvasNodeScreenFrame(node, camera),
		}));
	const hoverBorderNode =
		hoverNode &&
		hoverNode.id !== activeNode?.id &&
		!selectedNodeIdSet.current.has(hoverNode.id)
			? hoverNode
			: null;
	const hoverNodeScreenFrame = hoverBorderNode
		? resolveCanvasNodeScreenFrame(hoverBorderNode, camera)
		: null;
	if (
		!activeNodeScreenFrame &&
		!hoverNodeScreenFrame &&
		selectedNodeScreenFrames.length === 0 &&
		!selectionScreenFrame
	) {
		return null;
	}

	const hoverBorderStyle = resolveNodeInteractionBorderStyle({
		isActive: false,
		isSelected: false,
		isHovered: true,
	});
	const selectedBorderStyle = resolveNodeInteractionBorderStyle({
		isActive: false,
		isSelected: true,
		isHovered: false,
	});
	const activeBorderStyle = resolveNodeInteractionBorderStyle({
		isActive: true,
		isSelected: true,
		isHovered: false,
	});
	const groupBorderStyle = {
		...activeBorderStyle,
		color: "rgba(251,146,60,0.72)",
	};
	const resizeFrame = resizeTarget?.frame ?? null;
	const topLeftCornerX = -CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const topLeftCornerY = -CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const topRightCornerX =
		(resizeFrame?.width ?? 0) + CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const topRightCornerY = -CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const bottomRightCornerX =
		(resizeFrame?.width ?? 0) + CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const bottomRightCornerY =
		(resizeFrame?.height ?? 0) + CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const bottomLeftCornerX = -CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const bottomLeftCornerY =
		(resizeFrame?.height ?? 0) + CANVAS_RESIZE_ANCHOR_OFFSET_PX;

	return (
		<>
			<Group zIndex={1_000_000} pointerEvents="none">
				{hoverBorderNode && hoverNodeScreenFrame && (
					<Group
						key={`canvas-node-hover-outline-overlay-${hoverBorderNode.id}`}
						transform={[
							{ translateX: hoverNodeScreenFrame.x },
							{ translateY: hoverNodeScreenFrame.y },
						]}
					>
						<Rect
							opacity={1}
							x={0}
							y={0}
							width={hoverNodeScreenFrame.width}
							height={hoverNodeScreenFrame.height}
							style="stroke"
							strokeWidth={hoverBorderStyle.baseStrokeWidthPx}
							color={hoverBorderStyle.color}
						/>
					</Group>
				)}
				{selectedNodeScreenFrames.map(({ node, frame }) => (
					<Group
						key={`canvas-node-selected-outline-overlay-${node.id}`}
						transform={[{ translateX: frame.x }, { translateY: frame.y }]}
					>
						<Rect
							opacity={1}
							x={0}
							y={0}
							width={frame.width}
							height={frame.height}
							style="stroke"
							strokeWidth={selectedBorderStyle.baseStrokeWidthPx}
							color={selectedBorderStyle.color}
						/>
					</Group>
				))}
				{activeNode && activeNodeScreenFrame && (
					<Group
						key={`canvas-node-active-outline-overlay-${activeNode.id}`}
						transform={[
							{ translateX: activeNodeScreenFrame.x },
							{ translateY: activeNodeScreenFrame.y },
						]}
					>
						<Rect
							opacity={1}
							x={0}
							y={0}
							width={activeNodeScreenFrame.width}
							height={activeNodeScreenFrame.height}
							style="stroke"
							strokeWidth={activeBorderStyle.baseStrokeWidthPx}
							color={activeBorderStyle.color}
						/>
					</Group>
				)}
				{selectionScreenFrame && (
					<Group
						key="canvas-selection-bounds-overlay"
						transform={[
							{ translateX: selectionScreenFrame.x },
							{ translateY: selectionScreenFrame.y },
						]}
					>
						<Rect
							opacity={1}
							x={0}
							y={0}
							width={selectionScreenFrame.width}
							height={selectionScreenFrame.height}
							style="stroke"
							strokeWidth={groupBorderStyle.baseStrokeWidthPx}
							color={groupBorderStyle.color}
						/>
					</Group>
				)}
			</Group>
			{resizeFrame && isResizeEnabled && (
				<Group zIndex={1_000_001} pointerEvents="auto">
					<Group
						key={`canvas-resize-anchor-overlay-${resizeTarget?.key ?? "none"}`}
						transform={[
							{ translateX: resizeFrame.x },
							{ translateY: resizeFrame.y },
						]}
					>
						<Group
							transition={RESIZE_ANCHOR_ENTER_TRANSITION}
							translateX={-RESIZE_ANCHOR_ENTER_OFFSET_PX}
							translateY={-RESIZE_ANCHOR_ENTER_OFFSET_PX}
							animate={{
								translateX: 0,
								translateY: 0,
								opacity: resolveAnchorOpacity(
									"top-left",
									hoveredResizeAnchor,
									pressedResizeAnchor,
								),
							}}
							hitRect={{
								x: topLeftCornerX - CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX / 2,
								y: topLeftCornerY - CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX / 2,
								width: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
								height: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
							}}
							opacity={0}
							pointerEvents="auto"
							cursor="nwse-resize"
							onPointerEnter={() => {
								handleResizeAnchorPointerEnter("top-left");
							}}
							onPointerLeave={() => {
								handleResizeAnchorPointerLeave("top-left");
							}}
							onPointerDown={(event) => {
								topLeftResizeHandlers.onPointerDown?.(event);
							}}
						>
							<Path
								path={buildTopLeftAnchorPath(
									CANVAS_RESIZE_ANCHOR_OFFSET_PX,
									CANVAS_RESIZE_ANCHOR_LEG_PX,
								)}
								style="stroke"
								strokeWidth={CANVAS_RESIZE_ANCHOR_STROKE_PX}
								color="rgba(255,255,255,1)"
							/>
						</Group>
						<Group
							transition={RESIZE_ANCHOR_ENTER_TRANSITION}
							translateX={RESIZE_ANCHOR_ENTER_OFFSET_PX}
							translateY={-RESIZE_ANCHOR_ENTER_OFFSET_PX}
							animate={{
								translateX: 0,
								translateY: 0,
								opacity: resolveAnchorOpacity(
									"top-right",
									hoveredResizeAnchor,
									pressedResizeAnchor,
								),
							}}
							hitRect={{
								x: topRightCornerX - CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX / 2,
								y: topRightCornerY - CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX / 2,
								width: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
								height: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
							}}
							opacity={0}
							pointerEvents="auto"
							cursor="nesw-resize"
							onPointerEnter={() => {
								handleResizeAnchorPointerEnter("top-right");
							}}
							onPointerLeave={() => {
								handleResizeAnchorPointerLeave("top-right");
							}}
							onPointerDown={(event) => {
								topRightResizeHandlers.onPointerDown?.(event);
							}}
						>
							<Path
								path={buildTopRightAnchorPath(
									resizeFrame.width,
									CANVAS_RESIZE_ANCHOR_OFFSET_PX,
									CANVAS_RESIZE_ANCHOR_LEG_PX,
								)}
								style="stroke"
								strokeWidth={CANVAS_RESIZE_ANCHOR_STROKE_PX}
								color="rgba(255,255,255,1)"
							/>
						</Group>
						<Group
							transition={RESIZE_ANCHOR_ENTER_TRANSITION}
							translateX={RESIZE_ANCHOR_ENTER_OFFSET_PX}
							translateY={RESIZE_ANCHOR_ENTER_OFFSET_PX}
							animate={{
								translateX: 0,
								translateY: 0,
								opacity: resolveAnchorOpacity(
									"bottom-right",
									hoveredResizeAnchor,
									pressedResizeAnchor,
								),
							}}
							hitRect={{
								x: bottomRightCornerX - CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX / 2,
								y: bottomRightCornerY - CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX / 2,
								width: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
								height: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
							}}
							opacity={0}
							pointerEvents="auto"
							cursor="nwse-resize"
							onPointerEnter={() => {
								handleResizeAnchorPointerEnter("bottom-right");
							}}
							onPointerLeave={() => {
								handleResizeAnchorPointerLeave("bottom-right");
							}}
							onPointerDown={(event) => {
								bottomRightResizeHandlers.onPointerDown?.(event);
							}}
						>
							<Path
								path={buildBottomRightAnchorPath(
									resizeFrame.width,
									resizeFrame.height,
									CANVAS_RESIZE_ANCHOR_OFFSET_PX,
									CANVAS_RESIZE_ANCHOR_LEG_PX,
								)}
								style="stroke"
								strokeWidth={CANVAS_RESIZE_ANCHOR_STROKE_PX}
								color="rgba(255,255,255,1)"
							/>
						</Group>
						<Group
							transition={RESIZE_ANCHOR_ENTER_TRANSITION}
							translateX={-RESIZE_ANCHOR_ENTER_OFFSET_PX}
							translateY={RESIZE_ANCHOR_ENTER_OFFSET_PX}
							animate={{
								translateX: 0,
								translateY: 0,
								opacity: resolveAnchorOpacity(
									"bottom-left",
									hoveredResizeAnchor,
									pressedResizeAnchor,
								),
							}}
							hitRect={{
								x: bottomLeftCornerX - CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX / 2,
								y: bottomLeftCornerY - CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX / 2,
								width: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
								height: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
							}}
							opacity={0}
							pointerEvents="auto"
							cursor="nesw-resize"
							onPointerEnter={() => {
								handleResizeAnchorPointerEnter("bottom-left");
							}}
							onPointerLeave={() => {
								handleResizeAnchorPointerLeave("bottom-left");
							}}
							onPointerDown={(event) => {
								bottomLeftResizeHandlers.onPointerDown?.(event);
							}}
						>
							<Path
								path={buildBottomLeftAnchorPath(
									resizeFrame.height,
									CANVAS_RESIZE_ANCHOR_OFFSET_PX,
									CANVAS_RESIZE_ANCHOR_LEG_PX,
								)}
								style="stroke"
								strokeWidth={CANVAS_RESIZE_ANCHOR_STROKE_PX}
								color="rgba(255,255,255,1)"
							/>
						</Group>
					</Group>
				</Group>
			)}
		</>
	);
};
