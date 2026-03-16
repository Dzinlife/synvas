import type { CanvasKit } from "canvaskit-wasm";

import { JsiSkSurface } from "./JsiSkSurface";
import {
	getPreferredWebGPUTextureFormat,
	getSkiaRenderBackend,
	type SkiaRenderBackend,
	toCanvasKitWebGPU,
} from "./renderBackend";

type CanvasElement = HTMLCanvasElement | OffscreenCanvas;

const WEBGPU_TEXTURE_USAGE_FALLBACK = 0x01 | 0x02 | 0x04 | 0x10;

const getWebGPUTextureUsage = () => {
	if (typeof GPUTextureUsage === "undefined") {
		return WEBGPU_TEXTURE_USAGE_FALLBACK;
	}
	return (
		GPUTextureUsage.RENDER_ATTACHMENT |
		GPUTextureUsage.TEXTURE_BINDING |
		GPUTextureUsage.COPY_SRC |
		GPUTextureUsage.COPY_DST
	);
};

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

export const createSkiaCanvasSurface = (
	CanvasKit: CanvasKit,
	canvas: CanvasElement,
	backend: SkiaRenderBackend = getSkiaRenderBackend(),
) => {
	if (backend.kind === "webgpu") {
		const webgpuCanvasKit = toCanvasKitWebGPU(CanvasKit);
		const canvasContext = webgpuCanvasKit.MakeGPUCanvasContext?.(
			backend.deviceContext,
			canvas,
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
		const textureFormat = getPreferredWebGPUTextureFormat();
		const texture = backend.device.createTexture({
			size: {
				width: targetWidth,
				height: targetHeight,
			},
			format: textureFormat,
			usage: getWebGPUTextureUsage(),
		});
		const surface = toCanvasKitWebGPU(CanvasKit).MakeGPUTextureSurface?.(
			backend.deviceContext,
			texture,
			textureFormat,
			targetWidth,
			targetHeight,
			undefined,
		);
		if (!surface) {
			texture.destroy();
			return null;
		}
		return new JsiSkSurface(CanvasKit, surface, () => {
			texture.destroy();
		});
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
