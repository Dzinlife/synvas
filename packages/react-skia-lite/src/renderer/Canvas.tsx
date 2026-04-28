import type { FC, RefObject } from "react";
import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { SkiaPointerEventType } from "../dom/types";
import type { SharedValue } from "../animation/runtime/types";
import { Skia } from "../skia";
import type { SkImage, SkRect, SkSize } from "../skia/types";
import { SkiaPointerEventManager } from "../sksg/PointerEvents";
import { SkiaSGRoot } from "../sksg/Reconciler";
import { SkiaPictureView } from "../views/SkiaPictureView";
import {
	createSkiaCanvasId,
	skiaCanvasRegistry,
} from "../views/skiaCanvasRegistry";
import type {
	SkiaWebCanvasColorSpace,
	SkiaWebCanvasDynamicRange,
} from "../skia/web/canvasColorSpace";
import type { SkiaPictureViewHandle } from "../views/SkiaPictureView";
import { getDevicePixelRatio } from "../web";
import type {
	MeasureInWindowOnSuccessCallback,
	MeasureOnSuccessCallback,
	SkiaLayoutEvent,
	SkiaWebViewProps,
} from "../web";

export interface CanvasRef extends FC<CanvasProps> {
	makeImageSnapshot(rect?: SkRect): SkImage | null;
	makeImageSnapshotAsync(rect?: SkRect): Promise<SkImage>;
	redraw(): void;
	getCanvasId(): number;
	measure(callback: MeasureOnSuccessCallback): void;
	measureInWindow(callback: MeasureInWindowOnSuccessCallback): void;
	/**
	 * Get the SkiaSGRoot instance for direct rendering.
	 * This allows bypassing React's reconciliation for performance-critical updates.
	 */
	getRoot(): SkiaSGRoot;
}

export const useCanvasRef = () => useRef<CanvasRef>(null);

const useCanvasRefPriv = useRef<SkiaPictureViewHandle>;

