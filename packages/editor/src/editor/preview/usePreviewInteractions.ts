import type Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	renderLayoutToTopLeft,
	transformMetaToRenderLayout,
} from "@/dsl/layout";
import { getTransformSize } from "@/dsl/transform";
import type { TimelineElement, TransformMeta } from "@/dsl/types";
import {
	useMultiSelect,
	useSnap,
	useTimelineStore,
	useTrackAssignments,
} from "../contexts/TimelineContext";
import { cloneValue, createCopySeed } from "../utils/copyUtils";
import type { CanvasConvertOptions } from "./utils";

const SNAP_GUIDE_THRESHOLD = 6;

type SnapGuides = {
	vertical: number[];
	horizontal: number[];
};

type AxisSnapResult = {
	line: number | null;
	delta: number;
	distance: number;
};

type SnapComputeOptions = {
	movingX?: number[];
	movingY?: number[];
};

type TransformBase = {
	stageWidth: number;
	stageHeight: number;
	canvasWidth: number;
	canvasHeight: number;
	scaleX: number;
	scaleY: number;
	effectiveZoom: number;
	elementScaleX: number;
	elementScaleY: number;
	activeAnchor: string | null;
};

type SelectionRect = {
	visible: boolean;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
};

type TransformerBox = {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
};

type Point = {
	x: number;
	y: number;
};

type GroupElementSnapshot = {
	topLeft: Point;
	width: number;
	height: number;
	rotation: number;
};

