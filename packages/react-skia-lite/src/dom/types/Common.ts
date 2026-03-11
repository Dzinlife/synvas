import type { ReactNode } from "react";

import type {
	BlendMode,
	Color,
	InputMatrix,
	InputRRect,
	PaintStyle,
	SkPaint,
	SkPath,
	SkRect,
	SkRRect,
	StrokeCap,
	StrokeJoin,
	Transforms3d,
	Vector,
} from "../../skia/types";

export type SkEnum<T> = Uncapitalize<keyof T extends string ? keyof T : never>;

export type PathDef = string | SkPath;

export type ClipDef = SkRRect | SkRect | PathDef;

export type Fit =
	| "cover"
	| "contain"
	| "fill"
	| "fitHeight"
	| "fitWidth"
	| "none"
	| "scaleDown";

export type Radius = number | Vector;

export interface ChildrenProps {
	children?: ReactNode | ReactNode[];
}

export interface RectCtor {
	x?: number;
	y?: number;
	width: number;
	height: number;
}

export interface RRectCtor extends RectCtor {
	r?: Radius;
}

export type RectDef = RectCtor | { rect: SkRect };
export type RRectDef = RRectCtor | { rect: InputRRect };

export interface PointCircleDef {
	c?: Vector;
	r: number;
}

export interface ScalarCircleDef {
	cx: number;
	cy: number;
	r: number;
}

export type CircleDef = PointCircleDef | ScalarCircleDef;

export interface TransformProps {
	transform?: Transforms3d;
	origin?: Vector;
	matrix?: InputMatrix;
	translateX?: number;
	translateY?: number;
	scale?: number;
	scaleX?: number;
	scaleY?: number;
	rotate?: number;
	rotateZ?: number;
}

export type SkiaMotionValue = number;

export type SkiaMotionMap = Record<string, SkiaMotionValue>;

export interface SkiaMotionSpec {
	animate?: SkiaMotionMap;
	hover?: SkiaMotionMap;
	active?: SkiaMotionMap;
}

export interface CTMProps extends TransformProps {
	clip?: ClipDef;
	invertClip?: boolean;
	layer?: SkPaint | boolean;
}

export interface PaintProps extends ChildrenProps {
	color?: Color;
	strokeWidth?: number;
	blendMode?: SkEnum<typeof BlendMode>;
	style?: SkEnum<typeof PaintStyle>;
	strokeJoin?: SkEnum<typeof StrokeJoin>;
	strokeCap?: SkEnum<typeof StrokeCap>;
	strokeMiter?: number;
	opacity?: number;
	antiAlias?: boolean;
	dither?: boolean;
}

export type SkiaPointerEventType =
	| "pointerdown"
	| "pointermove"
	| "pointerup"
	| "pointercancel"
	| "pointerenter"
	| "pointerleave"
	| "click"
	| "doubleclick";

export interface SkiaPointerEventTarget {
	type: string;
	props: unknown;
}

export interface SkiaPointerEvent {
	type: SkiaPointerEventType;
	pointerId: number;
	pointerType: string;
	button: number;
	buttons: number;
	clientX: number;
	clientY: number;
	x: number;
	y: number;
	pressure: number;
	timeStamp: number;
	detail: number;
	cancelable: boolean;
	defaultPrevented: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	metaKey: boolean;
	nativeEvent: PointerEvent | MouseEvent;
	target: SkiaPointerEventTarget;
	currentTarget: SkiaPointerEventTarget;
	stopPropagation: () => void;
	isPropagationStopped: () => boolean;
	preventDefault: () => void;
}

export type SkiaPointerEventHandler = (event: SkiaPointerEvent) => void;

export interface SkiaPointerEventProps {
	onPointerDown?: SkiaPointerEventHandler;
	onPointerMove?: SkiaPointerEventHandler;
	onPointerUp?: SkiaPointerEventHandler;
	onPointerCancel?: SkiaPointerEventHandler;
	onPointerEnter?: SkiaPointerEventHandler;
	onPointerLeave?: SkiaPointerEventHandler;
	onClick?: SkiaPointerEventHandler;
	onDoubleClick?: SkiaPointerEventHandler;
	// 可选命中区域，便于在不直接绘制几何时提供交互热区
	hitRect?: RectCtor;
	pointerEvents?: "auto" | "none";
	// 仅 web 生效：命中该节点时设置宿主元素 cursor
	cursor?: string;
	motion?: SkiaMotionSpec;
}

export interface GroupProps
	extends PaintProps,
		CTMProps,
		SkiaPointerEventProps {
	zIndex?: number;
}
