import type { Node } from "../dom/types";
import type { SharedValue } from "../animation/runtime/types";
import type { SkImage, SkPicture, SkRect, SkSize } from "../skia/types";
import type {
	SkiaWebCanvasColorSpace,
	SkiaWebCanvasDynamicRange,
} from "../skia/web/canvasColorSpace";
import type { SkiaWebViewProps } from "../web/types";

export interface SkiaCanvasRegistry {
	web?: boolean;
	setCanvasProperty: <T>(canvasId: number, name: string, value: T) => void;
	requestRedraw: (canvasId: number) => void;
	makeImageSnapshot: (canvasId: number, rect?: SkRect) => SkImage | null;
	makeImageSnapshotAsync: (canvasId: number, rect?: SkRect) => Promise<SkImage>;
	size: (canvasId: number) => SkSize;
}

export interface SkiaBaseViewProps extends SkiaWebViewProps {
	/**
	 * When set to true the view will display information about the
	 * average time it takes to render.
	 */
	debug?: boolean;
	/**
	 * Pass an animated value to the onSize property to get updates when
	 * the Skia view is resized.
	 */
	onSize?: SharedValue<SkSize>;

	opaque?: boolean;
	colorSpace?: SkiaWebCanvasColorSpace;
	dynamicRange?: SkiaWebCanvasDynamicRange;
}

export interface SkiaPictureViewBaseProps extends SkiaBaseViewProps {
	picture?: SkPicture;
	canvasId?: string;
}

export interface SkiaDomViewProps extends SkiaBaseViewProps {
	root?: Node<unknown>;
}
