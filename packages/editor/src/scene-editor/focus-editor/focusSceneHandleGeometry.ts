import type {
	FocusFrame,
	FocusPoint,
	FocusRect,
} from "./focusSceneCoordinates";
import {
	createFocusFrameMatrix,
	invertFocusMatrix,
	mapFocusPoint,
} from "./focusSceneCoordinates";
import {
	FOCUS_ROTATE_CURSOR_BOTTOM_LEFT,
	FOCUS_ROTATE_CURSOR_BOTTOM_RIGHT,
	FOCUS_ROTATE_CURSOR_TOP_LEFT,
	FOCUS_ROTATE_CURSOR_TOP_RIGHT,
} from "./focusSceneCursor";

export const FOCUS_SCENE_CORNER_HANDLE_SIZE_PX = 6;
export const FOCUS_SCENE_CORNER_HIT_SIZE_PX = 10;
export const FOCUS_SCENE_EDGE_HIT_WIDTH_PX = 10;
export const FOCUS_SCENE_ROTATE_HIT_SIZE_PX = 24;
export const FOCUS_SCENE_ROTATE_OFFSET_PX = 24;

export type FocusResizeHandle =
	| "top-left"
	| "top-center"
	| "top-right"
	| "middle-left"
	| "middle-right"
	| "bottom-left"
	| "bottom-center"
	| "bottom-right";

export type FocusRotateHandle =
	| "rotate-top-left"
	| "rotate-top-right"
	| "rotate-bottom-right"
	| "rotate-bottom-left";

export type FocusTransformHandle = FocusResizeHandle | FocusRotateHandle;
export type FocusResizeHandleMode = "default" | "horizontal-only";

export type FocusTransformAnchorKind =
	| "resize-corner"
	| "resize-edge"
	| "rotate-corner";

export type FocusTransformHandleRenderItem = {
	id: string;
	handle: FocusTransformHandle;
	kind: FocusTransformAnchorKind;
	screenX: number;
	screenY: number;
	rectLocal: FocusRect;
	cursor: string;
	visibleCornerMarker: boolean;
};

const HALF_DIAGONAL = Math.SQRT1_2;

const buildResizeCursor = (handle: FocusResizeHandle): string => {
	switch (handle) {
		case "top-left":
		case "bottom-right":
			return "nwse-resize";
		case "top-right":
		case "bottom-left":
			return "nesw-resize";
		case "top-center":
		case "bottom-center":
			return "ns-resize";
		case "middle-left":
		case "middle-right":
			return "ew-resize";
		default:
			return "default";
	}
};

const buildRotateCursor = (handle: FocusRotateHandle): string => {
	switch (handle) {
		case "rotate-top-left":
			return FOCUS_ROTATE_CURSOR_TOP_LEFT;
		case "rotate-top-right":
			return FOCUS_ROTATE_CURSOR_TOP_RIGHT;
		case "rotate-bottom-right":
			return FOCUS_ROTATE_CURSOR_BOTTOM_RIGHT;
		case "rotate-bottom-left":
			return FOCUS_ROTATE_CURSOR_BOTTOM_LEFT;
		default:
			return "auto";
	}
};

const createItem = (
	frameScreen: FocusFrame,
	params: {
		id: string;
		handle: FocusTransformHandle;
		kind: FocusTransformAnchorKind;
		centerLocal: FocusPoint;
		rectLocal: FocusRect;
		cursor: string;
		visibleCornerMarker: boolean;
	},
): FocusTransformHandleRenderItem => {
	const matrix = createFocusFrameMatrix(frameScreen);
	const center = mapFocusPoint(matrix, params.centerLocal);
	return {
		id: params.id,
		handle: params.handle,
		kind: params.kind,
		screenX: center.x,
		screenY: center.y,
		rectLocal: params.rectLocal,
		cursor: params.cursor,
		visibleCornerMarker: params.visibleCornerMarker,
	};
};

export const isRotateHandle = (
	handle: FocusTransformHandle,
): handle is FocusRotateHandle => {
	return handle.startsWith("rotate-");
};

const DEFAULT_EDGE_HANDLES: FocusResizeHandle[] = [
	"top-center",
	"middle-right",
	"bottom-center",
	"middle-left",
];

const resolveEdgeHandlesByMode = (
	mode: FocusResizeHandleMode,
): FocusResizeHandle[] => {
	if (mode === "horizontal-only") {
		return ["middle-right", "middle-left"];
	}
	return DEFAULT_EDGE_HANDLES;
};

