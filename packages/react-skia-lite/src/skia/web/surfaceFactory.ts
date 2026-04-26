import type {
	CanvasKit,
	GrDirectContext,
	Surface,
	WebGPUCanvasContext,
	WebGPUDeviceContext,
	WebGLContextHandle,
} from "canvaskit-wasm";

import { JsiSkSurface } from "./JsiSkSurface";
import {
	resolveSkiaWebCanvasColorSpace,
	resolveSkiaWebCanvasDynamicRange,
	type SkiaWebCanvasDynamicRange,
	type SkiaWebCanvasColorSpace,
	toCanvasKitColorSpace,
	toPredefinedCanvasColorSpace,
} from "./canvasColorSpace";
import {
	getPreferredWebGPUTextureFormat,
	getSkiaRenderBackend,
	type SkiaRenderBackend,
	toCanvasKitWebGPU,
} from "./renderBackend";
import type { SkiaOffscreenSurfaceOptions } from "../types/Surface/SurfaceFactory";

type CanvasElement = HTMLCanvasElement | OffscreenCanvas;
type CachedWebGPUCanvasContext = {
	deviceContext: WebGPUDeviceContext;
	textureFormat: GPUTextureFormat;
	colorSpace: SkiaWebCanvasColorSpace;
	dynamicRange: SkiaWebCanvasDynamicRange;
	canvasContext: WebGPUCanvasContext;
};
type SkiaCanvasSurfaceOptions = {
	colorSpace?: SkiaWebCanvasColorSpace;
	dynamicRange?: SkiaWebCanvasDynamicRange;
};
type WebGLSurface = Surface & { _context?: unknown };
type WebGLOnScreenSurface = {
	surface: Surface;
	contextHandle: WebGLContextHandle;
	grContext: GrDirectContext;
};
type TrackedWebGLSurfaceContext = {
	contextHandle: WebGLContextHandle;
	grContext: GrDirectContext;
};

const WEBGPU_STANDARD_CANVAS_ALPHA_MODE = "premultiplied" as const;
const WEBGPU_HDR_CANVAS_ALPHA_MODE = "opaque" as const;
const WEBGPU_HDR_CANVAS_FORMAT = "rgba16float" as const;
const webgpuCanvasContextCache = new WeakMap<
	CanvasElement,
	CachedWebGPUCanvasContext
>();
let trackedWebGLSurfaceContext: TrackedWebGLSurfaceContext | null = null;
const emittedSurfaceWarnings = new Set<string>();

const warnSurfaceOnce = (key: string, message: string) => {
	if (emittedSurfaceWarnings.has(key)) return;
	emittedSurfaceWarnings.add(key);
	console.warn(message);
};

const normalizeOffscreenPixelRatio = (value: number) => {
	return Math.min(4, Math.max(1, value));
};

const resolveOffscreenPixelRatio = (pixelRatio?: number) => {
	if (
		typeof pixelRatio === "number" &&
		Number.isFinite(pixelRatio) &&
		pixelRatio > 0
	) {
		return normalizeOffscreenPixelRatio(pixelRatio);
	}
	if (
		typeof window !== "undefined" &&
		Number.isFinite(window.devicePixelRatio) &&
		window.devicePixelRatio > 0
	) {
		return normalizeOffscreenPixelRatio(window.devicePixelRatio);
	}
	return 1;
};

const applyOffscreenCanvasScale = (
	surface: JsiSkSurface,
	pixelRatio: number,
) => {
	if (pixelRatio === 1) return surface;
	surface.getCanvas().scale(pixelRatio, pixelRatio);
	return surface;
};

const setCanvasDrawingBufferColorSpaceIfPossible = (
	canvas: CanvasElement,
	colorSpace: SkiaWebCanvasColorSpace,
) => {
	const context = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as
		| ((WebGL2RenderingContext | WebGLRenderingContext) & {
				drawingBufferColorSpace?: string;
		  })
		| null;
	if (!context) {
		return colorSpace === "srgb";
	}
	if (!("drawingBufferColorSpace" in context)) {
		return colorSpace === "srgb";
	}
	const predefinedColorSpace = toPredefinedCanvasColorSpace(colorSpace);
	try {
		context.drawingBufferColorSpace = predefinedColorSpace;
		return context.drawingBufferColorSpace === predefinedColorSpace;
	} catch {
		return false;
	}
};

