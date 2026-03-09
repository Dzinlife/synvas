import type {
	GroupProps,
	RectCtor,
	SkiaPointerEvent,
	SkiaPointerEventTarget,
	SkiaPointerEventType,
} from "../dom/types";
import { NodeType } from "../dom/types";
import type {
	InputMatrix,
	Matrix3,
	Matrix4,
	Transforms3d,
} from "../skia/types";
import { processTransform3d, toMatrix3 } from "../skia/types";
import type { Node } from "./Node";
import { setNodeActiveState, setNodeHoverState } from "./InteractiveTransitions";

type Matrix3x3 = [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
];

type PointerEventHandlerKey =
	| "onPointerDown"
	| "onPointerMove"
	| "onPointerUp"
	| "onPointerCancel"
	| "onPointerEnter"
	| "onPointerLeave"
	| "onClick"
	| "onDoubleClick";

type Point = {
	x: number;
	y: number;
};

type Rect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type NativeInputEvent = PointerEvent | MouseEvent;

const HANDLER_BY_TYPE: Record<SkiaPointerEventType, PointerEventHandlerKey> = {
	pointerdown: "onPointerDown",
	pointermove: "onPointerMove",
	pointerup: "onPointerUp",
	pointercancel: "onPointerCancel",
	pointerenter: "onPointerEnter",
	pointerleave: "onPointerLeave",
	click: "onClick",
	doubleclick: "onDoubleClick",
};

const IDENTITY_MATRIX: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const isFiniteNumber = (value: unknown): value is number => {
	const candidate =
		typeof value === "object" &&
		value !== null &&
		"value" in value &&
		Number.isFinite((value as { value: unknown }).value)
			? (value as { value: unknown }).value
			: value;
	return typeof candidate === "number" && Number.isFinite(candidate);
};

const resolveNumericValue = (value: unknown): number | null => {
	if (
		typeof value === "object" &&
		value !== null &&
		"value" in value &&
		Number.isFinite((value as { value: unknown }).value)
	) {
		return Number((value as { value: unknown }).value);
	}
	if (!Number.isFinite(value)) return null;
	return Number(value);
};

const resolveSharedValue = (value: unknown): unknown => {
	if (!value || typeof value !== "object") return value;
	if (!("value" in value)) return value;
	return (value as { value: unknown }).value;
};

const getZIndex = (node: Node): number => {
	const value = (node.props as Partial<GroupProps>)?.zIndex;
	if (!isFiniteNumber(value)) return 0;
	return value;
};

const getSortedNodes = (nodes: Node[]): Node[] => {
	return nodes
		.map((node, order) => ({ node, order, zIndex: getZIndex(node) }))
		.sort((left, right) => {
			if (left.zIndex === right.zIndex) {
				return left.order - right.order;
			}
			return left.zIndex - right.zIndex;
		})
		.map(({ node }) => node);
};

const multiplyMatrix = (left: Matrix3x3, right: Matrix3x3): Matrix3x3 => {
	return [
		left[0] * right[0] + left[1] * right[3] + left[2] * right[6],
		left[0] * right[1] + left[1] * right[4] + left[2] * right[7],
		left[0] * right[2] + left[1] * right[5] + left[2] * right[8],
		left[3] * right[0] + left[4] * right[3] + left[5] * right[6],
		left[3] * right[1] + left[4] * right[4] + left[5] * right[7],
		left[3] * right[2] + left[4] * right[5] + left[5] * right[8],
		left[6] * right[0] + left[7] * right[3] + left[8] * right[6],
		left[6] * right[1] + left[7] * right[4] + left[8] * right[7],
		left[6] * right[2] + left[7] * right[5] + left[8] * right[8],
	];
};

const translateMatrix = (x: number, y: number): Matrix3x3 => {
	return [1, 0, x, 0, 1, y, 0, 0, 1];
};

