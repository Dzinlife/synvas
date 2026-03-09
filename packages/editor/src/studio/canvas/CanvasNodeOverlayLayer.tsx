import type { CanvasNode } from "core/studio/types";
import { Group, Path, Rect, type SkiaPointerEvent } from "react-skia-lite";
import type {
	CanvasNodeResizeAnchor,
	CanvasNodeResizeAnchorState,
} from "./canvasResizeAnchor";
import {
	CANVAS_RESIZE_ANCHOR_CORNER_RADIUS_PX,
	CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
	CANVAS_RESIZE_ANCHOR_LEG_PX,
	CANVAS_RESIZE_ANCHOR_OFFSET_PX,
	CANVAS_RESIZE_ANCHOR_STROKE_PX,
} from "./canvasResizeAnchor";
import {
	resolveNodeInteractionBorderStyle,
	resolveNodeInteractionStrokeWidth,
} from "./NodeInteractionWrapper";

const RESIZE_ANCHOR_ENTER_OFFSET_PX = 8;
const RESIZE_ANCHOR_ENTER_TRANSITION = {
	duration: 180,
	easing: "easeOutCubic",
} as const;
const NODE_OUTLINE_TRANSITION = {
	duration: 300,
	easing: "easeOutCubic",
} as const;

const buildTopLeftAnchorPath = (
	offsetWorld: number,
	legWorld: number,
	cornerRadiusWorld: number,
): string => {
	const cornerX = -offsetWorld;
	const cornerY = -offsetWorld;
	const radius = Math.max(0, Math.min(cornerRadiusWorld, legWorld / 2));
	return `M ${cornerX + legWorld} ${cornerY} L ${cornerX + radius} ${cornerY} Q ${cornerX} ${cornerY} ${cornerX} ${cornerY + radius} L ${cornerX} ${cornerY + legWorld}`;
};

const buildBottomRightAnchorPath = (
	width: number,
	height: number,
	offsetWorld: number,
	legWorld: number,
	cornerRadiusWorld: number,
): string => {
	const cornerX = width + offsetWorld;
	const cornerY = height + offsetWorld;
	const radius = Math.max(0, Math.min(cornerRadiusWorld, legWorld / 2));
	return `M ${cornerX - legWorld} ${cornerY} L ${cornerX - radius} ${cornerY} Q ${cornerX} ${cornerY} ${cornerX} ${cornerY - radius} L ${cornerX} ${cornerY - legWorld}`;
};

interface CanvasNodeOverlayLayerProps {
	nodes: CanvasNode[];
	cameraZoom: number;
	activeNodeId: string | null;
	focusedNodeId: string | null;
	hoveredNodeId: string | null;
	hoveredResizeAnchor: CanvasNodeResizeAnchorState | null;
	pressedResizeAnchor: CanvasNodeResizeAnchorState | null;
	onResizeAnchorPointerEnter: (
		nodeId: string,
		anchor: CanvasNodeResizeAnchor,
	) => void;
	onResizeAnchorPointerLeave: (
		nodeId: string,
		anchor: CanvasNodeResizeAnchor,
	) => void;
	onTopLeftResizePointerDown?: (event: SkiaPointerEvent) => void;
	onBottomRightResizePointerDown?: (event: SkiaPointerEvent) => void;
}

