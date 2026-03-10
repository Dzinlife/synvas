import type { CanvasNode } from "core/studio/types";

const CAMERA_ZOOM_EPSILON = 1e-6;
const CANVAS_SNAP_GUIDE_THRESHOLD_PX = 6;
const CANVAS_SNAP_GUIDE_MATCH_EPSILON = 1e-6;

export interface CanvasSnapRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CanvasSnapGuideValues {
	x: number[];
	y: number[];
}

export interface CanvasSnapGuidesWorld {
	vertical: number[];
	horizontal: number[];
}

export interface CanvasSnapGuidesScreen {
	vertical: number[];
	horizontal: number[];
}

export interface CanvasSnapMatchResult {
	line: number | null;
	delta: number;
	distance: number;
	value: number | null;
	lines: number[];
}

export interface CanvasSnapResult {
	deltaX: number;
	deltaY: number;
	matchX: CanvasSnapMatchResult;
	matchY: CanvasSnapMatchResult;
	guidesWorld: CanvasSnapGuidesWorld;
}

export const EMPTY_CANVAS_SNAP_GUIDES_SCREEN: CanvasSnapGuidesScreen = {
	vertical: [],
	horizontal: [],
};

export const EMPTY_CANVAS_SNAP_GUIDES_WORLD: CanvasSnapGuidesWorld = {
	vertical: [],
	horizontal: [],
};

const appendUniqueGuideLine = (lines: number[], line: number) => {
	const exists = lines.some((item) => {
		return Math.abs(item - line) <= CANVAS_SNAP_GUIDE_MATCH_EPSILON;
	});
	if (!exists) {
		lines.push(line);
	}
};

const resolveNodeSnapBounds = (node: CanvasNode): CanvasSnapRect => {
	const left = Math.min(node.x, node.x + node.width);
	const right = Math.max(node.x, node.x + node.width);
	const top = Math.min(node.y, node.y + node.height);
	const bottom = Math.max(node.y, node.y + node.height);
	return {
		x: left,
		y: top,
		width: Math.max(1, right - left),
		height: Math.max(1, bottom - top),
	};
};

export const collectCanvasSnapGuideValues = ({
	nodes,
	excludeNodeIds,
}: {
	nodes: CanvasNode[];
	excludeNodeIds: string[];
}): CanvasSnapGuideValues => {
	const excluded = new Set(excludeNodeIds);
	const guideX: number[] = [];
	const guideY: number[] = [];
	for (const node of nodes) {
		if (node.hidden || excluded.has(node.id)) continue;
		const bounds = resolveNodeSnapBounds(node);
		guideX.push(
			bounds.x,
			bounds.x + bounds.width / 2,
			bounds.x + bounds.width,
		);
		guideY.push(
			bounds.y,
			bounds.y + bounds.height / 2,
			bounds.y + bounds.height,
		);
	}
	return {
		x: guideX,
		y: guideY,
	};
};

export const resolveCanvasSnapThresholdWorld = (cameraZoom: number): number => {
	const safeZoom = Math.max(Math.abs(cameraZoom), CAMERA_ZOOM_EPSILON);
	return CANVAS_SNAP_GUIDE_THRESHOLD_PX / safeZoom;
};

export const findNearestCanvasGuide = (
	values: number[],
	guides: number[],
): CanvasSnapMatchResult => {
	if (values.length === 0 || guides.length === 0) {
		return {
			line: null,
			delta: 0,
			distance: Number.POSITIVE_INFINITY,
			value: null,
			lines: [],
		};
	}
	let bestLine: number | null = null;
	let bestDelta = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	let bestValue: number | null = null;
	const lines: number[] = [];
	for (const value of values) {
		for (const guide of guides) {
			const distance = Math.abs(guide - value);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestLine = guide;
				bestDelta = guide - value;
				bestValue = value;
			}
		}
	}
	if (bestLine !== null) {
		for (const value of values) {
			for (const guide of guides) {
				const distance = Math.abs(guide - value);
				if (
					Math.abs(distance - bestDistance) <=
					CANVAS_SNAP_GUIDE_MATCH_EPSILON
				) {
					appendUniqueGuideLine(lines, guide);
				}
			}
		}
	}
	return {
		line: bestLine,
		delta: bestDelta,
		distance: bestDistance,
		value: bestValue,
		lines,
	};
};

export const resolveCanvasRectSnap = ({
	guideValues,
	threshold,
	movingX,
	movingY,
}: {
	guideValues: CanvasSnapGuideValues;
	threshold: number;
	movingX: number[];
	movingY: number[];
}): CanvasSnapResult => {
	const matchX = findNearestCanvasGuide(movingX, guideValues.x);
	const matchY = findNearestCanvasGuide(movingY, guideValues.y);
	const snapX =
		matchX.line !== null && matchX.distance <= threshold ? matchX.delta : 0;
	const snapY =
		matchY.line !== null && matchY.distance <= threshold ? matchY.delta : 0;
	return {
		deltaX: snapX,
		deltaY: snapY,
		matchX,
		matchY,
		guidesWorld: {
			vertical: snapX !== 0 ? [...matchX.lines] : [],
			horizontal: snapY !== 0 ? [...matchY.lines] : [],
		},
	};
};

export const projectCanvasSnapGuidesToScreen = (
	guidesWorld: CanvasSnapGuidesWorld,
	camera: {
		x: number;
		y: number;
		zoom: number;
	},
): CanvasSnapGuidesScreen => {
	const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
	return {
		vertical: guidesWorld.vertical.map((worldX) => {
			return (worldX + camera.x) * safeZoom;
		}),
		horizontal: guidesWorld.horizontal.map((worldY) => {
			return (worldY + camera.y) * safeZoom;
		}),
	};
};
