import type { Image, TextureSource } from "canvaskit-wasm";

import { CanvasKit } from "../Skia";
import { JsiSkImage } from "./JsiSkImage";
import {
	getPreferredWebGPUTextureFormat,
	getSkiaRenderBackend,
	toCanvasKitWebGPU,
} from "./renderBackend";

type CanvasKitWithLazyTextureSourceImage = typeof CanvasKit & {
	MakeLazyImageFromTextureSource?: (src: TextureSource) => Image | null;
};

type WebGPUExternalImageCopy = Parameters<
	GPUQueue["copyExternalImageToTexture"]
>[0];
type WebGPUExternalTextureDestination = Parameters<
	GPUQueue["copyExternalImageToTexture"]
>[1] & {
	colorSpace?: PredefinedColorSpace;
};

export type TextureSourceTargetColorSpace = "srgb" | "display-p3";

export interface TextureSourceImageOptions {
	targetColorSpace?: TextureSourceTargetColorSpace;
	colorConversion?: "browser" | "none";
}

const WEBGPU_TEXTURE_USAGE_FALLBACK = 0x01 | 0x02 | 0x04 | 0x10;
let didWarnWebGLColorManagedTextureSource = false;

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

const destroyWebGPUTextureWhenQueueIdle = (
	device: GPUDevice,
	texture: GPUTexture,
) => {
	const onSubmittedWorkDone = device.queue?.onSubmittedWorkDone;
	if (typeof onSubmittedWorkDone !== "function") {
		texture.destroy();
		return;
	}
	// 等待已提交命令完成后再销毁外部纹理，避免 validation error。
	void onSubmittedWorkDone
		.call(device.queue)
		.catch(() => undefined)
		.finally(() => {
			texture.destroy();
		});
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

const toExternalTextureSource = (source: TextureSource | VideoFrame) =>
	({
		source: source as never,
	}) as WebGPUExternalImageCopy;

const resolveTargetColorSpace = (
	options: TextureSourceImageOptions | undefined,
): TextureSourceTargetColorSpace =>
	options?.targetColorSpace === "display-p3" &&
	CanvasKit.ColorSpace.DISPLAY_P3
		? "display-p3"
		: "srgb";

const toCanvasKitTextureColorSpace = (
	targetColorSpace: TextureSourceTargetColorSpace,
) =>
	targetColorSpace === "display-p3" && CanvasKit.ColorSpace.DISPLAY_P3
		? CanvasKit.ColorSpace.DISPLAY_P3
		: CanvasKit.ColorSpace.SRGB;

const toExternalTextureDestination = (
	texture: GPUTexture,
	targetColorSpace: TextureSourceTargetColorSpace,
	options: TextureSourceImageOptions | undefined,
): WebGPUExternalTextureDestination => ({
	texture,
	...(options?.colorConversion === "none"
		? {}
		: { colorSpace: targetColorSpace }),
});

export const makeImageFromTextureSourceDirect = (
	source: TextureSource | VideoFrame,
	options?: TextureSourceImageOptions,
): JsiSkImage | null => {
	const backend = getSkiaRenderBackend();
	if (backend.kind === "webgl") {
		if (
			(options?.targetColorSpace === "display-p3" ||
				options?.colorConversion === "browser") &&
			!didWarnWebGLColorManagedTextureSource
		) {
			didWarnWebGLColorManagedTextureSource = true;
			console.info(
				"WebGL texture-source images are created through the sRGB compatibility path.",
			);
		}
		try {
			const canvasKit = CanvasKit as CanvasKitWithLazyTextureSourceImage;
			const image =
				canvasKit.MakeLazyImageFromTextureSource?.(
					source as TextureSource,
				) ?? CanvasKit.MakeImageFromCanvasImageSource(source as CanvasImageSource);
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
	const targetColorSpace = resolveTargetColorSpace(options);
	const textureFormat = getPreferredWebGPUTextureFormat();
	const texture = backend.device.createTexture({
		size: {
			width,
			height,
		},
		format: textureFormat,
		usage: getWebGPUTextureUsage(),
	});
	try {
		backend.device.queue.copyExternalImageToTexture(
			toExternalTextureSource(source),
			toExternalTextureDestination(texture, targetColorSpace, options),
			{
				width,
				height,
			},
		);
		const image = toCanvasKitWebGPU(CanvasKit).SkImages?.WrapTexture?.(
			backend.deviceContext,
			texture,
			CanvasKit.ColorType.RGBA_8888,
			CanvasKit.AlphaType.Unpremul,
			toCanvasKitTextureColorSpace(targetColorSpace),
			undefined,
			undefined,
			() => {
				texture.destroy();
			},
		);
		if (!image) {
			destroyWebGPUTextureWhenQueueIdle(backend.device, texture);
			return null;
		}
		return new JsiSkImage(CanvasKit, image);
	} catch (error) {
		destroyWebGPUTextureWhenQueueIdle(backend.device, texture);
		console.warn("Failed to create texture-source image", error);
		return null;
	}
};