export const CanvasNodeOverlayLayer = ({
	nodes,
	cameraZoom,
	activeNodeId,
	focusedNodeId,
	hoveredNodeId,
	hoveredResizeAnchor,
	pressedResizeAnchor,
	onResizeAnchorPointerEnter,
	onResizeAnchorPointerLeave,
	onTopLeftResizePointerDown,
	onBottomRightResizePointerDown,
}: CanvasNodeOverlayLayerProps) => {
	return (
		<>
			<Group zIndex={1_000_000} pointerEvents="none">
				{nodes.map((node) => {
					const isFocused = node.id === focusedNodeId;
					const isActive = node.id === activeNodeId;
					const isDimmed = Boolean(focusedNodeId) && !isFocused;
					const isHovered = node.id === hoveredNodeId;
					const borderStyle = resolveNodeInteractionBorderStyle({
						isActive,
						isHovered,
					});
					const strokeWidth = resolveNodeInteractionStrokeWidth(
						borderStyle.baseStrokeWidthPx,
						cameraZoom,
					);
					const outlineOpacity = isActive ? 1 : isHovered ? 0.85 : 0;

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
							<Group
								transform={[{ translateX: node.x }, { translateY: node.y }]}
							>
								<Rect
									transition={NODE_OUTLINE_TRANSITION}
									opacity={0}
									animate={{
										opacity: outlineOpacity,
									}}
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
			<Group zIndex={1_000_001} pointerEvents="auto">
				{nodes.map((node) => {
					const isFocused = node.id === focusedNodeId;
					const isActive = node.id === activeNodeId;
					const isDimmed = Boolean(focusedNodeId) && !isFocused;
					if (focusedNodeId || !isActive || node.locked) return null;

					const safeZoom = Math.max(cameraZoom, 1e-6);
					const offsetWorld = CANVAS_RESIZE_ANCHOR_OFFSET_PX / safeZoom;
					const legWorld = CANVAS_RESIZE_ANCHOR_LEG_PX / safeZoom;
					const strokeWorld = CANVAS_RESIZE_ANCHOR_STROKE_PX / safeZoom;
					const hitSizeWorld = CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX / safeZoom;
					const cornerRadiusWorld =
						CANVAS_RESIZE_ANCHOR_CORNER_RADIUS_PX / safeZoom;
					const enterOffsetWorld = RESIZE_ANCHOR_ENTER_OFFSET_PX / safeZoom;
					const topLeftCornerX = -offsetWorld;
					const topLeftCornerY = -offsetWorld;
					const bottomRightCornerX = node.width + offsetWorld;
					const bottomRightCornerY = node.height + offsetWorld;
					const isTopLeftHovered =
						hoveredResizeAnchor?.nodeId === node.id &&
						hoveredResizeAnchor.anchor === "top-left";
					const isTopLeftPressed =
						pressedResizeAnchor?.nodeId === node.id &&
						pressedResizeAnchor.anchor === "top-left";
					const isBottomRightHovered =
						hoveredResizeAnchor?.nodeId === node.id &&
						hoveredResizeAnchor.anchor === "bottom-right";
					const isBottomRightPressed =
						pressedResizeAnchor?.nodeId === node.id &&
						pressedResizeAnchor.anchor === "bottom-right";
					const topLeftOpacity = isActive
						? isTopLeftHovered || isTopLeftPressed
							? 1
							: 0.3
						: 0;
					const bottomRightOpacity = isActive
						? isBottomRightHovered || isBottomRightPressed
							? 1
							: 0.3
						: 0;

					return (
						<Group
							key={`canvas-node-resize-anchor-overlay-${node.id}`}
							transform={[{ translateX: node.x }, { translateY: node.y }]}
							opacity={isDimmed ? 0.35 : 1}
						>
							<Group
								transition={RESIZE_ANCHOR_ENTER_TRANSITION}
								translateX={-enterOffsetWorld}
								translateY={-enterOffsetWorld}
								animate={{
									translateX: 0,
									translateY: 0,
									opacity: topLeftOpacity,
								}}
								hitRect={{
									x: topLeftCornerX - hitSizeWorld / 2,
									y: topLeftCornerY - hitSizeWorld / 2,
									width: hitSizeWorld,
									height: hitSizeWorld,
								}}
								opacity={0}
								pointerEvents={isActive ? "auto" : "none"}
								cursor={isActive ? "nwse-resize" : undefined}
								onPointerEnter={
									isActive
										? () => {
												onResizeAnchorPointerEnter(node.id, "top-left");
											}
										: undefined
								}
								onPointerLeave={
									isActive
										? () => {
												onResizeAnchorPointerLeave(node.id, "top-left");
											}
										: undefined
								}
								onPointerDown={
									isActive
										? (event) => {
												onTopLeftResizePointerDown?.(event);
											}
										: undefined
								}
							>
								<Path
									path={buildTopLeftAnchorPath(
										offsetWorld,
										legWorld,
										cornerRadiusWorld,
									)}
									style="stroke"
									strokeWidth={strokeWorld}
									// strokeJoin="round"
									// strokeCap="round"
									color="rgba(255,255,255,1)"
								/>
							</Group>
							<Group
								transition={RESIZE_ANCHOR_ENTER_TRANSITION}
								translateX={enterOffsetWorld}
								translateY={enterOffsetWorld}
								animate={{
									translateX: 0,
									translateY: 0,
									opacity: bottomRightOpacity,
								}}
								hitRect={{
									x: bottomRightCornerX - hitSizeWorld / 2,
									y: bottomRightCornerY - hitSizeWorld / 2,
									width: hitSizeWorld,
									height: hitSizeWorld,
								}}
								opacity={0}
								pointerEvents={isActive ? "auto" : "none"}
								cursor={isActive ? "nwse-resize" : undefined}
								onPointerEnter={
									isActive
										? () => {
												onResizeAnchorPointerEnter(node.id, "bottom-right");
											}
										: undefined
								}
								onPointerLeave={
									isActive
										? () => {
												onResizeAnchorPointerLeave(node.id, "bottom-right");
											}
										: undefined
								}
								onPointerDown={
									isActive
										? (event) => {
												onBottomRightResizePointerDown?.(event);
											}
										: undefined
								}
							>
								<Path
									path={buildBottomRightAnchorPath(
										node.width,
										node.height,
										offsetWorld,
										legWorld,
										cornerRadiusWorld,
									)}
									style="stroke"
									strokeWidth={strokeWorld}
									// strokeJoin="round"
									// strokeCap="round"
									color="rgba(255,255,255,1)"
								/>
							</Group>
						</Group>
					);
				})}
			</Group>
		</>
	);
};