const mapPoint = (matrix: Matrix3x3, point: Point): Point => {
	const x = matrix[0] * point.x + matrix[1] * point.y + matrix[2];
	const y = matrix[3] * point.x + matrix[4] * point.y + matrix[5];
	const w = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
	if (Math.abs(w) <= 1e-8) {
		return { x, y };
	}
	return {
		x: x / w,
		y: y / w,
	};
};

const invertMatrix = (matrix: Matrix3x3): Matrix3x3 | null => {
	const [a, b, c, d, e, f, g, h, i] = matrix;
	const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
	if (Math.abs(det) <= 1e-8) {
		return null;
	}
	const invDet = 1 / det;
	return [
		(e * i - f * h) * invDet,
		(c * h - b * i) * invDet,
		(b * f - c * e) * invDet,
		(f * g - d * i) * invDet,
		(a * i - c * g) * invDet,
		(c * d - a * f) * invDet,
		(d * h - e * g) * invDet,
		(b * g - a * h) * invDet,
		(a * e - b * d) * invDet,
	];
};

const toMatrix3x3 = (input: InputMatrix): Matrix3x3 | null => {
	if (Array.isArray(input)) {
		if (input.length === 9) {
			const values = input as unknown as Matrix3;
			return [
				values[0],
				values[1],
				values[2],
				values[3],
				values[4],
				values[5],
				values[6],
				values[7],
				values[8],
			];
		}
		if (input.length === 16) {
			const values = toMatrix3(input as unknown as Matrix4);
			return [
				values[0],
				values[1],
				values[2],
				values[3],
				values[4],
				values[5],
				values[6],
				values[7],
				values[8],
			];
		}
		if (input.length === 6) {
			return [
				input[0],
				input[1],
				input[2],
				input[3],
				input[4],
				input[5],
				0,
				0,
				1,
			];
		}
		return null;
	}
	if (input && typeof input === "object" && "get" in input) {
		const values = (input as { get: () => number[] }).get();
		if (Array.isArray(values) && values.length === 9) {
			return [
				values[0] ?? 1,
				values[1] ?? 0,
				values[2] ?? 0,
				values[3] ?? 0,
				values[4] ?? 1,
				values[5] ?? 0,
				values[6] ?? 0,
				values[7] ?? 0,
				values[8] ?? 1,
			];
		}
	}
	return null;
};

const resolveLocalMatrix = (props: Partial<GroupProps>): Matrix3x3 => {
	const originX = props.origin?.x ?? 0;
	const originY = props.origin?.y ?? 0;
	const hasOrigin = originX !== 0 || originY !== 0;
	let base: Matrix3x3 = IDENTITY_MATRIX;
	if (props.matrix) {
		base = toMatrix3x3(props.matrix) ?? IDENTITY_MATRIX;
	} else {
		const shorthandTransform: Transforms3d = [];
		const translateX = resolveNumericValue(props.translateX);
		if (translateX !== null && translateX !== 0) {
			shorthandTransform.push({ translateX });
		}
		const translateY = resolveNumericValue(props.translateY);
		if (translateY !== null && translateY !== 0) {
			shorthandTransform.push({ translateY });
		}
		const scale = resolveNumericValue(props.scale);
		if (scale !== null && scale !== 1) {
			shorthandTransform.push({ scale });
		}
		const scaleX = resolveNumericValue(props.scaleX);
		if (scaleX !== null && scaleX !== 1) {
			shorthandTransform.push({ scaleX });
		}
		const scaleY = resolveNumericValue(props.scaleY);
		if (scaleY !== null && scaleY !== 1) {
			shorthandTransform.push({ scaleY });
		}
		const rotate = resolveNumericValue(props.rotate);
		if (rotate !== null && rotate !== 0) {
			shorthandTransform.push({ rotate });
		}
		const rotateZ = resolveNumericValue(props.rotateZ);
		if (rotateZ !== null && rotateZ !== 0) {
			shorthandTransform.push({ rotateZ });
		}
		const rawTransform = resolveSharedValue(props.transform);
		const transform =
			Array.isArray(rawTransform) && rawTransform.length > 0
				? [...shorthandTransform, ...(rawTransform as Transforms3d)]
				: shorthandTransform;
		if (transform.length === 0) {
			if (!hasOrigin) return base;
			return multiplyMatrix(
				multiplyMatrix(translateMatrix(originX, originY), base),
				translateMatrix(-originX, -originY),
			);
		}
		const transformed = toMatrix3(
			processTransform3d(transform),
		);
		base = [
			transformed[0],
			transformed[1],
			transformed[2],
			transformed[3],
			transformed[4],
			transformed[5],
			transformed[6],
			transformed[7],
			transformed[8],
		];
	}
	if (!hasOrigin) return base;
	return multiplyMatrix(
		multiplyMatrix(translateMatrix(originX, originY), base),
		translateMatrix(-originX, -originY),
	);
};

