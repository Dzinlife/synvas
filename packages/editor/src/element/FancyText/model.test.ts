// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEditorRuntime } from "@/scene-editor/runtime/testUtils";
import {
	__resetFancyTextFontProviderCacheForTests,
	createFancyTextModel,
} from "./model";

const mocks = vi.hoisted(() => ({
	dataFromURI: vi.fn(),
	makeFreeTypeFaceFromData: vi.fn(),
	makeTypefaceFontProvider: vi.fn(),
	makeFont: vi.fn(),
	paragraphBuilderMake: vi.fn(),
	skiaColor: vi.fn((value: string) => value),
}));

vi.mock("react-skia-lite", () => ({
	FontEdging: {
		Alias: 0,
		AntiAlias: 1,
		SubpixelAntiAlias: 2,
	},
	FontHinting: {
		None: 0,
		Slight: 1,
		Normal: 2,
		Full: 3,
	},
	TextAlign: {
		Left: 0,
		Right: 1,
		Center: 2,
		Justify: 3,
		Start: 4,
		End: 5,
	},
	Skia: {
		Data: {
			fromURI: mocks.dataFromURI,
		},
		Typeface: {
			MakeFreeTypeFaceFromData: mocks.makeFreeTypeFaceFromData,
		},
		TypefaceFontProvider: {
			Make: mocks.makeTypefaceFontProvider,
		},
		Font: mocks.makeFont,
		ParagraphBuilder: {
			Make: mocks.paragraphBuilderMake,
		},
		Color: mocks.skiaColor,
	},
}));

const waitForCondition = async (
	condition: () => boolean,
	timeoutMs = 1500,
): Promise<void> => {
	const startedAt = Date.now();
	while (!condition()) {
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error("Timed out while waiting for condition");
		}
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	}
};

describe("FancyText model", () => {
	const runtime = createTestEditorRuntime("fancy-text-model-test");
	const createSegmenterMock = () =>
		vi.fn().mockImplementation((locale: string) => ({
			segment: (text: string) => {
				if (locale === "fr-FR") {
					return [
						{ segment: text, index: 0, isWordLike: true },
					];
				}
				return [
					{ segment: "Hello", index: 0, isWordLike: true },
					{ segment: " ", index: 5, isWordLike: false },
					{ segment: "world", index: 6, isWordLike: true },
				];
			},
		}));

	beforeEach(() => {
		vi.clearAllMocks();
		__resetFancyTextFontProviderCacheForTests();

		const segmenterMock = createSegmenterMock();
		vi.stubGlobal("Intl", {
			...globalThis.Intl,
			Segmenter: segmenterMock,
		});

		mocks.dataFromURI.mockResolvedValue({ id: "font-data" });
		mocks.makeFreeTypeFaceFromData.mockReturnValue({ id: "roboto-typeface" });
		mocks.makeTypefaceFontProvider.mockImplementation(() => ({
			registerFont: vi.fn(),
		}));
		mocks.makeFont.mockImplementation(() => ({
			setEdging: vi.fn(),
			setEmbeddedBitmaps: vi.fn(),
			setHinting: vi.fn(),
			setSubpixel: vi.fn(),
			setLinearMetrics: vi.fn(),
			dispose: vi.fn(),
		}));
		mocks.paragraphBuilderMake.mockImplementation(() => {
			const paragraph = {
				dispose: vi.fn(),
			};
			const builder = {
				pushStyle: vi.fn(() => builder),
				addText: vi.fn(() => builder),
				pop: vi.fn(() => builder),
				build: vi.fn(() => paragraph),
				dispose: vi.fn(),
			};
			return builder;
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("init 会加载 Roboto 资源并构建 paragraph/font", async () => {
		const store = createFancyTextModel(
			"fancy-text-1",
			{
				text: "Hello world",
			},
			runtime,
		);

		await store.getState().init();
		const provider = mocks.makeTypefaceFontProvider.mock.results[0]?.value as
			| { registerFont: ReturnType<typeof vi.fn> }
			| undefined;
		const font = mocks.makeFont.mock.results[0]?.value as
			| {
					setEdging: ReturnType<typeof vi.fn>;
					setEmbeddedBitmaps: ReturnType<typeof vi.fn>;
					setHinting: ReturnType<typeof vi.fn>;
					setSubpixel: ReturnType<typeof vi.fn>;
					setLinearMetrics: ReturnType<typeof vi.fn>;
				}
			| undefined;

		expect(mocks.dataFromURI).toHaveBeenCalledWith("/Roboto-Medium.ttf");
		expect(provider?.registerFont).toHaveBeenCalledWith(
			{ id: "roboto-typeface" },
			"Roboto",
		);
		expect(mocks.makeFont).toHaveBeenCalledWith({ id: "roboto-typeface" }, 48);
		expect(font?.setEdging).toHaveBeenCalledWith(2);
		expect(font?.setEmbeddedBitmaps).toHaveBeenCalledWith(false);
		expect(font?.setHinting).toHaveBeenCalledWith(0);
		expect(font?.setSubpixel).toHaveBeenCalledWith(true);
		expect(font?.setLinearMetrics).toHaveBeenCalledWith(true);
		expect(store.getState().internal.paragraph).toBeTruthy();
		expect(store.getState().internal.font).toBeTruthy();
		expect(store.getState().internal.wordSegments).toEqual([
			{ text: "Hello", start: 0, end: 5 },
			{ text: "world", start: 6, end: 11 },
		]);
		expect(store.getState().props.waveRadius).toBe(48);
		expect(store.getState().props.waveTranslateY).toBe(8);
		expect(store.getState().props.waveScale).toBe(0.16);
		expect(store.getState().internal.isReady).toBe(true);
	});

	it("setProps 更新 locale 后会重建 paragraph 和分词结果", async () => {
		const store = createFancyTextModel(
			"fancy-text-2",
			{
				text: "Bonjour",
				locale: "en-US",
			},
			runtime,
		);
		await store.getState().init();

		store.getState().setProps({ locale: "fr-FR" });
		await waitForCondition(() => {
			return (
				store.getState().props.locale === "fr-FR" &&
				store.getState().constraints.isLoading === false
			);
		});

		const segmenter = (globalThis.Intl as typeof Intl & {
			Segmenter: ReturnType<typeof createSegmenterMock>;
		}).Segmenter;
		expect(segmenter).toHaveBeenLastCalledWith("fr-FR", {
			granularity: "word",
		});
		expect(store.getState().internal.wordSegments).toEqual([
			{ text: "Bonjour", start: 0, end: 7 },
		]);
	});

	it("没有 word-like segment 时会保留空分词结果", async () => {
		const segmenterMock = vi.fn().mockImplementation(() => ({
			segment: () => [
				{ segment: " ", index: 0, isWordLike: false },
				{ segment: ",", index: 1, isWordLike: false },
			],
		}));
		vi.stubGlobal("Intl", {
			...globalThis.Intl,
			Segmenter: segmenterMock,
		});

		const store = createFancyTextModel(
			"fancy-text-3",
			{
				text: " ,",
			},
			runtime,
		);
		await store.getState().init();

		expect(store.getState().internal.wordSegments).toEqual([]);
	});
});
