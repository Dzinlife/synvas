import {
	Skia,
	type SkParagraph,
	type SkTypefaceFontProvider,
} from "react-skia-lite";
import {
	FONT_REGISTRY_PRIMARY_FAMILY,
	fontRegistry,
} from "@/typography/fontRegistry";

const DEFAULT_TEXT_COLOR = "#ffffff";
const DEFAULT_FONT_SIZE = 48;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 512;

export const clampTextNodeFontSize = (fontSize: number): number => {
	if (!Number.isFinite(fontSize)) return DEFAULT_FONT_SIZE;
	return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSize));
};

export const disposeTextNodeParagraph = (
	paragraph: SkParagraph | null | undefined,
): void => {
	if (!paragraph) return;
	try {
		paragraph.dispose();
	} catch {
		// 忽略段落二次释放。
	}
};

export const buildTextNodeParagraph = (params: {
	text: string;
	fontSize: number;
	fontProvider: SkTypefaceFontProvider | null;
	color?: string;
}): SkParagraph | null => {
	const text = params.text;
	const fontSize = clampTextNodeFontSize(params.fontSize);
	const color =
		typeof params.color === "string" && params.color.trim().length > 0
			? params.color
			: DEFAULT_TEXT_COLOR;
	try {
		const paragraphStyle = {};
		const baseStyle = {
			color: Skia.Color(color),
			fontSize,
			heightMultiplier: 1.2,
			...(params.fontProvider
				? { fontFamilies: [FONT_REGISTRY_PRIMARY_FAMILY] }
				: {}),
		};
		const builder = params.fontProvider
			? Skia.ParagraphBuilder.Make(paragraphStyle, params.fontProvider)
			: Skia.ParagraphBuilder.Make(paragraphStyle);
		try {
			const runPlan = fontRegistry.getParagraphRunPlan(text);
			if (runPlan.length <= 0) {
				builder.pushStyle(baseStyle).addText(text).pop();
				return builder.build();
			}
			for (const run of runPlan) {
				if (!run.text) continue;
				builder
					.pushStyle({
						...baseStyle,
						...(params.fontProvider
							? {
									fontFamilies:
										run.fontFamilies.length > 0
											? run.fontFamilies
											: [FONT_REGISTRY_PRIMARY_FAMILY],
								}
							: {}),
					})
					.addText(run.text)
					.pop();
			}
			return builder.build();
		} finally {
			builder.dispose();
		}
	} catch (error) {
		console.warn("[TextNode] Failed to build paragraph:", error);
		return null;
	}
};
