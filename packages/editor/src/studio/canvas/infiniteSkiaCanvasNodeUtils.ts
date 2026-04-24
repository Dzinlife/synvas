import type { CanvasNode } from "@/studio/project/types";
import type { CanvasNodeLayoutState } from "./canvasNodeLabelUtils";

const LAYOUT_EPSILON = 1e-6;

const resolveNodeLayoutState = (node: CanvasNode): CanvasNodeLayoutState => {
	return {
		x: node.x,
		y: node.y,
		width: node.width,
		height: node.height,
	};
};

const isNodeLayoutStateEqual = (
	left: CanvasNodeLayoutState,
	right: CanvasNodeLayoutState,
): boolean => {
	return (
		Math.abs(left.x - right.x) < LAYOUT_EPSILON &&
		Math.abs(left.y - right.y) < LAYOUT_EPSILON &&
		Math.abs(left.width - right.width) < LAYOUT_EPSILON &&
		Math.abs(left.height - right.height) < LAYOUT_EPSILON
	);
};

const resolveNodeStructureSignature = (nodes: CanvasNode[]): string => {
	return JSON.stringify(
		nodes.map(({ x, y, width, height, updatedAt, ...rest }) => {
			void updatedAt;
			return rest;
		}),
	);
};

const isLayerValueEqual = (left: unknown, right: unknown): boolean => {
	if (left === right) return true;
	if (typeof left !== typeof right) return false;
	if (left === null || right === null) return left === right;
	if (Array.isArray(left) && Array.isArray(right)) {
		if (left.length !== right.length) return false;
		for (let index = 0; index < left.length; index += 1) {
			if (!isLayerValueEqual(left[index], right[index])) return false;
		}
		return true;
	}
	if (
		typeof left === "object" &&
		typeof right === "object" &&
		!Array.isArray(left) &&
		!Array.isArray(right)
	) {
		const leftRecord = left as Record<string, unknown>;
		const rightRecord = right as Record<string, unknown>;
		const leftKeys = Object.keys(leftRecord);
		const rightKeys = Object.keys(rightRecord);
		if (leftKeys.length !== rightKeys.length) return false;
		for (const key of leftKeys) {
			if (!(key in rightRecord)) return false;
			if (!isLayerValueEqual(leftRecord[key], rightRecord[key])) return false;
		}
		return true;
	}
	return false;
};

export {
	LAYOUT_EPSILON,
	isLayerValueEqual,
	isNodeLayoutStateEqual,
	resolveNodeLayoutState,
	resolveNodeStructureSignature,
};
