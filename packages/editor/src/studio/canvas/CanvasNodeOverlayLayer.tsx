import { useDrag } from "@use-gesture/react";
import type { CanvasNode } from "core/studio/types";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	DashPathEffect,
	Easing,
	Group,
	Line,
	Path,
	Rect,
	type SharedValue,
	type SkiaPointerEvent,
	useDerivedValue,
	withTiming,
} from "react-skia-lite";
import type {
	CanvasCameraState,
	CanvasNodeLayoutState,
	CanvasWorldRect,
} from "./canvasNodeLabelUtils";
import {
	resolveCanvasNodeLayoutWorldRect,
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
import type { CanvasSnapGuidesScreen } from "./canvasSnapUtils";
import type { CanvasNodeDragEvent } from "./NodeInteractionWrapper";
import {
	resolveNodeInteractionBorderStyle,
	resolvePointerEventMeta,
} from "./NodeInteractionWrapper";

const CAMERA_ZOOM_EPSILON = 1e-6;
const RESIZE_ANCHOR_ENTER_OFFSET_PX = 8;
const RESIZE_ANCHOR_ENTER_TIMING = {
	duration: 200,
	easing: Easing.out(Easing.cubic),
} as const;

const RESIZE_DRAG_CONFIG = {
	pointer: { capture: false },
	keys: false,
	filterTaps: false,
	threshold: 0,
	triggerAllEvents: true,
} as const;

const buildAnchorPath = (anchor: CanvasNodeResizeAnchor): string => {
	const offset = CANVAS_RESIZE_ANCHOR_OFFSET_PX;
	const leg = CANVAS_RESIZE_ANCHOR_LEG_PX;
	if (anchor === "top-left") {
		return `M ${-offset + leg} ${-offset} L ${-offset} ${-offset} L ${-offset} ${-offset + leg}`;
	}
	if (anchor === "top-right") {
		return `M ${offset - leg} ${-offset} L ${offset} ${-offset} L ${offset} ${-offset + leg}`;
	}
	if (anchor === "bottom-right") {
		return `M ${offset - leg} ${offset} L ${offset} ${offset} L ${offset} ${offset - leg}`;
	}
	return `M ${-offset + leg} ${offset} L ${-offset} ${offset} L ${-offset} ${offset - leg}`;
};

const resolveAnchorHitRect = (anchor: CanvasNodeResizeAnchor) => {
	const halfHit = CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX / 2;
	if (anchor === "top-left") {
		return {
			x: -CANVAS_RESIZE_ANCHOR_OFFSET_PX - halfHit,
			y: -CANVAS_RESIZE_ANCHOR_OFFSET_PX - halfHit,
			width: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
			height: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
		};
	}
	if (anchor === "top-right") {
		return {
			x: CANVAS_RESIZE_ANCHOR_OFFSET_PX - halfHit,
			y: -CANVAS_RESIZE_ANCHOR_OFFSET_PX - halfHit,
			width: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
			height: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
		};
	}
	if (anchor === "bottom-right") {
		return {
			x: CANVAS_RESIZE_ANCHOR_OFFSET_PX - halfHit,
			y: CANVAS_RESIZE_ANCHOR_OFFSET_PX - halfHit,
			width: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
			height: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
		};
	}
	return {
		x: -CANVAS_RESIZE_ANCHOR_OFFSET_PX - halfHit,
		y: CANVAS_RESIZE_ANCHOR_OFFSET_PX - halfHit,
		width: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
		height: CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX,
	};
};

const resolveAnchorEnterOffset = (anchor: CanvasNodeResizeAnchor) => {
	if (anchor === "top-left") {
		return {
			x: -RESIZE_ANCHOR_ENTER_OFFSET_PX,
			y: -RESIZE_ANCHOR_ENTER_OFFSET_PX,
			cursor: "nwse-resize" as const,
		};
	}
	if (anchor === "top-right") {
		return {
			x: RESIZE_ANCHOR_ENTER_OFFSET_PX,
			y: -RESIZE_ANCHOR_ENTER_OFFSET_PX,
			cursor: "nesw-resize" as const,
		};
	}
	if (anchor === "bottom-right") {
		return {
			x: RESIZE_ANCHOR_ENTER_OFFSET_PX,
			y: RESIZE_ANCHOR_ENTER_OFFSET_PX,
			cursor: "nwse-resize" as const,
		};
	}
	return {
		x: -RESIZE_ANCHOR_ENTER_OFFSET_PX,
		y: RESIZE_ANCHOR_ENTER_OFFSET_PX,
		cursor: "nesw-resize" as const,
	};
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

const resolveScreenCornerTransform = (
	frame: ReturnType<typeof resolveCanvasWorldRectScreenFrame>,
	anchor: CanvasNodeResizeAnchor,
) => {
	if (anchor === "top-left") {
		return [{ translateX: frame.x }, { translateY: frame.y }];
	}
	if (anchor === "top-right") {
		return [{ translateX: frame.right }, { translateY: frame.y }];
	}
	if (anchor === "bottom-right") {
		return [{ translateX: frame.right }, { translateY: frame.bottom }];
	}
	return [{ translateX: frame.x }, { translateY: frame.bottom }];
};

interface CanvasScreenRectOutlineProps {
	resolveWorldRect: () => CanvasWorldRect;
	camera: SharedValue<CanvasCameraState>;
	color: string;
	baseStrokeWidthPx: number;
}

const CanvasScreenRectOutline = ({
	resolveWorldRect,
	camera,
	color,
	baseStrokeWidthPx,
}: CanvasScreenRectOutlineProps) => {
	const transform = useDerivedValue(() => {
		const frame = resolveCanvasWorldRectScreenFrame(
			resolveWorldRect(),
			camera.value,
		);
		return [{ translateX: frame.x }, { translateY: frame.y }];
	});
	const width = useDerivedValue(() => {
		return resolveCanvasWorldRectScreenFrame(
			resolveWorldRect(),
			camera.value,
		).width;
	});
	const height = useDerivedValue(() => {
		return resolveCanvasWorldRectScreenFrame(
			resolveWorldRect(),
			camera.value,
		).height;
	});

	return (
		<Group transform={transform}>
			<Rect
				opacity={1}
				x={0}
				y={0}
				width={width}
				height={height}
				style="stroke"
				strokeWidth={baseStrokeWidthPx}
				color={color}
			/>
		</Group>
	);
};

interface CanvasResizeAnchorHandleProps {
	anchor: CanvasNodeResizeAnchor;
	camera: SharedValue<CanvasCameraState>;
	resolveWorldRect: () => CanvasWorldRect;
	hoveredResizeAnchor: CanvasNodeResizeAnchor | null;
	pressedResizeAnchor: CanvasNodeResizeAnchor | null;
	onPointerEnter: () => void;
	onPointerLeave: () => void;
	onPointerDown?: (event: SkiaPointerEvent) => void;
}

const CanvasResizeAnchorHandle = ({
	anchor,
	camera,
	resolveWorldRect,
	hoveredResizeAnchor,
	pressedResizeAnchor,
	onPointerEnter,
	onPointerLeave,
	onPointerDown,
}: CanvasResizeAnchorHandleProps) => {
	const enterOffset = resolveAnchorEnterOffset(anchor);
	const path = buildAnchorPath(anchor);
	const hitRect = resolveAnchorHitRect(anchor);
	const transform = useDerivedValue(() => {
		const frame = resolveCanvasWorldRectScreenFrame(
			resolveWorldRect(),
			camera.value,
		);
		return resolveScreenCornerTransform(frame, anchor);
	});

	return (
		<Group transform={transform}>
			<Group
				translateX={enterOffset.x}
				translateY={enterOffset.y}
				motion={{
					animate: {
						translateX: withTiming(0, RESIZE_ANCHOR_ENTER_TIMING),
						translateY: withTiming(0, RESIZE_ANCHOR_ENTER_TIMING),
						opacity: withTiming(
							resolveAnchorOpacity(
								anchor,
								hoveredResizeAnchor,
								pressedResizeAnchor,
							),
							RESIZE_ANCHOR_ENTER_TIMING,
						),
					},
				}}
				hitRect={hitRect}
				opacity={0}
				pointerEvents="auto"
				cursor={enterOffset.cursor}
				onPointerEnter={onPointerEnter}
				onPointerLeave={onPointerLeave}
				onPointerDown={(event) => {
					onPointerDown?.(event);
				}}
			>
				<Path
					path={path}
					style="stroke"
					strokeWidth={CANVAS_RESIZE_ANCHOR_STROKE_PX}
					color="rgba(255,255,255,1)"
				/>
			</Group>
		</Group>
	);
};

interface CanvasNodeOverlayLayerProps {
	width: number;
	height: number;
	activeNode: CanvasNode | null;
	getNodeLayout: (
		nodeId: string,
	) => SharedValue<CanvasNodeLayoutState> | null;
	selectedNodes: CanvasNode[];
	hoverNode: CanvasNode | null;
	snapGuidesScreen: CanvasSnapGuidesScreen;
	camera: SharedValue<CanvasCameraState>;
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
	width,
	height,
	activeNode,
	getNodeLayout,
	selectedNodes,
	hoverNode,
	snapGuidesScreen,
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

	const selectedNodeIdSet = useMemo(() => {
		return new Set(selectedNodes.map((node) => node.id));
	}, [selectedNodes]);
	const resolveNodeWorldRectByLayout = useCallback(
		(node: CanvasNode): CanvasWorldRect => {
			return resolveCanvasNodeLayoutWorldRect(
				getNodeLayout(node.id)?.value ?? node,
			);
		},
		[getNodeLayout],
	);
	const resolveNodeByLayout = useCallback(
		(node: CanvasNode): CanvasNode => {
			const layout = getNodeLayout(node.id)?.value;
			if (!layout) return node;
			return {
				...node,
				...layout,
			};
		},
		[getNodeLayout],
	);
	const resolveSelectedWorldRect = useCallback((): CanvasWorldRect => {
		const nodeLayouts = selectedNodes
			.map((node) => {
				return getNodeLayout(node.id)?.value ?? node;
			})
			.filter(Boolean);
		let left = Number.POSITIVE_INFINITY;
		let top = Number.POSITIVE_INFINITY;
		let right = Number.NEGATIVE_INFINITY;
		let bottom = Number.NEGATIVE_INFINITY;
		for (const layout of nodeLayouts) {
			const worldRect = resolveCanvasNodeLayoutWorldRect(layout);
			left = Math.min(left, worldRect.left);
			top = Math.min(top, worldRect.top);
			right = Math.max(right, worldRect.right);
			bottom = Math.max(bottom, worldRect.bottom);
		}
		if (
			!Number.isFinite(left) ||
			!Number.isFinite(top) ||
			!Number.isFinite(right) ||
			!Number.isFinite(bottom)
		) {
			return {
				left: 0,
				top: 0,
				right: 1,
				bottom: 1,
				width: 1,
				height: 1,
			};
		}
		return {
			left,
			top,
			right,
			bottom,
			width: Math.max(1, right - left),
			height: Math.max(1, bottom - top),
		};
	}, [getNodeLayout, selectedNodes]);
	const isSingleSelection =
		Boolean(activeNode) &&
		(selectedNodes.length === 0 ||
			(selectedNodes.length === 1 && selectedNodes[0]?.id === activeNode?.id));
	const isNodeResizeEnabled = Boolean(
		activeNode && !activeNode.locked && isSingleSelection,
	);
	const isSelectionResizeEnabled = Boolean(
		selectedNodes.length > 1 && selectedNodes.some((node) => !node.locked),
	);
	const resizeTarget = isNodeResizeEnabled
		? {
				kind: "node" as const,
				key: `node:${activeNode?.id ?? ""}`,
		  }
		: isSelectionResizeEnabled
			? {
					kind: "selection" as const,
					key: `selection:${selectedNodes.map((node) => node.id).join(",")}`,
			  }
			: null;
	const isResizeEnabled = Boolean(resizeTarget);
	const selectedOutlineNodes = useMemo(() => {
		return selectedNodes.filter((node) => node.id !== activeNode?.id);
	}, [activeNode?.id, selectedNodes]);
	const hoverBorderNode =
		hoverNode &&
		hoverNode.id !== activeNode?.id &&
		!selectedNodeIdSet.has(hoverNode.id)
			? hoverNode
			: null;

	useLayoutEffect(() => {
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
			if (!isResizeEnabled || !resizeTarget) return;
			const resizeWorldRect =
				resizeTarget.kind === "node" && activeNode
					? resolveNodeWorldRectByLayout(activeNode)
					: resolveSelectedWorldRect();

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
				const activeNodeByLayout = activeNode
					? resolveNodeByLayout(activeNode)
					: null;
				const nextCamera = camera.value;
				const safeZoom = Math.max(nextCamera.zoom, CAMERA_ZOOM_EPSILON);
				const worldX = localPoint.x / safeZoom - nextCamera.x;
				const worldY = localPoint.y / safeZoom - nextCamera.y;
				setHoveredResizeAnchor(
					resizeTarget.kind === "node" && activeNodeByLayout
						? resolveCanvasResizeAnchorAtWorldPoint({
								node: activeNodeByLayout,
								worldX,
								worldY,
								cameraZoom: nextCamera.zoom,
						  })
						: resolveCanvasResizeAnchorAtRectWorldPoint({
								x: resizeWorldRect.left,
								y: resizeWorldRect.top,
								width: resizeWorldRect.width,
								height: resizeWorldRect.height,
								worldX,
								worldY,
								cameraZoom: nextCamera.zoom,
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
			camera,
			isResizeEnabled,
			onNodeResize,
			onSelectionResize,
			resolveNodeByLayout,
			resolveNodeWorldRectByLayout,
			resolveSelectedWorldRect,
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
	const hasSnapGuides =
		snapGuidesScreen.vertical.length > 0 || snapGuidesScreen.horizontal.length > 0;

	if (
		!hasSnapGuides &&
		!activeNode &&
		!hoverBorderNode &&
		selectedOutlineNodes.length === 0 &&
		selectedNodes.length <= 1
	) {
		return null;
	}

	return (
		<>
			<Group zIndex={1_000_000} pointerEvents="none">
				{snapGuidesScreen.vertical.map((x) => (
					<Line
						key={`canvas-snap-v-${x}`}
						p1={{ x, y: 0 }}
						p2={{ x, y: height }}
						style="stroke"
						strokeWidth={1}
						color="rgba(59,130,246,0.8)"
					>
						<DashPathEffect intervals={[4, 4]} phase={0} />
					</Line>
				))}
				{snapGuidesScreen.horizontal.map((y) => (
					<Line
						key={`canvas-snap-h-${y}`}
						p1={{ x: 0, y }}
						p2={{ x: width, y }}
						style="stroke"
						strokeWidth={1}
						color="rgba(59,130,246,0.8)"
					>
						<DashPathEffect intervals={[4, 4]} phase={0} />
					</Line>
				))}
				{hoverBorderNode && (
					<CanvasScreenRectOutline
						key={`canvas-node-hover-outline-overlay-${hoverBorderNode.id}`}
						resolveWorldRect={() => {
							return resolveNodeWorldRectByLayout(hoverBorderNode);
						}}
						camera={camera}
						baseStrokeWidthPx={hoverBorderStyle.baseStrokeWidthPx}
						color={hoverBorderStyle.color}
					/>
				)}
				{selectedOutlineNodes.map((node) => (
					<CanvasScreenRectOutline
						key={`canvas-node-selected-outline-overlay-${node.id}`}
						resolveWorldRect={() => {
							return resolveNodeWorldRectByLayout(node);
						}}
						camera={camera}
						baseStrokeWidthPx={selectedBorderStyle.baseStrokeWidthPx}
						color={selectedBorderStyle.color}
					/>
				))}
				{activeNode && (
					<CanvasScreenRectOutline
						key={`canvas-node-active-outline-overlay-${activeNode.id}`}
						resolveWorldRect={() => {
							return resolveNodeWorldRectByLayout(activeNode);
						}}
						camera={camera}
						baseStrokeWidthPx={activeBorderStyle.baseStrokeWidthPx}
						color={activeBorderStyle.color}
					/>
				)}
				{selectedNodes.length > 1 && (
					<CanvasScreenRectOutline
						key="canvas-selection-bounds-overlay"
						resolveWorldRect={resolveSelectedWorldRect}
						camera={camera}
						baseStrokeWidthPx={groupBorderStyle.baseStrokeWidthPx}
						color={groupBorderStyle.color}
					/>
				)}
			</Group>
			{resizeTarget && isResizeEnabled && (
				<Group zIndex={1_000_001} pointerEvents="auto">
					<CanvasResizeAnchorHandle
						anchor="top-left"
						camera={camera}
						resolveWorldRect={
							resizeTarget.kind === "node" && activeNode
								? () => {
										return resolveNodeWorldRectByLayout(activeNode);
								  }
								: resolveSelectedWorldRect
						}
						hoveredResizeAnchor={hoveredResizeAnchor}
						pressedResizeAnchor={pressedResizeAnchor}
						onPointerEnter={() => {
							handleResizeAnchorPointerEnter("top-left");
						}}
						onPointerLeave={() => {
							handleResizeAnchorPointerLeave("top-left");
						}}
						onPointerDown={topLeftResizeHandlers.onPointerDown}
					/>
					<CanvasResizeAnchorHandle
						anchor="top-right"
						camera={camera}
						resolveWorldRect={
							resizeTarget.kind === "node" && activeNode
								? () => {
										return resolveNodeWorldRectByLayout(activeNode);
								  }
								: resolveSelectedWorldRect
						}
						hoveredResizeAnchor={hoveredResizeAnchor}
						pressedResizeAnchor={pressedResizeAnchor}
						onPointerEnter={() => {
							handleResizeAnchorPointerEnter("top-right");
						}}
						onPointerLeave={() => {
							handleResizeAnchorPointerLeave("top-right");
						}}
						onPointerDown={topRightResizeHandlers.onPointerDown}
					/>
					<CanvasResizeAnchorHandle
						anchor="bottom-right"
						camera={camera}
						resolveWorldRect={
							resizeTarget.kind === "node" && activeNode
								? () => {
										return resolveNodeWorldRectByLayout(activeNode);
								  }
								: resolveSelectedWorldRect
						}
						hoveredResizeAnchor={hoveredResizeAnchor}
						pressedResizeAnchor={pressedResizeAnchor}
						onPointerEnter={() => {
							handleResizeAnchorPointerEnter("bottom-right");
						}}
						onPointerLeave={() => {
							handleResizeAnchorPointerLeave("bottom-right");
						}}
						onPointerDown={bottomRightResizeHandlers.onPointerDown}
					/>
					<CanvasResizeAnchorHandle
						anchor="bottom-left"
						camera={camera}
						resolveWorldRect={
							resizeTarget.kind === "node" && activeNode
								? () => {
										return resolveNodeWorldRectByLayout(activeNode);
								  }
								: resolveSelectedWorldRect
						}
						hoveredResizeAnchor={hoveredResizeAnchor}
						pressedResizeAnchor={pressedResizeAnchor}
						onPointerEnter={() => {
							handleResizeAnchorPointerEnter("bottom-left");
						}}
						onPointerLeave={() => {
							handleResizeAnchorPointerLeave("bottom-left");
						}}
						onPointerDown={bottomLeftResizeHandlers.onPointerDown}
					/>
				</Group>
			)}
		</>
	);
};
