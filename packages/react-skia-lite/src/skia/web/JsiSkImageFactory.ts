import type { CanvasKit, Image } from "canvaskit-wasm";
import type {
	ImageFactory,
	ImageInfo,
	NativeBuffer,
	SkData,
	SkImage,
} from "../types";
import { CanvasKitWebGLBuffer, isNativeBufferWeb } from "../types";
import type { CanvasKitWebGLBufferImpl } from "./CanvasKitWebGLBufferImpl";
import { getEnum, Host, throwNotImplementedOnRNWeb } from "./Host";
import { JsiSkData } from "./JsiSkData";
import { JsiSkImage } from "./JsiSkImage";
import type { JsiSkSurface } from "./JsiSkSurface";

const isHTMLImageElement = (
	value: CanvasImageSource | NativeBuffer,
): value is HTMLImageElement =>
	typeof HTMLImageElement !== "undefined" && value instanceof HTMLImageElement;

const isHTMLVideoElement = (
	value: CanvasImageSource | NativeBuffer,
): value is HTMLVideoElement =>
	typeof HTMLVideoElement !== "undefined" && value instanceof HTMLVideoElement;

const isImageBitmap = (
	value: CanvasImageSource | NativeBuffer,
): value is ImageBitmap =>
	typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap;

export class JsiSkImageFactory extends Host implements ImageFactory {
	constructor(CanvasKit: CanvasKit) {
		super(CanvasKit);
	}

	private replaceImageRef(image: JsiSkImage, nextImage: Image) {
		const previousImage = image.ref;
		image.ref = nextImage;
		if (previousImage === nextImage) {
			return image;
		}
		try {
			previousImage?.delete?.();
		} catch {}
		return image;
	}

	private makeImageFromCanvasImageSource(source: CanvasImageSource) {
		if (
			isHTMLImageElement(source) ||
			isHTMLVideoElement(source) ||
			isImageBitmap(source)
		) {
			return this.CanvasKit.MakeLazyImageFromTextureSource(source);
		}
		return this.CanvasKit.MakeImageFromCanvasImageSource(source);
	}

	MakeNull() {
		return new JsiSkImage(this.CanvasKit, null as unknown as Image);
	}

	MakeImageFromViewTag(viewTag: number): Promise<SkImage | null> {
		const view = viewTag as unknown as HTMLElement;
		// TODO: Implement screenshot from view in React JS
		console.log(view);
		return Promise.resolve(null);
	}

	MakeImageFromNativeBuffer(
		buffer: NativeBuffer,
		surface?: JsiSkSurface,
		image?: JsiSkImage,
	) {
		if (!isNativeBufferWeb(buffer)) {
			throw new Error("Invalid NativeBuffer");
		}
		if (!surface) {
			let img: Image;
			if (buffer instanceof CanvasKitWebGLBuffer) {
				img = (
					buffer as CanvasKitWebGLBuffer as CanvasKitWebGLBufferImpl
				).toImage();
			} else {
				img = this.makeImageFromCanvasImageSource(buffer as CanvasImageSource);
			}
			return new JsiSkImage(this.CanvasKit, img);
		}
		if (buffer instanceof CanvasKitWebGLBuffer) {
			const nextImage = (
				buffer as CanvasKitWebGLBuffer as CanvasKitWebGLBufferImpl
			).toImage();
			if (image) {
				return this.replaceImageRef(image, nextImage);
			}
			return new JsiSkImage(this.CanvasKit, nextImage);
		}
		const textureSourceSurface = surface.ref as unknown as {
			makeImageFromTextureSource?: (source: CanvasImageSource) => Image;
			updateTextureFromSource?: (
				image: Image,
				source: CanvasImageSource,
			) => Image;
		};
		if (
			typeof textureSourceSurface.makeImageFromTextureSource !== "function" ||
			typeof textureSourceSurface.updateTextureFromSource !== "function"
		) {
			const nextImage = this.makeImageFromCanvasImageSource(
				buffer as CanvasImageSource,
			);
			if (image) {
				return this.replaceImageRef(image, nextImage);
			}
			return new JsiSkImage(this.CanvasKit, nextImage);
		}
		if (!image) {
			const img = textureSourceSurface.makeImageFromTextureSource(
				buffer as CanvasImageSource,
			);
			return new JsiSkImage(this.CanvasKit, img);
		}
		const img = textureSourceSurface.updateTextureFromSource(
			image.ref,
			buffer as CanvasImageSource,
		);
		return this.replaceImageRef(image, img);
	}

	MakeImageFromEncoded(encoded: SkData) {
		const image = this.CanvasKit.MakeImageFromEncoded(
			JsiSkData.fromValue(encoded),
		);
		if (image === null) {
			return null;
		}
		return new JsiSkImage(this.CanvasKit, image);
	}

	MakeImageFromNativeTextureUnstable() {
		return throwNotImplementedOnRNWeb<SkImage>();
	}

	MakeImage(info: ImageInfo, data: SkData, bytesPerRow: number) {
		// see toSkImageInfo() from canvaskit
		const image = this.CanvasKit.MakeImage(
			{
				alphaType: getEnum(this.CanvasKit, "AlphaType", info.alphaType),
				colorSpace: this.CanvasKit.ColorSpace.SRGB,
				colorType: getEnum(this.CanvasKit, "ColorType", info.colorType),
				height: info.height,
				width: info.width,
			},
			JsiSkData.fromValue(data),
			bytesPerRow,
		);
		if (image === null) {
			return null;
		}
		return new JsiSkImage(this.CanvasKit, image);
	}
}