const normalizeRect = (rect: Rect): Rect => {
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

const containsRectPoint = (rect: Rect, point: Point): boolean => {
	return (
		point.x >= rect.x &&
		point.x <= rect.x + rect.width &&
		point.y >= rect.y &&
		point.y <= rect.y + rect.height
	);
};

const resolveRect = (props: Record<string, unknown>): Rect | null => {
	const rect = props.rect as Partial<Rect> | undefined;
	const nestedRect = (props.rect as { rect?: Partial<Rect> } | undefined)?.rect;
	if (
		rect &&
		isFiniteNumber(rect.x) &&
		isFiniteNumber(rect.y) &&
		isFiniteNumber(rect.width) &&
		isFiniteNumber(rect.height)
	) {
		return normalizeRect({
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height,
		});
	}
	if (
		nestedRect &&
		isFiniteNumber(nestedRect.x) &&
		isFiniteNumber(nestedRect.y) &&
		isFiniteNumber(nestedRect.width) &&
		isFiniteNumber(nestedRect.height)
	) {
		return normalizeRect({
			x: nestedRect.x,
			y: nestedRect.y,
			width: nestedRect.width,
			height: nestedRect.height,
		});
	}
	const width = props.width;
	const height = props.height;
	if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
	const x = isFiniteNumber(props.x) ? props.x : 0;
	const y = isFiniteNumber(props.y) ? props.y : 0;
	return normalizeRect({ x, y, width, height });
};

const resolveHitRect = (hitRect: RectCtor): Rect | null => {
	if (!isFiniteNumber(hitRect.width) || !isFiniteNumber(hitRect.height)) {
		return null;
	}
	return normalizeRect({
		x: isFiniteNumber(hitRect.x) ? hitRect.x : 0,
		y: isFiniteNumber(hitRect.y) ? hitRect.y : 0,
		width: hitRect.width,
		height: hitRect.height,
	});
};

const containsCirclePoint = (
	props: Record<string, unknown>,
	point: Point,
): boolean => {
	const center = props.c as Partial<Point> | undefined;
	const cx = isFiniteNumber(center?.x)
		? center.x
		: isFiniteNumber(props.cx)
			? props.cx
			: null;
	const cy = isFiniteNumber(center?.y)
		? center.y
		: isFiniteNumber(props.cy)
			? props.cy
			: null;
	const radius = props.r;
	if (!isFiniteNumber(cx) || !isFiniteNumber(cy) || !isFiniteNumber(radius)) {
		return false;
	}
	const dx = point.x - cx;
	const dy = point.y - cy;
	return dx * dx + dy * dy <= radius * radius;
};

const containsNodePoint = (
	nodeType: NodeType,
	props: Partial<GroupProps>,
	point: Point,
): boolean => {
	if (props.pointerEvents === "none") return false;
	if (props.hitRect) {
		const hitRect = resolveHitRect(props.hitRect);
		if (!hitRect) return false;
		return containsRectPoint(hitRect, point);
	}
	const rectLike = props as Record<string, unknown>;
	switch (nodeType) {
		case NodeType.Rect:
		case NodeType.RRect:
		case NodeType.Oval:
		case NodeType.Image:
		case NodeType.ImageSVG:
		case NodeType.Paragraph: {
			const rect = resolveRect(rectLike);
			if (!rect) return false;
			return containsRectPoint(rect, point);
		}
		case NodeType.Circle:
			return containsCirclePoint(rectLike, point);
		default:
			return false;
	}
};

const toEventTargetNode = (node: Node): SkiaPointerEventTarget => {
	return {
		type: node.type,
		props: node.props,
	};
};

const isPathEqual = (left: Node[], right: Node[]): boolean => {
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i++) {
		if (left[i] !== right[i]) return false;
	}
	return true;
};