const attachWebGLContextHandle = (
	surface: Surface,
	contextHandle: WebGLContextHandle,
) => {
	try {
		(surface as WebGLSurface)._context = contextHandle;
	} catch {}
};

const createWebGLOnScreenSurface = (
	CanvasKit: CanvasKit,
	canvas: CanvasElement,
	colorSpace: SkiaWebCanvasColorSpace,
) => {
	const canUseDisplayP3DrawingBuffer =
		colorSpace === "p3" &&
		setCanvasDrawingBufferColorSpaceIfPossible(canvas, colorSpace);
	if (colorSpace !== "p3") {
		setCanvasDrawingBufferColorSpaceIfPossible(canvas, colorSpace);
	}
	const contextHandle = CanvasKit.GetWebGLContext(canvas);
	if (!contextHandle || contextHandle < 0) {
		return null;
	}
	const grContext = CanvasKit.MakeWebGLContext(contextHandle);
	if (!grContext) {
		return null;
	}
	const tryMakeSurface = (nextColorSpace: SkiaWebCanvasColorSpace) => {
		const canUseDrawingBufferColorSpace =
			setCanvasDrawingBufferColorSpaceIfPossible(canvas, nextColorSpace);
		if (nextColorSpace === "p3" && !canUseDrawingBufferColorSpace) {
			return null;
		}
		const surface = CanvasKit.MakeOnScreenGLSurface(
			grContext,
			canvas.width,
			canvas.height,
			toCanvasKitColorSpace(CanvasKit, nextColorSpace),
		);
		if (!surface) {
			return null;
		}
		attachWebGLContextHandle(surface, contextHandle);
		return {
			surface,
			contextHandle,
			grContext,
		};
	};
	const surface =
		(colorSpace === "p3" && !canUseDisplayP3DrawingBuffer
			? null
			: tryMakeSurface(colorSpace)) ??
		(colorSpace === "p3" ? tryMakeSurface("srgb") : null);
	if (!surface) {
		grContext.delete();
	}
	return surface;
};

const isUsableGrContext = (context: GrDirectContext | null | undefined) => {
	if (!context) {
		return false;
	}
	const isDeleted = (context as GrDirectContext & { isDeleted?: () => boolean })
		.isDeleted;
	return !(typeof isDeleted === "function" && isDeleted.call(context));
};

const trackWebGLSurfaceContext = (webglSurface: WebGLOnScreenSurface) => {
	if (!isUsableGrContext(webglSurface.grContext)) {
		return () => {};
	}
	trackedWebGLSurfaceContext = {
		contextHandle: webglSurface.contextHandle,
		grContext: webglSurface.grContext,
	};
	return () => {
		if (trackedWebGLSurfaceContext?.grContext === webglSurface.grContext) {
			trackedWebGLSurfaceContext = null;
		}
	};
};

const tryActivateTrackedWebGLSurfaceContext = (CanvasKit: CanvasKit) => {
	if (trackedWebGLSurfaceContext === null) {
		return null;
	}
	if (!isUsableGrContext(trackedWebGLSurfaceContext.grContext)) {
		trackedWebGLSurfaceContext = null;
		return null;
	}
	const canvasKitWithContext = CanvasKit as CanvasKit & {
		setCurrentContext?: (context: WebGLContextHandle) => boolean;
	};
	canvasKitWithContext.setCurrentContext?.(
		trackedWebGLSurfaceContext.contextHandle,
	);
	return trackedWebGLSurfaceContext.grContext;
};

