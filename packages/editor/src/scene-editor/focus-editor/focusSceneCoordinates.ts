import type { SceneNode } from "core/studio/types";
import type { CameraState } from "@/studio/canvas/canvasWorkspaceUtils";

export const FOCUS_SCENE_EPSILON = 1e-6;

export interface FocusSceneCoordinateContext {
	camera: CameraState;
	focusedNode: SceneNode;
	sourceWidth: number;
	sourceHeight: number;
	sceneScaleX: number;
	sceneScaleY: number;
	safeSceneScaleX: number;
	safeSceneScaleY: number;
	stageScaleX: number;
	stageScaleY: number;
	safeCameraZoom: number;
}

export type FocusPoint = {
	x: number;
	y: number;
};

export type FocusRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type FocusFrame = {
	cx: number;
	cy: number;
	width: number;
	height: number;
	rotationRad: number;
};

export type FocusMatrix = {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
};

export const createFocusSceneCoordinateContext = (
	params: {
		camera: CameraState;
		focusedNode: SceneNode;
		sourceWidth: number;
		sourceHeight: number;
	},
): FocusSceneCoordinateContext => {
	const { camera, focusedNode } = params;
	const sourceWidth = Math.max(1, params.sourceWidth);
	const sourceHeight = Math.max(1, params.sourceHeight);
	const sceneScaleX = focusedNode.width / sourceWidth;
	const sceneScaleY = focusedNode.height / sourceHeight;
	const safeSceneScaleX =
		Math.abs(sceneScaleX) > FOCUS_SCENE_EPSILON ? sceneScaleX : 1;
	const safeSceneScaleY =
		Math.abs(sceneScaleY) > FOCUS_SCENE_EPSILON ? sceneScaleY : 1;
	const safeCameraZoom = Math.max(
		Math.abs(camera.zoom),
		FOCUS_SCENE_EPSILON,
	);

	return {
		camera,
		focusedNode,
		sourceWidth,
		sourceHeight,
		sceneScaleX,
		sceneScaleY,
		safeSceneScaleX,
		safeSceneScaleY,
		stageScaleX: safeSceneScaleX * camera.zoom,
		stageScaleY: safeSceneScaleY * camera.zoom,
		safeCameraZoom,
	};
};

export const screenToWorldPoint = (
	ctx: FocusSceneCoordinateContext,
	screenPoint: FocusPoint,
): FocusPoint => {
	return {
		x: screenPoint.x / ctx.safeCameraZoom - ctx.camera.x,
		y: screenPoint.y / ctx.safeCameraZoom - ctx.camera.y,
	};
};

export const worldToScreenPoint = (
	ctx: FocusSceneCoordinateContext,
	worldPoint: FocusPoint,
): FocusPoint => {
	return {
		x: (worldPoint.x + ctx.camera.x) * ctx.camera.zoom,
		y: (worldPoint.y + ctx.camera.y) * ctx.camera.zoom,
	};
};

export const worldToScenePoint = (
	ctx: FocusSceneCoordinateContext,
	worldPoint: FocusPoint,
): FocusPoint => {
	return {
		x: (worldPoint.x - ctx.focusedNode.x) / ctx.safeSceneScaleX,
		y: (worldPoint.y - ctx.focusedNode.y) / ctx.safeSceneScaleY,
	};
};

export const sceneToWorldPoint = (
	ctx: FocusSceneCoordinateContext,
	scenePoint: FocusPoint,
): FocusPoint => {
	return {
		x: ctx.focusedNode.x + scenePoint.x * ctx.safeSceneScaleX,
		y: ctx.focusedNode.y + scenePoint.y * ctx.safeSceneScaleY,
	};
};

export const screenToScenePoint = (
	ctx: FocusSceneCoordinateContext,
	screenPoint: FocusPoint,
): FocusPoint => {
	const world = screenToWorldPoint(ctx, screenPoint);
	return worldToScenePoint(ctx, world);
};

export const sceneToScreenPoint = (
	ctx: FocusSceneCoordinateContext,
	scenePoint: FocusPoint,
): FocusPoint => {
	const world = sceneToWorldPoint(ctx, scenePoint);
	return worldToScreenPoint(ctx, world);
};

export const sceneDistanceFromScreenDelta = (
	ctx: FocusSceneCoordinateContext,
	deltaX: number,
	deltaY: number,
): FocusPoint => {
	const scaleX = Math.max(
		Math.abs(ctx.stageScaleX),
		FOCUS_SCENE_EPSILON,
	);
	const scaleY = Math.max(
		Math.abs(ctx.stageScaleY),
		FOCUS_SCENE_EPSILON,
	);
	return {
		x: deltaX / scaleX,
		y: deltaY / scaleY,
	};
};

export const createFocusIdentityMatrix = (): FocusMatrix => {
	return {
		a: 1,
		b: 0,
		c: 0,
		d: 1,
		e: 0,
		f: 0,
	};
};

