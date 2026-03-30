import {
	Skia,
	type SkParagraph,
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

export type TextAlignMode = "left" | "center" | "right";

export interface TextProps {
	text: string;
	fontSize?: number;
	color?: string;
	textAlign?: TextAlignMode;
	lineHeight?: number;
}

export interface TextInternal extends TextLikeModelInternalBase {}

export type TextModelStore = ComponentModelStore<TextProps, TextInternal>;

const DEFAULT_TEXT = "新建文本";
const DEFAULT_FONT_SIZE = 48;
const DEFAULT_TEXT_COLOR = "#FFFFFF";
const DEFAULT_TEXT_ALIGN: TextAlignMode = "left";
const DEFAULT_LINE_HEIGHT = 1.2;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 512;
const MIN_LINE_HEIGHT = 0.5;
const MAX_LINE_HEIGHT = 4;

const clampNumber = (value: number, min: number, max: number): number => {
	return Math.min(max, Math.max(min, value));
};

const normalizeTextAlign = (value: unknown): TextAlignMode => {
	if (value === "center" || value === "right" || value === "left") {
		return value;
	}
	return DEFAULT_TEXT_ALIGN;
};

const normalizeTextProps = (
	props: Partial<TextProps> | undefined,
): Required<TextProps> => {
	const fontSize =
		typeof props?.fontSize === "number" && Number.isFinite(props.fontSize)
			? clampNumber(Math.round(props.fontSize), MIN_FONT_SIZE, MAX_FONT_SIZE)
			: DEFAULT_FONT_SIZE;
	const lineHeight =
		typeof props?.lineHeight === "number" && Number.isFinite(props.lineHeight)
			? clampNumber(props.lineHeight, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT)
			: DEFAULT_LINE_HEIGHT;
	const text = typeof props?.text === "string" ? props.text : DEFAULT_TEXT;
	const color =
		typeof props?.color === "string" && props.color.trim().length > 0
			? props.color.trim()
			: DEFAULT_TEXT_COLOR;
	const textAlign = normalizeTextAlign(props?.textAlign);
	return {
		text,
		fontSize,
		color,
		textAlign,
		lineHeight,
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
	props: Required<TextProps>;
	fontProvider: SkTypefaceFontProvider | null;
	runPlan: Array<{ text: string; fontFamilies: string[] }>;
	primaryFamily: string;
}): SkParagraph => {
	const { props, fontProvider, runPlan, primaryFamily } = params;
	const baseStyle = {
		color: resolveSkiaColor(props.color),
		fontSize: props.fontSize,
		heightMultiplier: props.lineHeight,
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
			builder.pushStyle(baseStyle).addText(props.text).pop();
			return builder.build();
		}
		for (const run of runPlan) {
			builder
				.pushStyle({
					...baseStyle,
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

const validateTextProps = (newProps: Partial<TextProps>): ValidationResult => {
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
	return {
		valid: errors.length === 0,
		errors,
	};
};

export const __resetTextFontProviderCacheForTests = (): void => {
	__resetTextTypographyFacadeForTests();
};

export function createTextModel(
	id: string,
	initialProps: TextProps,
	_runtime: EditorRuntime,
): TextModelStore {
	return createTextLikeModelController<TextProps, TextInternal>({
		id,
		type: "Text",
		initialProps,
		normalizeProps: (props) => normalizeTextProps(props),
		validateProps: validateTextProps,
		createInitialInternal: () => ({
			paragraph: null,
			fontProvider: null,
			isReady: false,
		}),
		buildParagraphFromRunPlan: ({
			props,
			fontProvider,
			runPlan,
			primaryFamily,
		}) => {
			return buildParagraph({
				props: normalizeTextProps(props),
				fontProvider,
				runPlan,
				primaryFamily,
			});
		},
	});
}
