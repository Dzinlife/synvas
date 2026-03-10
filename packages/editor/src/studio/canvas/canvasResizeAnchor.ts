import type { CanvasNode } from "core/studio/types";

export type CanvasNodeResizeAnchor =
	| "top-left"
	| "top-right"
	| "bottom-right"
	| "bottom-left";

export interface CanvasNodeResizeAnchorState {
	nodeId: string;
	anchor: CanvasNodeResizeAnchor;
}
export const CANVAS_RESIZE_ANCHOR_OFFSET_PX = 4;
export const CANVAS_RESIZE_ANCHOR_LEG_PX = 12;
export const CANVAS_RESIZE_ANCHOR_STROKE_PX = 2;
export const CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX = 24;

export const resolveCanvasResizeAnchorAtRectWorldPoint = (input: {
	x: number;
	y: number;
	width: number;
	height: number;
	worldX: number;
	worldY: number;
	cameraZoom: number;
}): CanvasNodeResizeAnchor | null => {
	const safeZoom = Math.max(input.cameraZoom, 1e-6);
	const offsetWorld = CANVAS_RESIZE_ANCHOR_OFFSET_PX / safeZoom;
	const hitSizeWorld = CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX / safeZoom;
	const left = Math.min(input.x, input.x + input.width);
	const right = Math.max(input.x, input.x + input.width);
	const top = Math.min(input.y, input.y + input.height);
	const bottom = Math.max(input.y, input.y + input.height);
	const anchors: Array<{
		anchor: CanvasNodeResizeAnchor;
		x: number;
		y: number;
	}> = [
		{
			anchor: "top-left",
			x: left - offsetWorld,
			y: top - offsetWorld,
		},
		{
			anchor: "top-right",
			x: right + offsetWorld,
			y: top - offsetWorld,
		},
		{
			anchor: "bottom-right",
			x: right + offsetWorld,
			y: bottom + offsetWorld,
		},
		{
			anchor: "bottom-left",
			x: left - offsetWorld,
			y: bottom + offsetWorld,
		},
	];
	const halfHit = hitSizeWorld / 2;
	const isInRect = (centerX: number, centerY: number): boolean => {
		return (
			input.worldX >= centerX - halfHit &&
			input.worldX <= centerX + halfHit &&
			input.worldY >= centerY - halfHit &&
			input.worldY <= centerY + halfHit
		);
	};

	let matched: CanvasNodeResizeAnchor | null = null;
	let minDistanceSquared = Number.POSITIVE_INFINITY;
	for (const anchor of anchors) {
		if (!isInRect(anchor.x, anchor.y)) continue;
		const dx = input.worldX - anchor.x;
		const dy = input.worldY - anchor.y;
		const distanceSquared = dx * dx + dy * dy;
		if (distanceSquared >= minDistanceSquared) continue;
		minDistanceSquared = distanceSquared;
		matched = anchor.anchor;
	}
	return matched;
};

export const resolveCanvasResizeAnchorAtWorldPoint = (input: {
	node: CanvasNode;
	worldX: number;
	worldY: number;
	cameraZoom: number;
}): CanvasNodeResizeAnchor | null => {
	return resolveCanvasResizeAnchorAtRectWorldPoint({
		x: input.node.x,
		y: input.node.y,
		width: input.node.width,
		height: input.node.height,
		worldX: input.worldX,
		worldY: input.worldY,
		cameraZoom: input.cameraZoom,
	});
};
