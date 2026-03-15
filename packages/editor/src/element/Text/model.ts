import {
	Skia,
	type SkParagraph,
	type SkTypefaceFontProvider,
	TextAlign,
} from "react-skia-lite";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { EditorRuntime } from "@/scene-editor/runtime/types";
import type { ComponentModel, ComponentModelStore } from "../model/types";

export type TextAlignMode = "left" | "center" | "right";

export interface TextProps {
	text: string;
	fontSize?: number;
	color?: string;
	textAlign?: TextAlignMode;
	lineHeight?: number;
}

export interface TextInternal {
	paragraph: SkParagraph | null;
	fontProvider: SkTypefaceFontProvider | null;
	isReady: boolean;
}

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
const ROBOTO_FONT_URI = "/Roboto-Medium.ttf";
const ROBOTO_FONT_FAMILY = "Roboto";

let robotoFontProviderPromise: Promise<SkTypefaceFontProvider | null> | null =
	null;

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

const loadRobotoFontProvider =
	async (): Promise<SkTypefaceFontProvider | null> => {
		if (!robotoFontProviderPromise) {
			robotoFontProviderPromise = (async () => {
				try {
					const fontData = await Skia.Data.fromURI(ROBOTO_FONT_URI);
					const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(fontData);
					if (!typeface) {
						console.warn("[TextModel] Failed to create Roboto typeface");
						return null;
					}
					const provider = Skia.TypefaceFontProvider.Make();
					provider.registerFont(typeface, ROBOTO_FONT_FAMILY);
					return provider;
				} catch (error) {
					console.warn("[TextModel] Failed to load Roboto font:", error);
					return null;
				}
			})();
		}
		return robotoFontProviderPromise;
	};

const buildParagraph = (
	props: Required<TextProps>,
	fontProvider: SkTypefaceFontProvider | null,
): SkParagraph => {
	const textStyle = {
		color: resolveSkiaColor(props.color),
		fontSize: props.fontSize,
		heightMultiplier: props.lineHeight,
		...(fontProvider ? { fontFamilies: [ROBOTO_FONT_FAMILY] } : {}),
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
		builder.pushStyle(textStyle).addText(props.text).pop();
		return builder.build();
	} finally {
		builder.dispose();
	}
};

export const __resetTextFontProviderCacheForTests = (): void => {
	robotoFontProviderPromise = null;
};

export function createTextModel(
	id: string,
	initialProps: TextProps,
	_runtime: EditorRuntime,
): TextModelStore {
	let disposed = false;
	let rebuildEpoch = 0;
	let store: TextModelStore;

	const applyParagraph = (nextParagraph: SkParagraph | null): void => {
		const previousParagraph = store.getState().internal.paragraph;
		if (previousParagraph && previousParagraph !== nextParagraph) {
			previousParagraph.dispose();
		}
	};

	const rebuildParagraph = async (props: TextProps): Promise<void> => {
		const currentEpoch = ++rebuildEpoch;
		const normalizedProps = normalizeTextProps(props);
		store.setState((state) => ({
			...state,
			constraints: {
				...state.constraints,
				isLoading: true,
				hasError: false,
				errorMessage: undefined,
			},
		}));
		const fontProvider = await loadRobotoFontProvider();
		if (disposed || currentEpoch !== rebuildEpoch) {
			return;
		}

		let paragraph: SkParagraph | null = null;
		try {
			paragraph = buildParagraph(normalizedProps, fontProvider);
		} catch (error) {
			if (disposed || currentEpoch !== rebuildEpoch) {
				paragraph?.dispose();
				return;
			}
			store.setState((state) => ({
				...state,
				constraints: {
					...state.constraints,
					isLoading: false,
					hasError: true,
					errorMessage: error instanceof Error ? error.message : String(error),
				},
				internal: {
					...state.internal,
					isReady: false,
				},
			}));
			return;
		}

		if (disposed || currentEpoch !== rebuildEpoch) {
			paragraph.dispose();
			return;
		}

		applyParagraph(paragraph);
		store.setState((state) => ({
			...state,
			constraints: {
				...state.constraints,
				isLoading: false,
				hasError: false,
				errorMessage: undefined,
			},
			internal: {
				...state.internal,
				paragraph,
				fontProvider,
				isReady: true,
			},
		}));
	};

	store = createStore<ComponentModel<TextProps, TextInternal>>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: "Text",
			props: normalizeTextProps(initialProps),
			constraints: {
				canTrimStart: true,
				canTrimEnd: true,
				isLoading: false,
			},
			internal: {
				paragraph: null,
				fontProvider: null,
				isReady: false,
			},

			setProps: (partial) => {
				const result = get().validate(partial);
				if (!result.valid) return result;
				const nextProps = normalizeTextProps({
					...get().props,
					...partial,
				});
				set((state) => ({
					...state,
					props: nextProps,
				}));
				void rebuildParagraph(nextProps);
				return result;
			},

			setConstraints: (partial) => {
				set((state) => ({
					...state,
					constraints: {
						...state.constraints,
						...partial,
					},
				}));
			},

			setInternal: (partial) => {
				set((state) => ({
					...state,
					internal: {
						...state.internal,
						...partial,
					},
				}));
			},

			validate: (newProps) => {
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
				if (
					newProps.color !== undefined &&
					typeof newProps.color !== "string"
				) {
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
			},

			init: async () => {
				await rebuildParagraph(get().props);
			},

			dispose: () => {
				disposed = true;
				rebuildEpoch += 1;
				const paragraph = get().internal.paragraph;
				paragraph?.dispose();
				set((state) => ({
					...state,
					internal: {
						...state.internal,
						paragraph: null,
						fontProvider: null,
						isReady: false,
					},
					constraints: {
						...state.constraints,
						isLoading: false,
					},
				}));
			},

			waitForReady: () => {
				return new Promise<void>((resolve) => {
					if (get().internal.isReady) {
						resolve();
						return;
					}
					const unsubscribe = store.subscribe((state) => {
						if (!state.internal.isReady) return;
						unsubscribe();
						resolve();
					});
				});
			},
		})),
	);

	return store;
}