const getOrCreateWebGPUCanvasContext = (
	CanvasKit: CanvasKit,
	canvas: CanvasElement,
	backend: Extract<SkiaRenderBackend, { kind: "webgpu" }>,
	colorSpace: SkiaWebCanvasColorSpace,
	dynamicRange: SkiaWebCanvasDynamicRange,
) => {
	const cachedContext = webgpuCanvasContextCache.get(canvas);
	if (
		cachedContext &&
		cachedContext.deviceContext === backend.deviceContext &&
		cachedContext.colorSpace === colorSpace &&
		cachedContext.dynamicRange === dynamicRange
	) {
		return cachedContext.canvasContext;
	}
	const makeCanvasContext = (nextDynamicRange: SkiaWebCanvasDynamicRange) => {
		const textureFormat =
			nextDynamicRange === "extended"
				? WEBGPU_HDR_CANVAS_FORMAT
				: getPreferredWebGPUTextureFormat();
		const canvasContext = toCanvasKitWebGPU(CanvasKit).MakeGPUCanvasContext?.(
			backend.deviceContext,
			canvas,
			{
				format: textureFormat,
				alphaMode:
					nextDynamicRange === "extended"
						? WEBGPU_HDR_CANVAS_ALPHA_MODE
						: WEBGPU_STANDARD_CANVAS_ALPHA_MODE,
				colorSpace: toPredefinedCanvasColorSpace(colorSpace),
				...(nextDynamicRange === "extended"
					? { toneMapping: { mode: "extended" as const } }
					: {}),
			},
		);
		return canvasContext ? { canvasContext, textureFormat } : null;
	};
	const resolved =
		(dynamicRange === "extended" ? makeCanvasContext("extended") : null) ??
		makeCanvasContext("standard");
	if (!resolved) {
		return null;
	}
	if (
		dynamicRange === "extended" &&
		resolved.textureFormat !== WEBGPU_HDR_CANVAS_FORMAT
	) {
		warnSurfaceOnce(
			"webgpu-hdr-canvas-fallback",
			"WebGPU HDR canvas output is unavailable; falling back to SDR canvas output.",
		);
	}
	webgpuCanvasContextCache.set(canvas, {
		deviceContext: backend.deviceContext,
		textureFormat: resolved.textureFormat,
		colorSpace,
		dynamicRange,
		canvasContext: resolved.canvasContext,
	});
	return resolved.canvasContext;
};

const getCurrentWebGLGrContext = (CanvasKit: CanvasKit) => {
	const canvasKit = CanvasKit as CanvasKit & {
		getCurrentGrDirectContext?: () => GrDirectContext | null;
	};
	let currentContext = canvasKit.getCurrentGrDirectContext?.();
	if (!currentContext) {
		// 尝试恢复主画布 context，避免离屏 surface 落到独立 GL context。
		currentContext =
			tryActivateTrackedWebGLSurfaceContext(CanvasKit) ??
			canvasKit.getCurrentGrDirectContext?.();
	}
	if (!isUsableGrContext(currentContext)) {
		return null;
	}
	return currentContext;
};

export const invalidateSkiaWebGPUCanvasContext = (canvas: CanvasElement) => {
	webgpuCanvasContextCache.delete(canvas);
};

export const createSkiaCanvasSurface = (
	CanvasKit: CanvasKit,
	canvas: CanvasElement,
	backend: SkiaRenderBackend = getSkiaRenderBackend(),
	options: SkiaCanvasSurfaceOptions = {},
) => {
	if (backend.kind === "webgpu") {
		const colorSpace = resolveSkiaWebCanvasColorSpace(
			options.colorSpace,
			CanvasKit,
		);
		const dynamicRange = resolveSkiaWebCanvasDynamicRange(options.dynamicRange);
		const canvasKitColorSpace = toCanvasKitColorSpace(CanvasKit, colorSpace);
		const webgpuCanvasKit = toCanvasKitWebGPU(CanvasKit);
		const canvasContext = getOrCreateWebGPUCanvasContext(
			CanvasKit,
			canvas,
			backend,
			colorSpace,
			dynamicRange,
		);
		if (!canvasContext) {
			return null;
		}
		const surface = webgpuCanvasKit.MakeGPUCanvasSurface?.(
			canvasContext,
			canvasKitColorSpace,
		);
		if (!surface) {
			return null;
		}
		return new JsiSkSurface(CanvasKit, surface);
	}
	if (backend.kind === "webgl") {
		if (options.dynamicRange === "extended") {
			warnSurfaceOnce(
				"webgl-hdr-canvas-fallback",
				"WebGL does not support HDR canvas output in react-skia-lite; falling back to SDR canvas output.",
			);
		}
		const colorSpace = resolveSkiaWebCanvasColorSpace(
			options.colorSpace,
			CanvasKit,
		);
		const webglSurface = createWebGLOnScreenSurface(
			CanvasKit,
			canvas,
			colorSpace,
		);
		if (!webglSurface) {
			return null;
		}
		const detachTrackedContext = trackWebGLSurfaceContext(webglSurface);
		return new JsiSkSurface(CanvasKit, webglSurface.surface, () => {
			detachTrackedContext();
		});
	}
	return null;
};

