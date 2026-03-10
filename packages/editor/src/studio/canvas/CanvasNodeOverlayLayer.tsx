import { useDrag } from "@use-gesture/react";
import type { CanvasNode } from "core/studio/types";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Group, Path, Rect, type SkiaPointerEvent } from "react-skia-lite";
import { resolveCanvasNodeScreenFrame } from "./canvasNodeLabelUtils";
import type { CanvasNodeResizeAnchor } from "./canvasResizeAnchor";
import {
	CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
	CANVAS_RESIZE_ANCHOR_LEG_PX,
	CANVAS_RESIZE_ANCHOR_OFFSET_PX,
	CANVAS_RESIZE_ANCHOR_STROKE_PX,
	resolveCanvasResizeAnchorAtWorldPoint,
} from "./canvasResizeAnchor";
import type { CanvasNodeDragEvent } from "./NodeInteractionWrapper";
import { resolveNodeInteractionBorderStyle } from "./NodeInteractionWrapper";

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
}

export const CanvasNodeOverlayLayer = ({
	activeNode,
	hoverNode,
	camera,
	onNodeResize,
}: CanvasNodeOverlayLayerProps) => {
	const resizingAnchorRef = useRef<CanvasNodeResizeAnchor | null>(null);
	const previousActiveNodeIdRef = useRef<string | null>(activeNode?.id ?? null);
	const [hoveredResizeAnchor, setHoveredResizeAnchor] =
		useState<CanvasNodeResizeAnchor | null>(null);
	const [pressedResizeAnchor, setPressedResizeAnchor] =
		useState<CanvasNodeResizeAnchor | null>(null);

	const activeNodeId = activeNode?.id ?? null;
	const isResizeEnabled = Boolean(activeNode && !activeNode.locked);

	useLayoutEffect(() => {
		// active 节点切换后清理旧的 anchor 交互状态
		if (previousActiveNodeIdRef.current === activeNodeId) return;
		previousActiveNodeIdRef.current = activeNodeId;
		resizingAnchorRef.current = null;
		setHoveredResizeAnchor(null);
		setPressedResizeAnchor(null);
	}, [activeNodeId]);

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
			if (!isResizeEnabled || !activeNode) return;

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

			if (state.first) {
				if (dragEvent.button !== 0) return;
				resizingAnchorRef.current = anchor;
				setPressedResizeAnchor(anchor);
				setHoveredResizeAnchor(anchor);
				onNodeResize?.({
					phase: "start",
					node: activeNode,
					anchor,
					event: dragEvent,
				});
			}

			if (resizingAnchorRef.current !== anchor) return;

			if (!state.last) {
				onNodeResize?.({
					phase: "move",
					node: activeNode,
					anchor,
					event: dragEvent,
				});
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
					resolveCanvasResizeAnchorAtWorldPoint({
						node: activeNode,
						worldX,
						worldY,
						cameraZoom: camera.zoom,
					}),
				);
			}
			onNodeResize?.({
				phase: "end",
				node: activeNode,
				anchor,
				event: dragEvent,
			});
		},
		[
			activeNode,
			camera.x,
			camera.y,
			camera.zoom,
			isResizeEnabled,
			onNodeResize,
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

	const activeNodeScreenFrame = activeNode
		? resolveCanvasNodeScreenFrame(activeNode, camera)
		: null;
	const hoverBorderNode =
		hoverNode && hoverNode.id !== activeNode?.id ? hoverNode : null;
	const hoverNodeScreenFrame = hoverBorderNode
		? resolveCanvasNodeScreenFrame(hoverBorderNode, camera)
		: null;
	if (!activeNodeScreenFrame && !hoverNodeScreenFrame) return null;

	const hoverBorderStyle = resolveNodeInteractionBorderStyle({
		isActive: false,
		isHovered: true,
	});
	const activeBorderStyle = resolveNodeInteractionBorderStyle({
		isActive: true,
		isHovered: false,
	});
	const topLeftCornerX = -CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const topLeftCornerY = -CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const topRightCornerX =
		(activeNodeScreenFrame?.width ?? 0) + CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const topRightCornerY = -CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const bottomRightCornerX =
		(activeNodeScreenFrame?.width ?? 0) + CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const bottomRightCornerY =
		(activeNodeScreenFrame?.height ?? 0) + CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const bottomLeftCornerX = -CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const bottomLeftCornerY =
		(activeNodeScreenFrame?.height ?? 0) + CANVAS_RESIZE_ANCHOR_OFFSET_PX;

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
			</Group>
			{activeNode && activeNodeScreenFrame && isResizeEnabled && (
				<Group zIndex={1_000_001} pointerEvents="auto">
					<Group
						key={`canvas-node-resize-anchor-overlay-${activeNode.id}`}
						transform={[
							{ translateX: activeNodeScreenFrame.x },
							{ translateY: activeNodeScreenFrame.y },
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
									activeNodeScreenFrame.width,
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
									activeNodeScreenFrame.width,
									activeNodeScreenFrame.height,
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
									activeNodeScreenFrame.height,
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
