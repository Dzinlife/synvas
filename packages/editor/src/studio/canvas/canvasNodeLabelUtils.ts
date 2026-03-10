import type { CanvasNode } from "core/studio/types";

const CAMERA_ZOOM_EPSILON = 1e-6;
export interface CanvasCameraState {
	x: number;
	y: number;
	zoom: number;
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

export const resolveCanvasNodeScreenFrame = (
	node: CanvasNode,
	camera: CanvasCameraState,
): CanvasScreenRect => {
	const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
	const nodeLeft = Math.min(node.x, node.x + node.width);
	const nodeRight = Math.max(node.x, node.x + node.width);
	const nodeTop = Math.min(node.y, node.y + node.height);
	const nodeBottom = Math.max(node.y, node.y + node.height);
	const x = (nodeLeft + camera.x) * safeZoom;
	const y = (nodeTop + camera.y) * safeZoom;
	const width = Math.max(1, (nodeRight - nodeLeft) * safeZoom);
	const height = Math.max(1, (nodeBottom - nodeTop) * safeZoom);
	return {
		x,
		y,
		width,
		height,
		right: x + width,
		bottom: y + height,
	};
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
