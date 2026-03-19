import type {
	CanvasKit,
	GrDirectContext,
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

const releaseWebGLCanvasContext = (canvas: CanvasElement) => {
	const context = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
	const loseContext = context?.getExtension("WEBGL_lose_context");
	loseContext?.loseContext();
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
	const currentContext = canvasKit.getCurrentGrDirectContext?.();
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
		return new JsiSkSurface(CanvasKit, surface, () => {
			releaseWebGLCanvasContext(canvas);
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
) => {
	const targetWidth = Math.max(1, Math.ceil(width));
	const targetHeight = Math.max(1, Math.ceil(height));
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
		return new JsiSkSurface(CanvasKit, surface);
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
				return new JsiSkSurface(CanvasKit, surface);
			}
		}
	}
	if (
		backend.kind === "webgl" &&
		typeof OffscreenCanvas !== "undefined" &&
		typeof CanvasKit.GetWebGLContext === "function" &&
		typeof CanvasKit.MakeWebGLContext === "function" &&
		typeof CanvasKit.MakeRenderTarget === "function"
	) {
		const canvas = new OffscreenCanvas(targetWidth, targetHeight);
		const contextHandle = CanvasKit.GetWebGLContext(canvas);
		const grContext = CanvasKit.MakeWebGLContext(contextHandle);
		if (!grContext) {
			if (typeof CanvasKit.deleteContext === "function") {
				CanvasKit.deleteContext(contextHandle);
			}
			return null;
		}
		const surface = CanvasKit.MakeRenderTarget(
			grContext,
			targetWidth,
			targetHeight,
		);
		if (!surface) {
			try {
				grContext.delete();
			} catch {}
			if (typeof CanvasKit.deleteContext === "function") {
				CanvasKit.deleteContext(contextHandle);
			}
			releaseWebGLCanvasContext(canvas);
			return null;
		}
		return new JsiSkSurface(CanvasKit, surface, () => {
			try {
				grContext.delete();
			} catch {}
			if (typeof CanvasKit.deleteContext === "function") {
				CanvasKit.deleteContext(contextHandle);
			}
			releaseWebGLCanvasContext(canvas);
		});
	}
	const surface = CanvasKit.MakeSurface(targetWidth, targetHeight);
	if (!surface) {
		return null;
	}
	return new JsiSkSurface(CanvasKit, surface);
};

export const assignCurrentSkiaSwapChainTexture = (surface: JsiSkSurface) => {
	const currentSurface = surface.ref as {
		assignCurrentSwapChainTexture?: () => boolean;
	};
	return currentSurface.assignCurrentSwapChainTexture?.() ?? true;
};
