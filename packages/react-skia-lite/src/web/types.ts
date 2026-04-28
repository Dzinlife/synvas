import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from "react";

export interface SkiaLayoutRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface SkiaLayoutEvent {
	timeStamp: number;
	nativeEvent: {
		layout: SkiaLayoutRect;
	};
	currentTarget: HTMLDivElement;
	target: HTMLDivElement;
	type: "layout";
}

export type SkiaPointerEventsMode = "box-none" | "none" | "box-only" | "auto";

export interface SkiaWebViewProps {
	children?: ReactNode;
	id?: string;
	testId?: string;
	tabIndex?: 0 | -1;
	style?: CSSProperties | null | undefined;
	pointerEvents?: SkiaPointerEventsMode;
	onLayout?: (event: SkiaLayoutEvent) => void;
	onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
	onPointerMove?: (event: PointerEvent<HTMLDivElement>) => void;
	onPointerUp?: (event: PointerEvent<HTMLDivElement>) => void;
	onPointerCancel?: (event: PointerEvent<HTMLDivElement>) => void;
	onPointerEnter?: (event: PointerEvent<HTMLDivElement>) => void;
	onPointerLeave?: (event: PointerEvent<HTMLDivElement>) => void;
	onClick?: (event: MouseEvent<HTMLDivElement>) => void;
	onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
}

export type MeasureOnSuccessCallback = (
	x: number,
	y: number,
	width: number,
	height: number,
	pageX: number,
	pageY: number,
) => void;

export type MeasureInWindowOnSuccessCallback = (
	x: number,
	y: number,
	width: number,
	height: number,
) => void;
