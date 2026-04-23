import {
	FontEdging,
	FontHinting,
	type SkFont,
	Skia,
	type SkParagraph,
	type SkTypeface,
	type SkTypefaceFontProvider,
	TextAlign,
} from "react-skia-lite";
import type { EditorRuntime } from "@/scene-editor/runtime/types";
import { __resetTextTypographyFacadeForTests } from "@/typography/textTypographyFacade";
import {
	createTextLikeModelController,
	type TextLikeModelInternalBase,
} from "../model/createTextLikeModelController";
import type { ComponentModelStore, ValidationResult } from "../model/types";
import { type FancyTextWordSegment, segmentFancyTextWords } from "./helpers";

export type TextAlignMode = "left" | "center" | "right";

export interface FancyTextProps {
	text: string;
	fontSize?: number;
	color?: string;
	textAlign?: TextAlignMode;
	lineHeight?: number;
	locale?: string;
	highlightColor?: string;
	waveRadius?: number;
	waveTranslateY?: number;
	waveScale?: number;
}

export interface FancyTextInternal extends TextLikeModelInternalBase {
	typeface: SkTypeface | null;
	font: SkFont | null;
	wordSegments: FancyTextWordSegment[];
}

export type FancyTextModelStore = ComponentModelStore<
	FancyTextProps,
	FancyTextInternal
>;

const DEFAULT_TEXT = "花字演示 Demo";
const DEFAULT_FONT_SIZE = 48;
const DEFAULT_TEXT_COLOR = "#FFFFFF";
const DEFAULT_TEXT_ALIGN: TextAlignMode = "left";
const DEFAULT_LINE_HEIGHT = 1.2;
const DEFAULT_LOCALE = "zh-CN";
const DEFAULT_HIGHLIGHT_COLOR = "#F59E0B";
const DEFAULT_WAVE_TRANSLATE_Y = 8;
const DEFAULT_WAVE_SCALE = 0.16;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 512;
const MIN_LINE_HEIGHT = 0.5;
const MAX_LINE_HEIGHT = 4;
const MIN_WAVE_RADIUS = 4;
const MAX_WAVE_RADIUS = 512;
const MIN_WAVE_TRANSLATE_Y = 0;
const MAX_WAVE_TRANSLATE_Y = 128;
const MIN_WAVE_SCALE = 0;
const MAX_WAVE_SCALE = 1;

const clampNumber = (value: number, min: number, max: number): number => {
	return Math.min(max, Math.max(min, value));
};

const normalizeTextAlign = (value: unknown): TextAlignMode => {
	if (value === "center" || value === "right" || value === "left") {
		return value;
	}
	return DEFAULT_TEXT_ALIGN;
};

const normalizeLocale = (value: unknown): string => {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: DEFAULT_LOCALE;
};

const normalizeColor = (value: unknown, fallback: string): string => {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: fallback;
};

const normalizeFancyTextProps = (
	props: Partial<FancyTextProps> | undefined,
): Required<FancyTextProps> => {
	const fontSize =
		typeof props?.fontSize === "number" && Number.isFinite(props.fontSize)
			? clampNumber(Math.round(props.fontSize), MIN_FONT_SIZE, MAX_FONT_SIZE)
			: DEFAULT_FONT_SIZE;
	const lineHeight =
		typeof props?.lineHeight === "number" && Number.isFinite(props.lineHeight)
			? clampNumber(props.lineHeight, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT)
			: DEFAULT_LINE_HEIGHT;
	const text = typeof props?.text === "string" ? props.text : DEFAULT_TEXT;
	const color = normalizeColor(props?.color, DEFAULT_TEXT_COLOR);
	const textAlign = normalizeTextAlign(props?.textAlign);
	const locale = normalizeLocale(props?.locale);
	const highlightColor = normalizeColor(
		props?.highlightColor,
		DEFAULT_HIGHLIGHT_COLOR,
	);
	const waveRadius =
		typeof props?.waveRadius === "number" && Number.isFinite(props.waveRadius)
			? clampNumber(props.waveRadius, MIN_WAVE_RADIUS, MAX_WAVE_RADIUS)
			: clampNumber(fontSize, MIN_WAVE_RADIUS, MAX_WAVE_RADIUS);
	const waveTranslateY =
		typeof props?.waveTranslateY === "number" &&
		Number.isFinite(props.waveTranslateY)
			? clampNumber(
					props.waveTranslateY,
					MIN_WAVE_TRANSLATE_Y,
					MAX_WAVE_TRANSLATE_Y,
				)
			: DEFAULT_WAVE_TRANSLATE_Y;
	const waveScale =
		typeof props?.waveScale === "number" && Number.isFinite(props.waveScale)
			? clampNumber(props.waveScale, MIN_WAVE_SCALE, MAX_WAVE_SCALE)
			: DEFAULT_WAVE_SCALE;
	return {
		text,
		fontSize,
		color,
		textAlign,
		lineHeight,
		locale,
		highlightColor,
		waveRadius,
		waveTranslateY,
		waveScale,
	};
};

const resolveSkiaTextAlign = (textAlign: TextAlignMode): TextAlign => {
	switch (textAlign) {
		case "center":
			return TextAlign.Center;
		case "right":
			return TextAlign.Right;
		default:
			return TextAlign.Left;
	}
};

const resolveSkiaColor = (color: string) => {
	try {
		return Skia.Color(color);
	} catch (_error) {
		return Skia.Color(DEFAULT_TEXT_COLOR);
	}
};

