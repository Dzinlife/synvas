import type { CSSProperties, RefObject } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";
import type {
	SkiaLayoutEvent,
	SkiaPointerEventsMode,
	SkiaWebViewProps,
} from "./types";

const DOM_LAYOUT_HANDLER_NAME = "__skiaLayoutHandler";

type LayoutTarget = HTMLDivElement & {
	__skiaLayoutHandler?: SkiaWebViewProps["onLayout"];
};

let resizeObserver: ResizeObserver | null = null;

export const getDevicePixelRatio = () =>
	typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

const createLayoutEvent = (
	node: HTMLDivElement,
	rect: DOMRectReadOnly,
): SkiaLayoutEvent => ({
	timeStamp: Date.now(),
	nativeEvent: {
		layout: {
			x: rect.left,
			y: rect.top,
			width: rect.width,
			height: rect.height,
		},
	},
	currentTarget: node,
	target: node,
	type: "layout",
});

const getObserver = () => {
	if (resizeObserver === null) {
		resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const node = entry.target as LayoutTarget;
				const onLayout = node[DOM_LAYOUT_HANDLER_NAME];
				if (typeof onLayout !== "function") {
					continue;
				}
				setTimeout(() => {
					onLayout(createLayoutEvent(node, entry.contentRect));
				}, 0);
			}
		});
	}
	return resizeObserver;
};

const useElementLayout = (
	ref: RefObject<LayoutTarget | null>,
	onLayout: SkiaWebViewProps["onLayout"],
) => {
	useLayoutEffect(() => {
		const node = ref.current;
		if (!node) {
			return;
		}
		node[DOM_LAYOUT_HANDLER_NAME] = onLayout;
		if (typeof ResizeObserver === "undefined") {
			return () => {
				delete node[DOM_LAYOUT_HANDLER_NAME];
			};
		}
		const observer = getObserver();
		if (typeof onLayout === "function") {
			observer.observe(node);
		}
		return () => {
			observer.unobserve(node);
			delete node[DOM_LAYOUT_HANDLER_NAME];
		};
	}, [ref, onLayout]);
};

const resolvePointerEventsStyle = (
	pointerEvents: SkiaPointerEventsMode | undefined,
): CSSProperties["pointerEvents"] | undefined => {
	if (pointerEvents === "none" || pointerEvents === "auto") {
		return pointerEvents;
	}
	return undefined;
};

export const WebView = ({
	children,
	id,
	testId,
	tabIndex,
	style: rawStyle,
	pointerEvents,
	onLayout,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onPointerCancel,
	onPointerEnter,
	onPointerLeave,
	onClick,
	onDoubleClick,
}: SkiaWebViewProps) => {
	const ref = useRef<LayoutTarget | null>(null);
	useElementLayout(ref, onLayout);
	const style = useMemo(() => {
		const pointerEventsStyle = resolvePointerEventsStyle(pointerEvents);
		return {
			alignItems: "stretch" as const,
			backgroundColor: "transparent" as const,
			border: "0 solid black" as const,
			boxSizing: "border-box" as const,
			display: "flex" as const,
			flexBasis: "auto" as const,
			flexDirection: "column" as const,
			flexShrink: 0,
			listStyle: "none" as const,
			margin: 0,
			minHeight: 0,
			minWidth: 0,
			padding: 0,
			position: "relative" as const,
			textDecoration: "none" as const,
			zIndex: 0,
			...(rawStyle ?? {}),
			...(pointerEventsStyle ? { pointerEvents: pointerEventsStyle } : {}),
		};
	}, [pointerEvents, rawStyle]);

	return (
		<div
			ref={ref}
			id={id}
			data-testid={testId}
			tabIndex={tabIndex}
			style={style}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
			onClick={onClick}
			onDoubleClick={onDoubleClick}
		>
			{children}
		</div>
	);
};
