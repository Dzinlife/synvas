import type {
	CanvasKit,
	FilterOptions,
	ImageFilter,
	Matrix3x3,
} from "canvaskit-wasm";

import type {
	BlendMode,
	ColorChannel,
	FilterMode,
	ImageFilterFactory,
	MipmapMode,
	SkColor,
	SkColorFilter,
	SkImage,
	SkImageFilter,
	SkMatrix,
	SkPicture,
	SkPoint3,
	SkRect,
	SkRuntimeShaderBuilder,
	SkShader,
	TileMode,
} from "../types";

import { getEnum, Host, throwNotImplementedOnWeb } from "./Host";
import { JsiSkColorFilter } from "./JsiSkColorFilter";
import { JsiSkImageFilter } from "./JsiSkImageFilter";
import { JsiSkMatrix } from "./JsiSkMatrix";

export class JsiSkImageFilterFactory
	extends Host
	implements ImageFilterFactory
{
	constructor(CanvasKit: CanvasKit) {
		super(CanvasKit);
	}
	MakeRuntimeShaderWithChildren(
		_builder: SkRuntimeShaderBuilder,
		_sampleRadius: number,
		_childShaderNames: string[],
		_inputs: Array<SkImageFilter | null>,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakeArithmetic(
		_k1: number,
		_k2: number,
		_k3: number,
		_k4: number,
		_enforcePMColor: boolean,
		_background?: SkImageFilter | null,
		_foreground?: SkImageFilter | null,
		_cropRect?: SkRect | null,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakeCrop(
		_rect: SkRect,
		_tileMode?: TileMode | null,
		_input?: SkImageFilter | null,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakeEmpty(): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakeImage(
		_image: SkImage,
		_srcRect?: SkRect | null,
		_dstRect?: SkRect | null,
		_filterMode?: FilterMode,
		_mipmap?: MipmapMode,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakeMagnifier(
		_lensBounds: SkRect,
		_zoomAmount: number,
		_inset: number,
		_filterMode?: FilterMode,
		_mipmap?: MipmapMode,
		_input?: SkImageFilter | null,
		_cropRect?: SkRect | null,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakeMatrixConvolution(
		_kernelSizeX: number,
		_kernelSizeY: number,
		_kernel: number[],
		_gain: number,
		_bias: number,
		_kernelOffsetX: number,
		_kernelOffsetY: number,
		_tileMode: TileMode,
		_convolveAlpha: boolean,
		_input?: SkImageFilter | null,
		_cropRect?: SkRect | null,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakeMatrixTransform(
		matrix: SkMatrix,
		filterMode?: FilterMode,
		mipmap?: MipmapMode,
		input?: SkImageFilter | null,
	): SkImageFilter {
		const matrixRef = JsiSkMatrix.fromValue<Matrix3x3>(matrix);
		const inputFilter =
			input === null || input === undefined
				? null
				: JsiSkImageFilter.fromValue<ImageFilter>(input);
		// Create FilterOptions object for CanvasKit
		const filterOptions: FilterOptions = {
			filter: filterMode
				? getEnum(this.CanvasKit, "FilterMode", filterMode)
				: this.CanvasKit.FilterMode.Linear,
			mipmap: mipmap
				? getEnum(this.CanvasKit, "MipmapMode", mipmap)
				: this.CanvasKit.MipmapMode.None,
		};
		const filter = this.CanvasKit.ImageFilter.MakeMatrixTransform(
			matrixRef,
			filterOptions,
			inputFilter,
		);
		return new JsiSkImageFilter(this.CanvasKit, filter);
	}
	MakeMerge(
		_filters: Array<SkImageFilter | null>,
		_cropRect?: SkRect | null,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakePicture(_picture: SkPicture, _targetRect?: SkRect | null): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakeTile(
		_src: SkRect,
		_dst: SkRect,
		_input?: SkImageFilter | null,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakeDistantLitDiffuse(
		_direction: SkPoint3,
		_lightColor: SkColor,
		_surfaceScale: number,
		_kd: number,
		_input?: SkImageFilter | null,
		_cropRect?: SkRect | null,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakePointLitDiffuse(
		_location: SkPoint3,
		_lightColor: SkColor,
		_surfaceScale: number,
		_kd: number,
		_input?: SkImageFilter | null,
		_cropRect?: SkRect | null,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakeSpotLitDiffuse(
		_location: SkPoint3,
		_target: SkPoint3,
		_falloffExponent: number,
		_cutoffAngle: number,
		_lightColor: SkColor,
		_surfaceScale: number,
		_kd: number,
		_input?: SkImageFilter | null,
		_cropRect?: SkRect | null,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakeDistantLitSpecular(
		_direction: SkPoint3,
		_lightColor: SkColor,
		_surfaceScale: number,
		_ks: number,
		_shininess: number,
		_input?: SkImageFilter | null,
		_cropRect?: SkRect | null,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakePointLitSpecular(
		_location: SkPoint3,
		_lightColor: SkColor,
		_surfaceScale: number,
		_ks: number,
		_shininess: number,
		_input?: SkImageFilter | null,
		_cropRect?: SkRect | null,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}
	MakeSpotLitSpecular(
		_location: SkPoint3,
		_target: SkPoint3,
		_falloffExponent: number,
		_cutoffAngle: number,
		_lightColor: SkColor,
		_surfaceScale: number,
		_ks: number,
		_shininess: number,
		_input?: SkImageFilter | null,
		_cropRect?: SkRect | null,
	): SkImageFilter {
		throw throwNotImplementedOnWeb();
	}

	MakeOffset(
		dx: number,
		dy: number,
		input?: SkImageFilter | null,
		cropRect?: SkRect | null,
	) {
		const inputFilter =
			input === null || input === undefined
				? null
				: JsiSkImageFilter.fromValue<ImageFilter>(input);
		if (cropRect) {
			console.warn("cropRect is not supported on web for MakeOffset");
		}
		const filter = this.CanvasKit.ImageFilter.MakeOffset(dx, dy, inputFilter);
		return new JsiSkImageFilter(this.CanvasKit, filter);
	}

	MakeDisplacementMap(
		channelX: ColorChannel,
		channelY: ColorChannel,
		scale: number,
		in1: SkImageFilter,
		input?: SkImageFilter | null,
		cropRect?: SkRect | null,
	): SkImageFilter {
		const inputFilter =
			input === null || input === undefined
				? null
				: JsiSkImageFilter.fromValue<ImageFilter>(input);
		if (cropRect) {
			console.warn("cropRect is not supported on web for MakeDisplacementMap");
		}
		const filter = this.CanvasKit.ImageFilter.MakeDisplacementMap(
			getEnum(this.CanvasKit, "ColorChannel", channelX),
			getEnum(this.CanvasKit, "ColorChannel", channelY),
			scale,
			JsiSkImageFilter.fromValue(in1),
			inputFilter,
		);
		return new JsiSkImageFilter(this.CanvasKit, filter);
	}

	MakeShader(
		shader: SkShader,
		dither?: boolean,
		cropRect?: SkRect | null,
	): SkImageFilter {
		if (dither !== undefined) {
			console.warn("dither parameter is not supported on web for MakeShader");
		}
		if (cropRect) {
			console.warn("cropRect is not supported on web for MakeShader");
		}
		const filter = this.CanvasKit.ImageFilter.MakeShader(
			JsiSkImageFilter.fromValue(shader),
		);
		return new JsiSkImageFilter(this.CanvasKit, filter);
	}

	MakeBlur(
		sigmaX: number,
		sigmaY: number,
		mode: TileMode,
		input?: SkImageFilter | null,
		cropRect?: SkRect | null,
	) {
		if (cropRect) {
			console.warn("cropRect is not supported on web for MakeBlur");
		}
		return new JsiSkImageFilter(
			this.CanvasKit,
			this.CanvasKit.ImageFilter.MakeBlur(
				sigmaX,
				sigmaY,
				getEnum(this.CanvasKit, "TileMode", mode),
				input === null || input === undefined
					? null
					: JsiSkImageFilter.fromValue(input),
			),
		);
	}

	MakeColorFilter(
		colorFilter: SkColorFilter,
		input?: SkImageFilter | null,
		cropRect?: SkRect | null,
	) {
		if (cropRect) {
			console.warn("cropRect is not supported on web for MakeColorFilter");
		}
		return new JsiSkImageFilter(
			this.CanvasKit,
			this.CanvasKit.ImageFilter.MakeColorFilter(
				JsiSkColorFilter.fromValue(colorFilter),
				input === null || input === undefined
					? null
					: JsiSkImageFilter.fromValue(input),
			),
		);
	}

	MakeCompose(outer: SkImageFilter | null, inner: SkImageFilter | null) {
		return new JsiSkImageFilter(
			this.CanvasKit,
			this.CanvasKit.ImageFilter.MakeCompose(
				outer === null ? null : JsiSkImageFilter.fromValue(outer),
				inner === null ? null : JsiSkImageFilter.fromValue(inner),
			),
		);
	}

	MakeDropShadow(
		dx: number,
		dy: number,
		sigmaX: number,
		sigmaY: number,
		color: SkColor,
		input?: SkImageFilter | null,
		cropRect?: SkRect | null,
	): SkImageFilter {
		const inputFilter =
			input === null || input === undefined
				? null
				: JsiSkImageFilter.fromValue<ImageFilter>(input);
		if (cropRect) {
			console.warn("cropRect is not supported on web for MakeDropShadow");
		}
		const filter = this.CanvasKit.ImageFilter.MakeDropShadow(
			dx,
			dy,
			sigmaX,
			sigmaY,
			color,
			inputFilter,
		);
		return new JsiSkImageFilter(this.CanvasKit, filter);
	}

	MakeDropShadowOnly(
		dx: number,
		dy: number,
		sigmaX: number,
		sigmaY: number,
		color: SkColor,
		input?: SkImageFilter | null,
		cropRect?: SkRect | null,
	): SkImageFilter {
		const inputFilter =
			input === null || input === undefined
				? null
				: JsiSkImageFilter.fromValue<ImageFilter>(input);
		if (cropRect) {
			console.warn("cropRect is not supported on web for MakeDropShadowOnly");
		}
		const filter = this.CanvasKit.ImageFilter.MakeDropShadowOnly(
			dx,
			dy,
			sigmaX,
			sigmaY,
			color,
			inputFilter,
		);
		return new JsiSkImageFilter(this.CanvasKit, filter);
	}

	MakeErode(
		rx: number,
		ry: number,
		input?: SkImageFilter | null,
		cropRect?: SkRect | null,
	): SkImageFilter {
		const inputFilter =
			input === null || input === undefined
				? null
				: JsiSkImageFilter.fromValue<ImageFilter>(input);
		if (cropRect) {
			console.warn("cropRect is not supported on web for MakeErode");
		}
		const filter = this.CanvasKit.ImageFilter.MakeErode(rx, ry, inputFilter);
		return new JsiSkImageFilter(this.CanvasKit, filter);
	}

	MakeDilate(
		rx: number,
		ry: number,
		input?: SkImageFilter | null,
		cropRect?: SkRect | null,
	): SkImageFilter {
		const inputFilter =
			input === null || input === undefined
				? null
				: JsiSkImageFilter.fromValue<ImageFilter>(input);
		if (cropRect) {
			console.warn("cropRect is not supported on web for MakeDilate");
		}
		const filter = this.CanvasKit.ImageFilter.MakeDilate(rx, ry, inputFilter);
		return new JsiSkImageFilter(this.CanvasKit, filter);
	}

	MakeBlend(
		mode: BlendMode,
		background: SkImageFilter,
		foreground?: SkImageFilter | null,
		cropRect?: SkRect | null,
	): SkImageFilter {
		const inputFilter =
			foreground === null || foreground === undefined
				? null
				: JsiSkImageFilter.fromValue<ImageFilter>(foreground);
		if (cropRect) {
			console.warn("cropRect is not supported on web for MakeBlend");
		}
		const filter = this.CanvasKit.ImageFilter.MakeBlend(
			getEnum(this.CanvasKit, "BlendMode", mode),
			JsiSkImageFilter.fromValue(background),
			inputFilter,
		);
		return new JsiSkImageFilter(this.CanvasKit, filter);
	}

	MakeRuntimeShader(
		_builder: SkRuntimeShaderBuilder,
		_childShaderName: string | null,
		_input?: SkImageFilter | null,
	) {
		return throwNotImplementedOnWeb<SkImageFilter>();
	}
}
