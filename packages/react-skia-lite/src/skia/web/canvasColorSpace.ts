import type { CanvasKit, ColorSpace } from "canvaskit-wasm";

export type SkiaWebCanvasColorSpace = "srgb" | "p3";

export type SkiaWebCanvasColorSpaceSupport = {
	displayP3Gamut: boolean;
	canvas2DDisplayP3: boolean;
	webglDrawingBufferDisplayP3: boolean;
	webgpuCanvasDisplayP3: boolean;
};

const DISPLAY_P3_MEDIA_QUERY = "(color-gamut: p3)";
const SRGB_CANVAS_COLOR_SPACE = "srgb" as const;
const DISPLAY_P3_CANVAS_COLOR_SPACE = "display-p3" as const;

type CanvasKitColorSpaceProvider = Pick<CanvasKit, "ColorSpace">;

type Canvas2DContextWithAttributes = CanvasRenderingContext2D & {
	getContextAttributes?: () => {
		colorSpace?: string;
	};
};

type WebGLContextWithColorSpace = (
	| WebGLRenderingContext
	| WebGL2RenderingContext
) & {
	drawingBufferColorSpace?: string;
};

const canUseDOMCanvas = () =>
	typeof document !== "undefined" &&
	typeof document.createElement === "function";

export const canDisplayP3Colors = (): boolean => {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return false;
	}
	try {
		return window.matchMedia(DISPLAY_P3_MEDIA_QUERY).matches;
	} catch {
		return false;
	}
};

const canCreateDisplayP3Canvas2D = (): boolean => {
	if (!canUseDOMCanvas()) return false;
	try {
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d", {
			colorSpace: DISPLAY_P3_CANVAS_COLOR_SPACE,
		} as CanvasRenderingContext2DSettings) as Canvas2DContextWithAttributes | null;
		return (
			context?.getContextAttributes?.().colorSpace ===
			DISPLAY_P3_CANVAS_COLOR_SPACE
		);
	} catch {
		return false;
	}
};

const canUseDisplayP3WebGLDrawingBuffer = (): boolean => {
	if (!canUseDOMCanvas()) return false;
	try {
		const canvas = document.createElement("canvas");
		const context = (canvas.getContext("webgl2") ??
			canvas.getContext("webgl")) as WebGLContextWithColorSpace | null;
		if (!context || !("drawingBufferColorSpace" in context)) {
			return false;
		}
		context.drawingBufferColorSpace = DISPLAY_P3_CANVAS_COLOR_SPACE;
		return context.drawingBufferColorSpace === DISPLAY_P3_CANVAS_COLOR_SPACE;
	} catch {
		return false;
	}
};

const canUseWebGPUCanvasColorSpace = (): boolean => {
	if (typeof navigator === "undefined") return false;
	const gpuNavigator = navigator as Navigator & {
		gpu?: {
			requestAdapter?: unknown;
		};
	};
	return typeof gpuNavigator.gpu?.requestAdapter === "function";
};

export const detectSkiaWebCanvasColorSpaceSupport =
	(): SkiaWebCanvasColorSpaceSupport => {
		const displayP3Gamut = canDisplayP3Colors();
		return {
			displayP3Gamut,
			canvas2DDisplayP3: displayP3Gamut && canCreateDisplayP3Canvas2D(),
			webglDrawingBufferDisplayP3:
				displayP3Gamut && canUseDisplayP3WebGLDrawingBuffer(),
			webgpuCanvasDisplayP3: displayP3Gamut && canUseWebGPUCanvasColorSpace(),
		};
	};

export const hasCanvasKitDisplayP3ColorSpace = (
	canvasKit: CanvasKitColorSpaceProvider,
) => Boolean(canvasKit.ColorSpace?.DISPLAY_P3);

export const resolveSkiaWebCanvasColorSpace = (
	requested: SkiaWebCanvasColorSpace | undefined,
	canvasKit?: CanvasKitColorSpaceProvider,
): SkiaWebCanvasColorSpace => {
	if (requested !== "p3") {
		return "srgb";
	}
	if (!canDisplayP3Colors()) {
		return "srgb";
	}
	if (canvasKit && !hasCanvasKitDisplayP3ColorSpace(canvasKit)) {
		return "srgb";
	}
	return "p3";
};

export const toPredefinedCanvasColorSpace = (
	colorSpace: SkiaWebCanvasColorSpace,
) =>
	colorSpace === "p3" ? DISPLAY_P3_CANVAS_COLOR_SPACE : SRGB_CANVAS_COLOR_SPACE;

export const toCanvasKitColorSpace = (
	canvasKit: CanvasKitColorSpaceProvider,
	colorSpace: SkiaWebCanvasColorSpace,
): ColorSpace =>
	colorSpace === "p3" && canvasKit.ColorSpace.DISPLAY_P3
		? canvasKit.ColorSpace.DISPLAY_P3
		: canvasKit.ColorSpace.SRGB;
