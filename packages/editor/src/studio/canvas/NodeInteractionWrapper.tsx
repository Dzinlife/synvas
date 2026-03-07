import { useDrag } from "@use-gesture/react";
import type { CanvasNode } from "core/studio/types";
import { Group, Rect, type SkiaPointerEvent } from "react-skia-lite";

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

interface NodeInteractionWrapperProps {
	node: CanvasNode;
	isActive: boolean;
	isDimmed: boolean;
	isHovered: boolean;
	cameraZoom: number;
	showBorder?: boolean;
	disabled?: boolean;
	onPointerEnter: (nodeId: string) => void;
	onPointerLeave: (nodeId: string) => void;
	onDragStart?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onDrag?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onDragEnd?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onClick?: (node: CanvasNode) => void;
	onDoubleClick?: (node: CanvasNode) => void;
	children: React.ReactNode;
}

interface NodeInteractionBorderStyle {
	color: string;
	baseStrokeWidthPx: number;
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

export const resolveNodeInteractionBorderStyle = ({
	isActive,
	isHovered,
}: {
	isActive: boolean;
	isHovered: boolean;
}): NodeInteractionBorderStyle => {
	if (isActive) {
		return {
			color: "rgba(251,146,60,1)",
			baseStrokeWidthPx: 2,
		};
	}
	if (isHovered) {
		return {
			color: "rgba(56,189,248,0.95)",
			baseStrokeWidthPx: 2,
		};
	}
	return {
		color: "rgba(255,255,255,0.2)",
		baseStrokeWidthPx: 1,
	};
};

export const resolveNodeInteractionStrokeWidth = (
	baseStrokeWidthPx: number,
	cameraZoom: number,
): number => {
	const safeZoom = Math.max(cameraZoom, 1e-6);
	return baseStrokeWidthPx / safeZoom;
};

export const NodeInteractionWrapper: React.FC<NodeInteractionWrapperProps> = ({
	node,
	isActive,
	isDimmed,
	isHovered,
	cameraZoom,
	showBorder = true,
	disabled = false,
	onPointerEnter,
	onPointerLeave,
	onDragStart,
	onDrag,
	onDragEnd,
	onClick,
	onDoubleClick,
	children,
}) => {
	const borderStyle = resolveNodeInteractionBorderStyle({
		isActive,
		isHovered,
	});
	const borderWidth = resolveNodeInteractionStrokeWidth(
		borderStyle.baseStrokeWidthPx,
		cameraZoom,
	);
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
			pointerEvents={disabled ? "none" : "auto"}
			hitRect={{
				x: 0,
				y: 0,
				width: Math.max(1, node.width),
				height: Math.max(1, node.height),
			}}
			onPointerEnter={disabled ? undefined : () => {
				onPointerEnter(node.id);
			}}
			onPointerLeave={disabled ? undefined : () => {
				onPointerLeave(node.id);
			}}
			onPointerDown={disabled ? undefined : (event) => {
				dragHandlers.onPointerDown?.(event);
			}}
			onClick={disabled ? undefined : () => {
				onClick?.(node);
			}}
			onDoubleClick={disabled ? undefined : () => {
				onDoubleClick?.(node);
			}}
		>
			{children}
			{showBorder && (
				<Rect
					x={0}
					y={0}
					width={Math.max(1, node.width)}
					height={Math.max(1, node.height)}
					style="stroke"
					strokeWidth={borderWidth}
					color={borderStyle.color}
				/>
			)}
		</Group>
	);
};