export const useCanvasSize = (userRef?: RefObject<CanvasRef | null>) => {
	const ourRef = useCanvasRef();
	const ref = userRef ?? ourRef;
	const [size, setSize] = useState<SkSize>({ width: 0, height: 0 });
	useLayoutEffect(() => {
		if (ref.current) {
			ref.current.measure((_x, _y, width, height) => {
				setSize({ width, height });
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	return { ref, size };
};

export interface CanvasProps extends Omit<SkiaWebViewProps, "onLayout"> {
	debug?: boolean;
	opaque?: boolean;
	onSize?: SharedValue<SkSize>;
	colorSpace?: SkiaWebCanvasColorSpace;
	dynamicRange?: SkiaWebCanvasDynamicRange;
	ref?: React.Ref<CanvasRef>;
	pd?: number;
	onLayout?: (event: SkiaLayoutEvent) => void;
}

type CanvasPointerEvent = Parameters<
	NonNullable<SkiaWebViewProps["onPointerDown"]>
>[0];
type CanvasMouseEvent = Parameters<NonNullable<SkiaWebViewProps["onClick"]>>[0];

export const Canvas = ({
	debug,
	opaque,
	children,
	onSize,
	colorSpace = "p3",
	dynamicRange = "standard",
	ref,
	onLayout,
	pd = getDevicePixelRatio(),
	...viewProps
}: CanvasProps) => {
	const viewRef = useCanvasRefPriv(null);
	const canvasId = useMemo(() => {
		return createSkiaCanvasId();
	}, []);

	const root = useMemo(() => new SkiaSGRoot(Skia, canvasId), [canvasId]);
	const pointerEventManager = useMemo(() => {
		return new SkiaPointerEventManager(() => root.sg.children);
	}, [root]);

	// Render effects
	useLayoutEffect(() => {
		root.setOffscreenSurfaceOptions({ colorSpace, dynamicRange });
	}, [colorSpace, dynamicRange, root]);

	useLayoutEffect(() => {
		root.render(children);
	}, [children, root]);

	useEffect(() => {
		return () => {
			root.unmount();
		};
	}, [root]);

	useEffect(() => {
		return () => {
			pointerEventManager.reset();
		};
	}, [pointerEventManager]);

	// Component methods
	useImperativeHandle(
		ref,
		() =>
			({
				makeImageSnapshot: (rect?: SkRect) => {
					return skiaCanvasRegistry.makeImageSnapshot(canvasId, rect);
				},
				makeImageSnapshotAsync: (rect?: SkRect) => {
					return skiaCanvasRegistry.makeImageSnapshotAsync(canvasId, rect);
				},
				redraw: () => {
					skiaCanvasRegistry.requestRedraw(canvasId);
				},
				getCanvasId: () => {
					return canvasId;
				},
				measure: (callback) => {
					viewRef.current?.measure(callback);
				},
				measureInWindow: (callback) => {
					viewRef.current?.measureInWindow(callback);
				},
				getRoot: () => {
					return root;
				},
			}) as CanvasRef,
		[canvasId, root],
	);

	const onLayoutWeb = useCallback(
		(e: SkiaLayoutEvent) => {
			onLayout?.(e);
			const { width, height } = e.nativeEvent.layout;
			if (onSize) onSize.value = { width, height };
		},
		[onLayout, onSize],
	);

	const {
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerCancel,
		onPointerLeave,
		onClick,
		onDoubleClick,
		...restViewProps
	} = viewProps;

	const dispatchPointerEvent = useCallback(
		(
			type: SkiaPointerEventType,
			event: CanvasPointerEvent | CanvasMouseEvent,
		) => {
			const domEvent = event as unknown as {
				nativeEvent: PointerEvent | MouseEvent;
				currentTarget: EventTarget & HTMLElement;
			};
			const hostElement = domEvent.currentTarget as HTMLElement;
			const pointerId =
				"pointerId" in domEvent.nativeEvent
					? domEvent.nativeEvent.pointerId
					: 1;
			if (type === "pointerdown") {
				hostElement.setPointerCapture?.(pointerId);
			} else if (
				(type === "pointerup" || type === "pointercancel") &&
				hostElement.hasPointerCapture?.(pointerId)
			) {
				hostElement.releasePointerCapture?.(pointerId);
			}
			pointerEventManager.dispatch(type, domEvent.nativeEvent, hostElement);
		},
		[pointerEventManager],
	);

	const onCanvasPointerDown = useCallback<
		NonNullable<SkiaWebViewProps["onPointerDown"]>
	>(
		(event) => {
			dispatchPointerEvent("pointerdown", event);
			onPointerDown?.(event);
		},
		[dispatchPointerEvent, onPointerDown],
	);

	const onCanvasPointerMove = useCallback<
		NonNullable<SkiaWebViewProps["onPointerMove"]>
	>(
		(event) => {
			dispatchPointerEvent("pointermove", event);
			onPointerMove?.(event);
		},
		[dispatchPointerEvent, onPointerMove],
	);

	const onCanvasPointerUp = useCallback<
		NonNullable<SkiaWebViewProps["onPointerUp"]>
	>(
		(event) => {
			dispatchPointerEvent("pointerup", event);
			onPointerUp?.(event);
		},
		[dispatchPointerEvent, onPointerUp],
	);

	const onCanvasPointerCancel = useCallback<
		NonNullable<SkiaWebViewProps["onPointerCancel"]>
	>(
		(event) => {
			dispatchPointerEvent("pointercancel", event);
			onPointerCancel?.(event);
		},
		[dispatchPointerEvent, onPointerCancel],
	);

	const onCanvasPointerLeave = useCallback<
		NonNullable<SkiaWebViewProps["onPointerLeave"]>
	>(
		(event) => {
			dispatchPointerEvent("pointerleave", event);
			onPointerLeave?.(event);
		},
		[dispatchPointerEvent, onPointerLeave],
	);

	const onCanvasClick = useCallback<NonNullable<SkiaWebViewProps["onClick"]>>(
		(event) => {
			dispatchPointerEvent("click", event);
			onClick?.(event);
		},
		[dispatchPointerEvent, onClick],
	);

	const onCanvasDoubleClick = useCallback<
		NonNullable<SkiaWebViewProps["onDoubleClick"]>
	>(
		(event) => {
			dispatchPointerEvent("doubleclick", event);
			onDoubleClick?.(event);
		},
		[dispatchPointerEvent, onDoubleClick],
	);

	return (
		<SkiaPictureView
			pd={pd}
			ref={viewRef}
			canvasId={`${canvasId}`}
			debug={debug}
			opaque={opaque}
			colorSpace={colorSpace}
			dynamicRange={dynamicRange}
			onLayout={onSize || onLayout ? onLayoutWeb : undefined}
			onPointerDown={onCanvasPointerDown}
			onPointerMove={onCanvasPointerMove}
			onPointerUp={onCanvasPointerUp}
			onPointerCancel={onCanvasPointerCancel}
			onPointerLeave={onCanvasPointerLeave}
			onClick={onCanvasClick}
			onDoubleClick={onCanvasDoubleClick}
			{...restViewProps}
		/>
	);
};
