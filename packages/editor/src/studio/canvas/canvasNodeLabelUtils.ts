import type { CanvasNode } from "core/studio/types";

const CAMERA_ZOOM_EPSILON = 1e-6;
export interface CanvasCameraState {
	x: number;
	y: number;
	zoom: number;
}

export interface CanvasNodeLayoutState {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CanvasScreenRect {
	x: number;
	y: number;
	width: number;
	height: number;
	right: number;
	bottom: number;
}

export interface CanvasViewportRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

export interface CanvasWorldRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

export interface CanvasNodeLabelLayoutInput {
	frame: CanvasScreenRect;
	badgeHeight: number;
	gap: number;
}

export interface CanvasNodeLabelLayout {
	x: number;
	y: number;
	availableWidth: number;
}

export const resolveCanvasViewportRect = (
	width: number,
	height: number,
): CanvasViewportRect => {
	const safeWidth = Math.max(1, width);
	const safeHeight = Math.max(1, height);
	return {
		left: 0,
		top: 0,
		right: safeWidth,
		bottom: safeHeight,
		width: safeWidth,
		height: safeHeight,
	};
};

export const resolveCanvasWorldRectScreenFrame = (
	rect: CanvasWorldRect,
	camera: CanvasCameraState,
): CanvasScreenRect => {
	const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
	const x = (rect.left + camera.x) * safeZoom;
	const y = (rect.top + camera.y) * safeZoom;
	const width = Math.max(1, rect.width * safeZoom);
	const height = Math.max(1, rect.height * safeZoom);
	return {
		x,
		y,
		width,
		height,
		right: x + width,
		bottom: y + height,
	};
};

export const resolveCanvasNodeScreenFrame = (
	node: CanvasNode,
	camera: CanvasCameraState,
): CanvasScreenRect => {
	return resolveCanvasNodeLayoutScreenFrame(node, camera);
};

export const resolveCanvasNodeLayoutWorldRect = (
	layout: CanvasNodeLayoutState,
): CanvasWorldRect => {
	const nodeLeft = Math.min(layout.x, layout.x + layout.width);
	const nodeRight = Math.max(layout.x, layout.x + layout.width);
	const nodeTop = Math.min(layout.y, layout.y + layout.height);
	const nodeBottom = Math.max(layout.y, layout.y + layout.height);
	return {
		left: nodeLeft,
		top: nodeTop,
		right: nodeRight,
		bottom: nodeBottom,
		width: Math.max(1, nodeRight - nodeLeft),
		height: Math.max(1, nodeBottom - nodeTop),
	};
};

export const resolveCanvasNodeLayoutScreenFrame = (
	layout: CanvasNodeLayoutState,
	camera: CanvasCameraState,
): CanvasScreenRect => {
	const worldRect = resolveCanvasNodeLayoutWorldRect(layout);
	return resolveCanvasWorldRectScreenFrame(worldRect, camera);
};

export const isCanvasScreenRectVisible = (
	frame: CanvasScreenRect,
	viewport: CanvasViewportRect,
): boolean => {
	return (
		frame.right > viewport.left &&
		frame.x < viewport.right &&
		frame.bottom > viewport.top &&
		frame.y < viewport.bottom
	);
};

export const resolveCanvasNodeLabelLayout = ({
	frame,
	badgeHeight,
	gap,
}: CanvasNodeLabelLayoutInput): CanvasNodeLabelLayout | null => {
	if (frame.width <= 0 || frame.height <= 0) return null;
	const availableWidth = frame.width;
	if (availableWidth <= 0) return null;
	return {
		x: frame.x,
		y: frame.y - Math.max(0, gap) - Math.max(1, badgeHeight),
		availableWidth,
	};
};
