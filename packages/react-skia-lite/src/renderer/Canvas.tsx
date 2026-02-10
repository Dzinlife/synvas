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
import { SkiaSGRoot } from "../sksg/Reconciler";
import SkiaPictureViewNativeComponent from "../specs/SkiaPictureViewNativeComponent";
import { SkiaViewApi } from "../views/api";
import { SkiaViewNativeId } from "../views/SkiaViewNativeId";

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
	colorSpace?: "p3" | "srgb";
	ref?: React.Ref<CanvasRef>;
	androidWarmup?: boolean;
	__destroyWebGLContextAfterRender?: boolean;
	pd?: number;
}

export const Canvas = ({
	debug,
	opaque,
	children,
	onSize,
	colorSpace = "p3",
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

	// Render effects
	useLayoutEffect(() => {
		root.render(children);
	}, [children, root, nativeId]);

	useEffect(() => {
		return () => {
			root.unmount();
		};
	}, [root]);

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
	return (
		<SkiaPictureViewNativeComponent
			pd={pd}
			ref={viewRef}
			collapsable={false}
			nativeID={`${nativeId}`}
			debug={debug}
			opaque={opaque}
			// colorSpace={colorSpace}
			// androidWarmup={androidWarmup}
			onLayout={
				Platform.OS === "web" && (onSize || onLayout) ? onLayoutWeb : onLayout
			}
			{...viewProps}
		/>
	);
};
