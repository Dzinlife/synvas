import type {
	CanvasKit,
	GrDirectContext,
	Surface,
	WebGPUCanvasContext,
	WebGPUDeviceContext,
} from "canvaskit-wasm";

import { JsiSkSurface } from "./JsiSkSurface";
import {
	getPreferredWebGPUTextureFormat,
	getSkiaRenderBackend,
	type SkiaRenderBackend,
	toCanvasKitWebGPU,
} from "./renderBackend";

type CanvasElement = HTMLCanvasElement | OffscreenCanvas;
type CachedWebGPUCanvasContext = {
	deviceContext: WebGPUDeviceContext;
	textureFormat: GPUTextureFormat;
	canvasContext: WebGPUCanvasContext;
};

const WEBGPU_CANVAS_ALPHA_MODE = "premultiplied" as const;
const webgpuCanvasContextCache = new WeakMap<
	CanvasElement,
	CachedWebGPUCanvasContext
>();
let trackedWebGLSurfaceContext: unknown | null = null;

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

const applyOffscreenCanvasScale = (surface: JsiSkSurface, pixelRatio: number) => {
	if (pixelRatio === 1) return surface;
	surface.getCanvas().scale(pixelRatio, pixelRatio);
	return surface;
};

const setCanvasDisplayP3IfPossible = (canvas: CanvasElement) => {
	const context = canvas.getContext("webgl2") as
		| (WebGL2RenderingContext & {
				drawingBufferColorSpace?: string;
		  })
		| null;
	if (context) {
		context.drawingBufferColorSpace = "display-p3";
	}
};

const trackWebGLSurfaceContext = (surface: Surface) => {
	const contextHandle = (surface as Surface & { _context?: unknown })._context;
	if (contextHandle === undefined || contextHandle === null) {
		return () => {};
	}
	trackedWebGLSurfaceContext = contextHandle;
	return () => {
		if (trackedWebGLSurfaceContext === contextHandle) {
			trackedWebGLSurfaceContext = null;
		}
	};
};

const tryActivateTrackedWebGLSurfaceContext = (CanvasKit: CanvasKit) => {
	if (trackedWebGLSurfaceContext === null) {
		return;
	}
	const canvasKitWithContext = CanvasKit as CanvasKit & {
		setCurrentContext?: (context: unknown) => boolean;
	};
	canvasKitWithContext.setCurrentContext?.(trackedWebGLSurfaceContext);
};

const getOrCreateWebGPUCanvasContext = (
	CanvasKit: CanvasKit,
	canvas: CanvasElement,
	backend: Extract<SkiaRenderBackend, { kind: "webgpu" }>,
) => {
	const textureFormat = getPreferredWebGPUTextureFormat();
	const cachedContext = webgpuCanvasContextCache.get(canvas);
	if (
		cachedContext &&
		cachedContext.deviceContext === backend.deviceContext &&
		cachedContext.textureFormat === textureFormat
	) {
		return cachedContext.canvasContext;
	}
	const canvasContext = toCanvasKitWebGPU(CanvasKit).MakeGPUCanvasContext?.(
		backend.deviceContext,
		canvas,
		{
			format: textureFormat,
			alphaMode: WEBGPU_CANVAS_ALPHA_MODE,
		},
	);
	if (!canvasContext) {
		return null;
	}
	webgpuCanvasContextCache.set(canvas, {
		deviceContext: backend.deviceContext,
		textureFormat,
		canvasContext,
	});
	return canvasContext;
};

const getCurrentWebGLGrContext = (CanvasKit: CanvasKit) => {
	const canvasKit = CanvasKit as CanvasKit & {
		getCurrentGrDirectContext?: () => GrDirectContext | null;
	};
	let currentContext = canvasKit.getCurrentGrDirectContext?.();
	if (!currentContext) {
		// 尝试恢复主画布 context，避免离屏 surface 落到独立 GL context。
		tryActivateTrackedWebGLSurfaceContext(CanvasKit);
		currentContext = canvasKit.getCurrentGrDirectContext?.();
	}
	if (!currentContext) {
		return null;
	}
	const isDeleted = (
		currentContext as GrDirectContext & { isDeleted?: () => boolean }
	).isDeleted;
	if (typeof isDeleted === "function" && isDeleted.call(currentContext)) {
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
) => {
	if (backend.kind === "webgpu") {
		const webgpuCanvasKit = toCanvasKitWebGPU(CanvasKit);
		const canvasContext = getOrCreateWebGPUCanvasContext(
			CanvasKit,
			canvas,
			backend,
		);
		if (!canvasContext) {
			return null;
		}
		const surface = webgpuCanvasKit.MakeGPUCanvasSurface?.(canvasContext);
		if (!surface) {
			return null;
		}
		return new JsiSkSurface(CanvasKit, surface);
	}
	if (backend.kind === "webgl") {
		setCanvasDisplayP3IfPossible(canvas);
		const surface = CanvasKit.MakeWebGLCanvasSurface(canvas);
		if (!surface) {
			return null;
		}
		const detachTrackedContext = trackWebGLSurfaceContext(surface);
		return new JsiSkSurface(CanvasKit, surface, () => {
			detachTrackedContext();
		});
	}
	const surface = CanvasKit.MakeSWCanvasSurface(canvas);
	if (!surface) {
		return null;
	}
	return new JsiSkSurface(CanvasKit, surface);
};

export const createSkiaOffscreenSurface = (
	CanvasKit: CanvasKit,
	width: number,
	height: number,
	backend: SkiaRenderBackend = getSkiaRenderBackend(),
	pixelRatio?: number,
) => {
	const logicalWidth = Math.max(1, Math.ceil(width));
	const logicalHeight = Math.max(1, Math.ceil(height));
	const resolvedPixelRatio = resolveOffscreenPixelRatio(pixelRatio);
	const targetWidth = Math.max(1, Math.ceil(logicalWidth * resolvedPixelRatio));
	const targetHeight = Math.max(1, Math.ceil(logicalHeight * resolvedPixelRatio));
	if (backend.kind === "webgpu") {
		const surface = toCanvasKitWebGPU(CanvasKit).SkSurfaces?.RenderTarget?.(
			backend.deviceContext,
			{
				width: targetWidth,
				height: targetHeight,
				colorType: CanvasKit.ColorType.RGBA_8888,
				alphaType: CanvasKit.AlphaType.Premul,
				colorSpace: CanvasKit.ColorSpace.SRGB,
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
	}
	const surface = CanvasKit.MakeSurface(targetWidth, targetHeight);
	if (!surface) {
		return null;
	}
	return applyOffscreenCanvasScale(
		new JsiSkSurface(CanvasKit, surface),
		resolvedPixelRatio,
	);
};

export const assignCurrentSkiaSwapChainTexture = (surface: JsiSkSurface) => {
	const currentSurface = surface.ref as {
		assignCurrentSwapChainTexture?: () => boolean;
	};
	return currentSurface.assignCurrentSwapChainTexture?.() ?? true;
};
