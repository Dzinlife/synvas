import type { Image, Surface, TextureSource } from "canvaskit-wasm";

import type { SkImage } from "../types";

import { CanvasKit } from "../Skia";
import { JsiSkImage } from "./JsiSkImage";
import {
	getPreferredWebGPUTextureFormat,
	getSkiaRenderBackend,
	toCanvasKitWebGPU,
} from "./renderBackend";

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

const getTextureSourceWidth = (source: TextureSource | VideoFrame) => {
	return (
		(source as { naturalWidth?: number }).naturalWidth ??
		(source as { videoWidth?: number }).videoWidth ??
		(source as { displayWidth?: number }).displayWidth ??
		(source as { width?: number }).width ??
		0
	);
};

const getTextureSourceHeight = (source: TextureSource | VideoFrame) => {
	return (
		(source as { naturalHeight?: number }).naturalHeight ??
		(source as { videoHeight?: number }).videoHeight ??
		(source as { displayHeight?: number }).displayHeight ??
		(source as { height?: number }).height ??
		0
	);
};

const toExternalTextureSource = (source: TextureSource | VideoFrame) => {
	return source as unknown as HTMLCanvasElement | OffscreenCanvas | ImageBitmap;
};

const disposeSurface = (surface: Surface | null | undefined) => {
	try {
		surface?.dispose?.();
	} catch {}
	try {
		surface?.delete?.();
	} catch {}
};

const attachImageCleanup = (image: Image, cleanup: () => void) => {
	const mutableImage = image as Image & {
		delete?: () => void;
		__aiNLETextureSourceCleanupAttached?: boolean;
	};
	if (mutableImage.__aiNLETextureSourceCleanupAttached) {
		return image;
	}
	const originalDelete =
		typeof mutableImage.delete === "function"
			? mutableImage.delete.bind(mutableImage)
			: undefined;
	let released = false;
	const release = () => {
		if (released) {
			return;
		}
		released = true;
		cleanup();
	};
	mutableImage.delete = () => {
		release();
		originalDelete?.();
	};
	mutableImage.__aiNLETextureSourceCleanupAttached = true;
	return image;
};

export const makeImageFromTextureSourceDirect = (
	source: TextureSource | VideoFrame,
): SkImage | null => {
	const backend = getSkiaRenderBackend();
	if (backend.kind === "webgl") {
		try {
			const image = CanvasKit.MakeLazyImageFromTextureSource(
				source as TextureSource,
			);
			return new JsiSkImage(CanvasKit, image);
		} catch (error) {
			console.warn("Failed to create WebGL texture-source image", error);
			return null;
		}
	}
	if (backend.kind !== "webgpu") {
		return null;
	}
	const width = Math.max(1, Math.ceil(getTextureSourceWidth(source)));
	const height = Math.max(1, Math.ceil(getTextureSourceHeight(source)));
	const textureFormat = getPreferredWebGPUTextureFormat();
	const texture = backend.device.createTexture({
		size: {
			width,
			height,
		},
		format: textureFormat,
		usage: getWebGPUTextureUsage(),
	});
	let surface: Surface | null = null;
	try {
		backend.device.queue.copyExternalImageToTexture(
			{
				source: toExternalTextureSource(source),
			},
			{ texture },
			{
				width,
				height,
			},
		);
		surface = toCanvasKitWebGPU(CanvasKit).MakeGPUTextureSurface?.(
			backend.deviceContext,
			texture,
			textureFormat,
			width,
			height,
			undefined,
		) as Surface | null;
		if (!surface) {
			texture.destroy();
			return null;
		}
		const image = attachImageCleanup(surface.makeImageSnapshot(), () => {
			disposeSurface(surface);
			texture.destroy();
		});
		return new JsiSkImage(CanvasKit, image);
	} catch (error) {
		disposeSurface(surface);
		texture.destroy();
		console.warn("Failed to create texture-source image", error);
		return null;
	}
};