const buildParagraph = (params: {
	props: Required<FancyTextProps>;
	fontProvider: SkTypefaceFontProvider | null;
	runPlan: Array<{ text: string; fontFamilies: string[] }>;
	primaryFamily: string;
}): SkParagraph => {
	const { props, fontProvider, runPlan, primaryFamily } = params;
	const baseTextStyle = {
		color: resolveSkiaColor(props.color),
		fontSize: props.fontSize,
		heightMultiplier: props.lineHeight,
		locale: props.locale,
		...(fontProvider ? { fontFamilies: [primaryFamily] } : {}),
	};
	const builder = fontProvider
		? Skia.ParagraphBuilder.Make(
				{
					textAlign: resolveSkiaTextAlign(props.textAlign),
				},
				fontProvider,
			)
		: Skia.ParagraphBuilder.Make({
				textAlign: resolveSkiaTextAlign(props.textAlign),
			});
	try {
		if (runPlan.length <= 0) {
			builder.pushStyle(baseTextStyle).addText(props.text).pop();
			return builder.build();
		}
		for (const run of runPlan) {
			builder
				.pushStyle({
					...baseTextStyle,
					...(fontProvider ? { fontFamilies: run.fontFamilies } : {}),
				})
				.addText(run.text)
				.pop();
		}
		return builder.build();
	} finally {
		builder.dispose();
	}
};

const buildFont = (
	typeface: SkTypeface | null,
	fontSize: number,
): SkFont | null => {
	if (!typeface) return null;
	const font = Skia.Font(typeface, fontSize);
	font.setEdging(FontEdging.SubpixelAntiAlias);
	font.setEmbeddedBitmaps(false);
	font.setHinting(FontHinting.None);
	font.setSubpixel(true);
	font.setLinearMetrics(true);
	return font;
};

const validateFancyTextProps = (
	newProps: Partial<FancyTextProps>,
): ValidationResult => {
	const errors: string[] = [];
	if (newProps.text !== undefined && typeof newProps.text !== "string") {
		errors.push("text must be a string");
	}
	if (
		newProps.fontSize !== undefined &&
		(typeof newProps.fontSize !== "number" ||
			!Number.isFinite(newProps.fontSize))
	) {
		errors.push("fontSize must be a finite number");
	}
	if (newProps.color !== undefined && typeof newProps.color !== "string") {
		errors.push("color must be a string");
	}
	if (
		newProps.textAlign !== undefined &&
		newProps.textAlign !== "left" &&
		newProps.textAlign !== "center" &&
		newProps.textAlign !== "right"
	) {
		errors.push("textAlign must be left/center/right");
	}
	if (
		newProps.lineHeight !== undefined &&
		(typeof newProps.lineHeight !== "number" ||
			!Number.isFinite(newProps.lineHeight))
	) {
		errors.push("lineHeight must be a finite number");
	}
	if (newProps.locale !== undefined && typeof newProps.locale !== "string") {
		errors.push("locale must be a string");
	}
	if (
		newProps.highlightColor !== undefined &&
		typeof newProps.highlightColor !== "string"
	) {
		errors.push("highlightColor must be a string");
	}
	if (
		newProps.waveRadius !== undefined &&
		(typeof newProps.waveRadius !== "number" ||
			!Number.isFinite(newProps.waveRadius))
	) {
		errors.push("waveRadius must be a finite number");
	}
	if (
		newProps.waveTranslateY !== undefined &&
		(typeof newProps.waveTranslateY !== "number" ||
			!Number.isFinite(newProps.waveTranslateY))
	) {
		errors.push("waveTranslateY must be a finite number");
	}
	if (
		newProps.waveScale !== undefined &&
		(typeof newProps.waveScale !== "number" ||
			!Number.isFinite(newProps.waveScale))
	) {
		errors.push("waveScale must be a finite number");
	}
	return {
		valid: errors.length === 0,
		errors,
	};
};

export const __resetFancyTextFontProviderCacheForTests = (): void => {
	__resetTextTypographyFacadeForTests();
};

export function createFancyTextModel(
	id: string,
	initialProps: FancyTextProps,
	_runtime: EditorRuntime,
): FancyTextModelStore {
	return createTextLikeModelController<FancyTextProps, FancyTextInternal>({
		id,
		type: "Text",
		initialProps,
		normalizeProps: (props) => normalizeFancyTextProps(props),
		validateProps: validateFancyTextProps,
		createInitialInternal: () => ({
			paragraph: null,
			fontProvider: null,
			typeface: null,
			font: null,
			wordSegments: [],
			isReady: false,
		}),
		buildParagraphFromRunPlan: ({
			props,
			fontProvider,
			runPlan,
			primaryFamily,
		}) => {
			return buildParagraph({
				props: normalizeFancyTextProps(props),
				fontProvider,
				runPlan,
				primaryFamily,
			});
		},
		buildExtraInternal: ({ props, primaryTypeface }) => {
			const normalizedProps = normalizeFancyTextProps(props);
			return {
				typeface: primaryTypeface,
				font: buildFont(primaryTypeface, normalizedProps.fontSize),
				wordSegments: segmentFancyTextWords(
					normalizedProps.text,
					normalizedProps.locale,
				),
			};
		},
		disposeExtraInternal: (internal) => {
			internal.font?.dispose();
		},
		disposeBuiltExtraInternal: (internal) => {
			internal.font?.dispose?.();
		},
	});
}
