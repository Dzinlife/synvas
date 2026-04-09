import { buildTimelineBatchCommandFromSnapshots } from "core/editor/ot";
import {
	canvasPointToTransformPosition,
	transformPositionToCanvasPoint,
} from "core/element/position";
import type { TimelineElement, TransformMeta } from "core/element/types";
import type { SceneNode } from "core/studio/types";
import type React from "react";
import {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { SkiaPointerEvent, SkParagraph } from "react-skia-lite";
import { transformMetaToRenderLayout } from "@/element/layout";
import {
	componentRegistry,
	type ElementResizeBehavior,
} from "@/element/model/componentRegistry";
import { useProjectStore } from "@/projects/projectStore";
import type { TimelineStoreApi } from "@/scene-editor/contexts/TimelineContext";
import { EditorRuntimeContext } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import { cloneValue, createCopySeed } from "@/scene-editor/utils/copyUtils";
import { reflowInsertedElementsOnTracks } from "@/scene-editor/utils/insertedTrackReflow";
import { finalizeTimelineElements } from "@/scene-editor/utils/mainTrackMagnet";
import type { CameraState } from "@/studio/canvas/canvasWorkspaceUtils";
import {
	canRedoTextEditingLocalHistory,
	canUndoTextEditingLocalHistory,
	clearTextEditingLocalHistory,
	createTextEditingLocalHistory,
	createTextEditingSession,
	pushTextEditingLocalHistory,
	redoTextEditingLocalHistory,
	resolveTextEditingDecorations,
	resolveTextEditingIndexAtScreenPoint,
	resolveTextEditingOverlayRect,
	resolveTextEditingSelectionFromAnchor,
	type TextEditingLocalHistory,
	type TextEditingSelection,
	type TextEditingSession,
	type TextEditingTarget,
	undoTextEditingLocalHistory,
	updateTextEditingSessionComposition,
	updateTextEditingSessionDraft,
	updateTextEditingSessionSelection,
	updateTextEditingSessionTarget,
} from "@/studio/canvas/text-editing";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import {
	createFocusFrameMatrix,
	createFocusSceneCoordinateContext,
	FOCUS_SCENE_EPSILON,
	type FocusFrame,
	type FocusMatrix,
	type FocusPoint,
	type FocusRect,
	getFocusBoundingRect,
	getFocusFrameCorners,
	getFocusMatrixMetrics,
	invertFocusMatrix,
	isFocusPointInFrame,
	isFocusRectIntersect,
	mapFocusPoint,
	multiplyFocusMatrix,
	sceneToScreenPoint,
	screenToScenePoint,
} from "./focusSceneCoordinates";
import {
	buildFocusTransformHandleItems,
	type FocusResizeHandleMode,
	type FocusTransformHandle,
	type FocusTransformHandleRenderItem,
	isRotateHandle,
	resolveFocusTransformHandleAtPoint,
} from "./focusSceneHandleGeometry";

const SNAP_GUIDE_THRESHOLD_PX = 6;
const SNAP_GUIDE_MATCH_EPSILON = 1e-6;
const MIN_TRANSFORM_SIZE_PX = 5;

const POSITION_QUANTUM = 1e-6;
const SCALE_QUANTUM = 1e-6;
const ROTATION_QUANTUM = 1e-6;
const POSITION_INTEGER_SNAP_EPSILON = 1e-3;

type TimelineHistorySnapshot = {
	elements: TimelineElement[];
	tracks: ReturnType<TimelineStoreApi["getState"]>["tracks"];
	audioTrackStates: ReturnType<
		TimelineStoreApi["getState"]
	>["audioTrackStates"];
	rippleEditingEnabled: boolean;
};

type FocusSceneElementLayout = {
	element: TimelineElement;
	id: string;
	frameScene: FocusFrame;
	frameScreen: FocusFrame;
	boxScene: FocusRect;
};

type TextParagraphLike = {
	layout: (width: number) => void;
	getHeight: () => number;
};

const isTextParagraphLike = (value: unknown): value is TextParagraphLike => {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<TextParagraphLike>;
	return (
		typeof candidate.layout === "function" &&
		typeof candidate.getHeight === "function"
	);
};

const isSkParagraphLike = (value: unknown): value is SkParagraph => {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<SkParagraph>;
	return (
		typeof candidate.layout === "function" &&
		typeof candidate.getHeight === "function" &&
		typeof candidate.getGlyphPositionAtCoordinate === "function" &&
		typeof candidate.getRectsForRange === "function" &&
		typeof candidate.getLineMetrics === "function" &&
		typeof candidate.getGlyphInfoAt === "function"
	);
};

export type FocusSceneLabelItem = {
	id: string;
	screenX: number;
	screenY: number;
	screenWidth: number;
	screenHeight: number;
	canvasWidth: number;
	canvasHeight: number;
	rotationDeg: number;
};

export type FocusSnapGuides = {
	vertical: number[];
	horizontal: number[];
};

export type FocusSceneTextEditingDecorations = {
	frameScreen: FocusFrame;
	selectionRectsLocal: FocusRect[];
	compositionRectsLocal: FocusRect[];
	caretRectLocal: FocusRect | null;
};

export interface FocusSceneTextEditingBridgeState {
	sessionId: string;
	editingElementId: string;
	value: string;
	selection: TextEditingSelection;
	isComposing: boolean;
	canUndo: boolean;
	canRedo: boolean;
	overlayRectScreen: FocusRect;
	onValueChange: (value: string, selection: TextEditingSelection) => void;
	onSelectionChange: (selection: TextEditingSelection) => void;
	onCompositionStart: (selection: TextEditingSelection) => void;
	onCompositionUpdate: (selection: TextEditingSelection, data: string) => void;
	onCompositionEnd: (selection: TextEditingSelection, data: string) => void;
	onUndo: () => void;
	onRedo: () => void;
	onCommit: () => void;
	onCancel: () => void;
	onBlur: () => void;
}

export type { FocusTransformHandle, FocusTransformHandleRenderItem };

interface UseFocusSceneSkiaInteractionsOptions {
	width: number;
	height: number;
	camera: CameraState;
	focusedNode: SceneNode | null;
	sourceWidth: number;
	sourceHeight: number;
	interactiveElements: TimelineElement[];
	interactiveElementsRef: React.MutableRefObject<TimelineElement[]>;
	timelineStore: TimelineStoreApi | null;
	disabled?: boolean;
}

interface DragSession {
	kind: "drag";
	startScene: FocusPoint;
	anchorId: string;
	targetIds: string[];
	initialCenters: Record<string, FocusPoint>;
	initialBounds: FocusRect | null;
	historySnapshot: TimelineHistorySnapshot | null;
	copyMode: boolean;
	copyIds: string[];
	sourceIds: string[];
	changed: boolean;
	selectionFrameAtStart: FocusFrame | null;
}

interface MarqueeSession {
	kind: "marquee";
	startScene: FocusPoint;
	additive: boolean;
	initialSelectedIds: string[];
}

interface TransformElementSnapshot {
	id: string;
	matrix: FocusMatrix;
	frameScene: FocusFrame;
	transform: TransformMeta;
}

interface TransformSession {
	kind: "transform";
	handle: FocusTransformHandle;
	resizeBehavior: ElementResizeBehavior;
	baseFrameScene: FocusFrame;
	baseElements: TransformElementSnapshot[];
	startAngleRad: number;
	rotationSnapOffsetRad: number;
	historySnapshot: TimelineHistorySnapshot | null;
	changed: boolean;
}

type InteractionSession =
	| DragSession
	| MarqueeSession
	| TransformSession
	| null;

type TransformPointerInput = {
	x: number;
	y: number;
	altKey: boolean;
	shiftKey: boolean;
};

type EditableTextElement = TimelineElement & {
	type: "Text";
	transform: TransformMeta;
	props: {
		text: string;
	};
};

interface TextEditingRestoreSnapshot {
	id: string;
	text: string;
	transform: TransformMeta;
}

interface TextEditingHistorySession {
	historySnapshot: TimelineHistorySnapshot | null;
	restoreSnapshot: TextEditingRestoreSnapshot;
	localHistory: TextEditingLocalHistory;
}

const snapNearInteger = (value: number): number => {
	const rounded = Math.round(value);
	if (Math.abs(value - rounded) <= POSITION_INTEGER_SNAP_EPSILON) {
		return rounded;
	}
	return value;
};

const quantize = (value: number, quantum: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.round(value / quantum) * quantum;
};

const quantizeTransform = (transform: TransformMeta): TransformMeta => {
	return {
		...transform,
		position: {
			...transform.position,
			x: snapNearInteger(quantize(transform.position.x, POSITION_QUANTUM)),
			y: snapNearInteger(quantize(transform.position.y, POSITION_QUANTUM)),
		},
		scale: {
			x: quantize(transform.scale.x, SCALE_QUANTUM),
			y: quantize(transform.scale.y, SCALE_QUANTUM),
		},
		rotation: {
			...transform.rotation,
			value: quantize(transform.rotation.value, ROTATION_QUANTUM),
		},
	};
};

const isTransformChanged = (
	prev: TransformMeta,
	next: TransformMeta,
): boolean => {
	return (
		prev.baseSize.width !== next.baseSize.width ||
		prev.baseSize.height !== next.baseSize.height ||
		prev.position.x !== next.position.x ||
		prev.position.y !== next.position.y ||
		prev.scale.x !== next.scale.x ||
		prev.scale.y !== next.scale.y ||
		prev.rotation.value !== next.rotation.value
	);
};

const isFocusFrameEqual = (left: FocusFrame, right: FocusFrame): boolean => {
	return (
		Math.abs(left.cx - right.cx) <= FOCUS_SCENE_EPSILON &&
		Math.abs(left.cy - right.cy) <= FOCUS_SCENE_EPSILON &&
		Math.abs(left.width - right.width) <= FOCUS_SCENE_EPSILON &&
		Math.abs(left.height - right.height) <= FOCUS_SCENE_EPSILON &&
		Math.abs(left.rotationRad - right.rotationRad) <= FOCUS_SCENE_EPSILON
	);
};

const isTextEditingTargetEqual = (
	left: TextEditingTarget,
	right: TextEditingTarget,
): boolean => {
	return (
		left.id === right.id &&
		left.text === right.text &&
		left.paragraph === right.paragraph &&
		Math.abs(left.baseSize.width - right.baseSize.width) <=
			FOCUS_SCENE_EPSILON &&
		Math.abs(left.baseSize.height - right.baseSize.height) <=
			FOCUS_SCENE_EPSILON &&
		isFocusFrameEqual(left.frame, right.frame)
	);
};

const resolveScaleFromSize = (
	nextSize: number,
	baseSize: number,
	previousScale: number,
): number => {
	if (!Number.isFinite(baseSize) || Math.abs(baseSize) < FOCUS_SCENE_EPSILON) {
		return previousScale;
	}
	const sign = previousScale < 0 ? -1 : 1;
	return sign * (nextSize / baseSize);
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

const createFocusScaleMatrix = (
	scaleX: number,
	scaleY: number,
): FocusMatrix => {
	return {
		a: scaleX,
		b: 0,
		c: 0,
		d: scaleY,
		e: 0,
		f: 0,
	};
};

const createFocusFrameUnitMatrix = (frame: FocusFrame): FocusMatrix => {
	return multiplyFocusMatrix(
		multiplyFocusMatrix(
			multiplyFocusMatrix(
				createFocusTranslationMatrix(frame.cx, frame.cy),
				createFocusRotationMatrix(frame.rotationRad),
			),
			createFocusScaleMatrix(frame.width, frame.height),
		),
		createFocusTranslationMatrix(-0.5, -0.5),
	);
};

const createCopyElement = (
	source: TimelineElement,
	copyId: string,
): TimelineElement => {
	return {
		...source,
		id: copyId,
		props: cloneValue(source.props),
		transform: cloneValue(source.transform),
		render: cloneValue(source.render),
		timeline: { ...source.timeline },
		...(source.clip ? { clip: cloneValue(source.clip) } : {}),
	};
};

const hasTransform = (
	element: TimelineElement | null | undefined,
): element is TimelineElement & { transform: TransformMeta } => {
	return Boolean(element?.transform);
};

const isEditableTextElement = (
	element: TimelineElement | null | undefined,
): element is EditableTextElement => {
	if (!element || element.type !== "Text" || !hasTransform(element)) {
		return false;
	}
	return typeof (element.props as { text?: unknown })?.text === "string";
};

const appendUniqueGuideLine = (lines: number[], line: number) => {
	const exists = lines.some((item) => {
		return Math.abs(item - line) <= SNAP_GUIDE_MATCH_EPSILON;
	});
	if (!exists) {
		lines.push(line);
	}
};

const findNearestGuide = (values: number[], guides: number[]) => {
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
				if (Math.abs(distance - bestDistance) <= SNAP_GUIDE_MATCH_EPSILON) {
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

const normalizeAngleRad = (value: number): number => {
	let next = value;
	while (next <= -Math.PI) {
		next += Math.PI * 2;
	}
	while (next > Math.PI) {
		next -= Math.PI * 2;
	}
	return next;
};

const screenFrameToSceneFrame = (
	frameScreen: FocusFrame,
	stageScaleX: number,
	stageScaleY: number,
	centerScene: FocusPoint,
): FocusFrame => {
	return {
		cx: centerScene.x,
		cy: centerScene.y,
		width:
			frameScreen.width / Math.max(Math.abs(stageScaleX), FOCUS_SCENE_EPSILON),
		height:
			frameScreen.height / Math.max(Math.abs(stageScaleY), FOCUS_SCENE_EPSILON),
		rotationRad: frameScreen.rotationRad,
	};
};

const resolvePointerField = (
	event: SkiaPointerEvent,
	key: "button" | "buttons",
): number => {
	const value = event[key];
	if (!Number.isFinite(value)) return 0;
	return Number(value);
};

const resolveSnapThresholdScene = (
	stageScaleX: number,
	stageScaleY: number,
): number => {
	const reference = Math.max(
		Math.min(Math.abs(stageScaleX), Math.abs(stageScaleY)),
		FOCUS_SCENE_EPSILON,
	);
	return SNAP_GUIDE_THRESHOLD_PX / reference;
};

const resolveMinTransformSizeScene = (
	stageScaleX: number,
	stageScaleY: number,
): number => {
	const reference = Math.max(
		Math.min(Math.abs(stageScaleX), Math.abs(stageScaleY)),
		FOCUS_SCENE_EPSILON,
	);
	return MIN_TRANSFORM_SIZE_PX / reference;
};

const resolveTrackIndex = (element: TimelineElement): number => {
	return element.timeline.trackIndex ?? 0;
};

const resolveTopHitElement = (
	point: FocusPoint,
	layouts: FocusSceneElementLayout[],
): FocusSceneElementLayout | null => {
	for (let index = layouts.length - 1; index >= 0; index -= 1) {
		const layout = layouts[index];
		if (!layout) continue;
		if (isFocusPointInFrame(point, layout.frameScreen)) {
			return layout;
		}
	}
	return null;
};

const resolveSelectionFrameScene = (
	layouts: FocusSceneElementLayout[],
	selectedIds: string[],
): FocusFrame | null => {
	const selectedLayouts = layouts.filter((layout) =>
		selectedIds.includes(layout.id),
	);
	if (selectedLayouts.length === 0) {
		return null;
	}
	if (selectedLayouts.length === 1) {
		return selectedLayouts[0]?.frameScene ?? null;
	}
	const corners = selectedLayouts.flatMap((layout) =>
		getFocusFrameCorners(layout.frameScene),
	);
	const bounds = getFocusBoundingRect(corners);
	return {
		cx: bounds.x + bounds.width / 2,
		cy: bounds.y + bounds.height / 2,
		width: bounds.width,
		height: bounds.height,
		rotationRad: 0,
	};
};

const resolveSelectionFrameScreen = (
	selectionFrameScene: FocusFrame | null,
	ctx: ReturnType<typeof createFocusSceneCoordinateContext> | null,
): FocusFrame | null => {
	if (!selectionFrameScene) return null;
	if (!ctx) return null;
	const centerScreen = sceneToScreenPoint(ctx, {
		x: selectionFrameScene.cx,
		y: selectionFrameScene.cy,
	});
	return {
		cx: centerScreen.x,
		cy: centerScreen.y,
		width: selectionFrameScene.width * Math.abs(ctx.stageScaleX),
		height: selectionFrameScene.height * Math.abs(ctx.stageScaleY),
		rotationRad: selectionFrameScene.rotationRad,
	};
};

const resolveElementResizeBehavior = (
	element: TimelineElement | undefined,
): ElementResizeBehavior => {
	if (!element) return "default";
	const definition = componentRegistry.get(element.component);
	return definition?.meta.resizeBehavior ?? "default";
};

const resolveSelectionResizeBehavior = ({
	selectedIds,
	layouts,
}: {
	selectedIds: string[];
	layouts: FocusSceneElementLayout[];
}): ElementResizeBehavior => {
	if (selectedIds.length !== 1) return "default";
	const selectedId = selectedIds[0];
	if (!selectedId) return "default";
	const selectedLayout = layouts.find((layout) => layout.id === selectedId);
	return resolveElementResizeBehavior(selectedLayout?.element);
};

const resolveResizeHandleMode = (
	behavior: ElementResizeBehavior,
): FocusResizeHandleMode => {
	if (behavior === "text-width-reflow") {
		return "horizontal-only";
	}
	return "default";
};

const resolveTimelineModelRegistry = ({
	runtimeManager,
	timelineStore,
}: {
	runtimeManager: StudioRuntimeManager | null;
	timelineStore: TimelineStoreApi | null;
}) => {
	if (!runtimeManager || !timelineStore) return null;
	const runtime = runtimeManager
		.listTimelineRuntimes()
		.find((item) => item.timelineStore === timelineStore);
	return runtime?.modelRegistry ?? null;
};

const resolveTextReflowHeightFromModel = ({
	modelRegistry,
	elementId,
	baseWidth,
}: {
	modelRegistry: ReturnType<typeof resolveTimelineModelRegistry>;
	elementId: string;
	baseWidth: number;
}): number | null => {
	if (!modelRegistry) return null;
	const modelStore = modelRegistry.get(elementId);
	if (!modelStore) return null;
	const internal = (modelStore.getState() as { internal?: unknown }).internal;
	if (!internal || typeof internal !== "object") return null;
	const paragraph = (internal as { paragraph?: unknown }).paragraph;
	if (!isTextParagraphLike(paragraph)) return null;
	try {
		paragraph.layout(baseWidth);
		const height = paragraph.getHeight();
		if (!Number.isFinite(height)) return null;
		return height;
	} catch (_error) {
		return null;
	}
};

const resolveTextSideResizeFrameScreen = (params: {
	baseFrameScreen: FocusFrame;
	handle: FocusTransformHandle;
	pointerScreen: FocusPoint;
	centered: boolean;
}): FocusFrame | null => {
	const { baseFrameScreen, handle, pointerScreen, centered } = params;
	if (isRotateHandle(handle)) return null;
	if (handle !== "middle-left" && handle !== "middle-right") return null;
	const baseMatrix = createFocusFrameMatrix(baseFrameScreen);
	const inverse = invertFocusMatrix(baseMatrix);
	if (!inverse) return null;
	const pointerLocal = mapFocusPoint(inverse, pointerScreen);
	const originCenterX = baseFrameScreen.width / 2;
	const minWidth = MIN_TRANSFORM_SIZE_PX;
	let left = 0;
	let right = baseFrameScreen.width;
	if (centered) {
		const halfWidth = Math.max(
			minWidth / 2,
			Math.abs(pointerLocal.x - originCenterX),
		);
		left = originCenterX - halfWidth;
		right = originCenterX + halfWidth;
	} else if (handle === "middle-right") {
		right = Math.max(pointerLocal.x, minWidth);
	} else {
		left = Math.min(pointerLocal.x, baseFrameScreen.width - minWidth);
	}
	const nextLocalCenter = {
		x: (left + right) / 2,
		y: baseFrameScreen.height / 2,
	};
	const nextScreenCenter = mapFocusPoint(baseMatrix, nextLocalCenter);
	return {
		cx: nextScreenCenter.x,
		cy: nextScreenCenter.y,
		width: Math.max(minWidth, right - left),
		height: Math.max(MIN_TRANSFORM_SIZE_PX, baseFrameScreen.height),
		rotationRad: baseFrameScreen.rotationRad,
	};
};

const resolveResizeAnchorDelta = (params: {
	baseFrameScreen: FocusFrame;
	handle: FocusTransformHandle;
	pointerScreen: FocusPoint;
	centered: boolean;
}): {
	frameScreen: FocusFrame;
	scaleSignX: number;
	scaleSignY: number;
} | null => {
	const { baseFrameScreen, handle, pointerScreen, centered } = params;
	if (isRotateHandle(handle)) {
		return null;
	}
	const baseMatrix = createFocusFrameMatrix(baseFrameScreen);
	const inverse = invertFocusMatrix(baseMatrix);
	if (!inverse) return null;
	const pointerLocal = mapFocusPoint(inverse, pointerScreen);
	const originCenterX = baseFrameScreen.width / 2;
	const originCenterY = baseFrameScreen.height / 2;

	const moveLeft = handle.includes("left");
	const moveRight = handle.includes("right");
	const moveTop = handle.includes("top");
	const moveBottom = handle.includes("bottom");
	const moveCenterX = handle === "top-center" || handle === "bottom-center";
	const moveCenterY = handle === "middle-left" || handle === "middle-right";
	const isCorner =
		(moveLeft || moveRight) &&
		(moveTop || moveBottom) &&
		!moveCenterX &&
		!moveCenterY;

	let left = 0;
	let right = baseFrameScreen.width;
	let top = 0;
	let bottom = baseFrameScreen.height;
	let scaleSignX = 1;
	let scaleSignY = 1;

	if (moveLeft || moveRight || moveCenterX) {
		if (centered && (moveLeft || moveRight)) {
			const halfWidth = Math.abs(pointerLocal.x - originCenterX);
			left = originCenterX - halfWidth;
			right = originCenterX + halfWidth;
			const direction = pointerLocal.x - originCenterX;
			if (Math.abs(direction) > FOCUS_SCENE_EPSILON) {
				const baseDir = moveRight ? 1 : -1;
				scaleSignX = direction * baseDir >= 0 ? 1 : -1;
			}
		} else if (moveLeft) {
			left = pointerLocal.x;
			scaleSignX = pointerLocal.x <= right ? 1 : -1;
		} else if (moveRight) {
			right = pointerLocal.x;
			scaleSignX = pointerLocal.x >= left ? 1 : -1;
		}
	}

	if (moveTop || moveBottom || moveCenterY) {
		if (centered && (moveTop || moveBottom)) {
			const halfHeight = Math.abs(pointerLocal.y - originCenterY);
			top = originCenterY - halfHeight;
			bottom = originCenterY + halfHeight;
			const direction = pointerLocal.y - originCenterY;
			if (Math.abs(direction) > FOCUS_SCENE_EPSILON) {
				const baseDir = moveBottom ? 1 : -1;
				scaleSignY = direction * baseDir >= 0 ? 1 : -1;
			}
		} else if (moveTop) {
			top = pointerLocal.y;
			scaleSignY = pointerLocal.y <= bottom ? 1 : -1;
		} else if (moveBottom) {
			bottom = pointerLocal.y;
			scaleSignY = pointerLocal.y >= top ? 1 : -1;
		}
	}

	let width = Math.abs(right - left);
	let height = Math.abs(bottom - top);

	if (isCorner && baseFrameScreen.height > FOCUS_SCENE_EPSILON) {
		const safeBaseWidth = Math.max(baseFrameScreen.width, FOCUS_SCENE_EPSILON);
		const safeBaseHeight = Math.max(
			baseFrameScreen.height,
			FOCUS_SCENE_EPSILON,
		);
		const scaleX = width / safeBaseWidth;
		const scaleY = height / safeBaseHeight;
		const scale = Math.max((scaleX + scaleY) / 2, 0);
		width = baseFrameScreen.width * scale;
		height = baseFrameScreen.height * scale;

		if (centered) {
			left = originCenterX - width / 2;
			right = originCenterX + width / 2;
			top = originCenterY - height / 2;
			bottom = originCenterY + height / 2;
		} else {
			const fixedX = moveLeft ? right : left;
			const fixedY = moveTop ? bottom : top;
			if (moveLeft) {
				if (scaleSignX >= 0) {
					left = fixedX - width;
					right = fixedX;
				} else {
					left = fixedX;
					right = fixedX + width;
				}
			} else {
				if (scaleSignX >= 0) {
					left = fixedX;
					right = fixedX + width;
				} else {
					left = fixedX - width;
					right = fixedX;
				}
			}
			if (moveTop) {
				if (scaleSignY >= 0) {
					top = fixedY - height;
					bottom = fixedY;
				} else {
					top = fixedY;
					bottom = fixedY + height;
				}
			} else {
				if (scaleSignY >= 0) {
					top = fixedY;
					bottom = fixedY + height;
				} else {
					top = fixedY - height;
					bottom = fixedY;
				}
			}
		}
	}

	const nextLocalCenter = {
		x: (left + right) / 2,
		y: (top + bottom) / 2,
	};
	const nextScreenCenter = mapFocusPoint(baseMatrix, nextLocalCenter);

	return {
		frameScreen: {
			cx: nextScreenCenter.x,
			cy: nextScreenCenter.y,
			width: Math.max(0, width),
			height: Math.max(0, height),
			rotationRad: baseFrameScreen.rotationRad,
		},
		scaleSignX,
		scaleSignY,
	};
};

const frameToAxisRect = (frame: FocusFrame): FocusRect => {
	return {
		x: frame.cx - frame.width / 2,
		y: frame.cy - frame.height / 2,
		width: frame.width,
		height: frame.height,
	};
};

const axisRectToFrame = (rect: FocusRect, rotationRad: number): FocusFrame => {
	return {
		cx: rect.x + rect.width / 2,
		cy: rect.y + rect.height / 2,
		width: rect.width,
		height: rect.height,
		rotationRad,
	};
};

export interface UseFocusSceneSkiaInteractionsResult {
	elementLayouts: FocusSceneElementLayout[];
	selectedIds: string[];
	hoveredId: string | null;
	draggingId: string | null;
	editingElementId: string | null;
	textEditingDecorations: FocusSceneTextEditingDecorations | null;
	textEditingBridgeState: FocusSceneTextEditingBridgeState | null;
	selectionRectScreen: FocusRect | null;
	snapGuidesScreen: FocusSnapGuides;
	selectionFrameScreen: FocusFrame | null;
	handleItems: FocusTransformHandleRenderItem[];
	activeHandle: FocusTransformHandle | null;
	labelItems: FocusSceneLabelItem[];
	onLayerPointerDown: (event: SkiaPointerEvent) => void;
	onLayerDoubleClick: (event: SkiaPointerEvent) => void;
	onLayerPointerMove: (event: SkiaPointerEvent) => void;
	onLayerPointerUp: (event: SkiaPointerEvent) => void;
	onLayerPointerLeave: () => void;
}

export const useFocusSceneSkiaInteractions = ({
	width,
	height,
	camera,
	focusedNode,
	sourceWidth,
	sourceHeight,
	interactiveElements,
	interactiveElementsRef,
	timelineStore,
	disabled = false,
}: UseFocusSceneSkiaInteractionsOptions): UseFocusSceneSkiaInteractionsResult => {
	const editorRuntime = useContext(EditorRuntimeContext);
	const runtimeManager = useMemo<StudioRuntimeManager | null>(() => {
		const manager = editorRuntime as Partial<StudioRuntimeManager> | null;
		if (!manager?.listTimelineRuntimes) return null;
		return manager as StudioRuntimeManager;
	}, [editorRuntime]);
	const pushHistory = useStudioHistoryStore((state) => state.push);
	const ctx = useMemo(() => {
		if (!focusedNode) return null;
		return createFocusSceneCoordinateContext({
			camera,
			focusedNode,
			sourceWidth,
			sourceHeight,
		});
	}, [camera, focusedNode, sourceHeight, sourceWidth]);

	const [selectedIds, setSelectedIdsState] = useState<string[]>(() => {
		return timelineStore?.getState().selectedIds ?? [];
	});
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [selectionRectScene, setSelectionRectScene] =
		useState<FocusRect | null>(null);
	const [snapGuidesScene, setSnapGuidesScene] = useState<FocusSnapGuides>({
		vertical: [],
		horizontal: [],
	});
	const [selectionFrameSceneOverride, setSelectionFrameSceneOverride] =
		useState<FocusFrame | null>(null);
	const [activeHandle, setActiveHandle] = useState<FocusTransformHandle | null>(
		null,
	);
	const [textEditingSessionState, setTextEditingSessionState] =
		useState<TextEditingSession | null>(null);
	const interactionSessionRef = useRef<InteractionSession>(null);
	const transformPointerInputRef = useRef<TransformPointerInput | null>(null);
	const selectionFrameOverrideSelectionKeyRef = useRef<string | null>(null);
	const selectionFrameSceneOverrideRef = useRef<FocusFrame | null>(null);
	const textEditingSessionRef = useRef<TextEditingSession | null>(null);
	const textEditingHistorySessionRef = useRef<TextEditingHistorySession | null>(
		null,
	);
	const textEditingSelectionAnchorRef = useRef<number | null>(null);
	const textEditingPointerSelectingRef = useRef(false);
	const selectedIdsKey = useMemo(() => {
		return [...selectedIds].sort().join("|");
	}, [selectedIds]);

	const applySelectionFrameOverride = useCallback(
		(frame: FocusFrame | null) => {
			setSelectionFrameSceneOverride(frame);
			selectionFrameOverrideSelectionKeyRef.current = frame
				? selectedIdsKey
				: null;
		},
		[selectedIdsKey],
	);

	useEffect(() => {
		if (!timelineStore) {
			setSelectedIdsState([]);
			return;
		}
		return timelineStore.subscribe(
			(state) => state.selectedIds,
			(nextSelectedIds) => {
				setSelectedIdsState(nextSelectedIds);
			},
			{ fireImmediately: true },
		);
	}, [timelineStore]);

	useEffect(() => {
		selectionFrameSceneOverrideRef.current = selectionFrameSceneOverride;
	}, [selectionFrameSceneOverride]);

	useEffect(() => {
		textEditingSessionRef.current = textEditingSessionState;
	}, [textEditingSessionState]);

	useEffect(() => {
		if (!timelineStore) return;
		return timelineStore.subscribe(
			(state) => state.elements,
			() => {
				if (interactionSessionRef.current) return;
				if (!selectionFrameSceneOverrideRef.current) return;
				applySelectionFrameOverride(null);
			},
		);
	}, [applySelectionFrameOverride, timelineStore]);

	const captureHistorySnapshot =
		useCallback((): TimelineHistorySnapshot | null => {
			if (!timelineStore) return null;
			const state = timelineStore.getState();
			return {
				elements: state.elements,
				tracks: state.tracks,
				audioTrackStates: state.audioTrackStates,
				rippleEditingEnabled: state.rippleEditingEnabled,
			};
		}, [timelineStore]);

	const resolveHistorySceneId = useCallback((): string | null => {
		if (!timelineStore) return null;
		const runtime = runtimeManager
			?.listTimelineRuntimes()
			.find((item) => item.timelineStore === timelineStore);
		if (runtime?.ref.sceneId) return runtime.ref.sceneId;
		if (focusedNode?.sceneId) return focusedNode.sceneId;
		return useProjectStore.getState().currentProject?.ui.activeSceneId ?? null;
	}, [focusedNode?.sceneId, runtimeManager, timelineStore]);

	const pushHistorySnapshot = useCallback(
		(snapshot: TimelineHistorySnapshot | null) => {
			if (!snapshot) return;
			if (!timelineStore) return;
			const sceneId = resolveHistorySceneId();
			if (!sceneId) return;
			const state = timelineStore.getState();
			if (state.elements === snapshot.elements) return;
			const command = buildTimelineBatchCommandFromSnapshots({
				before: snapshot,
				after: {
					elements: state.elements,
					tracks: state.tracks,
					audioTrackStates: state.audioTrackStates,
					rippleEditingEnabled: state.rippleEditingEnabled,
				},
			});
			if (!command) return;
			pushHistory({
				kind: "timeline.ot",
				timelineRef: {
					kind: "scene",
					sceneId,
				},
				sceneId,
				command,
				intent: "root",
			});
		},
		[pushHistory, resolveHistorySceneId, timelineStore],
	);

	const setElementsWithoutHistory = useCallback(
		(
			elements:
				| TimelineElement[]
				| ((previous: TimelineElement[]) => TimelineElement[]),
		) => {
			if (!timelineStore) return;
			timelineStore.getState().setElements(elements, { history: false });
		},
		[timelineStore],
	);

	const setSelection = useCallback(
		(ids: string[], primaryId?: string | null) => {
			if (!timelineStore) return;
			timelineStore.getState().setSelectedIds(ids, primaryId);
		},
		[timelineStore],
	);

	const reconcileCopyDragElements = useCallback(
		(copyIds: string[]) => {
			if (!timelineStore || copyIds.length === 0) return;
			const copyIdSet = new Set(copyIds);
			const state = timelineStore.getState();
			const baseElements = state.elements.filter(
				(element) => !copyIdSet.has(element.id),
			);
			const copiedElements = state.elements.filter((element) =>
				copyIdSet.has(element.id),
			);
			if (copiedElements.length === 0) return;

			// 复制拖拽提交时，副本需要按插入元素规则重新分配轨道，避免与源元素时间重叠。
			const reflowedCopies = reflowInsertedElementsOnTracks(
				baseElements,
				copiedElements,
			);
			const finalized = finalizeTimelineElements(
				[...baseElements, ...reflowedCopies],
				{
					rippleEditingEnabled: state.rippleEditingEnabled,
					fps: state.fps,
				},
			);
			setElementsWithoutHistory(finalized);
		},
		[setElementsWithoutHistory, timelineStore],
	);

	const modelCenterToSceneCenter = useCallback(
		(position: { x: number; y: number }): FocusPoint => {
			const { canvasX, canvasY } = transformPositionToCanvasPoint(
				position.x,
				position.y,
				{ width: sourceWidth, height: sourceHeight },
				{ width: sourceWidth, height: sourceHeight },
			);
			return {
				x: canvasX,
				y: canvasY,
			};
		},
		[sourceHeight, sourceWidth],
	);

	const sceneCenterToModelPosition = useCallback(
		(sceneCenter: FocusPoint) => {
			return canvasPointToTransformPosition(
				sceneCenter.x,
				sceneCenter.y,
				{ width: sourceWidth, height: sourceHeight },
				{ width: sourceWidth, height: sourceHeight },
			);
		},
		[sourceHeight, sourceWidth],
	);

	const elementLayouts = useMemo<FocusSceneElementLayout[]>(() => {
		if (!ctx) return [];
		const result: FocusSceneElementLayout[] = [];
		for (const element of interactiveElements) {
			if (!hasTransform(element)) continue;
			const renderLayout = transformMetaToRenderLayout(
				element.transform,
				{ width: sourceWidth, height: sourceHeight },
				{ width: sourceWidth, height: sourceHeight },
			);
			const frameScene: FocusFrame = {
				cx: renderLayout.cx,
				cy: renderLayout.cy,
				width: renderLayout.w,
				height: renderLayout.h,
				rotationRad: renderLayout.rotation,
			};
			const centerScreen = sceneToScreenPoint(ctx, {
				x: frameScene.cx,
				y: frameScene.cy,
			});
			const frameScreen: FocusFrame = {
				cx: centerScreen.x,
				cy: centerScreen.y,
				width: frameScene.width * Math.abs(ctx.stageScaleX),
				height: frameScene.height * Math.abs(ctx.stageScaleY),
				rotationRad: frameScene.rotationRad,
			};
			result.push({
				element,
				id: element.id,
				frameScene,
				frameScreen,
				boxScene: getFocusBoundingRect(getFocusFrameCorners(frameScene)),
			});
		}
		return result;
	}, [ctx, interactiveElements, sourceHeight, sourceWidth]);

	const timelineModelRegistry = useMemo(() => {
		return resolveTimelineModelRegistry({
			runtimeManager,
			timelineStore,
		});
	}, [runtimeManager, timelineStore]);

	const resolveTextEditingTargetFromLayout = useCallback(
		(layout: FocusSceneElementLayout | null): TextEditingTarget | null => {
			if (!layout) return null;
			if (!isEditableTextElement(layout.element)) return null;
			if (!timelineModelRegistry) return null;
			const modelStore = timelineModelRegistry.get(layout.id);
			if (!modelStore) return null;
			const internal = (modelStore.getState() as { internal?: unknown })
				.internal;
			if (!internal || typeof internal !== "object") return null;
			const paragraph = (internal as { paragraph?: unknown }).paragraph;
			if (!isSkParagraphLike(paragraph)) return null;
			const baseWidth = Math.max(1, layout.element.transform.baseSize.width);
			try {
				paragraph.layout(baseWidth);
			} catch {
				// 段落布局失败时跳过编辑态，避免引入不可恢复状态。
				return null;
			}
			return {
				id: layout.id,
				text: layout.element.props.text,
				paragraph,
				frame: layout.frameScreen,
				baseSize: {
					width: layout.element.transform.baseSize.width,
					height: layout.element.transform.baseSize.height,
				},
			};
		},
		[timelineModelRegistry],
	);

	const resolveTextEditingTargetById = useCallback(
		(elementId: string): TextEditingTarget | null => {
			const layout =
				elementLayouts.find((item) => item.id === elementId) ?? null;
			return resolveTextEditingTargetFromLayout(layout);
		},
		[elementLayouts, resolveTextEditingTargetFromLayout],
	);

	const resolveTextEditingTargetAtPoint = useCallback(
		(screenPoint: FocusPoint): TextEditingTarget | null => {
			const hitLayout = resolveTopHitElement(screenPoint, elementLayouts);
			return resolveTextEditingTargetFromLayout(hitLayout);
		},
		[elementLayouts, resolveTextEditingTargetFromLayout],
	);

	const applyTextEditingDraftToTimeline = useCallback(
		(elementId: string, nextText: string) => {
			setElementsWithoutHistory((previousElements) => {
				let changed = false;
				const nextElements = previousElements.map((element) => {
					if (element.id !== elementId) return element;
					if (!isEditableTextElement(element)) return element;
					const nextPropsText = nextText;
					const reflowHeight = resolveTextReflowHeightFromModel({
						modelRegistry: timelineModelRegistry,
						elementId,
						baseWidth: element.transform.baseSize.width,
					});
					const nextTransform =
						reflowHeight !== null &&
						Math.abs(reflowHeight - element.transform.baseSize.height) >
							FOCUS_SCENE_EPSILON
							? {
									...element.transform,
									baseSize: {
										...element.transform.baseSize,
										height: reflowHeight,
									},
								}
							: element.transform;
					if (
						element.props.text === nextPropsText &&
						nextTransform === element.transform
					) {
						return element;
					}
					changed = true;
					return {
						...element,
						props:
							element.props.text === nextPropsText
								? element.props
								: {
										...element.props,
										text: nextPropsText,
									},
						transform: nextTransform,
					};
				});
				return changed ? nextElements : previousElements;
			});
		},
		[setElementsWithoutHistory, timelineModelRegistry],
	);

	const finishTextEditingSession = useCallback(
		(mode: "commit" | "cancel") => {
			const historySession = textEditingHistorySessionRef.current;
			textEditingHistorySessionRef.current = null;
			textEditingSelectionAnchorRef.current = null;
			textEditingPointerSelectingRef.current = false;
			setTextEditingSessionState(null);
			if (!historySession) return;
			if (mode === "cancel") {
				const { restoreSnapshot } = historySession;
				setElementsWithoutHistory((previousElements) => {
					let changed = false;
					const nextElements = previousElements.map((element) => {
						if (element.id !== restoreSnapshot.id) return element;
						if (!isEditableTextElement(element)) return element;
						const sameText = element.props.text === restoreSnapshot.text;
						const sameBaseSize =
							Math.abs(
								element.transform.baseSize.width -
									restoreSnapshot.transform.baseSize.width,
							) <= FOCUS_SCENE_EPSILON &&
							Math.abs(
								element.transform.baseSize.height -
									restoreSnapshot.transform.baseSize.height,
							) <= FOCUS_SCENE_EPSILON;
						if (sameText && sameBaseSize) {
							return element;
						}
						changed = true;
						return {
							...element,
							props: {
								...element.props,
								text: restoreSnapshot.text,
							},
							transform: cloneValue(restoreSnapshot.transform),
						};
					});
					return changed ? nextElements : previousElements;
				});
				return;
			}
			historySession.localHistory = clearTextEditingLocalHistory(
				historySession.localHistory,
			);
			pushHistorySnapshot(historySession.historySnapshot);
		},
		[pushHistorySnapshot, setElementsWithoutHistory],
	);

	const beginTextEditingSession = useCallback(
		(target: TextEditingTarget, selection: TextEditingSelection) => {
			if (!timelineStore) return;
			const currentSession = textEditingSessionRef.current;
			if (!currentSession || currentSession.target.id !== target.id) {
				const sourceElement = timelineStore
					.getState()
					.elements.find((element) => element.id === target.id);
				if (!isEditableTextElement(sourceElement)) return;
				textEditingHistorySessionRef.current = {
					historySnapshot: captureHistorySnapshot(),
					restoreSnapshot: {
						id: sourceElement.id,
						text: sourceElement.props.text,
						transform: cloneValue(sourceElement.transform),
					},
					localHistory: createTextEditingLocalHistory(),
				};
			}
			interactionSessionRef.current = null;
			transformPointerInputRef.current = null;
			setSelectionRectScene(null);
			setSnapGuidesScene({ vertical: [], horizontal: [] });
			setDraggingId(null);
			setActiveHandle(null);
			applySelectionFrameOverride(null);
			setSelection([target.id], target.id);
			setTextEditingSessionState((previousSession) => {
				if (previousSession && previousSession.target.id === target.id) {
					const withTarget = updateTextEditingSessionTarget(
						previousSession,
						target,
					);
					return updateTextEditingSessionSelection(withTarget, selection);
				}
				return createTextEditingSession({
					target,
					selection,
				});
			});
			textEditingSelectionAnchorRef.current = selection.end;
		},
		[
			applySelectionFrameOverride,
			captureHistorySnapshot,
			setSelection,
			timelineStore,
		],
	);

	const beginTextEditingPointerSelection = useCallback(
		(screenPoint: FocusPoint, extendSelection: boolean) => {
			const session = textEditingSessionRef.current;
			if (!session) return;
			const focusIndex = resolveTextEditingIndexAtScreenPoint(
				session,
				screenPoint,
			);
			const anchorIndex = extendSelection
				? (textEditingSelectionAnchorRef.current ?? session.selection.start)
				: focusIndex;
			const nextSelection = extendSelection
				? resolveTextEditingSelectionFromAnchor(anchorIndex, focusIndex)
				: {
						start: focusIndex,
						end: focusIndex,
						direction: "none" as const,
					};
			textEditingSelectionAnchorRef.current = anchorIndex;
			setTextEditingSessionState((previousSession) => {
				if (!previousSession) return previousSession;
				return updateTextEditingSessionSelection(
					previousSession,
					nextSelection,
				);
			});
		},
		[],
	);

	const handleTextEditingValueChange = useCallback(
		(value: string, selection: TextEditingSelection) => {
			const currentSession = textEditingSessionRef.current;
			if (!currentSession) return;
			textEditingSelectionAnchorRef.current = selection.end;
			setTextEditingSessionState((previousSession) => {
				if (!previousSession) return previousSession;
				if (previousSession.draftText !== value) {
					const historySession = textEditingHistorySessionRef.current;
					if (historySession) {
						historySession.localHistory = pushTextEditingLocalHistory(
							historySession.localHistory,
							{
								text: previousSession.draftText,
								selection: previousSession.selection,
							},
						);
					}
				}
				const nextSession = updateTextEditingSessionDraft(previousSession, {
					draftText: value,
					selection,
				});
				return nextSession;
			});
			applyTextEditingDraftToTimeline(currentSession.target.id, value);
		},
		[applyTextEditingDraftToTimeline],
	);

	const handleTextEditingSelectionChange = useCallback(
		(selection: TextEditingSelection) => {
			textEditingSelectionAnchorRef.current = selection.end;
			setTextEditingSessionState((previousSession) => {
				if (!previousSession) return previousSession;
				return updateTextEditingSessionSelection(previousSession, selection);
			});
		},
		[],
	);

	const handleTextEditingUndo = useCallback(() => {
		const currentSession = textEditingSessionRef.current;
		const historySession = textEditingHistorySessionRef.current;
		if (!currentSession || !historySession) return;
		const undoResult = undoTextEditingLocalHistory(
			historySession.localHistory,
			{
				text: currentSession.draftText,
				selection: currentSession.selection,
			},
		);
		const snapshot = undoResult.snapshot;
		if (!snapshot) return;
		historySession.localHistory = undoResult.history;
		textEditingSelectionAnchorRef.current = snapshot.selection.end;
		setTextEditingSessionState((previousSession) => {
			if (!previousSession) return previousSession;
			const withDraft = updateTextEditingSessionDraft(previousSession, {
				draftText: snapshot.text,
				selection: snapshot.selection,
			});
			return updateTextEditingSessionComposition(withDraft, null);
		});
		applyTextEditingDraftToTimeline(currentSession.target.id, snapshot.text);
	}, [applyTextEditingDraftToTimeline]);

	const handleTextEditingRedo = useCallback(() => {
		const currentSession = textEditingSessionRef.current;
		const historySession = textEditingHistorySessionRef.current;
		if (!currentSession || !historySession) return;
		const redoResult = redoTextEditingLocalHistory(
			historySession.localHistory,
			{
				text: currentSession.draftText,
				selection: currentSession.selection,
			},
		);
		const snapshot = redoResult.snapshot;
		if (!snapshot) return;
		historySession.localHistory = redoResult.history;
		textEditingSelectionAnchorRef.current = snapshot.selection.end;
		setTextEditingSessionState((previousSession) => {
			if (!previousSession) return previousSession;
			const withDraft = updateTextEditingSessionDraft(previousSession, {
				draftText: snapshot.text,
				selection: snapshot.selection,
			});
			return updateTextEditingSessionComposition(withDraft, null);
		});
		applyTextEditingDraftToTimeline(currentSession.target.id, snapshot.text);
	}, [applyTextEditingDraftToTimeline]);

	const textEditingHistoryState = textEditingHistorySessionRef.current;
	const textEditingCanUndo = textEditingHistoryState
		? canUndoTextEditingLocalHistory(textEditingHistoryState.localHistory)
		: false;
	const textEditingCanRedo = textEditingHistoryState
		? canRedoTextEditingLocalHistory(textEditingHistoryState.localHistory)
		: false;

	const handleTextEditingCompositionStart = useCallback(
		(selection: TextEditingSelection) => {
			textEditingSelectionAnchorRef.current = selection.end;
			setTextEditingSessionState((previousSession) => {
				if (!previousSession) return previousSession;
				const withSelection = updateTextEditingSessionSelection(
					previousSession,
					selection,
				);
				return updateTextEditingSessionComposition(withSelection, selection);
			});
		},
		[],
	);

	const handleTextEditingCompositionUpdate = useCallback(
		(selection: TextEditingSelection, _data?: string) => {
			textEditingSelectionAnchorRef.current = selection.end;
			setTextEditingSessionState((previousSession) => {
				if (!previousSession) return previousSession;
				const withSelection = updateTextEditingSessionSelection(
					previousSession,
					selection,
				);
				return updateTextEditingSessionComposition(withSelection, selection);
			});
		},
		[],
	);

	const handleTextEditingCompositionEnd = useCallback(
		(selection: TextEditingSelection, _data?: string) => {
			textEditingSelectionAnchorRef.current = selection.end;
			setTextEditingSessionState((previousSession) => {
				if (!previousSession) return previousSession;
				const withSelection = updateTextEditingSessionSelection(
					previousSession,
					selection,
				);
				return updateTextEditingSessionComposition(withSelection, null);
			});
		},
		[],
	);

	const textEditingDecorations =
		useMemo<FocusSceneTextEditingDecorations | null>(() => {
			if (!textEditingSessionState) return null;
			const decorations = resolveTextEditingDecorations(
				textEditingSessionState,
			);
			return {
				frameScreen: decorations.frame,
				selectionRectsLocal: decorations.selectionRects.map((rect) => ({
					x: rect.x,
					y: rect.y,
					width: rect.width,
					height: rect.height,
				})),
				compositionRectsLocal: decorations.compositionRects.map((rect) => ({
					x: rect.x,
					y: rect.y,
					width: rect.width,
					height: rect.height,
				})),
				caretRectLocal: decorations.caretRect
					? {
							x: decorations.caretRect.x,
							y: decorations.caretRect.y,
							width: decorations.caretRect.width,
							height: decorations.caretRect.height,
						}
					: null,
			};
		}, [textEditingSessionState]);

	const textEditingBridgeState =
		useMemo<FocusSceneTextEditingBridgeState | null>(() => {
			if (!textEditingSessionState) return null;
			return {
				sessionId: `focus-text-edit-${textEditingSessionState.target.id}`,
				editingElementId: textEditingSessionState.target.id,
				value: textEditingSessionState.draftText,
				selection: textEditingSessionState.selection,
				isComposing: textEditingSessionState.mode === "composing",
				canUndo: textEditingCanUndo,
				canRedo: textEditingCanRedo,
				overlayRectScreen: resolveTextEditingOverlayRect(
					textEditingSessionState.target.frame,
				),
				onValueChange: handleTextEditingValueChange,
				onSelectionChange: handleTextEditingSelectionChange,
				onCompositionStart: handleTextEditingCompositionStart,
				onCompositionUpdate: handleTextEditingCompositionUpdate,
				onCompositionEnd: handleTextEditingCompositionEnd,
				onUndo: handleTextEditingUndo,
				onRedo: handleTextEditingRedo,
				onCommit: () => {
					finishTextEditingSession("commit");
				},
				onCancel: () => {
					finishTextEditingSession("cancel");
				},
				onBlur: () => {
					finishTextEditingSession("commit");
				},
			};
		}, [
			finishTextEditingSession,
			handleTextEditingRedo,
			handleTextEditingCompositionEnd,
			handleTextEditingCompositionStart,
			handleTextEditingCompositionUpdate,
			handleTextEditingSelectionChange,
			handleTextEditingUndo,
			handleTextEditingValueChange,
			textEditingCanRedo,
			textEditingCanUndo,
			textEditingSessionState,
		]);

	const editingElementId = textEditingSessionState?.target.id ?? null;
	const editingDraftText = textEditingSessionState?.draftText ?? null;
	const editingParagraph = textEditingSessionState?.target.paragraph ?? null;

	useEffect(() => {
		if (!editingElementId) return;
		const nextTarget = resolveTextEditingTargetById(editingElementId);
		if (!nextTarget) {
			finishTextEditingSession("commit");
			return;
		}
		setTextEditingSessionState((previousSession) => {
			if (!previousSession || previousSession.target.id !== editingElementId) {
				return previousSession;
			}
			if (isTextEditingTargetEqual(previousSession.target, nextTarget)) {
				return previousSession;
			}
			return updateTextEditingSessionTarget(previousSession, nextTarget);
		});
	}, [
		editingElementId,
		finishTextEditingSession,
		resolveTextEditingTargetById,
	]);

	useEffect(() => {
		if (!editingElementId || editingDraftText === null || !editingParagraph)
			return;
		// 文本段落在 model 异步重建后再回流一次高度，保证编辑中高度实时跟随。
		applyTextEditingDraftToTimeline(editingElementId, editingDraftText);
	}, [
		applyTextEditingDraftToTimeline,
		editingDraftText,
		editingElementId,
		editingParagraph,
	]);

	const selectionFrameScene = useMemo(() => {
		if (
			selectionFrameSceneOverride &&
			selectionFrameOverrideSelectionKeyRef.current === selectedIdsKey
		) {
			return selectionFrameSceneOverride;
		}
		return resolveSelectionFrameScene(elementLayouts, selectedIds);
	}, [
		elementLayouts,
		selectedIds,
		selectedIdsKey,
		selectionFrameSceneOverride,
	]);

	useEffect(() => {
		if (!selectionFrameSceneOverride) return;
		if (selectionFrameOverrideSelectionKeyRef.current === selectedIdsKey)
			return;
		applySelectionFrameOverride(null);
	}, [
		applySelectionFrameOverride,
		selectedIdsKey,
		selectionFrameSceneOverride,
	]);

	const selectionFrameScreen = useMemo(() => {
		return resolveSelectionFrameScreen(selectionFrameScene, ctx);
	}, [ctx, selectionFrameScene]);

	const selectedResizeBehavior = useMemo<ElementResizeBehavior>(() => {
		return resolveSelectionResizeBehavior({
			selectedIds,
			layouts: elementLayouts,
		});
	}, [elementLayouts, selectedIds]);

	const selectionRectScreen = useMemo(() => {
		if (!selectionRectScene) return null;
		if (!ctx) return null;
		const startScreen = sceneToScreenPoint(ctx, {
			x: selectionRectScene.x,
			y: selectionRectScene.y,
		});
		const endScreen = sceneToScreenPoint(ctx, {
			x: selectionRectScene.x + selectionRectScene.width,
			y: selectionRectScene.y + selectionRectScene.height,
		});
		return {
			x: Math.min(startScreen.x, endScreen.x),
			y: Math.min(startScreen.y, endScreen.y),
			width: Math.abs(endScreen.x - startScreen.x),
			height: Math.abs(endScreen.y - startScreen.y),
		};
	}, [ctx, selectionRectScene]);

	const snapGuidesScreen = useMemo(() => {
		if (!ctx) {
			return {
				vertical: [],
				horizontal: [],
			};
		}
		return {
			vertical: snapGuidesScene.vertical.map((sceneX) => {
				return sceneToScreenPoint(ctx, { x: sceneX, y: 0 }).x;
			}),
			horizontal: snapGuidesScene.horizontal.map((sceneY) => {
				return sceneToScreenPoint(ctx, { x: 0, y: sceneY }).y;
			}),
		};
	}, [ctx, snapGuidesScene.horizontal, snapGuidesScene.vertical]);

	const handleItems = useMemo(() => {
		if (!selectionFrameScreen) return [];
		return buildFocusTransformHandleItems(selectionFrameScreen, {
			resizeHandleMode: resolveResizeHandleMode(selectedResizeBehavior),
		});
	}, [selectedResizeBehavior, selectionFrameScreen]);

	const labelItems = useMemo<FocusSceneLabelItem[]>(() => {
		if (selectedIds.length === 0) return [];
		if (selectedIds.length > 1 && selectionFrameScreen && selectionFrameScene) {
			return [
				{
					id: "group-selection",
					screenX: selectionFrameScreen.cx,
					screenY: selectionFrameScreen.cy,
					screenWidth: selectionFrameScreen.width,
					screenHeight: selectionFrameScreen.height,
					canvasWidth: selectionFrameScene.width,
					canvasHeight: selectionFrameScene.height,
					rotationDeg: (selectionFrameScreen.rotationRad * 180) / Math.PI,
				},
			];
		}
		return elementLayouts
			.filter((layout) => selectedIds.includes(layout.id))
			.map((layout) => {
				return {
					id: layout.id,
					screenX: layout.frameScreen.cx,
					screenY: layout.frameScreen.cy,
					screenWidth: layout.frameScreen.width,
					screenHeight: layout.frameScreen.height,
					canvasWidth: layout.frameScene.width,
					canvasHeight: layout.frameScene.height,
					rotationDeg: (layout.frameScreen.rotationRad * 180) / Math.PI,
				};
			});
	}, [elementLayouts, selectedIds, selectionFrameScene, selectionFrameScreen]);

	const resolveGuides = useCallback(
		(excludeIds: string[]) => {
			const guideX: number[] = [0, sourceWidth / 2, sourceWidth];
			const guideY: number[] = [0, sourceHeight / 2, sourceHeight];
			for (const element of interactiveElementsRef.current) {
				if (excludeIds.includes(element.id)) continue;
				const layout = elementLayouts.find((item) => item.id === element.id);
				if (!layout) continue;
				guideX.push(
					layout.boxScene.x,
					layout.boxScene.x + layout.boxScene.width / 2,
					layout.boxScene.x + layout.boxScene.width,
				);
				guideY.push(
					layout.boxScene.y,
					layout.boxScene.y + layout.boxScene.height / 2,
					layout.boxScene.y + layout.boxScene.height,
				);
			}
			return {
				x: guideX,
				y: guideY,
			};
		},
		[elementLayouts, interactiveElementsRef, sourceHeight, sourceWidth],
	);

	const applyDragToElements = useCallback(
		(targetIds: string[], nextCenters: Record<string, FocusPoint>): boolean => {
			if (!timelineStore) return false;
			const currentElements = timelineStore.getState().elements;
			let changed = false;
			const nextElements = currentElements.map((element) => {
				if (!targetIds.includes(element.id)) return element;
				if (!element.transform) return element;
				const nextCenter = nextCenters[element.id];
				if (!nextCenter) return element;
				const { positionX, positionY } = sceneCenterToModelPosition(nextCenter);
				const updatedTransform = quantizeTransform({
					...element.transform,
					position: {
						...element.transform.position,
						x: positionX,
						y: positionY,
					},
				});
				if (!isTransformChanged(element.transform, updatedTransform)) {
					return element;
				}
				changed = true;
				return {
					...element,
					transform: updatedTransform,
				};
			});
			if (!changed) return false;
			setElementsWithoutHistory(nextElements);
			return true;
		},
		[sceneCenterToModelPosition, setElementsWithoutHistory, timelineStore],
	);

	const handlePointerDownInternal = useCallback(
		(event: SkiaPointerEvent) => {
			if (disabled || !ctx || !timelineStore) return;
			if (width <= 0 || height <= 0) return;
			if (resolvePointerField(event, "button") !== 0) return;
			const screenPoint = { x: event.x, y: event.y };
			const scenePoint = screenToScenePoint(ctx, screenPoint);
			transformPointerInputRef.current = null;
			const metaPressed = event.shiftKey || event.ctrlKey || event.metaKey;
			const currentElements = timelineStore.getState().elements;
			const currentSelection = timelineStore.getState().selectedIds;
			const textEditingSession = textEditingSessionRef.current;

			if (textEditingSession) {
				const isInsideEditingFrame = isFocusPointInFrame(
					screenPoint,
					textEditingSession.target.frame,
				);
				if (!isInsideEditingFrame) {
					finishTextEditingSession("commit");
				} else {
					interactionSessionRef.current = null;
					textEditingPointerSelectingRef.current = true;
					beginTextEditingPointerSelection(
						screenPoint,
						Boolean(event.shiftKey),
					);
					setHoveredId(textEditingSession.target.id);
					setDraggingId(null);
					setSnapGuidesScene({ vertical: [], horizontal: [] });
					setActiveHandle(null);
					return;
				}
			}

			if (selectionFrameScreen) {
				const maybeHandle = resolveFocusTransformHandleAtPoint(
					selectionFrameScreen,
					screenPoint,
					handleItems,
				);
				if (maybeHandle && selectionFrameScene) {
					const startAngleRad = Math.atan2(
						scenePoint.y - selectionFrameScene.cy,
						scenePoint.x - selectionFrameScene.cx,
					);
					const handlePointScene = screenToScenePoint(ctx, {
						x: maybeHandle.screenX,
						y: maybeHandle.screenY,
					});
					const handleAngleRad = Math.atan2(
						handlePointScene.y - selectionFrameScene.cy,
						handlePointScene.x - selectionFrameScene.cx,
					);
					const baseElements: TransformElementSnapshot[] = [];
					for (const element of currentElements) {
						if (!currentSelection.includes(element.id)) continue;
						if (!hasTransform(element)) continue;
						const layout = elementLayouts.find(
							(item) => item.id === element.id,
						);
						if (!layout) continue;
						baseElements.push({
							id: element.id,
							transform: element.transform,
							frameScene: layout.frameScene,
							matrix: createFocusFrameUnitMatrix(layout.frameScene),
						});
					}
					if (baseElements.length > 0) {
						interactionSessionRef.current = {
							kind: "transform",
							handle: maybeHandle.handle,
							resizeBehavior: selectedResizeBehavior,
							baseFrameScene: selectionFrameScene,
							baseElements,
							startAngleRad,
							rotationSnapOffsetRad: normalizeAngleRad(
								startAngleRad - handleAngleRad,
							),
							historySnapshot: captureHistorySnapshot(),
							changed: false,
						};
						transformPointerInputRef.current = {
							x: event.x,
							y: event.y,
							altKey: Boolean(event.altKey),
							shiftKey: Boolean(event.shiftKey),
						};
						setActiveHandle(maybeHandle.handle);
						applySelectionFrameOverride(selectionFrameScene);
						return;
					}
				}
			}

			const hitLayout = resolveTopHitElement(screenPoint, elementLayouts);
			if (hitLayout) {
				const isSelected = currentSelection.includes(hitLayout.id);
				if (metaPressed) {
					if (isSelected) {
						const next = currentSelection.filter((id) => id !== hitLayout.id);
						setSelection(next, next[0] ?? null);
					} else {
						setSelection([...currentSelection, hitLayout.id], hitLayout.id);
					}
					return;
				}

				const dragSelection = isSelected ? currentSelection : [hitLayout.id];
				if (!isSelected) {
					setSelection([hitLayout.id], hitLayout.id);
				}
				const initialCenters: Record<string, FocusPoint> = {};
				let minX = Number.POSITIVE_INFINITY;
				let minY = Number.POSITIVE_INFINITY;
				let maxX = Number.NEGATIVE_INFINITY;
				let maxY = Number.NEGATIVE_INFINITY;
				for (const element of currentElements) {
					if (!dragSelection.includes(element.id)) continue;
					if (!hasTransform(element)) continue;
					const center = modelCenterToSceneCenter(element.transform.position);
					initialCenters[element.id] = center;
					const layout = elementLayouts.find((item) => item.id === element.id);
					if (!layout) continue;
					minX = Math.min(minX, layout.boxScene.x);
					minY = Math.min(minY, layout.boxScene.y);
					maxX = Math.max(maxX, layout.boxScene.x + layout.boxScene.width);
					maxY = Math.max(maxY, layout.boxScene.y + layout.boxScene.height);
				}
				const initialBounds =
					minX === Number.POSITIVE_INFINITY
						? null
						: {
								x: minX,
								y: minY,
								width: maxX - minX,
								height: maxY - minY,
							};

				const copyMode = Boolean(event.altKey);
				let targetIds = [...dragSelection];
				let copyIds: string[] = [];
				if (copyMode) {
					const seed = createCopySeed();
					const idMap = new Map<string, string>();
					dragSelection.forEach((id, index) => {
						idMap.set(id, `element-${seed}-${index}`);
					});
					const copies = currentElements
						.map((element) => {
							if (!dragSelection.includes(element.id)) return null;
							const copyId = idMap.get(element.id);
							if (!copyId) return null;
							return createCopyElement(element, copyId);
						})
						.filter(Boolean) as TimelineElement[];
					if (copies.length > 0) {
						setElementsWithoutHistory([...currentElements, ...copies]);
						copyIds = copies.map((copy) => copy.id);
						targetIds = [...copyIds];
						for (const sourceId of dragSelection) {
							const copyId = idMap.get(sourceId);
							if (!copyId) continue;
							const center = initialCenters[sourceId];
							if (!center) continue;
							initialCenters[copyId] = center;
						}
					}
				}

				interactionSessionRef.current = {
					kind: "drag",
					startScene: scenePoint,
					anchorId: copyMode ? (copyIds[0] ?? hitLayout.id) : hitLayout.id,
					targetIds,
					initialCenters,
					initialBounds,
					historySnapshot: captureHistorySnapshot(),
					copyMode,
					copyIds,
					sourceIds: dragSelection,
					changed: false,
					selectionFrameAtStart:
						isSelected && selectionFrameScene
							? selectionFrameScene
							: dragSelection.length === 1
								? hitLayout.frameScene
								: null,
				};
				setDraggingId(hitLayout.id);
				setHoveredId(hitLayout.id);
				return;
			}

			interactionSessionRef.current = {
				kind: "marquee",
				startScene: scenePoint,
				additive: metaPressed,
				initialSelectedIds: currentSelection,
			};
			if (!metaPressed) {
				// 点击空白区域默认清空选择，随后可继续拖拽框选。
				setSelection([], null);
			}
			setSelectionRectScene({
				x: scenePoint.x,
				y: scenePoint.y,
				width: 0,
				height: 0,
			});
			setSnapGuidesScene({ vertical: [], horizontal: [] });
			setDraggingId(null);
			setHoveredId(null);
		},
		[
			disabled,
			width,
			height,
			ctx,
			timelineStore,
			selectionFrameScreen,
			selectionFrameScene,
			handleItems,
			selectedResizeBehavior,
			elementLayouts,
			captureHistorySnapshot,
			modelCenterToSceneCenter,
			applySelectionFrameOverride,
			beginTextEditingPointerSelection,
			finishTextEditingSession,
			setSelection,
			setElementsWithoutHistory,
		],
	);

	const handlePointerDoubleClickInternal = useCallback(
		(event: SkiaPointerEvent) => {
			if (disabled || !timelineStore) return;
			if (width <= 0 || height <= 0) return;
			if (resolvePointerField(event, "button") !== 0) return;
			const screenPoint = { x: event.x, y: event.y };
			const target = resolveTextEditingTargetAtPoint(screenPoint);
			if (!target) return;
			const baseSession = createTextEditingSession({
				target,
			});
			const caretIndex = resolveTextEditingIndexAtScreenPoint(
				baseSession,
				screenPoint,
			);
			beginTextEditingSession(target, {
				start: caretIndex,
				end: caretIndex,
				direction: "none",
			});
		},
		[
			beginTextEditingSession,
			disabled,
			height,
			resolveTextEditingTargetAtPoint,
			timelineStore,
			width,
		],
	);

	const handlePointerMoveInternal = useCallback(
		(event: SkiaPointerEvent) => {
			if (disabled || !ctx || !timelineStore) return;
			const screenPoint = { x: event.x, y: event.y };
			const scenePoint = screenToScenePoint(ctx, screenPoint);
			const session = interactionSessionRef.current;
			const textEditingSession = textEditingSessionRef.current;

			if (textEditingSession) {
				const primaryPressed =
					(resolvePointerField(event, "buttons") & 1) === 1;
				if (textEditingPointerSelectingRef.current && primaryPressed) {
					beginTextEditingPointerSelection(screenPoint, true);
				}
				if (!primaryPressed) {
					textEditingPointerSelectingRef.current = false;
				}
				setHoveredId(textEditingSession.target.id);
				setActiveHandle(null);
				return;
			}

			if (!session) {
				const hitLayout = resolveTopHitElement(screenPoint, elementLayouts);
				setHoveredId(hitLayout?.id ?? null);
				if (selectionFrameScreen) {
					const handle = resolveFocusTransformHandleAtPoint(
						selectionFrameScreen,
						screenPoint,
						handleItems,
					);
					setActiveHandle(handle?.handle ?? null);
				}
				return;
			}

			if (session.kind === "marquee") {
				const nextRect: FocusRect = {
					x: Math.min(session.startScene.x, scenePoint.x),
					y: Math.min(session.startScene.y, scenePoint.y),
					width: Math.abs(scenePoint.x - session.startScene.x),
					height: Math.abs(scenePoint.y - session.startScene.y),
				};
				setSelectionRectScene(nextRect);
				const selectedFromRect = elementLayouts
					.filter((layout) => isFocusRectIntersect(nextRect, layout.boxScene))
					.sort((left, right) => {
						const leftTrack = resolveTrackIndex(left.element);
						const rightTrack = resolveTrackIndex(right.element);
						if (leftTrack !== rightTrack) {
							return leftTrack - rightTrack;
						}
						return (
							interactiveElements.findIndex((el) => el.id === left.id) -
							interactiveElements.findIndex((el) => el.id === right.id)
						);
					})
					.map((layout) => layout.id);
				if (session.additive) {
					const merged = Array.from(
						new Set([...session.initialSelectedIds, ...selectedFromRect]),
					);
					setSelection(merged, merged[0] ?? null);
				} else {
					setSelection(selectedFromRect, selectedFromRect[0] ?? null);
				}
				return;
			}

			if (session.kind === "drag") {
				const guides = resolveGuides(session.targetIds);
				const deltaScene = {
					x: scenePoint.x - session.startScene.x,
					y: scenePoint.y - session.startScene.y,
				};
				let adjustedDeltaX = deltaScene.x;
				let adjustedDeltaY = deltaScene.y;
				const snapEnabled = timelineStore.getState().snapEnabled;
				if (snapEnabled && session.initialBounds) {
					const moving = {
						x: session.initialBounds.x + adjustedDeltaX,
						y: session.initialBounds.y + adjustedDeltaY,
						width: session.initialBounds.width,
						height: session.initialBounds.height,
					};
					const threshold = resolveSnapThresholdScene(
						ctx.stageScaleX,
						ctx.stageScaleY,
					);
					const snapX = findNearestGuide(
						[moving.x, moving.x + moving.width / 2, moving.x + moving.width],
						guides.x,
					);
					const snapY = findNearestGuide(
						[moving.y, moving.y + moving.height / 2, moving.y + moving.height],
						guides.y,
					);
					const verticalGuides: number[] = [];
					const horizontalGuides: number[] = [];
					if (snapX.line !== null && snapX.distance <= threshold) {
						adjustedDeltaX += snapX.delta;
						for (const line of snapX.lines) {
							appendUniqueGuideLine(verticalGuides, line);
						}
					}
					if (snapY.line !== null && snapY.distance <= threshold) {
						adjustedDeltaY += snapY.delta;
						for (const line of snapY.lines) {
							appendUniqueGuideLine(horizontalGuides, line);
						}
					}
					setSnapGuidesScene({
						vertical: verticalGuides,
						horizontal: horizontalGuides,
					});
				} else {
					setSnapGuidesScene({ vertical: [], horizontal: [] });
				}

				const nextCenters: Record<string, FocusPoint> = {};
				for (const id of session.targetIds) {
					const initial = session.initialCenters[id];
					if (!initial) continue;
					nextCenters[id] = {
						x: initial.x + adjustedDeltaX,
						y: initial.y + adjustedDeltaY,
					};
				}
				const changed = applyDragToElements(session.targetIds, nextCenters);
				if (changed) {
					session.changed = true;
					if (!session.copyMode && session.selectionFrameAtStart) {
						applySelectionFrameOverride({
							...session.selectionFrameAtStart,
							cx: session.selectionFrameAtStart.cx + adjustedDeltaX,
							cy: session.selectionFrameAtStart.cy + adjustedDeltaY,
						});
					}
				}
				return;
			}

			if (session.kind === "transform") {
				transformPointerInputRef.current = {
					x: event.x,
					y: event.y,
					altKey: Boolean(event.altKey),
					shiftKey: Boolean(event.shiftKey),
				};
				const baseFrameScene = session.baseFrameScene;
				const baseFrameScreen = resolveSelectionFrameScreen(
					baseFrameScene,
					ctx,
				);
				if (!baseFrameScreen) return;
				const centered = Boolean(event.altKey);
				const snapRotate = Boolean(event.shiftKey);
				const isTextWidthReflowHandle =
					session.resizeBehavior === "text-width-reflow" &&
					(session.handle === "middle-left" ||
						session.handle === "middle-right");
				let nextFrameScreen: FocusFrame | null = null;
				let resizeScaleSignX = 1;
				let resizeScaleSignY = 1;

				if (isRotateHandle(session.handle)) {
					const currentAngle = Math.atan2(
						scenePoint.y - baseFrameScene.cy,
						scenePoint.x - baseFrameScene.cx,
					);
					let nextRotation = normalizeAngleRad(
						baseFrameScene.rotationRad + (currentAngle - session.startAngleRad),
					);
					if (snapRotate) {
						const snapStep = Math.PI / 4;
						const snapTarget = normalizeAngleRad(
							nextRotation + session.rotationSnapOffsetRad,
						);
						nextRotation = normalizeAngleRad(
							Math.round(snapTarget / snapStep) * snapStep,
						);
					}
					nextFrameScreen = {
						...baseFrameScreen,
						rotationRad: nextRotation,
					};
				} else {
					if (isTextWidthReflowHandle) {
						nextFrameScreen = resolveTextSideResizeFrameScreen({
							baseFrameScreen,
							handle: session.handle,
							pointerScreen: screenPoint,
							centered,
						});
					} else {
						const resizeResult = resolveResizeAnchorDelta({
							baseFrameScreen,
							handle: session.handle,
							pointerScreen: screenPoint,
							centered,
						});
						if (!resizeResult) return;
						nextFrameScreen = resizeResult.frameScreen;
						resizeScaleSignX = resizeResult.scaleSignX;
						resizeScaleSignY = resizeResult.scaleSignY;
					}
				}
				if (!nextFrameScreen) return;

				const minSizeScene = resolveMinTransformSizeScene(
					ctx.stageScaleX,
					ctx.stageScaleY,
				);
				const nextFrameSceneRaw = screenFrameToSceneFrame(
					nextFrameScreen,
					ctx.stageScaleX,
					ctx.stageScaleY,
					screenToScenePoint(ctx, {
						x: nextFrameScreen.cx,
						y: nextFrameScreen.cy,
					}),
				);
				if (
					nextFrameSceneRaw.width < minSizeScene ||
					nextFrameSceneRaw.height < minSizeScene
				) {
					return;
				}
				let nextFrameScene = nextFrameSceneRaw;
				if (isRotateHandle(session.handle)) {
					setSnapGuidesScene({ vertical: [], horizontal: [] });
				} else {
					const snapEnabled = timelineStore.getState().snapEnabled;
					const canSnapResize =
						snapEnabled &&
						Math.abs(nextFrameScene.rotationRad) <= 1e-3 &&
						Math.abs(session.baseFrameScene.rotationRad) <= 1e-3;
					if (!canSnapResize) {
						setSnapGuidesScene({ vertical: [], horizontal: [] });
					} else {
						const oldRect = frameToAxisRect(session.baseFrameScene);
						const currentRect = frameToAxisRect(nextFrameScene);
						const leftMoved =
							Math.abs(currentRect.x - oldRect.x) > FOCUS_SCENE_EPSILON;
						const rightMoved =
							Math.abs(
								currentRect.x + currentRect.width - (oldRect.x + oldRect.width),
							) > FOCUS_SCENE_EPSILON;
						const topMoved =
							Math.abs(currentRect.y - oldRect.y) > FOCUS_SCENE_EPSILON;
						const bottomMoved =
							Math.abs(
								currentRect.y +
									currentRect.height -
									(oldRect.y + oldRect.height),
							) > FOCUS_SCENE_EPSILON;

						let moveLeftForSnap = leftMoved;
						let moveRightForSnap = rightMoved;
						let moveTopForSnap = topMoved;
						let moveBottomForSnap = bottomMoved;
						if (!centered && leftMoved && rightMoved) {
							if (session.handle.includes("left")) {
								moveLeftForSnap = resizeScaleSignX >= 0;
								moveRightForSnap = !moveLeftForSnap;
							} else if (session.handle.includes("right")) {
								moveRightForSnap = resizeScaleSignX >= 0;
								moveLeftForSnap = !moveRightForSnap;
							}
						}
						if (!centered && topMoved && bottomMoved) {
							if (session.handle.includes("top")) {
								moveTopForSnap = resizeScaleSignY >= 0;
								moveBottomForSnap = !moveTopForSnap;
							} else if (session.handle.includes("bottom")) {
								moveBottomForSnap = resizeScaleSignY >= 0;
								moveTopForSnap = !moveBottomForSnap;
							}
						}

						const movingX: number[] = [];
						if (moveLeftForSnap && !moveRightForSnap) {
							movingX.push(currentRect.x);
						} else if (moveRightForSnap && !moveLeftForSnap) {
							movingX.push(currentRect.x + currentRect.width);
						} else if (moveLeftForSnap && moveRightForSnap) {
							if (centered) {
								movingX.push(currentRect.x, currentRect.x + currentRect.width);
							} else {
								movingX.push(currentRect.x + currentRect.width / 2);
							}
						}
						const movingY: number[] = [];
						if (moveTopForSnap && !moveBottomForSnap) {
							movingY.push(currentRect.y);
						} else if (moveBottomForSnap && !moveTopForSnap) {
							movingY.push(currentRect.y + currentRect.height);
						} else if (moveTopForSnap && moveBottomForSnap) {
							if (centered) {
								movingY.push(currentRect.y, currentRect.y + currentRect.height);
							} else {
								movingY.push(currentRect.y + currentRect.height / 2);
							}
						}

						if (movingX.length === 0 && movingY.length === 0) {
							setSnapGuidesScene({ vertical: [], horizontal: [] });
						} else {
							const guides = resolveGuides(
								session.baseElements.map((item) => item.id),
							);
							const guidesX = [...guides.x];
							const guidesY = [...guides.y];
							if (centered && moveLeftForSnap && moveRightForSnap) {
								guidesX.push(oldRect.x, oldRect.x + oldRect.width);
							}
							if (centered && moveTopForSnap && moveBottomForSnap) {
								guidesY.push(oldRect.y, oldRect.y + oldRect.height);
							}
							const threshold = resolveSnapThresholdScene(
								ctx.stageScaleX,
								ctx.stageScaleY,
							);
							const snapX =
								movingX.length > 0
									? findNearestGuide(movingX, guidesX)
									: {
											line: null,
											delta: 0,
											distance: Number.POSITIVE_INFINITY,
											value: null,
											lines: [],
										};
							const snapY =
								movingY.length > 0
									? findNearestGuide(movingY, guidesY)
									: {
											line: null,
											delta: 0,
											distance: Number.POSITIVE_INFINITY,
											value: null,
											lines: [],
										};

							let deltaX =
								snapX.line !== null && snapX.distance <= threshold
									? snapX.delta
									: 0;
							let deltaY =
								snapY.line !== null && snapY.distance <= threshold
									? snapY.delta
									: 0;
							const cornerHandle =
								(session.handle.includes("left") ||
									session.handle.includes("right")) &&
								(session.handle.includes("top") ||
									session.handle.includes("bottom"));
							const cornerLike =
								cornerHandle &&
								moveLeftForSnap !== moveRightForSnap &&
								moveTopForSnap !== moveBottomForSnap;
							const centeredCornerLike =
								cornerHandle &&
								centered &&
								moveLeftForSnap &&
								moveRightForSnap &&
								moveTopForSnap &&
								moveBottomForSnap;
							const shouldKeepCornerAspect = cornerLike || centeredCornerLike;
							if (shouldKeepCornerAspect && deltaX !== 0 && deltaY !== 0) {
								if (Math.abs(deltaX) <= Math.abs(deltaY)) {
									deltaY = 0;
								} else {
									deltaX = 0;
								}
							}
							if (deltaX === 0 && deltaY === 0) {
								setSnapGuidesScene({ vertical: [], horizontal: [] });
							} else {
								const snappedRect = { ...currentRect };
								if (deltaX !== 0) {
									if (moveLeftForSnap && !moveRightForSnap) {
										snappedRect.x += deltaX;
										snappedRect.width -= deltaX;
									} else if (moveRightForSnap && !moveLeftForSnap) {
										snappedRect.width += deltaX;
									} else if (moveLeftForSnap && moveRightForSnap) {
										if (centered && snapX.value !== null) {
											const snapToLeft =
												Math.abs(snapX.value - currentRect.x) <=
												Math.abs(
													snapX.value - (currentRect.x + currentRect.width),
												);
											if (snapToLeft) {
												snappedRect.x += deltaX;
												snappedRect.width -= deltaX * 2;
											} else {
												snappedRect.x -= deltaX;
												snappedRect.width += deltaX * 2;
											}
										} else {
											snappedRect.x += deltaX;
										}
									}
								}
								if (deltaY !== 0) {
									if (moveTopForSnap && !moveBottomForSnap) {
										snappedRect.y += deltaY;
										snappedRect.height -= deltaY;
									} else if (moveBottomForSnap && !moveTopForSnap) {
										snappedRect.height += deltaY;
									} else if (moveTopForSnap && moveBottomForSnap) {
										if (centered && snapY.value !== null) {
											const snapToTop =
												Math.abs(snapY.value - currentRect.y) <=
												Math.abs(
													snapY.value - (currentRect.y + currentRect.height),
												);
											if (snapToTop) {
												snappedRect.y += deltaY;
												snappedRect.height -= deltaY * 2;
											} else {
												snappedRect.y -= deltaY;
												snappedRect.height += deltaY * 2;
											}
										} else {
											snappedRect.y += deltaY;
										}
									}
								}
								if (shouldKeepCornerAspect) {
									const ratio =
										currentRect.width /
										Math.max(currentRect.height, FOCUS_SCENE_EPSILON);
									if (centeredCornerLike) {
										const centerX = currentRect.x + currentRect.width / 2;
										const centerY = currentRect.y + currentRect.height / 2;
										if (deltaX !== 0) {
											const nextHeight =
												snappedRect.width /
												Math.max(ratio, FOCUS_SCENE_EPSILON);
											snappedRect.height = nextHeight;
											snappedRect.y = centerY - nextHeight / 2;
										} else if (deltaY !== 0) {
											const nextWidth = snappedRect.height * ratio;
											snappedRect.width = nextWidth;
											snappedRect.x = centerX - nextWidth / 2;
										}
									} else {
										const fixedX =
											moveLeftForSnap && !moveRightForSnap
												? currentRect.x + currentRect.width
												: currentRect.x;
										const fixedY =
											moveTopForSnap && !moveBottomForSnap
												? currentRect.y + currentRect.height
												: currentRect.y;
										if (deltaX !== 0) {
											const nextHeight =
												snappedRect.width /
												Math.max(ratio, FOCUS_SCENE_EPSILON);
											snappedRect.height = nextHeight;
											if (moveTopForSnap && !moveBottomForSnap) {
												snappedRect.y = fixedY - nextHeight;
											} else if (moveBottomForSnap && !moveTopForSnap) {
												snappedRect.y = fixedY;
											}
										} else if (deltaY !== 0) {
											const nextWidth = snappedRect.height * ratio;
											snappedRect.width = nextWidth;
											if (moveLeftForSnap && !moveRightForSnap) {
												snappedRect.x = fixedX - nextWidth;
											} else if (moveRightForSnap && !moveLeftForSnap) {
												snappedRect.x = fixedX;
											}
										}
									}
								}
								if (
									snappedRect.width >= minSizeScene &&
									snappedRect.height >= minSizeScene
								) {
									nextFrameScene = axisRectToFrame(
										snappedRect,
										nextFrameScene.rotationRad,
									);
								}
								setSnapGuidesScene({
									vertical:
										deltaX !== 0 && snapX.line !== null ? [...snapX.lines] : [],
									horizontal:
										deltaY !== 0 && snapY.line !== null ? [...snapY.lines] : [],
								});
							}
						}
					}
				}

				const baseMatrix = createFocusFrameUnitMatrix(session.baseFrameScene);
				const nextMatrix = createFocusFrameUnitMatrix(nextFrameScene);
				const inverseBase = invertFocusMatrix(baseMatrix);
				if (!inverseBase) return;
				const deltaMatrix = multiplyFocusMatrix(nextMatrix, inverseBase);
				const modelRegistry = resolveTimelineModelRegistry({
					runtimeManager,
					timelineStore,
				});
				const currentElements = timelineStore.getState().elements;
				let changed = false;
				let selectionFrameOverride: FocusFrame | null = null;
				const nextElements = currentElements.map((element) => {
					const snapshot = session.baseElements.find(
						(item) => item.id === element.id,
					);
					if (!snapshot) return element;
					if (!element.transform) return element;
					const transformedMatrix = multiplyFocusMatrix(
						deltaMatrix,
						snapshot.matrix,
					);
					const metrics = getFocusMatrixMetrics(transformedMatrix, 1, 1);
					const { positionX, positionY } = sceneCenterToModelPosition(
						metrics.center,
					);
					const isTextWidthReflowResize =
						session.resizeBehavior === "text-width-reflow" &&
						!isRotateHandle(session.handle) &&
						(session.handle === "middle-left" ||
							session.handle === "middle-right") &&
						session.baseElements.length === 1;
					if (isTextWidthReflowResize) {
						const baseScaleX = snapshot.transform.scale.x;
						const baseScaleY = snapshot.transform.scale.y;
						const absScaleX = Math.max(
							Math.abs(baseScaleX),
							FOCUS_SCENE_EPSILON,
						);
						const absScaleY = Math.max(
							Math.abs(baseScaleY),
							FOCUS_SCENE_EPSILON,
						);
						const minBaseWidth = minSizeScene / absScaleX;
						const minBaseHeight = minSizeScene / absScaleY;
						const nextBaseWidth = Math.max(
							minBaseWidth,
							nextFrameScene.width / absScaleX,
						);
						const reflowHeight = resolveTextReflowHeightFromModel({
							modelRegistry,
							elementId: snapshot.id,
							baseWidth: nextBaseWidth,
						});
						const nextBaseHeight = Math.max(
							minBaseHeight,
							reflowHeight ?? snapshot.transform.baseSize.height,
						);
						const updatedTransform = quantizeTransform({
							...snapshot.transform,
							baseSize: {
								...snapshot.transform.baseSize,
								width: nextBaseWidth,
								height: nextBaseHeight,
							},
							position: {
								...snapshot.transform.position,
								x: positionX,
								y: positionY,
							},
							scale: {
								x: baseScaleX,
								y: baseScaleY,
							},
							rotation: {
								...snapshot.transform.rotation,
								value: (metrics.rotationRad * 180) / Math.PI,
							},
						});
						if (!isTransformChanged(element.transform, updatedTransform)) {
							return element;
						}
						changed = true;
						selectionFrameOverride = {
							cx: metrics.center.x,
							cy: metrics.center.y,
							width: updatedTransform.baseSize.width * Math.abs(baseScaleX),
							height: updatedTransform.baseSize.height * Math.abs(baseScaleY),
							rotationRad: metrics.rotationRad,
						};
						return {
							...element,
							transform: updatedTransform,
						};
					}
					const updatedTransform = quantizeTransform({
						...snapshot.transform,
						position: {
							...snapshot.transform.position,
							x: positionX,
							y: positionY,
						},
						scale: {
							x: resolveScaleFromSize(
								metrics.width,
								snapshot.transform.baseSize.width,
								snapshot.transform.scale.x * resizeScaleSignX,
							),
							y: resolveScaleFromSize(
								metrics.height,
								snapshot.transform.baseSize.height,
								snapshot.transform.scale.y * resizeScaleSignY,
							),
						},
						rotation: {
							...snapshot.transform.rotation,
							value: (metrics.rotationRad * 180) / Math.PI,
						},
					});
					if (!isTransformChanged(element.transform, updatedTransform)) {
						return element;
					}
					changed = true;
					return {
						...element,
						transform: updatedTransform,
					};
				});
				if (!changed) return;
				session.changed = true;
				setElementsWithoutHistory(nextElements);
				applySelectionFrameOverride(selectionFrameOverride ?? nextFrameScene);
			}
		},
		[
			applySelectionFrameOverride,
			beginTextEditingPointerSelection,
			disabled,
			ctx,
			elementLayouts,
			handleItems,
			selectionFrameScreen,
			timelineStore,
			interactiveElements,
			setSelection,
			resolveGuides,
			applyDragToElements,
			sceneCenterToModelPosition,
			setElementsWithoutHistory,
			runtimeManager,
		],
	);

	const handlePointerUpInternal = useCallback(() => {
		if (textEditingSessionRef.current) {
			transformPointerInputRef.current = null;
			textEditingPointerSelectingRef.current = false;
			setSelectionRectScene(null);
			setSnapGuidesScene({ vertical: [], horizontal: [] });
			setDraggingId(null);
			setActiveHandle(null);
			return;
		}
		const session = interactionSessionRef.current;
		if (!session) {
			transformPointerInputRef.current = null;
			setSelectionRectScene(null);
			setSnapGuidesScene({ vertical: [], horizontal: [] });
			setDraggingId(null);
			setActiveHandle(null);
			return;
		}

		if (session.kind === "marquee") {
			transformPointerInputRef.current = null;
			setSelectionRectScene(null);
			setSnapGuidesScene({ vertical: [], horizontal: [] });
			interactionSessionRef.current = null;
			return;
		}

		if (session.kind === "drag") {
			transformPointerInputRef.current = null;
			if (session.copyMode && timelineStore) {
				if (session.copyIds.length > 0) {
					const currentElements = timelineStore.getState().elements;
					const hasMoved = session.targetIds.some((id) => {
						const initial = session.initialCenters[id];
						const current = currentElements.find(
							(element) => element.id === id,
						);
						if (!initial || !current?.transform) return false;
						const center = modelCenterToSceneCenter(current.transform.position);
						return (
							Math.abs(center.x - initial.x) > 1e-6 ||
							Math.abs(center.y - initial.y) > 1e-6
						);
					});
					if (!hasMoved) {
						setElementsWithoutHistory(
							currentElements.filter(
								(element) => !session.copyIds.includes(element.id),
							),
						);
						setSelection(session.sourceIds, session.sourceIds[0] ?? null);
					} else {
						reconcileCopyDragElements(session.copyIds);
						setSelection(session.copyIds, session.copyIds[0] ?? null);
						session.changed = true;
					}
				}
			}
			if (session.changed) {
				pushHistorySnapshot(session.historySnapshot);
			}
			setDraggingId(null);
			setSnapGuidesScene({ vertical: [], horizontal: [] });
			setSelectionRectScene(null);
			setActiveHandle(null);
			interactionSessionRef.current = null;
			return;
		}

		if (session.kind === "transform") {
			transformPointerInputRef.current = null;
			if (session.changed) {
				pushHistorySnapshot(session.historySnapshot);
			}
			if (session.baseElements.length <= 1) {
				applySelectionFrameOverride(null);
			}
			setActiveHandle(null);
			setSnapGuidesScene({ vertical: [], horizontal: [] });
			interactionSessionRef.current = null;
		}
	}, [
		applySelectionFrameOverride,
		timelineStore,
		modelCenterToSceneCenter,
		reconcileCopyDragElements,
		setElementsWithoutHistory,
		setSelection,
		pushHistorySnapshot,
	]);

	const handlePointerLeaveInternal = useCallback(() => {
		if (textEditingSessionRef.current) {
			// 文本编辑态由输入桥接接管，不在 leave 时打断选区。
			return;
		}
		if (interactionSessionRef.current) {
			// 拖拽/变换过程中忽略 leave，避免在句柄拖动时被误中断。
			return;
		}
		transformPointerInputRef.current = null;
		setHoveredId(null);
		setActiveHandle(null);
	}, []);

	useEffect(() => {
		if (disabled) return;
		if (typeof window === "undefined") return;

		const handleModifierKeyEvent = (event: KeyboardEvent) => {
			const session = interactionSessionRef.current;
			if (!session || session.kind !== "transform") return;
			if (isRotateHandle(session.handle)) return;
			const pointerInput = transformPointerInputRef.current;
			if (!pointerInput) return;
			const nextAltKey =
				event.key === "Alt" ||
				event.code === "AltLeft" ||
				event.code === "AltRight"
					? event.type === "keydown"
					: event.getModifierState("Alt");
			const nextShiftKey = Boolean(event.shiftKey);
			if (
				pointerInput.altKey === nextAltKey &&
				pointerInput.shiftKey === nextShiftKey
			) {
				return;
			}
			transformPointerInputRef.current = {
				...pointerInput,
				altKey: nextAltKey,
				shiftKey: nextShiftKey,
			};
			// Alt 键切换时复用最后一次指针位置，立即重算缩放模式。
			handlePointerMoveInternal({
				x: pointerInput.x,
				y: pointerInput.y,
				button: 0,
				buttons: 1,
				altKey: nextAltKey,
				shiftKey: nextShiftKey,
				ctrlKey: false,
				metaKey: false,
			} as SkiaPointerEvent);
		};

		window.addEventListener("keydown", handleModifierKeyEvent);
		window.addEventListener("keyup", handleModifierKeyEvent);
		return () => {
			window.removeEventListener("keydown", handleModifierKeyEvent);
			window.removeEventListener("keyup", handleModifierKeyEvent);
		};
	}, [disabled, handlePointerMoveInternal]);

	useEffect(() => {
		if (disabled || !ctx || !timelineStore) {
			interactionSessionRef.current = null;
			transformPointerInputRef.current = null;
			textEditingPointerSelectingRef.current = false;
			textEditingSelectionAnchorRef.current = null;
			textEditingHistorySessionRef.current = null;
			setHoveredId(null);
			setDraggingId(null);
			setSelectionRectScene(null);
			setSnapGuidesScene({ vertical: [], horizontal: [] });
			applySelectionFrameOverride(null);
			setActiveHandle(null);
			setTextEditingSessionState(null);
		}
	}, [applySelectionFrameOverride, disabled, ctx, timelineStore]);

	return {
		elementLayouts,
		selectedIds,
		hoveredId,
		draggingId,
		editingElementId,
		textEditingDecorations,
		textEditingBridgeState,
		selectionRectScreen,
		snapGuidesScreen,
		selectionFrameScreen,
		handleItems,
		activeHandle,
		labelItems,
		onLayerPointerDown: handlePointerDownInternal,
		onLayerDoubleClick: handlePointerDoubleClickInternal,
		onLayerPointerMove: handlePointerMoveInternal,
		onLayerPointerUp: handlePointerUpInternal,
		onLayerPointerLeave: handlePointerLeaveInternal,
	};
};