export const buildFocusTransformHandleItems = (
	frameScreen: FocusFrame,
	options?: {
		resizeHandleMode?: FocusResizeHandleMode;
	},
): FocusTransformHandleRenderItem[] => {
	const resizeHandleMode = options?.resizeHandleMode ?? "default";
	const width = Math.max(0, frameScreen.width);
	const height = Math.max(0, frameScreen.height);
	const halfEdge = FOCUS_SCENE_EDGE_HIT_WIDTH_PX / 2;
	const halfCorner = FOCUS_SCENE_CORNER_HIT_SIZE_PX / 2;
	const halfRotate = FOCUS_SCENE_ROTATE_HIT_SIZE_PX / 2;

	const rotateItems: FocusTransformHandleRenderItem[] = [
		createItem(frameScreen, {
			id: "rotate-top-left",
			handle: "rotate-top-left",
			kind: "rotate-corner",
			centerLocal: {
				x: -HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX,
				y: -HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX,
			},
			rectLocal: {
				x: -HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX - halfRotate,
				y: -HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX - halfRotate,
				width: FOCUS_SCENE_ROTATE_HIT_SIZE_PX,
				height: FOCUS_SCENE_ROTATE_HIT_SIZE_PX,
			},
			cursor: buildRotateCursor("rotate-top-left"),
			visibleCornerMarker: false,
		}),
		createItem(frameScreen, {
			id: "rotate-top-right",
			handle: "rotate-top-right",
			kind: "rotate-corner",
			centerLocal: {
				x: width + HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX,
				y: -HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX,
			},
			rectLocal: {
				x: width + HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX - halfRotate,
				y: -HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX - halfRotate,
				width: FOCUS_SCENE_ROTATE_HIT_SIZE_PX,
				height: FOCUS_SCENE_ROTATE_HIT_SIZE_PX,
			},
			cursor: buildRotateCursor("rotate-top-right"),
			visibleCornerMarker: false,
		}),
		createItem(frameScreen, {
			id: "rotate-bottom-right",
			handle: "rotate-bottom-right",
			kind: "rotate-corner",
			centerLocal: {
				x: width + HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX,
				y: height + HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX,
			},
			rectLocal: {
				x: width + HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX - halfRotate,
				y: height + HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX - halfRotate,
				width: FOCUS_SCENE_ROTATE_HIT_SIZE_PX,
				height: FOCUS_SCENE_ROTATE_HIT_SIZE_PX,
			},
			cursor: buildRotateCursor("rotate-bottom-right"),
			visibleCornerMarker: false,
		}),
		createItem(frameScreen, {
			id: "rotate-bottom-left",
			handle: "rotate-bottom-left",
			kind: "rotate-corner",
			centerLocal: {
				x: -HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX,
				y: height + HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX,
			},
			rectLocal: {
				x: -HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX - halfRotate,
				y: height + HALF_DIAGONAL * FOCUS_SCENE_ROTATE_OFFSET_PX - halfRotate,
				width: FOCUS_SCENE_ROTATE_HIT_SIZE_PX,
				height: FOCUS_SCENE_ROTATE_HIT_SIZE_PX,
			},
			cursor: buildRotateCursor("rotate-bottom-left"),
			visibleCornerMarker: false,
		}),
	];

	const cornerResizeItems: FocusTransformHandleRenderItem[] = [
		createItem(frameScreen, {
			id: "top-left",
			handle: "top-left",
			kind: "resize-corner",
			centerLocal: { x: 0, y: 0 },
			rectLocal: {
				x: -halfCorner,
				y: -halfCorner,
				width: FOCUS_SCENE_CORNER_HIT_SIZE_PX,
				height: FOCUS_SCENE_CORNER_HIT_SIZE_PX,
			},
			cursor: buildResizeCursor("top-left"),
			visibleCornerMarker: true,
		}),
		createItem(frameScreen, {
			id: "top-right",
			handle: "top-right",
			kind: "resize-corner",
			centerLocal: { x: width, y: 0 },
			rectLocal: {
				x: width - halfCorner,
				y: -halfCorner,
				width: FOCUS_SCENE_CORNER_HIT_SIZE_PX,
				height: FOCUS_SCENE_CORNER_HIT_SIZE_PX,
			},
			cursor: buildResizeCursor("top-right"),
			visibleCornerMarker: true,
		}),
		createItem(frameScreen, {
			id: "bottom-right",
			handle: "bottom-right",
			kind: "resize-corner",
			centerLocal: { x: width, y: height },
			rectLocal: {
				x: width - halfCorner,
				y: height - halfCorner,
				width: FOCUS_SCENE_CORNER_HIT_SIZE_PX,
				height: FOCUS_SCENE_CORNER_HIT_SIZE_PX,
			},
			cursor: buildResizeCursor("bottom-right"),
			visibleCornerMarker: true,
		}),
		createItem(frameScreen, {
			id: "bottom-left",
			handle: "bottom-left",
			kind: "resize-corner",
			centerLocal: { x: 0, y: height },
			rectLocal: {
				x: -halfCorner,
				y: height - halfCorner,
				width: FOCUS_SCENE_CORNER_HIT_SIZE_PX,
				height: FOCUS_SCENE_CORNER_HIT_SIZE_PX,
			},
			cursor: buildResizeCursor("bottom-left"),
			visibleCornerMarker: true,
		}),
	];

	const edgeResizeItems: FocusTransformHandleRenderItem[] = [
		createItem(frameScreen, {
			id: "top-center",
			handle: "top-center",
			kind: "resize-edge",
			centerLocal: { x: width / 2, y: 0 },
			rectLocal: {
				x: 0,
				y: -halfEdge,
				width,
				height: FOCUS_SCENE_EDGE_HIT_WIDTH_PX,
			},
			cursor: buildResizeCursor("top-center"),
			visibleCornerMarker: false,
		}),
		createItem(frameScreen, {
			id: "middle-right",
			handle: "middle-right",
			kind: "resize-edge",
			centerLocal: { x: width, y: height / 2 },
			rectLocal: {
				x: width - halfEdge,
				y: 0,
				width: FOCUS_SCENE_EDGE_HIT_WIDTH_PX,
				height,
			},
			cursor: buildResizeCursor("middle-right"),
			visibleCornerMarker: false,
		}),
		createItem(frameScreen, {
			id: "bottom-center",
			handle: "bottom-center",
			kind: "resize-edge",
			centerLocal: { x: width / 2, y: height },
			rectLocal: {
				x: 0,
				y: height - halfEdge,
				width,
				height: FOCUS_SCENE_EDGE_HIT_WIDTH_PX,
			},
			cursor: buildResizeCursor("bottom-center"),
			visibleCornerMarker: false,
		}),
		createItem(frameScreen, {
			id: "middle-left",
			handle: "middle-left",
			kind: "resize-edge",
			centerLocal: { x: 0, y: height / 2 },
			rectLocal: {
				x: -halfEdge,
				y: 0,
				width: FOCUS_SCENE_EDGE_HIT_WIDTH_PX,
				height,
			},
			cursor: buildResizeCursor("middle-left"),
			visibleCornerMarker: false,
		}),
	].filter((item) => {
		return resolveEdgeHandlesByMode(resizeHandleMode).includes(
			item.handle as FocusResizeHandle,
		);
	});

	return [...rotateItems, ...cornerResizeItems, ...edgeResizeItems];
};

const isPointInRect = (point: FocusPoint, rect: FocusRect): boolean => {
	return (
		point.x >= rect.x &&
		point.x <= rect.x + rect.width &&
		point.y >= rect.y &&
		point.y <= rect.y + rect.height
	);
};

const resolveHitPriority = (item: FocusTransformHandleRenderItem): number => {
	switch (item.kind) {
		case "resize-corner":
			return 2;
		case "rotate-corner":
			return 1;
		case "resize-edge":
			return 0;
		default:
			return 0;
	}
};

export const resolveFocusTransformHandleAtPoint = (
	frameScreen: FocusFrame,
	screenPoint: FocusPoint,
	items: FocusTransformHandleRenderItem[],
): FocusTransformHandleRenderItem | null => {
	const inverse = invertFocusMatrix(createFocusFrameMatrix(frameScreen));
	if (!inverse) return null;
	const localPoint = mapFocusPoint(inverse, screenPoint);
	const sortedItems = [...items].sort((left, right) => {
		return resolveHitPriority(right) - resolveHitPriority(left);
	});
	for (const item of sortedItems) {
		if (isPointInRect(localPoint, item.rectLocal)) {
			return item;
		}
	}
	return null;
};