export const createSkiaOffscreenSurface = (
	CanvasKit: CanvasKit,
	width: number,
	height: number,
	backend: SkiaRenderBackend = getSkiaRenderBackend(),
	optionsOrPixelRatio?: number | SkiaOffscreenSurfaceOptions,
) => {
	const options =
		typeof optionsOrPixelRatio === "number"
			? { pixelRatio: optionsOrPixelRatio }
			: (optionsOrPixelRatio ?? {});
	const logicalWidth = Math.max(1, Math.ceil(width));
	const logicalHeight = Math.max(1, Math.ceil(height));
	const resolvedPixelRatio = resolveOffscreenPixelRatio(options.pixelRatio);
	const targetWidth = Math.max(1, Math.ceil(logicalWidth * resolvedPixelRatio));
	const targetHeight = Math.max(
		1,
		Math.ceil(logicalHeight * resolvedPixelRatio),
	);
	if (backend.kind === "webgpu") {
		const colorSpace = resolveSkiaWebCanvasColorSpace(
			options.colorSpace,
			CanvasKit,
		);
		const dynamicRange = resolveSkiaWebCanvasDynamicRange(options.dynamicRange);
		const canvasKitColorSpace = toCanvasKitColorSpace(CanvasKit, colorSpace);
		const webgpuColorTypes = CanvasKit.ColorType as CanvasKit["ColorType"] & {
			RGBA_F16?: unknown;
		};
		const colorType =
			dynamicRange === "extended" && webgpuColorTypes.RGBA_F16
				? webgpuColorTypes.RGBA_F16
				: CanvasKit.ColorType.RGBA_8888;
		if (
			dynamicRange === "extended" &&
			colorType === CanvasKit.ColorType.RGBA_8888
		) {
			warnSurfaceOnce(
				"webgpu-hdr-offscreen-fallback",
				"WebGPU HDR offscreen surface requested RGBA_F16, but CanvasKit does not expose it; falling back to RGBA_8888.",
			);
		}
		const surface = toCanvasKitWebGPU(CanvasKit).SkSurfaces?.RenderTarget?.(
			backend.deviceContext,
			{
				width: targetWidth,
				height: targetHeight,
				colorType,
				alphaType: CanvasKit.AlphaType.Premul,
				colorSpace: canvasKitColorSpace,
			},
			false,
			undefined,
			"",
		);
		if (!surface) {
			return null;
		}
		return applyOffscreenCanvasScale(
			new JsiSkSurface(CanvasKit, surface),
			resolvedPixelRatio,
		);
	}
	if (
		backend.kind === "webgl" &&
		typeof CanvasKit.MakeRenderTarget === "function"
	) {
		const currentGrContext = getCurrentWebGLGrContext(CanvasKit);
		if (currentGrContext) {
			const surface = CanvasKit.MakeRenderTarget(
				currentGrContext,
				targetWidth,
				targetHeight,
			);
			if (surface) {
				return applyOffscreenCanvasScale(
					new JsiSkSurface(CanvasKit, surface),
					resolvedPixelRatio,
				);
			}
		}
		return null;
	}
	return null;
};

export const assignCurrentSkiaSwapChainTexture = (surface: JsiSkSurface) => {
	const currentSurface = surface.ref as {
		assignCurrentSwapChainTexture?: () => boolean;
	};
	return currentSurface.assignCurrentSwapChainTexture?.() ?? true;
};
