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

export const NodeInteractionWrapper: React.FC<NodeInteractionWrapperProps> = ({
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
