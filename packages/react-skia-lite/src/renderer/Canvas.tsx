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
import { Platform } from "../Platform";
import type {
	LayoutChangeEvent,
	MeasureInWindowOnSuccessCallback,
	MeasureOnSuccessCallback,
	SharedValue,
	View,
	ViewProps,
} from "../react-native-types";
import { Skia } from "../skia";
import type { SkImage, SkRect, SkSize } from "../skia/types";
import { SkiaPointerEventManager } from "../sksg/PointerEvents";
import { SkiaSGRoot } from "../sksg/Reconciler";
import SkiaPictureViewNativeComponent from "../specs/SkiaPictureViewNativeComponent";
import { SkiaViewApi } from "../views/api";
import { SkiaViewNativeId } from "../views/SkiaViewNativeId";
import type {
	SkiaWebCanvasColorSpace,
	SkiaWebCanvasDynamicRange,
} from "../skia/web/canvasColorSpace";

export interface CanvasRef extends FC<CanvasProps> {
	makeImageSnapshot(rect?: SkRect): SkImage;
	makeImageSnapshotAsync(rect?: SkRect): Promise<SkImage>;
	redraw(): void;
	getNativeId(): number;
	measure(callback: MeasureOnSuccessCallback): void;
	measureInWindow(callback: MeasureInWindowOnSuccessCallback): void;
	/**
	 * Get the SkiaSGRoot instance for direct rendering.
	 * This allows bypassing React's reconciliation for performance-critical updates.
	 */
	getRoot(): SkiaSGRoot;
}

export const useCanvasRef = () => useRef<CanvasRef>(null);

const useCanvasRefPriv = useRef<View>;

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

export interface CanvasProps extends Omit<ViewProps, "onLayout"> {
	debug?: boolean;
	opaque?: boolean;
	onSize?: SharedValue<SkSize>;
	colorSpace?: SkiaWebCanvasColorSpace;
	dynamicRange?: SkiaWebCanvasDynamicRange;
	ref?: React.Ref<CanvasRef>;
	androidWarmup?: boolean;
	pd?: number;
}

type CanvasPointerEvent = Parameters<
	NonNullable<ViewProps["onPointerDown"]>
>[0];
type CanvasMouseEvent = Parameters<NonNullable<ViewProps["onClick"]>>[0];

export const Canvas = ({
	debug,
	opaque,
	children,
	onSize,
	colorSpace = "p3",
	dynamicRange = "standard",
	androidWarmup = false,
	ref,
	// Here know this is a type error but this is done on purpose to check it at runtime
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-expect-error
	onLayout,
	pd = Platform.PixelRatio,
	...viewProps
}: CanvasProps) => {
	const viewRef = useCanvasRefPriv(null);
	// Native ID
	const nativeId = useMemo(() => {
		return SkiaViewNativeId.current++;
	}, []);

	// Root
	const root = useMemo(() => new SkiaSGRoot(Skia, nativeId), [nativeId]);
	const pointerEventManager = useMemo(() => {
		return new SkiaPointerEventManager(() => root.sg.children);
	}, [root]);

	// Render effects
	useLayoutEffect(() => {
		root.render(children);
	}, [children, root, nativeId]);

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
					return SkiaViewApi.makeImageSnapshot(nativeId, rect);
				},
				makeImageSnapshotAsync: (rect?: SkRect) => {
					return SkiaViewApi.makeImageSnapshotAsync(nativeId, rect);
				},
				redraw: () => {
					SkiaViewApi.requestRedraw(nativeId);
				},
				getNativeId: () => {
					return nativeId;
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
		[nativeId, root],
	);

	const onLayoutWeb = useCallback(
		(e: LayoutChangeEvent) => {
			if (onLayout) {
				onLayout(e);
			}
			if (Platform.OS === "web" && onSize) {
				const { width, height } = e.nativeEvent.layout;
				onSize.value = { width, height };
			}
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
			if (Platform.OS !== "web") {
				return;
			}
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
		NonNullable<ViewProps["onPointerDown"]>
	>(
		(event) => {
			dispatchPointerEvent("pointerdown", event);
			onPointerDown?.(event);
		},
		[dispatchPointerEvent, onPointerDown],
	);

	const onCanvasPointerMove = useCallback<
		NonNullable<ViewProps["onPointerMove"]>
	>(
		(event) => {
			dispatchPointerEvent("pointermove", event);
			onPointerMove?.(event);
		},
		[dispatchPointerEvent, onPointerMove],
	);

	const onCanvasPointerUp = useCallback<NonNullable<ViewProps["onPointerUp"]>>(
		(event) => {
			dispatchPointerEvent("pointerup", event);
			onPointerUp?.(event);
		},
		[dispatchPointerEvent, onPointerUp],
	);

	const onCanvasPointerCancel = useCallback<
		NonNullable<ViewProps["onPointerCancel"]>
	>(
		(event) => {
			dispatchPointerEvent("pointercancel", event);
			onPointerCancel?.(event);
		},
		[dispatchPointerEvent, onPointerCancel],
	);

	const onCanvasPointerLeave = useCallback<
		NonNullable<ViewProps["onPointerLeave"]>
	>(
		(event) => {
			dispatchPointerEvent("pointerleave", event);
			onPointerLeave?.(event);
		},
		[dispatchPointerEvent, onPointerLeave],
	);

	const onCanvasClick = useCallback<NonNullable<ViewProps["onClick"]>>(
		(event) => {
			dispatchPointerEvent("click", event);
			onClick?.(event);
		},
		[dispatchPointerEvent, onClick],
	);

	const onCanvasDoubleClick = useCallback<
		NonNullable<ViewProps["onDoubleClick"]>
	>(
		(event) => {
			dispatchPointerEvent("doubleclick", event);
			onDoubleClick?.(event);
		},
		[dispatchPointerEvent, onDoubleClick],
	);

	return (
		<SkiaPictureViewNativeComponent
			pd={pd}
			ref={viewRef}
			collapsable={false}
			nativeID={`${nativeId}`}
			debug={debug}
			opaque={opaque}
			colorSpace={colorSpace}
			dynamicRange={dynamicRange}
			// androidWarmup={androidWarmup}
			onLayout={
				Platform.OS === "web" && (onSize || onLayout) ? onLayoutWeb : onLayout
			}
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
