import type { CanvasNode } from "core/studio/types";

export type CanvasNodeResizeAnchor = "top-left" | "bottom-right";

export interface CanvasNodeResizeAnchorState {
	nodeId: string;
	anchor: CanvasNodeResizeAnchor;
}
export const CANVAS_RESIZE_ANCHOR_OFFSET_PX = 2;
export const CANVAS_RESIZE_ANCHOR_LEG_PX = 12;
export const CANVAS_RESIZE_ANCHOR_STROKE_PX = 2;
export const CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX = 24;
export const CANVAS_RESIZE_ANCHOR_CORNER_RADIUS_PX = 1;

export const resolveCanvasResizeAnchorAtWorldPoint = (input: {
	node: CanvasNode;
	worldX: number;
	worldY: number;
	cameraZoom: number;
}): CanvasNodeResizeAnchor | null => {
	const safeZoom = Math.max(input.cameraZoom, 1e-6);
	const offsetWorld = CANVAS_RESIZE_ANCHOR_OFFSET_PX / safeZoom;
	const hitSizeWorld = CANVAS_RESIZE_ANCHOR_HIT_SIZE_PX / safeZoom;
	const topLeft = {
		x: input.node.x - offsetWorld,
		y: input.node.y - offsetWorld,
	};
	const bottomRight = {
		x: input.node.x + input.node.width + offsetWorld,
		y: input.node.y + input.node.height + offsetWorld,
	};
	const halfHit = hitSizeWorld / 2;
	const isInRect = (centerX: number, centerY: number): boolean => {
		return (
			input.worldX >= centerX - halfHit &&
			input.worldX <= centerX + halfHit &&
			input.worldY >= centerY - halfHit &&
			input.worldY <= centerY + halfHit
		);
	};
	if (isInRect(topLeft.x, topLeft.y)) {
		return "top-left";
	}
	if (isInRect(bottomRight.x, bottomRight.y)) {
		return "bottom-right";
	}
	return null;
};