const getSharedPrefixLength = (left: Node[], right: Node[]): number => {
	const len = Math.min(left.length, right.length);
	let index = 0;
	while (index < len && left[index] === right[index]) {
		index++;
	}
	return index;
};

const getPointerId = (event: NativeInputEvent): number => {
	if ("pointerId" in event && Number.isFinite(event.pointerId)) {
		return event.pointerId;
	}
	return 1;
};

const getPointerType = (event: NativeInputEvent): string => {
	if ("pointerType" in event) {
		return event.pointerType;
	}
	return "mouse";
};

const getPressure = (event: NativeInputEvent): number => {
	if ("pressure" in event && Number.isFinite(event.pressure)) {
		return event.pressure;
	}
	return 0;
};

const getDetail = (event: NativeInputEvent): number => {
	if ("detail" in event && Number.isFinite(event.detail)) {
		return event.detail;
	}
	return 0;
};

const getPointerPoint = (
	event: NativeInputEvent,
	hostElement: HTMLElement,
): Point => {
	const rect = hostElement.getBoundingClientRect();
	return {
		x: event.clientX - rect.left,
		y: event.clientY - rect.top,
	};
};

const resolveCursorFromPath = (path: Node[] | null): string | null => {
	if (!path || path.length === 0) return null;
	for (let i = path.length - 1; i >= 0; i--) {
		const cursor = (path[i].props as Partial<GroupProps>)?.cursor;
		if (typeof cursor !== "string") continue;
		const trimmedCursor = cursor.trim();
		if (trimmedCursor.length > 0) {
			return trimmedCursor;
		}
	}
	return null;
};

export class SkiaPointerEventManager {
	private activeTargetPathByPointerId = new Map<number, Node[]>();
	private hoverPathByPointerId = new Map<number, Node[]>();
	private activeNodeByPointerId = new Map<number, Node>();

	constructor(private getRootNodes: () => Node[]) {}

	reset() {
		for (const path of this.hoverPathByPointerId.values()) {
			for (const node of path) {
				setNodeHoverState(node, false);
			}
		}
		for (const node of this.activeNodeByPointerId.values()) {
			setNodeActiveState(node, false);
		}
		this.activeTargetPathByPointerId.clear();
		this.hoverPathByPointerId.clear();
		this.activeNodeByPointerId.clear();
	}

	dispatch(
		type: SkiaPointerEventType,
		event: NativeInputEvent,
		hostElement: HTMLElement,
	) {
		const pointerId = getPointerId(event);
		const point = getPointerPoint(event, hostElement);
		const hitPath = this.findHitPath(point);

		if (type === "pointerleave") {
			this.updateHover(pointerId, null, event, point);
			this.releaseActiveNode(pointerId);
			this.applyHostCursor(hostElement, null);
			return;
		}

		if (
			type === "pointermove" ||
			type === "pointerdown" ||
			type === "pointerup" ||
			type === "pointercancel"
		) {
			this.updateHover(pointerId, hitPath, event, point);
		}

		const activePath = this.activeTargetPathByPointerId.get(pointerId) ?? null;
		const cursorPath = type === "pointermove" ? (activePath ?? hitPath) : hitPath;
		this.applyHostCursor(hostElement, resolveCursorFromPath(cursorPath));

		const dispatchPath = this.resolveDispatchPath(type, pointerId, hitPath);
		if (type === "pointerdown") {
			const activeTarget = dispatchPath?.[dispatchPath.length - 1] ?? null;
			if (activeTarget) {
				this.releaseActiveNode(pointerId);
				this.activeNodeByPointerId.set(pointerId, activeTarget);
				setNodeActiveState(activeTarget, true);
			} else {
				this.releaseActiveNode(pointerId);
			}
		}
		if (type === "pointerup" || type === "pointercancel") {
			this.releaseActiveNode(pointerId);
		}
		if (!dispatchPath || dispatchPath.length === 0) {
			return;
		}
		this.emitBubbling(dispatchPath, type, event, point);
	}