export const multiplyFocusMatrix = (
	left: FocusMatrix,
	right: FocusMatrix,
): FocusMatrix => {
	return {
		a: left.a * right.a + left.c * right.b,
		b: left.b * right.a + left.d * right.b,
		c: left.a * right.c + left.c * right.d,
		d: left.b * right.c + left.d * right.d,
		e: left.a * right.e + left.c * right.f + left.e,
		f: left.b * right.e + left.d * right.f + left.f,
	};
};

export const invertFocusMatrix = (matrix: FocusMatrix): FocusMatrix | null => {
	const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
	if (Math.abs(determinant) <= FOCUS_SCENE_EPSILON) {
		return null;
	}
	const reciprocal = 1 / determinant;
	return {
		a: matrix.d * reciprocal,
		b: -matrix.b * reciprocal,
		c: -matrix.c * reciprocal,
		d: matrix.a * reciprocal,
		e: (matrix.c * matrix.f - matrix.d * matrix.e) * reciprocal,
		f: (matrix.b * matrix.e - matrix.a * matrix.f) * reciprocal,
	};
};

export const mapFocusPoint = (
	matrix: FocusMatrix,
	point: FocusPoint,
): FocusPoint => {
	return {
		x: matrix.a * point.x + matrix.c * point.y + matrix.e,
		y: matrix.b * point.x + matrix.d * point.y + matrix.f,
	};
};

const createFocusTranslationMatrix = (x: number, y: number): FocusMatrix => {
	return {
		a: 1,
		b: 0,
		c: 0,
		d: 1,
		e: x,
		f: y,
	};
};

const createFocusRotationMatrix = (rotationRad: number): FocusMatrix => {
	const cos = Math.cos(rotationRad);
	const sin = Math.sin(rotationRad);
	return {
		a: cos,
		b: sin,
		c: -sin,
		d: cos,
		e: 0,
		f: 0,
	};
};

export const createFocusFrameMatrix = (frame: FocusFrame): FocusMatrix => {
	const toCenter = createFocusTranslationMatrix(frame.cx, frame.cy);
	const rotate = createFocusRotationMatrix(frame.rotationRad);
	const toTopLeft = createFocusTranslationMatrix(
		-frame.width / 2,
		-frame.height / 2,
	);
	return multiplyFocusMatrix(
		multiplyFocusMatrix(toCenter, rotate),
		toTopLeft,
	);
};

export const getFocusFrameCorners = (frame: FocusFrame): FocusPoint[] => {
	const matrix = createFocusFrameMatrix(frame);
	return [
		mapFocusPoint(matrix, { x: 0, y: 0 }),
		mapFocusPoint(matrix, { x: frame.width, y: 0 }),
		mapFocusPoint(matrix, { x: frame.width, y: frame.height }),
		mapFocusPoint(matrix, { x: 0, y: frame.height }),
	];
};

export const getFocusBoundingRect = (points: FocusPoint[]): FocusRect => {
	if (points.length === 0) {
		return {
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		};
	}
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	return {
		x: minX,
		y: minY,
		width: Math.max(0, maxX - minX),
		height: Math.max(0, maxY - minY),
	};
};

export const isFocusPointInFrame = (
	point: FocusPoint,
	frame: FocusFrame,
): boolean => {
	const inverse = invertFocusMatrix(createFocusFrameMatrix(frame));
	if (!inverse) return false;
	const localPoint = mapFocusPoint(inverse, point);
	return (
		localPoint.x >= 0 &&
		localPoint.x <= frame.width &&
		localPoint.y >= 0 &&
		localPoint.y <= frame.height
	);
};

export const getFocusMatrixMetrics = (
	matrix: FocusMatrix,
	width: number,
	height: number,
) => {
	const origin = mapFocusPoint(matrix, { x: 0, y: 0 });
	const xAxisEnd = mapFocusPoint(matrix, { x: width, y: 0 });
	const yAxisEnd = mapFocusPoint(matrix, { x: 0, y: height });
	const center = mapFocusPoint(matrix, { x: width / 2, y: height / 2 });
	return {
		center,
		width: Math.hypot(xAxisEnd.x - origin.x, xAxisEnd.y - origin.y),
		height: Math.hypot(yAxisEnd.x - origin.x, yAxisEnd.y - origin.y),
		rotationRad: Math.atan2(xAxisEnd.y - origin.y, xAxisEnd.x - origin.x),
	};
};

export const normalizeFocusRect = (rect: FocusRect): FocusRect => {
	const left = Math.min(rect.x, rect.x + rect.width);
	const right = Math.max(rect.x, rect.x + rect.width);
	const top = Math.min(rect.y, rect.y + rect.height);
	const bottom = Math.max(rect.y, rect.y + rect.height);
	return {
		x: left,
		y: top,
		width: right - left,
		height: bottom - top,
	};
};

export const isFocusRectIntersect = (
	left: FocusRect,
	right: FocusRect,
): boolean => {
	const a = normalizeFocusRect(left);
	const b = normalizeFocusRect(right);
	return (
		a.x < b.x + b.width &&
		a.x + a.width > b.x &&
		a.y < b.y + b.height &&
		a.y + a.height > b.y
	);
};
