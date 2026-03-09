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

export const resolveCanvasResizeAnchorAtWorldPoint = (input: {
	node: CanvasNode;
	worldX: number;
	worldY: number;
	cameraZoom: number;
}): CanvasNodeResizeAnchor | null => {
	const safeZoom = Math.max(input.cameraZoom, 1e-6);
	const offsetWorld = CANVAS_RESIZE_ANCHOR_OFFSET_PX / safeZoom;
	const hitSizeWorld = CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX / safeZoom;
	const anchors: Array<{
		anchor: CanvasNodeResizeAnchor;
		x: number;
		y: number;
	}> = [
		{
			anchor: "top-left",
			x: input.node.x - offsetWorld,
			y: input.node.y - offsetWorld,
		},
		{
			anchor: "top-right",
			x: input.node.x + input.node.width + offsetWorld,
			y: input.node.y - offsetWorld,
		},
		{
			anchor: "bottom-right",
			x: input.node.x + input.node.width + offsetWorld,
			y: input.node.y + input.node.height + offsetWorld,
		},
		{
			anchor: "bottom-left",
			x: input.node.x - offsetWorld,
			y: input.node.y + input.node.height + offsetWorld,
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
