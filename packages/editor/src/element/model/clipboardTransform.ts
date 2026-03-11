import { transformPositionToCanvasPoint } from "core/element/position";
import type { TimelineElement } from "core/element/types";
import { getTransformSize } from "../transform";

interface CanvasSize {
	width: number;
	height: number;
}

export interface ClipboardNodeGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
}

const DEFAULT_CANVAS_SIZE: CanvasSize = {
	width: 1920,
	height: 1080,
};

const clampNormalized = (value: unknown): number => {
	if (!Number.isFinite(value as number)) return 0.5;
	return Math.min(1, Math.max(0, Number(value)));
};

const resolveCanvasSize = (
	input: CanvasSize | null | undefined,
): CanvasSize => {
	if (!input) return DEFAULT_CANVAS_SIZE;
	const width =
		Number.isFinite(input.width) && input.width > 0 ? input.width : 1;
	const height =
		Number.isFinite(input.height) && input.height > 0 ? input.height : 1;
	return {
		width,
		height,
	};
};

export const resolveClipboardNodeGeometry = (
	element: TimelineElement,
	sourceCanvasSize: CanvasSize | null | undefined,
	fallbackSize: { width: number; height: number },
): ClipboardNodeGeometry => {
	const canvasSize = resolveCanvasSize(sourceCanvasSize);
	const transform = element.transform;
	const transformSize = transform ? getTransformSize(transform) : fallbackSize;
	const width = Math.max(
		1,
		Math.round(
			Number.isFinite(transformSize.width)
				? transformSize.width
				: fallbackSize.width,
		),
	);
	const height = Math.max(
		1,
		Math.round(
			Number.isFinite(transformSize.height)
				? transformSize.height
				: fallbackSize.height,
		),
	);
	const anchorX = clampNormalized(transform?.anchor?.x);
	const anchorY = clampNormalized(transform?.anchor?.y);
	const positionX =
		Number.isFinite(transform?.position?.x) &&
		transform?.position?.x !== undefined
			? transform.position.x
			: 0;
	const positionY =
		Number.isFinite(transform?.position?.y) &&
		transform?.position?.y !== undefined
			? transform.position.y
			: 0;
	const anchorPoint = transformPositionToCanvasPoint(
		positionX,
		positionY,
		canvasSize,
		canvasSize,
	);
	return {
		x: Math.round(anchorPoint.canvasX - width * anchorX),
		y: Math.round(anchorPoint.canvasY - height * anchorY),
		width,
		height,
	};
};