	private applyHostCursor(hostElement: HTMLElement, cursor: string | null) {
		const nextCursor = cursor ?? "";
		if (hostElement.style.cursor === nextCursor) return;
		hostElement.style.cursor = nextCursor;
	}

	private resolveDispatchPath(
		type: SkiaPointerEventType,
		pointerId: number,
		hitPath: Node[] | null,
	): Node[] | null {
		if (type === "pointerdown") {
			if (hitPath && hitPath.length > 0) {
				this.activeTargetPathByPointerId.set(pointerId, hitPath);
			} else {
				this.activeTargetPathByPointerId.delete(pointerId);
			}
			return hitPath;
		}
		if (type === "pointermove") {
			return this.activeTargetPathByPointerId.get(pointerId) ?? hitPath;
		}
		if (type === "pointerup" || type === "pointercancel") {
			const activePath = this.activeTargetPathByPointerId.get(pointerId);
			this.activeTargetPathByPointerId.delete(pointerId);
			return activePath ?? hitPath;
		}
		return hitPath;
	}

	private findHitPath(point: Point): Node[] | null {
		const nodes = this.getRootNodes();
		return this.findHitPathFromNodes(nodes, point, IDENTITY_MATRIX, []);
	}

	private findHitPathFromNodes(
		nodes: Node[],
		worldPoint: Point,
		parentMatrix: Matrix3x3,
		parentPath: Node[],
	): Node[] | null {
		const sortedNodes = getSortedNodes(nodes);
		for (let i = sortedNodes.length - 1; i >= 0; i--) {
			const node = sortedNodes[i];
			const props = (node.props ?? {}) as Partial<GroupProps>;
			if (props.pointerEvents === "none") {
				continue;
			}
			const worldMatrix = multiplyMatrix(
				parentMatrix,
				resolveLocalMatrix(props),
			);
			const nextPath = [...parentPath, node];
			const childHitPath = this.findHitPathFromNodes(
				node.children,
				worldPoint,
				worldMatrix,
				nextPath,
			);
			if (childHitPath) {
				return childHitPath;
			}
			const inverted = invertMatrix(worldMatrix);
			if (!inverted) {
				continue;
			}
			const localPoint = mapPoint(inverted, worldPoint);
			if (containsNodePoint(node.type, props, localPoint)) {
				return nextPath;
			}
		}
		return null;
	}

	private updateHover(
		pointerId: number,
		nextPath: Node[] | null,
		event: NativeInputEvent,
		point: Point,
	) {
		const previousPath = this.hoverPathByPointerId.get(pointerId) ?? [];
		const safeNextPath = nextPath ?? [];
		if (isPathEqual(previousPath, safeNextPath)) {
			return;
		}
		const sharedPrefixLength = getSharedPrefixLength(
			previousPath,
			safeNextPath,
		);

		for (let i = previousPath.length - 1; i >= sharedPrefixLength; i--) {
			setNodeHoverState(previousPath[i], false);
			this.emitOnNode(previousPath[i], "pointerleave", event, point);
		}
		for (let i = sharedPrefixLength; i < safeNextPath.length; i++) {
			setNodeHoverState(safeNextPath[i], true);
			this.emitOnNode(safeNextPath[i], "pointerenter", event, point);
		}

		if (safeNextPath.length > 0) {
			this.hoverPathByPointerId.set(pointerId, safeNextPath);
		} else {
			this.hoverPathByPointerId.delete(pointerId);
		}
	}

