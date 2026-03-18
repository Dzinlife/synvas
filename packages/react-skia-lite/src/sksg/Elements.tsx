import type {
	AtlasProps,
	BlendColorFilterProps,
	BlendImageFilterProps,
	BlendProps,
	BlurImageFilterProps,
	BlurMaskFilterProps,
	BoxProps,
	BoxShadowProps,
	ChildrenProps,
	CircleProps,
	ColorProps,
	CornerPathEffectProps,
	DashPathEffectProps,
	DiffRectProps,
	DiscretePathEffectProps,
	DisplacementMapImageFilterProps,
	DrawingNodeProps,
	DropShadowImageFilterProps,
	FractalNoiseProps,
	GlyphsProps,
	GroupProps,
	ImageFilterProps,
	ImageProps,
	ImageShaderProps,
	ImageSVGProps,
	LerpColorFilterProps,
	Line2DPathEffectProps,
	LinearGradientProps,
	LineProps,
	MatrixColorFilterProps,
	MorphologyImageFilterProps,
	OffsetImageFilterProps,
	OvalProps,
	PaintProps,
	ParagraphProps,
	PatchProps,
	Path1DPathEffectProps,
	Path2DPathEffectProps,
	PathProps,
	PictureProps,
	PointsProps,
	RadialGradientProps,
	RectProps,
	RenderTargetProps,
	RoundedRectProps,
	RuntimeShaderImageFilterProps,
	ShaderProps,
	SkottieProps,
	SweepGradientProps,
	TextBlobProps,
	TextPathProps,
	TextProps,
	TurbulenceProps,
	TwoPointConicalGradientProps,
	VerticesProps,
} from "../dom/types";
import type { SkiaProps } from "../renderer";

declare module "react" {
	namespace JSX {
		interface IntrinsicElements {
			skGroup: SkiaProps<GroupProps>;
			skLayer: SkiaProps<ChildrenProps>;
			skPaint: SkiaProps<PaintProps>;

			// Drawings
			skFill: SkiaProps<DrawingNodeProps>;
			skImage: SkiaProps<ImageProps>;
			skCircle: SkiaProps<CircleProps>;
			skPath: SkiaProps<PathProps>;
			skLine: SkiaProps<LineProps>;
			skOval: SkiaProps<OvalProps>;
			skPatch: SkiaProps<PatchProps>;
			skPoints: SkiaProps<PointsProps>;
			skRect: SkiaProps<RectProps>;
			skRRect: SkiaProps<RoundedRectProps>;
			skAtlas: SkiaProps<AtlasProps>;
			skVertices: SkiaProps<VerticesProps>;
			skText: SkiaProps<TextProps>;
			skTextPath: SkiaProps<TextPathProps>;
			skTextBlob: SkiaProps<TextBlobProps>;
			skGlyphs: SkiaProps<GlyphsProps>;
			skDiffRect: SkiaProps<DiffRectProps>;
			skSkottie: SkiaProps<SkottieProps>;
			skPicture: SkiaProps<PictureProps>;
			skImageSVG: SkiaProps<ImageSVGProps>;

			// BlurMaskFilters
			skBlurMaskFilter: SkiaProps<BlurMaskFilterProps>;

			// ImageFilters
			skImageFilter: SkiaProps<ImageFilterProps>;
			skBlendImageFilter: SkiaProps<BlendImageFilterProps>;
			skBlurImageFilter: SkiaProps<BlurImageFilterProps>;
			skOffsetImageFilter: SkiaProps<OffsetImageFilterProps>;
			skDropShadowImageFilter: SkiaProps<DropShadowImageFilterProps>;
			skDisplacementMapImageFilter: SkiaProps<DisplacementMapImageFilterProps>;
			skRuntimeShaderImageFilter: SkiaProps<RuntimeShaderImageFilterProps>;
			skMorphologyImageFilter: SkiaProps<MorphologyImageFilterProps>;

			// ColorFilters
			skMatrixColorFilter: SkiaProps<MatrixColorFilterProps>;
			skBlendColorFilter: SkiaProps<BlendColorFilterProps>;
			skLinearToSRGBGammaColorFilter: SkiaProps<ChildrenProps>;
			skSRGBToLinearGammaColorFilter: SkiaProps<ChildrenProps>;
			skLumaColorFilter: SkiaProps<ChildrenProps>;
			skLerpColorFilter: SkiaProps<LerpColorFilterProps>;

			// Shaders
			skShader: SkiaProps<ShaderProps>;
			skImageShader: SkiaProps<ImageShaderProps>;
			skColorShader: SkiaProps<ColorProps>;
			skTurbulence: SkiaProps<TurbulenceProps>;
			skFractalNoise: SkiaProps<FractalNoiseProps>;
			skLinearGradient: SkiaProps<LinearGradientProps>;
			skRadialGradient: SkiaProps<RadialGradientProps>;
			skSweepGradient: SkiaProps<SweepGradientProps>;
			skTwoPointConicalGradient: SkiaProps<TwoPointConicalGradientProps>;

			// Path Effects
			skDiscretePathEffect: SkiaProps<DiscretePathEffectProps>;
			skDashPathEffect: SkiaProps<DashPathEffectProps>;
			skPath1DPathEffect: SkiaProps<Path1DPathEffectProps>;
			skPath2DPathEffect: SkiaProps<Path2DPathEffectProps>;
			skCornerPathEffect: SkiaProps<CornerPathEffectProps>;
			skSumPathEffect: ChildrenProps;
			skLine2DPathEffect: SkiaProps<Line2DPathEffectProps>;

			// Mixed declarations/drawings
			skBlend: SkiaProps<BlendProps>;
			skBackdropFilter: SkiaProps<ChildrenProps>;
			skRenderTarget: SkiaProps<RenderTargetProps>;
			skBox: SkiaProps<BoxProps>;
			skBoxShadow: SkiaProps<BoxShadowProps>;

			// Paragraph
			skParagraph: SkiaProps<ParagraphProps>;
		}
	}
}