type GroupTransformSnapshot = {
	center: Point;
	rotation: number;
	scaleX: number;
	scaleY: number;
	transform: Konva.Transform;
	elements: Record<string, GroupElementSnapshot>;
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const POSITION_QUANTUM = 1e-6;
const SIZE_QUANTUM = 1e-6;
const SCALE_QUANTUM = 1e-6;
const ROTATION_QUANTUM = 1e-6;
const POSITION_INTEGER_SNAP_EPSILON = 1e-4;
const SCALE_EPSILON = 1e-6;
const MIN_TRANSFORM_SIZE_STAGE = 5;
const GUIDE_LOCK_EPSILON = 0.5;

type CanvasRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type SnapGuideValues = {
	x: number[];
	y: number[];
};

type EdgeMoveState = {
	left: boolean;
	right: boolean;
	top: boolean;
	bottom: boolean;
};

const quantize = (value: number, quantum: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.round(value / quantum) * quantum;
};

const snapNearInteger = (value: number): number => {
	const rounded = Math.round(value);
	if (Math.abs(value - rounded) <= POSITION_INTEGER_SNAP_EPSILON) {
		return rounded;
	}
	return value;
};

const quantizeCanvasRect = (rect: CanvasRect): CanvasRect => {
	return {
		x: snapNearInteger(quantize(rect.x, POSITION_QUANTUM)),
		y: snapNearInteger(quantize(rect.y, POSITION_QUANTUM)),
		width: Math.max(0, quantize(rect.width, SIZE_QUANTUM)),
		height: Math.max(0, quantize(rect.height, SIZE_QUANTUM)),
	};
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

const resolveScaleFromSize = (
	nextSize: number,
	baseSize: number,
	previousScale: number,
) => {
	if (!Number.isFinite(baseSize) || Math.abs(baseSize) < SCALE_EPSILON) {
		return previousScale;
	}
	const sign = previousScale < 0 ? -1 : 1;
	return sign * (nextSize / baseSize);
};

const isHorizontalResizeAnchor = (anchor: string | null): boolean => {
	return anchor === "middle-left" || anchor === "middle-right";
};

const isVerticalResizeAnchor = (anchor: string | null): boolean => {
	return (
		anchor === "top-center" ||
		anchor === "bottom-center" ||
		anchor === "middle-top" ||
		anchor === "middle-bottom"
	);
};

const isCornerResizeAnchor = (anchor: string | null): boolean => {
	return (
		anchor === "top-left" ||
		anchor === "top-right" ||
		anchor === "bottom-left" ||
		anchor === "bottom-right"
	);
};

const resolveUniformScale = (params: {
	nextWidth: number;
	nextHeight: number;
	baseWidth: number;
	baseHeight: number;
	previousScaleX: number;
	previousScaleY: number;
}): { scaleX: number; scaleY: number } => {
	const {
		nextWidth,
		nextHeight,
		baseWidth,
		baseHeight,
		previousScaleX,
		previousScaleY,
	} = params;

	const candidates: number[] = [];
	if (Number.isFinite(baseWidth) && Math.abs(baseWidth) >= SCALE_EPSILON) {
		candidates.push(Math.abs(nextWidth / baseWidth));
	}
	if (Number.isFinite(baseHeight) && Math.abs(baseHeight) >= SCALE_EPSILON) {
		candidates.push(Math.abs(nextHeight / baseHeight));
	}
	const magnitude =
		candidates.length > 0
			? candidates.reduce((sum, value) => sum + value, 0) / candidates.length
			: Math.max(Math.abs(previousScaleX), Math.abs(previousScaleY));
	const signX = previousScaleX < 0 ? -1 : 1;
	const signY = previousScaleY < 0 ? -1 : 1;

	return {
		scaleX: signX * magnitude,
		scaleY: signY * magnitude,
	};
};

export interface UsePreviewInteractionsOptions {
	renderElements: TimelineElement[];
	renderElementsRef: React.MutableRefObject<TimelineElement[]>;
	canvasConvertOptions: CanvasConvertOptions;
	canvasWidth: number;
	canvasHeight: number;
	getEffectiveZoom: () => number;
	stageToCanvasCoords: (
		stageX: number,
		stageY: number,
	) => {
		canvasX: number;
		canvasY: number;
	};
	canvasToStageCoords: (
		canvasX: number,
		canvasY: number,
	) => {
		stageX: number;
		stageY: number;
	};
}

const findNearestGuide = (
	movingValues: number[],
	guideValues: number[],
): AxisSnapResult => {
	let best: AxisSnapResult = {
		line: null,
		delta: 0,
		distance: Infinity,
	};

	movingValues.forEach((value) => {
		guideValues.forEach((guide) => {
			const distance = Math.abs(guide - value);
			if (distance < best.distance) {
				best = { line: guide, delta: guide - value, distance };
			}
		});
	});

	return best;
};

const snapValueToGuide = (
	value: number,
	guides: number[],
	epsilon: number,
): number => {
	const nearest = findNearestGuide([value], guides);
	if (nearest.line === null || nearest.distance > epsilon) {
		return value;
	}
	return nearest.line;
};

const lockFixedEdgesToGuides = (
	box: CanvasRect,
	moved: EdgeMoveState,
	guides: SnapGuideValues,
): CanvasRect => {
	let left = box.x;
	let right = box.x + box.width;
	let top = box.y;
	let bottom = box.y + box.height;

	if (!moved.left) {
		left = snapValueToGuide(left, guides.x, GUIDE_LOCK_EPSILON);
	}
	if (!moved.right) {
		right = snapValueToGuide(right, guides.x, GUIDE_LOCK_EPSILON);
	}
	if (!moved.top) {
		top = snapValueToGuide(top, guides.y, GUIDE_LOCK_EPSILON);
	}
	if (!moved.bottom) {
		bottom = snapValueToGuide(bottom, guides.y, GUIDE_LOCK_EPSILON);
	}

	return {
		x: left,
		y: top,
		width: Math.max(0, right - left),
		height: Math.max(0, bottom - top),
	};
};

const createCopyElement = (source: TimelineElement, copyId: string) => ({
	...source,
	id: copyId,
	props: cloneValue(source.props),
	transform: cloneValue(source.transform),
	render: cloneValue(source.render),
	timeline: { ...source.timeline },
	...(source.clip ? { clip: cloneValue(source.clip) } : {}),
});

export const usePreviewInteractions = ({
	renderElements,
	renderElementsRef,
	canvasConvertOptions,
	canvasWidth,
	canvasHeight,
	getEffectiveZoom,
	stageToCanvasCoords,
	canvasToStageCoords,
}: UsePreviewInteractionsOptions) => {
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const { selectedIds, select, toggleSelect, deselectAll, setSelection } =
		useMultiSelect();
	const { snapEnabled } = useSnap();
	const { trackAssignments } = useTrackAssignments();
	const [selectionRect, setSelectionRect] = useState<SelectionRect>({
		visible: false,
		x1: 0,
		y1: 0,
		x2: 0,
		y2: 0,
	});
	const stageRef = useRef<Konva.Stage | null>(null);
	const transformerRef = useRef<Konva.Transformer | null>(null);
	const transformBaseRef = useRef<Record<string, TransformBase>>({});
	const transformCanvasBoxRef = useRef<Record<string, CanvasRect>>({});
	const groupProxyRef = useRef<Konva.Rect | null>(null);
	const groupTransformSnapshotRef = useRef<GroupTransformSnapshot | null>(null);
	const groupTransformingRef = useRef(false);
	const groupRotationRef = useRef(0);
	const groupCenterRef = useRef<Point | null>(null);
	const selectionKeyRef = useRef<string>("");
	const altPressedRef = useRef(false);
	const shiftPressedRef = useRef(false);
	const isSelecting = useRef(false);
	const selectionAdditiveRef = useRef(false);
	const initialSelectedIdsRef = useRef<string[]>([]);
	const selectionRectRef = useRef(selectionRect);
	const dragSelectedIdsRef = useRef<string[]>([]);
	const dragInitialPositionsRef = useRef<
		Record<string, { x: number; y: number }>
	>({});
	const dragSourcePositionsRef = useRef<
		Record<string, { x: number; y: number }>
	>({});
	const [snapGuides, setSnapGuides] = useState<SnapGuides>({
		vertical: [],
		horizontal: [],
	});
	const [groupProxyBox, setGroupProxyBox] = useState<TransformerBox | null>(
		null,
	);
	const copyModeRef = useRef(false);
	const copyIdMapRef = useRef<Map<string, string>>(new Map());
	const copySourceIdsRef = useRef<string[]>([]);
	const copySourceSnapshotsRef = useRef<Map<string, TimelineElement>>(
		new Map(),
	);
	const dragAnchorIdRef = useRef<string | null>(null);
	const suppressDragStartRef = useRef(false);
	const suppressDragEndRef = useRef<Set<string>>(new Set());
	const dragHasMovedRef = useRef(false);
	const dragLastCanvasRef = useRef<{ canvasX: number; canvasY: number } | null>(
		null,
	);

	const clearSnapGuides = useCallback(() => {
		setSnapGuides({ vertical: [], horizontal: [] });
	}, []);

	const updateTransformerCenteredScaling = useCallback((centered: boolean) => {
		const transformer = transformerRef.current;
		if (!transformer) return;
		transformer.centeredScaling(centered);
		transformer.getLayer()?.batchDraw();
	}, []);

	const updateTransformerRotationSnaps = useCallback((enabled: boolean) => {
		const transformer = transformerRef.current;
		if (!transformer) return;
		if (enabled) {
			transformer.rotationSnaps([0, 45, 90, 135, 180, 225, 270, 315]);
			transformer.rotationSnapTolerance(5);
		} else {
			transformer.rotationSnaps([]);
		}
		transformer.getLayer()?.batchDraw();
	}, []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!event.altKey || altPressedRef.current) return;
			altPressedRef.current = true;
			updateTransformerCenteredScaling(true);
		};

		const handleKeyUp = (event: KeyboardEvent) => {
			if (event.key !== "Alt" || !altPressedRef.current) return;
			altPressedRef.current = false;
			updateTransformerCenteredScaling(false);
		};

		const handleWindowBlur = () => {
			if (!altPressedRef.current) return;
			altPressedRef.current = false;
			updateTransformerCenteredScaling(false);
		};

		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);
		window.addEventListener("blur", handleWindowBlur);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
			window.removeEventListener("blur", handleWindowBlur);
		};
	}, [updateTransformerCenteredScaling]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!event.shiftKey || shiftPressedRef.current) return;
			shiftPressedRef.current = true;
			updateTransformerRotationSnaps(true);
		};

		const handleKeyUp = (event: KeyboardEvent) => {
			if (event.key !== "Shift" || !shiftPressedRef.current) return;
			shiftPressedRef.current = false;
			updateTransformerRotationSnaps(false);
		};

		const handleWindowBlur = () => {
			if (!shiftPressedRef.current) return;
			shiftPressedRef.current = false;
			updateTransformerRotationSnaps(false);
		};

		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);
		window.addEventListener("blur", handleWindowBlur);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
			window.removeEventListener("blur", handleWindowBlur);
		};
	}, [updateTransformerRotationSnaps]);

	useEffect(() => {
		const selectionKey = selectedIds.slice().sort().join("|");
		if (selectionKeyRef.current !== selectionKey) {
			selectionKeyRef.current = selectionKey;
			groupRotationRef.current = 0;
			groupCenterRef.current = null;
			groupTransformSnapshotRef.current = null;
			groupTransformingRef.current = false;
		}
	}, [selectedIds]);

	const getElementCanvasBox = useCallback(
		(el: TimelineElement): CanvasRect => {
			const renderLayout = transformMetaToRenderLayout(
				el.transform,
				canvasConvertOptions.picture,
				canvasConvertOptions.canvas,
			);
			const { x, y, width, height } = renderLayoutToTopLeft(renderLayout);
			return {
				x,
				y,
				width,
				height,
			};
		},
		[canvasConvertOptions],
	);

	const projectGuidesToStage = useCallback(
		(guides: SnapGuides): SnapGuides => {
			return {
				vertical: guides.vertical.map((x) => canvasToStageCoords(x, 0).stageX),
				horizontal: guides.horizontal.map(
					(y) => canvasToStageCoords(0, y).stageY,
				),
			};
		},
		[canvasToStageCoords],
	);

	const getSnapGuideValues = useCallback(
		(excludeIds: string[]): SnapGuideValues => {
			const guideX: number[] = [];
			const guideY: number[] = [];

			renderElementsRef.current.forEach((el) => {
				if (excludeIds.includes(el.id)) return;
				const box = getElementCanvasBox(el);
				guideX.push(box.x, box.x + box.width / 2, box.x + box.width);
				guideY.push(box.y, box.y + box.height / 2, box.y + box.height);
			});

			guideX.push(0, canvasWidth / 2, canvasWidth);
			guideY.push(0, canvasHeight / 2, canvasHeight);

			return {
				x: guideX,
				y: guideY,
			};
		},
		[getElementCanvasBox, renderElementsRef, canvasWidth, canvasHeight],
	);

	const computeGroupProxyBox = useCallback((): TransformerBox | null => {
		const selectedElements = renderElements.filter((el) =>
			selectedIds.includes(el.id),
		);
		if (selectedElements.length < 2) {
			return null;
		}

		const effectiveZoom = getEffectiveZoom();
		const corners: Point[] = [];

		selectedElements.forEach((el) => {
			const renderLayout = transformMetaToRenderLayout(
				el.transform,
				canvasConvertOptions.picture,
				canvasConvertOptions.canvas,
			);
			const { x, y, width, height, rotation } =
				renderLayoutToTopLeft(renderLayout);
			const { stageX: topLeftX, stageY: topLeftY } = canvasToStageCoords(x, y);
			const stageWidth = width * effectiveZoom;
			const stageHeight = height * effectiveZoom;
			const cos = Math.cos(rotation);
			const sin = Math.sin(rotation);

			corners.push(
				{ x: topLeftX, y: topLeftY },
				{ x: topLeftX + stageWidth * cos, y: topLeftY + stageWidth * sin },
				{
					x: topLeftX + stageWidth * cos - stageHeight * sin,
					y: topLeftY + stageWidth * sin + stageHeight * cos,
				},
				{
					x: topLeftX - stageHeight * sin,
					y: topLeftY + stageHeight * cos,
				},
			);
		});

		if (corners.length === 0) {
			return null;
		}

		let groupCenter = groupCenterRef.current;
		if (!groupCenter) {
			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;

			corners.forEach((corner) => {
				minX = Math.min(minX, corner.x);
				minY = Math.min(minY, corner.y);
				maxX = Math.max(maxX, corner.x);
				maxY = Math.max(maxY, corner.y);
			});

			groupCenter = {
				x: (minX + maxX) / 2,
				y: (minY + maxY) / 2,
			};
			groupCenterRef.current = groupCenter;
		}

		const rotation = groupRotationRef.current;
		const cos = Math.cos(-rotation);
		const sin = Math.sin(-rotation);
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;

		corners.forEach((corner) => {
			const dx = corner.x - groupCenter.x;
			const dy = corner.y - groupCenter.y;
			const localX = dx * cos - dy * sin;
			const localY = dx * sin + dy * cos;
			minX = Math.min(minX, localX);
			minY = Math.min(minY, localY);
			maxX = Math.max(maxX, localX);
			maxY = Math.max(maxY, localY);
		});

		const localCenter = {
			x: (minX + maxX) / 2,
			y: (minY + maxY) / 2,
		};
		const cosForward = Math.cos(rotation);
		const sinForward = Math.sin(rotation);
		const nextCenter = {
			x:
				groupCenter.x + localCenter.x * cosForward - localCenter.y * sinForward,
			y:
				groupCenter.y + localCenter.x * sinForward + localCenter.y * cosForward,
		};

		groupCenterRef.current = nextCenter;

		return {
			x: nextCenter.x,
			y: nextCenter.y,
			width: Math.max(0, maxX - minX),
			height: Math.max(0, maxY - minY),
			rotation: toDegrees(rotation),
		};
	}, [
		canvasConvertOptions,
		canvasToStageCoords,
		getEffectiveZoom,
		renderElements,
		selectedIds,
	]);

	useEffect(() => {
		if (selectedIds.length < 2) {
			groupRotationRef.current = 0;
			groupCenterRef.current = null;
			groupTransformSnapshotRef.current = null;
			groupTransformingRef.current = false;
			setGroupProxyBox(null);
			return;
		}
		if (groupTransformingRef.current) {
			return;
		}
		setGroupProxyBox(computeGroupProxyBox());
	}, [computeGroupProxyBox, selectedIds.length]);

	const computeSnapResult = useCallback(
		(
			movingBox: CanvasRect,
			excludeIds: string[],
			threshold: number,
			options?: SnapComputeOptions,
			guideValues?: SnapGuideValues,
		) => {
			const guides = guideValues ?? getSnapGuideValues(excludeIds);
			const guideX = guides.x;
			const guideY = guides.y;

			const movingX = options?.movingX ?? [
				movingBox.x,
				movingBox.x + movingBox.width / 2,
				movingBox.x + movingBox.width,
			];
			const movingY = options?.movingY ?? [
				movingBox.y,
				movingBox.y + movingBox.height / 2,
				movingBox.y + movingBox.height,
			];

			const bestX = findNearestGuide(movingX, guideX);
			const bestY = findNearestGuide(movingY, guideY);

			return {
				deltaX:
					bestX.line !== null && bestX.distance <= threshold ? bestX.delta : 0,
				deltaY:
					bestY.line !== null && bestY.distance <= threshold ? bestY.delta : 0,
				guides: {
					vertical:
						bestX.line !== null && bestX.distance <= threshold
							? [bestX.line]
							: [],
					horizontal:
						bestY.line !== null && bestY.distance <= threshold
							? [bestY.line]
							: [],
				},
			};
		},
		[getSnapGuideValues],
	);

	const getTrackIndexForElement = useCallback(
		(el: TimelineElement) =>
			trackAssignments.get(el.id) ?? el.timeline.trackIndex ?? 0,
		[trackAssignments],
	);

	const clearCopyState = useCallback(() => {
		copyModeRef.current = false;
		copyIdMapRef.current = new Map();
		copySourceIdsRef.current = [];
		copySourceSnapshotsRef.current = new Map();
		dragAnchorIdRef.current = null;
		suppressDragStartRef.current = false;
		suppressDragEndRef.current.clear();
		dragHasMovedRef.current = false;
		dragLastCanvasRef.current = null;
		dragSourcePositionsRef.current = {};
	}, []);

	const applyTrackAssignments = useCallback(
		(nextElements: TimelineElement[]) => {
			return nextElements;
		},
		[],
	);

	const resetCopySourceNodes = useCallback(() => {
		const stage = stageRef.current ?? transformerRef.current?.getStage();
		if (!stage) return;
		const snapshots = copySourceSnapshotsRef.current;
		if (snapshots.size === 0) return;

		snapshots.forEach((source, sourceId) => {
			const node = stage.findOne(`.element-${sourceId}`) as Konva.Node | null;
			if (!node) return;
			const { x, y } = getElementCanvasBox(source);
			const { stageX, stageY } = canvasToStageCoords(x, y);
			node.position({ x: stageX, y: stageY });
		});

		stage.batchDraw();
	}, [getElementCanvasBox, canvasToStageCoords]);

	const handleMouseDown = useCallback((id: string) => {
		setDraggingId(id);
	}, []);

	const handleMouseUp = useCallback(() => {
		setDraggingId(null);
		clearSnapGuides();
	}, [clearSnapGuides]);

	const handleDragStart = useCallback(
		(id: string, e: Konva.KonvaEventObject<DragEvent>) => {
			if (suppressDragStartRef.current) {
				suppressDragStartRef.current = false;
				return;
			}
			dragLastCanvasRef.current = null;
			const nextSelectedIds = selectedIds.includes(id) ? selectedIds : [id];
			if (!selectedIds.includes(id)) {
				setSelection([id], id);
			}

			const currentElements = useTimelineStore.getState().elements;
			const positions: Record<string, { x: number; y: number }> = {};
			for (const el of currentElements) {
				if (!nextSelectedIds.includes(el.id)) continue;
				const renderLayout = transformMetaToRenderLayout(
					el.transform,
					canvasConvertOptions.picture,
					canvasConvertOptions.canvas,
				);
				const { x, y } = renderLayoutToTopLeft(renderLayout);
				positions[el.id] = { x, y };
			}

			const isCopyDragStart = Boolean(
				(e.evt as MouseEvent | undefined)?.altKey,
			);
			copyModeRef.current = isCopyDragStart;
			dragHasMovedRef.current = false;
			dragSourcePositionsRef.current = isCopyDragStart ? positions : {};

			let dragSelectedIds = nextSelectedIds;
			let dragPositions: Record<string, { x: number; y: number }> = {};
			let draggingIndicatorId = id;

			if (isCopyDragStart) {
				copySourceIdsRef.current = nextSelectedIds;
				const sourceSnapshots = new Map<string, TimelineElement>();
				nextSelectedIds.forEach((sourceId) => {
					const source = currentElements.find((el) => el.id === sourceId);
					if (source) sourceSnapshots.set(sourceId, source);
				});
				copySourceSnapshotsRef.current = sourceSnapshots;

				const seed = createCopySeed();
				const nextMap = new Map<string, string>();
				nextSelectedIds.forEach((sourceId, index) => {
					nextMap.set(sourceId, `element-${seed}-${index}`);
				});
				copyIdMapRef.current = nextMap;

				const copyIds = nextSelectedIds
					.map((sourceId) => nextMap.get(sourceId))
					.filter((copyId): copyId is string => Boolean(copyId));

				const copies = currentElements
					.map((el) => {
						const copyId = nextMap.get(el.id);
						if (!copyId || !nextSelectedIds.includes(el.id)) return null;
						return createCopyElement(el, copyId);
					})
					.filter(Boolean) as TimelineElement[];

				if (copies.length > 0) {
					useTimelineStore.setState({
						elements: [...currentElements, ...copies],
					});
				}

				// 在 alt 复制模式下，我们继续拖拽源元素，但将位移应用到副本上
				// 保持选中源元素，这样 Transformer 可以正确绑定到现有的源节点
				// 拖拽结束后再切换选择到副本
				// dragSelectedIds 存储副本 ID，用于在 handleDrag 中更新副本元素
				dragSelectedIds = [...copyIds];
				// dragPositions 存储副本 ID -> 源元素初始位置的映射
				nextSelectedIds.forEach((sourceId) => {
					const copyId = nextMap.get(sourceId);
					const position = positions[sourceId];
					if (!copyId || !position) return;
					dragPositions[copyId] = position;
				});

				// 不切换选择，保持源元素被选中（Transformer 绑定到源节点）
				draggingIndicatorId = id; // 继续使用源元素 ID
				// dragAnchorId 使用被点击源元素对应的副本 ID
				const primaryCopyId = nextMap.get(id) ?? copyIds[0] ?? id;
				dragAnchorIdRef.current = primaryCopyId;
			} else {
				copyIdMapRef.current = new Map();
				copySourceIdsRef.current = [];
				copySourceSnapshotsRef.current = new Map();
				dragAnchorIdRef.current = id;
				dragPositions = positions;
			}

			dragSelectedIdsRef.current = dragSelectedIds;
			dragInitialPositionsRef.current = dragPositions;

			setDraggingId(draggingIndicatorId);
			setHoveredId(draggingIndicatorId); // 拖拽开始时保持 hover 状态
		},
		[selectedIds, setSelection, canvasConvertOptions],
	);

	const applyDragToElements = useCallback(
		(canvasX: number, canvasY: number, anchorId?: string) => {
			const dragSelectedIds = dragSelectedIdsRef.current;
			const initialPositions = dragInitialPositionsRef.current;
			const dragAnchorId = anchorId ?? dragAnchorIdRef.current;
			if (!dragAnchorId) return;

			const isMultiDrag =
				dragSelectedIds.length > 1 && dragSelectedIds.includes(dragAnchorId);
			const draggedInitial = initialPositions[dragAnchorId];
			if (isMultiDrag && !draggedInitial) return;

			const deltaX = draggedInitial ? canvasX - draggedInitial.x : 0;
			const deltaY = draggedInitial ? canvasY - draggedInitial.y : 0;

			// 直接使用 setState 确保更新被触发
			const currentElements = useTimelineStore.getState().elements;
			const newElements = currentElements.map((el) => {
				const isDragged = dragSelectedIds.includes(el.id);
				const initial = initialPositions[el.id];
				if (isMultiDrag && isDragged && initial && draggedInitial) {
					const nextCanvasX = initial.x + deltaX;
					const nextCanvasY = initial.y + deltaY;
					const size = getTransformSize(el.transform);
					const updatedTransform = quantizeTransform({
						...el.transform,
						position: {
							...el.transform.position,
							x: nextCanvasX + size.width * el.transform.anchor.x,
							y: nextCanvasY + size.height * el.transform.anchor.y,
						},
					});

					return {
						...el,
						transform: updatedTransform,
					};
				}

				// 使用 el.id 而不是 el.props.id
				if (!isDragged || el.id !== dragAnchorId) return el;

				const size = getTransformSize(el.transform);
				const updatedTransform = quantizeTransform({
					...el.transform,
					position: {
						...el.transform.position,
						x: canvasX + size.width * el.transform.anchor.x,
						y: canvasY + size.height * el.transform.anchor.y,
					},
				});

				return {
					...el,
					transform: updatedTransform,
				};
			});

			useTimelineStore.setState({ elements: newElements });
		},
		[],
	);

	const handleDrag = useCallback(
		(id: string, e: Konva.KonvaEventObject<DragEvent>) => {
			const node = e.target;
			const stageX = node.x();
			const stageY = node.y();
			const effectiveZoom = getEffectiveZoom();
			const stageWidth = node.width() * node.scaleX();
			const stageHeight = node.height() * node.scaleY();
			const { canvasX: rawCanvasX, canvasY: rawCanvasY } = stageToCanvasCoords(
				stageX,
				stageY,
			);

			const dragSelectedIds = dragSelectedIdsRef.current;
			const initialPositions = dragInitialPositionsRef.current;
			const dragAnchorId = dragAnchorIdRef.current ?? id;
			const isMultiDrag =
				dragSelectedIds.length > 1 && dragSelectedIds.includes(dragAnchorId);
			const draggedInitial = initialPositions[dragAnchorId];

			const currentElements = useTimelineStore.getState().elements;
			let adjustedCanvasX = rawCanvasX;
			let adjustedCanvasY = rawCanvasY;

			if (snapEnabled) {
				let movingBox: CanvasRect = {
					x: rawCanvasX,
					y: rawCanvasY,
					width: stageWidth / effectiveZoom,
					height: stageHeight / effectiveZoom,
				};

				if (isMultiDrag && draggedInitial) {
					let minX = Infinity;
					let minY = Infinity;
					let maxX = -Infinity;
					let maxY = -Infinity;

					dragSelectedIds.forEach((selectedId) => {
						const element = currentElements.find((el) => el.id === selectedId);
						if (!element) return;

						const renderLayout = transformMetaToRenderLayout(
							element.transform,
							canvasConvertOptions.picture,
							canvasConvertOptions.canvas,
						);
						const { x, y, width, height } = renderLayoutToTopLeft(renderLayout);
						const initial = initialPositions[selectedId];
						const baseX = initial?.x ?? x;
						const baseY = initial?.y ?? y;
						minX = Math.min(minX, baseX);
						minY = Math.min(minY, baseY);
						maxX = Math.max(maxX, baseX + width);
						maxY = Math.max(maxY, baseY + height);
					});

					if (minX !== Infinity) {
						const deltaCanvasX = rawCanvasX - draggedInitial.x;
						const deltaCanvasY = rawCanvasY - draggedInitial.y;
						movingBox = {
							x: minX + deltaCanvasX,
							y: minY + deltaCanvasY,
							width: maxX - minX,
							height: maxY - minY,
						};
					}
				}

				// In copy mode, keep source elements as snap guides.
				const snapExcludeIds = dragSelectedIds;
				const snapThreshold =
					SNAP_GUIDE_THRESHOLD / Math.max(effectiveZoom, 1e-6);
				const snapResult = computeSnapResult(
					movingBox,
					snapExcludeIds,
					snapThreshold,
				);
				adjustedCanvasX += snapResult.deltaX;
				adjustedCanvasY += snapResult.deltaY;
				setSnapGuides(projectGuidesToStage(snapResult.guides));
			} else {
				clearSnapGuides();
			}

			const { stageX: adjustedStageX, stageY: adjustedStageY } =
				canvasToStageCoords(adjustedCanvasX, adjustedCanvasY);
			if (adjustedStageX !== stageX || adjustedStageY !== stageY) {
				node.position({ x: adjustedStageX, y: adjustedStageY });
			}

			const canvasX = adjustedCanvasX;
			const canvasY = adjustedCanvasY;
			dragLastCanvasRef.current = { canvasX, canvasY };

			if (draggedInitial) {
				const deltaX = canvasX - draggedInitial.x;
				const deltaY = canvasY - draggedInitial.y;
				if (deltaX !== 0 || deltaY !== 0) {
					dragHasMovedRef.current = true;
				}
			}

			// 在多选拖拽时，直接更新所有选中节点的 Konva 位置
			// 这可以防止 Transformer 与元素位置不同步导致的抖动
			if (isMultiDrag && draggedInitial) {
				const stage = node.getStage();
				const deltaCanvasX = canvasX - draggedInitial.x;
				const deltaCanvasY = canvasY - draggedInitial.y;

				if (copyModeRef.current) {
					const sourceIds = copySourceIdsRef.current;
					const sourcePositions = dragSourcePositionsRef.current;
					sourceIds.forEach((sourceId) => {
						const initial = sourcePositions[sourceId];
						if (!initial) return;

						const otherNode = stage?.findOne(
							`.element-${sourceId}`,
						) as Konva.Node | null;
						if (!otherNode) return;

						const nextCanvasX = initial.x + deltaCanvasX;
						const nextCanvasY = initial.y + deltaCanvasY;
						const { stageX: nextStageX, stageY: nextStageY } =
							canvasToStageCoords(nextCanvasX, nextCanvasY);
						otherNode.position({ x: nextStageX, y: nextStageY });
					});
				} else {
					dragSelectedIds.forEach((selectedId) => {
						if (selectedId === dragAnchorId) return; // 锚点节点已经更新
						const initial = initialPositions[selectedId];
						if (!initial) return;

						const otherNode = stage?.findOne(
							`.element-${selectedId}`,
						) as Konva.Node | null;
						if (!otherNode) return;

						const nextCanvasX = initial.x + deltaCanvasX;
						const nextCanvasY = initial.y + deltaCanvasY;
						const { stageX: nextStageX, stageY: nextStageY } =
							canvasToStageCoords(nextCanvasX, nextCanvasY);
						otherNode.position({ x: nextStageX, y: nextStageY });
					});
				}
			}

			applyDragToElements(canvasX, canvasY, dragAnchorId);
		},
		[
			stageToCanvasCoords,
			snapEnabled,
			getEffectiveZoom,
			canvasConvertOptions,
			canvasToStageCoords,
			computeSnapResult,
			clearSnapGuides,
			applyDragToElements,
			projectGuidesToStage,
		],
	);

	const handleDragEnd = useCallback(
		(id: string, e: Konva.KonvaEventObject<DragEvent>) => {
			if (suppressDragEndRef.current.has(id)) {
				suppressDragEndRef.current.delete(id);
				return;
			}
			if (copyModeRef.current) {
				// In copy mode, use the last drag position to avoid a late source reset.
				const lastDrag = dragLastCanvasRef.current;
				if (lastDrag) {
					applyDragToElements(
						lastDrag.canvasX,
						lastDrag.canvasY,
						dragAnchorIdRef.current ?? id,
					);
				}
			} else {
				handleDrag(id, e);
			}
			setDraggingId(null);
			clearSnapGuides();

			if (copyModeRef.current) {
				// Always restore original elements to their pre-copy snapshot.
				const snapshots = copySourceSnapshotsRef.current;
				if (snapshots.size > 0) {
					const currentElements = useTimelineStore.getState().elements;
					const restored = currentElements.map(
						(el) => snapshots.get(el.id) ?? el,
					);
					useTimelineStore.setState({ elements: restored });
				}

				resetCopySourceNodes();

				// If there was no movement, treat it as a cancelled copy-drag.
				if (!dragHasMovedRef.current) {
					const copyIds = new Set(copyIdMapRef.current.values());
					if (copyIds.size > 0) {
						const currentElements = useTimelineStore.getState().elements;
						const nextElements = currentElements.filter(
							(el) => !copyIds.has(el.id),
						);
						useTimelineStore.setState({ elements: nextElements });
					}

					const sources = copySourceIdsRef.current;
					if (sources.length > 0) {
						const primaryId = sources.includes(id) ? id : (sources[0] ?? null);
						setSelection(sources, primaryId);
					}
				} else {
					// 复制成功，切换选择到副本元素
					const copyIds = Array.from(copyIdMapRef.current.values());
					if (copyIds.length > 0) {
						const primaryCopyId = copyIdMapRef.current.get(id) ?? copyIds[0];
						setSelection(copyIds, primaryCopyId ?? null);
					}

					const currentElements = useTimelineStore.getState().elements;
					useTimelineStore.setState({
						elements: applyTrackAssignments(currentElements),
					});
				}
			}

			clearCopyState();
		},
		[
			handleDrag,
			clearSnapGuides,
			clearCopyState,
			setSelection,
			applyTrackAssignments,
			resetCopySourceNodes,
			applyDragToElements,
		],
	);

	const handleMouseEnter = useCallback(
		(id: string) => {
			if (!draggingId) {
				setHoveredId(id);
			}
		},
		[draggingId],
	);

	const handleMouseLeave = useCallback(() => {
		if (!draggingId) {
			setHoveredId(null);
		}
	}, [draggingId]);

	// 更新 Transformer 的节点（时间变化时也需要刷新）
	useEffect(() => {
		if (!transformerRef.current) return;

		const stage = transformerRef.current.getStage();
		if (!stage) return;

		const visibleSelectedIds = selectedIds.filter((id) =>
			renderElements.some((el) => el.id === id),
		);
		if (visibleSelectedIds.length > 1 && groupProxyRef.current) {
			transformerRef.current.nodes([groupProxyRef.current]);
		} else {
			const nodes = visibleSelectedIds
				.map((id) => stage.findOne(`.element-${id}`))
				.filter((node): node is Konva.Node => Boolean(node));
			transformerRef.current.nodes(nodes);
		}
		transformerRef.current.centeredScaling(altPressedRef.current);
		transformerRef.current.rotationSnaps(
			shiftPressedRef.current ? [0, 45, 90, 135, 180, 225, 270, 315] : [],
		);
		transformerRef.current.getLayer()?.batchDraw();
	}, [selectedIds, renderElements]);

	const snapshotGroupTransform = useCallback(
		(node: Konva.Rect) => {
			groupTransformingRef.current = true;
			const baseCenter = { x: node.x(), y: node.y() };
			const baseRotation = toRadians(node.rotation());
			const baseScaleX = node.scaleX() || 1;
			const baseScaleY = node.scaleY() || 1;
			const baseTransform = node.getAbsoluteTransform().copy();
			const elements: Record<string, GroupElementSnapshot> = {};

			selectedIds.forEach((id) => {
				const element = renderElementsRef.current.find((el) => el.id === id);
				if (!element) return;

				const renderLayout = transformMetaToRenderLayout(
					element.transform,
					canvasConvertOptions.picture,
					canvasConvertOptions.canvas,
				);
				const { x, y, width, height, rotation } =
					renderLayoutToTopLeft(renderLayout);
				const { stageX, stageY } = canvasToStageCoords(x, y);

				elements[id] = {
					topLeft: { x: stageX, y: stageY },
					width,
					height,
					rotation,
				};
			});

			groupTransformSnapshotRef.current = {
				center: baseCenter,
				rotation: baseRotation,
				scaleX: baseScaleX,
				scaleY: baseScaleY,
				transform: baseTransform,
				elements,
			};
		},
		[canvasConvertOptions, canvasToStageCoords, renderElementsRef, selectedIds],
	);

	const handleGroupTransformStart = useCallback(
		(e: Konva.KonvaEventObject<Event>) => {
			const node = e.target as Konva.Rect;
			snapshotGroupTransform(node);
		},
		[snapshotGroupTransform],
	);

	const handleGroupTransform = useCallback(
		(e: Konva.KonvaEventObject<Event>) => {
			const node = e.target as Konva.Rect;
			if (!groupTransformSnapshotRef.current) {
				snapshotGroupTransform(node);
			}
			const snapshot = groupTransformSnapshotRef.current;
			if (!snapshot) return;

			const currentCenter = { x: node.x(), y: node.y() };
			const currentRotation = toRadians(node.rotation());
			const currentScaleX = node.scaleX() || 1;
			const currentScaleY = node.scaleY() || 1;
			const currentTransform = node.getAbsoluteTransform().copy();
			const inverseBase = snapshot.transform.copy().invert();
			const deltaTransform = currentTransform.copy().multiply(inverseBase);

			const deltaRotation = currentRotation - snapshot.rotation;
			const scaleX = currentScaleX / snapshot.scaleX;
			const scaleY = currentScaleY / snapshot.scaleY;

			const currentElements = useTimelineStore.getState().elements;
			const newElements = currentElements.map((el) => {
				const base = snapshot.elements[el.id];
				if (!base) return el;

				const nextTopLeft = deltaTransform.point(base.topLeft);
				const { canvasX: nextLeft, canvasY: nextTop } = stageToCanvasCoords(
					nextTopLeft.x,
					nextTopLeft.y,
				);
				const nextWidth = base.width * scaleX;
				const nextHeight = base.height * scaleY;
				const nextRotation = base.rotation + deltaRotation;
				const nextScaleX = resolveScaleFromSize(
					nextWidth,
					el.transform.baseSize.width,
					el.transform.scale.x,
				);
				const nextScaleY = resolveScaleFromSize(
					nextHeight,
					el.transform.baseSize.height,
					el.transform.scale.y,
				);
				const updatedTransform = quantizeTransform({
					...el.transform,
					position: {
						...el.transform.position,
						x: nextLeft + nextWidth * el.transform.anchor.x,
						y: nextTop + nextHeight * el.transform.anchor.y,
					},
					scale: {
						x: nextScaleX,
						y: nextScaleY,
					},
					rotation: {
						...el.transform.rotation,
						value: toDegrees(nextRotation),
					},
				});

				return {
					...el,
					transform: updatedTransform,
				};
			});

			useTimelineStore.setState({ elements: newElements });
			groupRotationRef.current = currentRotation;
			groupCenterRef.current = currentCenter;
			setGroupProxyBox({
				x: currentCenter.x,
				y: currentCenter.y,
				width: node.width(),
				height: node.height(),
				rotation: node.rotation(),
			});
		},
		[snapshotGroupTransform, stageToCanvasCoords],
	);

	const handleGroupTransformEnd = useCallback(
		(e: Konva.KonvaEventObject<Event>) => {
			const node = e.target as Konva.Rect;
			const scaleX = node.scaleX() || 1;
			const scaleY = node.scaleY() || 1;
			if (scaleX !== 1 || scaleY !== 1) {
				node.scaleX(1);
				node.scaleY(1);
				node.width(node.width() * scaleX);
				node.height(node.height() * scaleY);
			}

			groupRotationRef.current = toRadians(node.rotation());
			groupCenterRef.current = { x: node.x(), y: node.y() };
			groupTransformSnapshotRef.current = null;
			groupTransformingRef.current = false;
			setGroupProxyBox({
				x: node.x(),
				y: node.y(),
				width: node.width(),
				height: node.height(),
				rotation: node.rotation(),
			});
			clearSnapGuides();
		},
		[clearSnapGuides],
	);

	// 处理 transform 事件（实时更新）
	const handleTransformStart = useCallback(
		(id: string, e: Konva.KonvaEventObject<Event>) => {
			const node = e.target as Konva.Node;
			const element = useTimelineStore
				.getState()
				.elements.find((el) => el.id === id);
			delete transformCanvasBoxRef.current[id];
			if ("altKey" in e.evt) {
				const eventAltPressed = Boolean((e.evt as MouseEvent).altKey);
				if (eventAltPressed !== altPressedRef.current) {
					altPressedRef.current = eventAltPressed;
					updateTransformerCenteredScaling(eventAltPressed);
				}
			}
			if ("shiftKey" in e.evt) {
				const eventShiftPressed = Boolean((e.evt as MouseEvent).shiftKey);
				if (eventShiftPressed !== shiftPressedRef.current) {
					shiftPressedRef.current = eventShiftPressed;
					updateTransformerRotationSnaps(eventShiftPressed);
				}
			}
			const effectiveZoom = getEffectiveZoom();
			const baseScaleX = node.scaleX() || 1;
			const baseScaleY = node.scaleY() || 1;
			const baseStageWidth = node.width() * baseScaleX;
			const baseStageHeight = node.height() * baseScaleY;

			transformBaseRef.current[id] = {
				stageWidth: baseStageWidth,
				stageHeight: baseStageHeight,
				canvasWidth: baseStageWidth / effectiveZoom,
				canvasHeight: baseStageHeight / effectiveZoom,
				scaleX: baseScaleX,
				scaleY: baseScaleY,
				effectiveZoom,
				elementScaleX: element?.transform.scale.x ?? 1,
				elementScaleY: element?.transform.scale.y ?? 1,
				activeAnchor: transformerRef.current?.getActiveAnchor?.() ?? null,
			};
		},
		[
			getEffectiveZoom,
			updateTransformerCenteredScaling,
			updateTransformerRotationSnaps,
		],
	);

	const handleTransform = useCallback(
		(id: string, e: Konva.KonvaEventObject<Event>) => {
			const node = e.target as Konva.Node;
			let base = transformBaseRef.current[id];
			if (!base) {
				const effectiveZoom = getEffectiveZoom();
				const baseScaleX = node.scaleX() || 1;
				const baseScaleY = node.scaleY() || 1;
				const baseStageWidth = node.width() * baseScaleX;
				const baseStageHeight = node.height() * baseScaleY;
				const element = useTimelineStore
					.getState()
					.elements.find((el) => el.id === id);

				base = {
					stageWidth: baseStageWidth,
					stageHeight: baseStageHeight,
					canvasWidth: baseStageWidth / effectiveZoom,
					canvasHeight: baseStageHeight / effectiveZoom,
					scaleX: baseScaleX,
					scaleY: baseScaleY,
					effectiveZoom,
					elementScaleX: element?.transform.scale.x ?? 1,
					elementScaleY: element?.transform.scale.y ?? 1,
					activeAnchor: transformerRef.current?.getActiveAnchor?.() ?? null,
				};
				transformBaseRef.current[id] = base;
			}

			const stageX = node.x();
			const stageY = node.y();
			const stageWidthScaled = node.width() * node.scaleX();
			const stageHeightScaled = node.height() * node.scaleY();
			const cachedCanvasBox = transformCanvasBoxRef.current[id];
			const fallbackCanvasPos = stageToCanvasCoords(stageX, stageY);
			const canvasX = cachedCanvasBox?.x ?? fallbackCanvasPos.canvasX;
			const canvasY = cachedCanvasBox?.y ?? fallbackCanvasPos.canvasY;
			const pictureWidthScaled =
				cachedCanvasBox?.width ?? stageWidthScaled / base.effectiveZoom;
			const pictureHeightScaled =
				cachedCanvasBox?.height ?? stageHeightScaled / base.effectiveZoom;
			const rotationDegrees = node.rotation();
			const activeAnchor =
				base.activeAnchor ??
				transformerRef.current?.getActiveAnchor?.() ??
				null;

			const currentElements = useTimelineStore.getState().elements;
			const newElements = currentElements.map((el) => {
				if (el.id !== id) return el;

				let nextScaleX = resolveScaleFromSize(
					pictureWidthScaled,
					el.transform.baseSize.width,
					base.elementScaleX,
				);
				let nextScaleY = resolveScaleFromSize(
					pictureHeightScaled,
					el.transform.baseSize.height,
					base.elementScaleY,
				);
				if (isCornerResizeAnchor(activeAnchor)) {
					const uniformScale = resolveUniformScale({
						nextWidth: pictureWidthScaled,
						nextHeight: pictureHeightScaled,
						baseWidth: el.transform.baseSize.width,
						baseHeight: el.transform.baseSize.height,
						previousScaleX: base.elementScaleX,
						previousScaleY: base.elementScaleY,
					});
					nextScaleX = uniformScale.scaleX;
					nextScaleY = uniformScale.scaleY;
				} else if (isHorizontalResizeAnchor(activeAnchor)) {
					nextScaleY = base.elementScaleY;
				} else if (isVerticalResizeAnchor(activeAnchor)) {
					nextScaleX = base.elementScaleX;
				}
				const nextWidth = el.transform.baseSize.width * Math.abs(nextScaleX);
				const nextHeight = el.transform.baseSize.height * Math.abs(nextScaleY);
				const updatedTransform = quantizeTransform({
					...el.transform,
					position: {
						...el.transform.position,
						x: canvasX + nextWidth * el.transform.anchor.x,
						y: canvasY + nextHeight * el.transform.anchor.y,
					},
					scale: {
						x: nextScaleX,
						y: nextScaleY,
					},
					rotation: {
						...el.transform.rotation,
						value: rotationDegrees,
					},
				});

				return {
					...el,
					transform: updatedTransform,
				};
			});

			useTimelineStore.setState({ elements: newElements });
		},
		[stageToCanvasCoords, getEffectiveZoom],
	);

	// 处理 transform 结束事件
	const handleTransformEnd = useCallback(
		(id: string, e: Konva.KonvaEventObject<Event>) => {
			const node = e.target as Konva.Node;
			const base = transformBaseRef.current[id];

			const stageWidthScaled = node.width() * node.scaleX();
			const stageHeightScaled = node.height() * node.scaleY();

			// 重置 scale，更新 width 和 height
			node.scaleX(1);
			node.scaleY(1);
			node.width(stageWidthScaled);
			node.height(stageHeightScaled);

			const stageX = node.x();
			const stageY = node.y();
			const cachedCanvasBox = transformCanvasBoxRef.current[id];
			const fallbackCanvasPos = stageToCanvasCoords(stageX, stageY);
			const canvasX = cachedCanvasBox?.x ?? fallbackCanvasPos.canvasX;
			const canvasY = cachedCanvasBox?.y ?? fallbackCanvasPos.canvasY;
			const effectiveZoom = base?.effectiveZoom ?? getEffectiveZoom();
			const pictureWidthScaled =
				cachedCanvasBox?.width ?? stageWidthScaled / effectiveZoom;
			const pictureHeightScaled =
				cachedCanvasBox?.height ?? stageHeightScaled / effectiveZoom;
			const rotationDegrees = node.rotation();
			const activeAnchor =
				base?.activeAnchor ??
				transformerRef.current?.getActiveAnchor?.() ??
				null;

			const currentElements = useTimelineStore.getState().elements;
			const newElements = currentElements.map((el) => {
				if (el.id !== id) return el;

				let nextScaleX = resolveScaleFromSize(
					pictureWidthScaled,
					el.transform.baseSize.width,
					base?.elementScaleX ?? el.transform.scale.x,
				);
				let nextScaleY = resolveScaleFromSize(
					pictureHeightScaled,
					el.transform.baseSize.height,
					base?.elementScaleY ?? el.transform.scale.y,
				);
				if (isCornerResizeAnchor(activeAnchor)) {
					const uniformScale = resolveUniformScale({
						nextWidth: pictureWidthScaled,
						nextHeight: pictureHeightScaled,
						baseWidth: el.transform.baseSize.width,
						baseHeight: el.transform.baseSize.height,
						previousScaleX: base?.elementScaleX ?? el.transform.scale.x,
						previousScaleY: base?.elementScaleY ?? el.transform.scale.y,
					});
					nextScaleX = uniformScale.scaleX;
					nextScaleY = uniformScale.scaleY;
				} else if (isHorizontalResizeAnchor(activeAnchor)) {
					nextScaleY = base?.elementScaleY ?? el.transform.scale.y;
				} else if (isVerticalResizeAnchor(activeAnchor)) {
					nextScaleX = base?.elementScaleX ?? el.transform.scale.x;
				}
				const nextWidth = el.transform.baseSize.width * Math.abs(nextScaleX);
				const nextHeight = el.transform.baseSize.height * Math.abs(nextScaleY);
				const updatedTransform = quantizeTransform({
					...el.transform,
					position: {
						...el.transform.position,
						x: canvasX + nextWidth * el.transform.anchor.x,
						y: canvasY + nextHeight * el.transform.anchor.y,
					},
					scale: {
						x: nextScaleX,
						y: nextScaleY,
					},
					rotation: {
						...el.transform.rotation,
						value: rotationDegrees,
					},
				});

				return {
					...el,
					transform: updatedTransform,
				};
			});

			useTimelineStore.setState({ elements: newElements });
			delete transformBaseRef.current[id];
			delete transformCanvasBoxRef.current[id];
			clearSnapGuides();
		},
		[stageToCanvasCoords, getEffectiveZoom, clearSnapGuides],
	);

	// 处理点击事件，支持选择/取消选择
	const handleStageClick = useCallback(
		(e: Konva.KonvaEventObject<MouseEvent>) => {
			// 如果正在使用选择框，不处理点击
			if (
				selectionRect.visible &&
				selectionRect.x2 !== selectionRect.x1 &&
				selectionRect.y2 !== selectionRect.y1
			) {
				return;
			}

			// 点击空白区域，取消选择
			if (e.target === e.target.getStage()) {
				deselectAll();
				return;
			}

			// 检查是否点击了元素
			const clickedId = (e.target as Konva.Node).attrs["data-id"];
			if (!clickedId) {
				return;
			}

			// 检查是否按下了 Shift 或 Ctrl/Cmd
			const metaPressed = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
			if (metaPressed) {
				toggleSelect(clickedId);
				return;
			}

			select(clickedId);
		},
		[selectionRect, deselectAll, toggleSelect, select],
	);

	// 处理鼠标按下，开始选择框
	const handleStageMouseDown = useCallback(
		(e: Konva.KonvaEventObject<MouseEvent>) => {
			// 如果点击的不是 stage，不处理
			if (e.target !== e.target.getStage()) {
				return;
			}

			const pos = e.target.getStage().getPointerPosition();
			if (!pos) return;

			// 将 Stage 坐标转换为画布坐标用于选择框显示
			const { canvasX, canvasY } = stageToCanvasCoords(pos.x, pos.y);

			isSelecting.current = true;
			selectionAdditiveRef.current =
				e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
			initialSelectedIdsRef.current = selectedIds;
			const nextRect = {
				visible: true,
				x1: canvasX,
				y1: canvasY,
				x2: canvasX,
				y2: canvasY,
			};
			selectionRectRef.current = nextRect;
			setSelectionRect(nextRect);
		},
		[stageToCanvasCoords, selectedIds],
	);

	const computeSelectedIdsInRect = useCallback(
		(rect: { x1: number; y1: number; x2: number; y2: number }) => {
			const selBox = {
				x: Math.min(rect.x1, rect.x2),
				y: Math.min(rect.y1, rect.y2),
				width: Math.abs(rect.x2 - rect.x1),
				height: Math.abs(rect.y2 - rect.y1),
			};

			const selected: string[] = [];
			renderElements.forEach((el) => {
				const renderLayout = transformMetaToRenderLayout(
					el.transform,
					canvasConvertOptions.picture,
					canvasConvertOptions.canvas,
				);
				const { x, y, width, height } = renderLayoutToTopLeft(renderLayout);

				const elBox = {
					x,
					y,
					width,
					height,
				};

				if (
					selBox.x < elBox.x + elBox.width &&
					selBox.x + selBox.width > elBox.x &&
					selBox.y < elBox.y + elBox.height &&
					selBox.y + selBox.height > elBox.y
				) {
					selected.push(el.id);
				}
			});

			return selected;
		},
		[renderElements, canvasConvertOptions],
	);

	const applyMarqueeSelection = useCallback(
		(nextRect: { x1: number; y1: number; x2: number; y2: number }) => {
			const selected = computeSelectedIdsInRect(nextRect);
			if (selectionAdditiveRef.current) {
				const merged = Array.from(
					new Set([...initialSelectedIdsRef.current, ...selected]),
				);
				const primary =
					selected[selected.length - 1] ??
					initialSelectedIdsRef.current[0] ??
					null;
				setSelection(merged, primary);
			} else {
				setSelection(selected, selected[0] ?? null);
			}
		},
		[computeSelectedIdsInRect, setSelection],
	);

	// 处理鼠标移动，更新选择框
	const handleStageMouseMove = useCallback(
		(e: Konva.KonvaEventObject<MouseEvent>) => {
			if (!isSelecting.current) {
				return;
			}

			const pos = e.target.getStage()?.getPointerPosition();
			if (!pos) return;

			// 将 Stage 坐标转换为画布坐标
			const { canvasX, canvasY } = stageToCanvasCoords(pos.x, pos.y);

			const nextRect = {
				...selectionRectRef.current,
				x2: canvasX,
				y2: canvasY,
			};
			selectionRectRef.current = nextRect;
			setSelectionRect(nextRect);
			applyMarqueeSelection(nextRect);
		},
		[stageToCanvasCoords, applyMarqueeSelection],
	);

	// 处理鼠标抬起，完成选择框
	const handleStageMouseUp = useCallback(() => {
		if (!isSelecting.current) {
			return;
		}

		isSelecting.current = false;

		// 延迟隐藏选择框，以便点击事件可以检查
		setTimeout(() => {
			setSelectionRect((prev) => ({ ...prev, visible: false }));
		}, 0);

		applyMarqueeSelection(selectionRectRef.current);
	}, [applyMarqueeSelection]);

	const selectionStageRect = useMemo(() => {
		if (!selectionRect.visible) return null;
		const { stageX: sx1, stageY: sy1 } = canvasToStageCoords(
			selectionRect.x1,
			selectionRect.y1,
		);
		const { stageX: sx2, stageY: sy2 } = canvasToStageCoords(
			selectionRect.x2,
			selectionRect.y2,
		);
		return {
			x: Math.min(sx1, sx2),
			y: Math.min(sy1, sy2),
			width: Math.abs(sx2 - sx1),
			height: Math.abs(sy2 - sy1),
		};
	}, [selectionRect, canvasToStageCoords]);

	const transformerBoundBoxFunc = useCallback(
		(oldBox: TransformerBox, newBox: TransformerBox): TransformerBox => {
			const activeAnchor = transformerRef.current?.getActiveAnchor?.();
			if (activeAnchor === "rotater") {
				clearSnapGuides();
				return newBox;
			}

			const effectiveZoom = Math.max(getEffectiveZoom(), SCALE_EPSILON);
			const minSizeCanvas = MIN_TRANSFORM_SIZE_STAGE / effectiveZoom;
			const snapThreshold = SNAP_GUIDE_THRESHOLD / effectiveZoom;

			const toCanvasBox = (box: TransformerBox): CanvasRect => {
				const { canvasX, canvasY } = stageToCanvasCoords(box.x, box.y);
				return {
					x: canvasX,
					y: canvasY,
					width: box.width / effectiveZoom,
					height: box.height / effectiveZoom,
				};
			};

			const toStageBox = (box: CanvasRect): TransformerBox => {
				const { stageX, stageY } = canvasToStageCoords(box.x, box.y);
				return {
					...newBox,
					x: stageX,
					y: stageY,
					width: box.width * effectiveZoom,
					height: box.height * effectiveZoom,
				};
			};

			const isCornerAnchor =
				activeAnchor === "top-left" ||
				activeAnchor === "top-right" ||
				activeAnchor === "bottom-left" ||
				activeAnchor === "bottom-right";
			const oldCanvasBox = toCanvasBox(oldBox);
			const newCanvasBox = toCanvasBox(newBox);
			const guideValues = getSnapGuideValues(selectedIds);
			const persistAndProjectBox = (box: CanvasRect): TransformerBox => {
				const quantizedBox = quantizeCanvasRect(box);
				if (selectedIds.length === 1) {
					const singleId = selectedIds[0];
					if (singleId) {
						transformCanvasBoxRef.current[singleId] = quantizedBox;
					}
				}
				return toStageBox(quantizedBox);
			};
			const cornerMoved: EdgeMoveState = (() => {
				switch (activeAnchor) {
					case "top-left":
						return { left: true, right: false, top: true, bottom: false };
					case "top-right":
						return { left: false, right: true, top: true, bottom: false };
					case "bottom-left":
						return { left: true, right: false, top: false, bottom: true };
					case "bottom-right":
						return { left: false, right: true, top: false, bottom: true };
					default:
						return { left: true, right: true, top: true, bottom: true };
				}
			})();

			const getFixedCorner = () => {
				switch (activeAnchor) {
					case "top-left":
						return {
							x: oldCanvasBox.x + oldCanvasBox.width,
							y: oldCanvasBox.y + oldCanvasBox.height,
						};
					case "top-right":
						return {
							x: oldCanvasBox.x,
							y: oldCanvasBox.y + oldCanvasBox.height,
						};
					case "bottom-left":
						return {
							x: oldCanvasBox.x + oldCanvasBox.width,
							y: oldCanvasBox.y,
						};
					case "bottom-right":
						return { x: oldCanvasBox.x, y: oldCanvasBox.y };
					default:
						return { x: oldCanvasBox.x, y: oldCanvasBox.y };
				}
			};

			const getMovingCorner = (box: CanvasRect) => {
				switch (activeAnchor) {
					case "top-left":
						return { x: box.x, y: box.y };
					case "top-right":
						return { x: box.x + box.width, y: box.y };
					case "bottom-left":
						return { x: box.x, y: box.y + box.height };
					case "bottom-right":
						return { x: box.x + box.width, y: box.y + box.height };
					default:
						return { x: box.x, y: box.y };
				}
			};

			const buildCornerBox = (
				desiredCorner: { x: number; y: number },
				snapAxis: "x" | "y" | null,
			): CanvasRect => {
				const ratio =
					oldCanvasBox.height === 0
						? 1
						: oldCanvasBox.width / oldCanvasBox.height;
				const fixed = getFixedCorner();
				const widthFromCorner = Math.abs(desiredCorner.x - fixed.x);
				const heightFromCorner = Math.abs(desiredCorner.y - fixed.y);

				let width = 0;
				let height = 0;

				if (snapAxis === "x") {
					width = widthFromCorner;
					height = ratio === 0 ? 0 : width / ratio;
				} else if (snapAxis === "y") {
					height = heightFromCorner;
					width = height * ratio;
				} else {
					const denom =
						oldCanvasBox.width * oldCanvasBox.width +
						oldCanvasBox.height * oldCanvasBox.height;
					const scale =
						denom === 0
							? 1
							: (oldCanvasBox.width * widthFromCorner +
									oldCanvasBox.height * heightFromCorner) /
								denom;
					width = oldCanvasBox.width * scale;
					height = oldCanvasBox.height * scale;
				}

				switch (activeAnchor) {
					case "top-left":
						return {
							x: fixed.x - width,
							y: fixed.y - height,
							width,
							height,
						};
					case "top-right":
						return {
							x: fixed.x,
							y: fixed.y - height,
							width,
							height,
						};
					case "bottom-left":
						return {
							x: fixed.x - width,
							y: fixed.y,
							width,
							height,
						};
					case "bottom-right":
						return {
							x: fixed.x,
							y: fixed.y,
							width,
							height,
						};
					default:
						return newCanvasBox;
				}
			};

			let baseBox = newCanvasBox;
			if (isCornerAnchor) {
				baseBox = buildCornerBox(getMovingCorner(newCanvasBox), null);
			}

			// 限制最小尺寸
			if (baseBox.width < minSizeCanvas || baseBox.height < minSizeCanvas) {
				return oldBox;
			}
			if (!snapEnabled) {
				clearSnapGuides();
				return persistAndProjectBox(baseBox);
			}

			if (isCornerAnchor) {
				const movingCorner = getMovingCorner(baseBox);
				const snapResult = computeSnapResult(
					baseBox,
					selectedIds,
					snapThreshold,
					{
						movingX: [movingCorner.x],
						movingY: [movingCorner.y],
					},
					guideValues,
				);
				const snapX = snapResult.deltaX !== 0;
				const snapY = snapResult.deltaY !== 0;

				if (!snapX && !snapY) {
					const stabilizedBox = lockFixedEdgesToGuides(
						baseBox,
						cornerMoved,
						guideValues,
					);
					setSnapGuides(projectGuidesToStage(snapResult.guides));
					return persistAndProjectBox(stabilizedBox);
				}

				let snapAxis: "x" | "y";
				if (snapX && snapY) {
					snapAxis =
						Math.abs(snapResult.deltaX) <= Math.abs(snapResult.deltaY)
							? "x"
							: "y";
				} else {
					snapAxis = snapX ? "x" : "y";
				}

				const snappedCorner = {
					x: movingCorner.x + (snapAxis === "x" ? snapResult.deltaX : 0),
					y: movingCorner.y + (snapAxis === "y" ? snapResult.deltaY : 0),
				};

				const snappedBox = buildCornerBox(snappedCorner, snapAxis);
				if (
					snappedBox.width < minSizeCanvas ||
					snappedBox.height < minSizeCanvas
				) {
					return oldBox;
				}
				const stabilizedBox = lockFixedEdgesToGuides(
					snappedBox,
					cornerMoved,
					guideValues,
				);

				setSnapGuides({
					...projectGuidesToStage({
						vertical: snapAxis === "x" ? snapResult.guides.vertical : [],
						horizontal: snapAxis === "y" ? snapResult.guides.horizontal : [],
					}),
				});
				return persistAndProjectBox(stabilizedBox);
			}

			const leftMoved = baseBox.x !== oldCanvasBox.x;
			const rightMoved =
				baseBox.x + baseBox.width !== oldCanvasBox.x + oldCanvasBox.width;
			const topMoved = baseBox.y !== oldCanvasBox.y;
			const bottomMoved =
				baseBox.y + baseBox.height !== oldCanvasBox.y + oldCanvasBox.height;

			const movingX: number[] = [];
			if (leftMoved && !rightMoved) {
				movingX.push(baseBox.x);
			} else if (rightMoved && !leftMoved) {
				movingX.push(baseBox.x + baseBox.width);
			} else if (leftMoved && rightMoved) {
				movingX.push(baseBox.x + baseBox.width / 2);
			}

			const movingY: number[] = [];
			if (topMoved && !bottomMoved) {
				movingY.push(baseBox.y);
			} else if (bottomMoved && !topMoved) {
				movingY.push(baseBox.y + baseBox.height);
			} else if (topMoved && bottomMoved) {
				movingY.push(baseBox.y + baseBox.height / 2);
			}

			const snapResult = computeSnapResult(
				baseBox,
				selectedIds,
				snapThreshold,
				{
					movingX,
					movingY,
				},
				guideValues,
			);
			if (snapResult.deltaX === 0 && snapResult.deltaY === 0) {
				const stabilizedBox = lockFixedEdgesToGuides(
					baseBox,
					{
						left: leftMoved,
						right: rightMoved,
						top: topMoved,
						bottom: bottomMoved,
					},
					guideValues,
				);
				setSnapGuides(projectGuidesToStage(snapResult.guides));
				return persistAndProjectBox(stabilizedBox);
			}

			const nextBox = { ...baseBox };

			if (snapResult.deltaX !== 0) {
				if (leftMoved && !rightMoved) {
					nextBox.x += snapResult.deltaX;
					nextBox.width -= snapResult.deltaX;
				} else if (rightMoved && !leftMoved) {
					nextBox.width += snapResult.deltaX;
				} else if (leftMoved && rightMoved) {
					nextBox.x += snapResult.deltaX;
				}
			}

			if (snapResult.deltaY !== 0) {
				if (topMoved && !bottomMoved) {
					nextBox.y += snapResult.deltaY;
					nextBox.height -= snapResult.deltaY;
				} else if (bottomMoved && !topMoved) {
					nextBox.height += snapResult.deltaY;
				} else if (topMoved && bottomMoved) {
					nextBox.y += snapResult.deltaY;
				}
			}

			if (nextBox.width < minSizeCanvas || nextBox.height < minSizeCanvas) {
				return oldBox;
			}
			const stabilizedBox = lockFixedEdgesToGuides(
				nextBox,
				{
					left: leftMoved,
					right: rightMoved,
					top: topMoved,
					bottom: bottomMoved,
				},
				guideValues,
			);

			setSnapGuides(projectGuidesToStage(snapResult.guides));
			return persistAndProjectBox(stabilizedBox);
		},
		[
			clearSnapGuides,
			computeSnapResult,
			snapEnabled,
			selectedIds,
			getSnapGuideValues,
			getEffectiveZoom,
			stageToCanvasCoords,
			canvasToStageCoords,
			projectGuidesToStage,
		],
	);

	return {
		stageRef,
		transformerRef,
		groupProxyRef,
		groupProxyBox,
		selectedIds,
		hoveredId,
		draggingId,
		snapGuides,
		selectionRect,
		selectionStageRect,
		getTrackIndexForElement,
		transformerBoundBoxFunc,
		handleMouseDown,
		handleMouseUp,
		handleDragStart,
		handleDrag,
		handleDragEnd,
		handleGroupTransformStart,
		handleGroupTransform,
		handleGroupTransformEnd,
		handleTransformStart,
		handleTransform,
		handleTransformEnd,
		handleMouseEnter,
		handleMouseLeave,
		handleStageClick,
		handleStageMouseDown,
		handleStageMouseMove,
		handleStageMouseUp,
		transformBaseRef,
	};
};
