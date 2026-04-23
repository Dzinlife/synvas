import { useDrag } from "@use-gesture/react";
import type { CanvasNode } from "@/studio/project/types";
import {
	Group,
	Rect,
	type SharedValue,
	type SkiaPointerEvent,
	useDerivedValue,
} from "react-skia-lite";
import type { CanvasNodeLayoutState } from "./canvasNodeLabelUtils";

export interface CanvasNodePointerEvent {
	clientX: number;
	clientY: number;
	button: number;
	buttons: number;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
}

export interface CanvasNodeDragEvent extends CanvasNodePointerEvent {
	movementX: number;
	movementY: number;
	first: boolean;
	last: boolean;
	tap: boolean;
}

interface NodeInteractionWrapperProps {
	node: CanvasNode;
	layout?: SharedValue<CanvasNodeLayoutState> | null;
	disabled?: boolean;
	onPointerEnter?: (nodeId: string) => void;
	onPointerLeave?: (nodeId: string) => void;
	onDragStart?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onDrag?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onDragEnd?: (node: CanvasNode, event: CanvasNodeDragEvent) => void;
	onClick?: (node: CanvasNode, event: CanvasNodePointerEvent) => void;
	onDoubleClick?: (node: CanvasNode, event: CanvasNodePointerEvent) => void;
	children?: React.ReactNode;
}

const NODE_INTERACTION_SURFACE_COLOR = "rgba(255,255,255,0.001)";

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

const resolveBooleanField = (
	event: unknown,
	key: "shiftKey" | "altKey" | "metaKey" | "ctrlKey",
): boolean => {
	if (!event || typeof event !== "object") return false;
	if (!(key in event)) return false;
	return Boolean((event as Record<string, unknown>)[key]);
};

const resolveClientField = (
	event: unknown,
	key: "clientX" | "clientY" | "x" | "y",
): number => {
	if (!event || typeof event !== "object") return 0;
	if (!(key in event)) return 0;
	const value = (event as Record<string, unknown>)[key];
	if (!Number.isFinite(value)) return 0;
	return Number(value);
};

export const resolvePointerEventMeta = (
	event: unknown,
	fallbackClientX = 0,
	fallbackClientY = 0,
): CanvasNodePointerEvent => {
	return {
		clientX:
			resolveClientField(event, "clientX") || resolveClientField(event, "x") || fallbackClientX,
		clientY:
			resolveClientField(event, "clientY") || resolveClientField(event, "y") || fallbackClientY,
		button: resolvePointerField(event, "button"),
		buttons: resolvePointerField(event, "buttons"),
		shiftKey: resolveBooleanField(event, "shiftKey"),
		altKey: resolveBooleanField(event, "altKey"),
		metaKey: resolveBooleanField(event, "metaKey"),
		ctrlKey: resolveBooleanField(event, "ctrlKey"),
	};
};

export const NodeInteractionWrapper: React.FC<NodeInteractionWrapperProps> = ({
	node,
	layout = null,
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
	const transform = useDerivedValue(() => {
		const nextLayout = layout?.value ?? node;
		return [
			{ translateX: nextLayout.x },
			{ translateY: nextLayout.y },
		];
	});
	const hitRect = useDerivedValue(() => {
		const nextLayout = layout?.value ?? node;
		return {
			x: 0,
			y: 0,
			width: Math.max(1, nextLayout.width),
			height: Math.max(1, nextLayout.height),
		};
	});
	const borderRectWidth = useDerivedValue(() => {
		const nextLayout = layout?.value ?? node;
		return Math.max(1, nextLayout.width);
	});
	const borderRectHeight = useDerivedValue(() => {
		const nextLayout = layout?.value ?? node;
		return Math.max(1, nextLayout.height);
	});
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
				...resolvePointerEventMeta(event, clientX, clientY),
				movementX: mx,
				movementY: my,
				first,
				last,
				tap,
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
			transform={transform}
			pointerEvents={disabled ? "none" : "auto"}
			hitRect={hitRect}
			onPointerEnter={disabled ? undefined : () => {
				onPointerEnter?.(node.id);
			}}
			onPointerLeave={disabled ? undefined : () => {
				onPointerLeave?.(node.id);
			}}
			onPointerDown={disabled ? undefined : (event) => {
				dragHandlers.onPointerDown?.(event);
			}}
			onClick={disabled ? undefined : (event) => {
				onClick?.(node, resolvePointerEventMeta(event));
			}}
			onDoubleClick={disabled ? undefined : (event) => {
				onDoubleClick?.(node, resolvePointerEventMeta(event));
			}}
		>
			<Rect
				x={0}
				y={0}
				width={borderRectWidth}
				height={borderRectHeight}
				color={NODE_INTERACTION_SURFACE_COLOR}
			/>
			{children}
		</Group>
	);
};