	private releaseActiveNode(pointerId: number) {
		const activeNode = this.activeNodeByPointerId.get(pointerId);
		if (!activeNode) return;
		setNodeActiveState(activeNode, false);
		this.activeNodeByPointerId.delete(pointerId);
	}

	private emitBubbling(
		path: Node[],
		type: SkiaPointerEventType,
		nativeEvent: NativeInputEvent,
		point: Point,
	) {
		const targetNode = path[path.length - 1];
		if (!targetNode) return;
		let propagationStopped = false;
		const target = toEventTargetNode(targetNode);
		const event: SkiaPointerEvent = {
			type,
			pointerId: getPointerId(nativeEvent),
			pointerType: getPointerType(nativeEvent),
			button: nativeEvent.button,
			buttons: nativeEvent.buttons,
			clientX: nativeEvent.clientX,
			clientY: nativeEvent.clientY,
			x: point.x,
			y: point.y,
			pressure: getPressure(nativeEvent),
			timeStamp: nativeEvent.timeStamp,
			detail: getDetail(nativeEvent),
			cancelable: nativeEvent.cancelable,
			defaultPrevented: nativeEvent.defaultPrevented,
			altKey: nativeEvent.altKey,
			ctrlKey: nativeEvent.ctrlKey,
			shiftKey: nativeEvent.shiftKey,
			metaKey: nativeEvent.metaKey,
			nativeEvent,
			target,
			currentTarget: target,
			stopPropagation: () => {
				propagationStopped = true;
				nativeEvent.stopPropagation();
			},
			isPropagationStopped: () => propagationStopped,
			preventDefault: () => {
				nativeEvent.preventDefault();
				event.defaultPrevented = nativeEvent.defaultPrevented;
			},
		};

		for (let i = path.length - 1; i >= 0; i--) {
			const node = path[i];
			const handler = ((node.props as Partial<GroupProps>)[
				HANDLER_BY_TYPE[type]
			] ?? null) as ((e: SkiaPointerEvent) => void) | null;
			if (!handler) continue;
			event.currentTarget = toEventTargetNode(node);
			handler(event);
			if (propagationStopped) {
				break;
			}
		}
	}

	private emitOnNode(
		node: Node,
		type: Extract<SkiaPointerEventType, "pointerenter" | "pointerleave">,
		nativeEvent: NativeInputEvent,
		point: Point,
	) {
		const handler = ((node.props as Partial<GroupProps>)[
			HANDLER_BY_TYPE[type]
		] ?? null) as ((e: SkiaPointerEvent) => void) | null;
		if (!handler) return;
		const target = toEventTargetNode(node);
		const event: SkiaPointerEvent = {
			type,
			pointerId: getPointerId(nativeEvent),
			pointerType: getPointerType(nativeEvent),
			button: nativeEvent.button,
			buttons: nativeEvent.buttons,
			clientX: nativeEvent.clientX,
			clientY: nativeEvent.clientY,
			x: point.x,
			y: point.y,
			pressure: getPressure(nativeEvent),
			timeStamp: nativeEvent.timeStamp,
			detail: getDetail(nativeEvent),
			cancelable: nativeEvent.cancelable,
			defaultPrevented: nativeEvent.defaultPrevented,
			altKey: nativeEvent.altKey,
			ctrlKey: nativeEvent.ctrlKey,
			shiftKey: nativeEvent.shiftKey,
			metaKey: nativeEvent.metaKey,
			nativeEvent,
			target,
			currentTarget: target,
			stopPropagation: () => {
				nativeEvent.stopPropagation();
			},
			isPropagationStopped: () => false,
			preventDefault: () => {
				nativeEvent.preventDefault();
				event.defaultPrevented = nativeEvent.defaultPrevented;
			},
		};
		handler(event);
	}
}
