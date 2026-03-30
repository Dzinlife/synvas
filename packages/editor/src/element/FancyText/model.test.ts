// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEditorRuntime } from "@/scene-editor/runtime/testUtils";
import {
	__resetFancyTextFontProviderCacheForTests,
	createFancyTextModel,
} from "./model";

const mocks = vi.hoisted(() => {
	const revisionListeners = new Set<() => void>();
	const runPlanByText = new Map<
		string,
		Array<{
			text: string;
			fontFamilies: string[];
			status: "primary" | "fallback";
		}>
	>();
	let primaryTypeface: { id: string } | null = { id: "primary-typeface" };
	return {
		resolveRenderContext: vi.fn(async (text: string) => ({
			fontProvider: { registerFont: vi.fn() },
			primaryTypeface,
			runPlan: runPlanByText.get(text) ?? [
				{
					text,
					fontFamilies: ["Noto Sans SC"],
					status: "primary" as const,
				},
			],
			primaryFamily: "Noto Sans SC",
		})),
		subscribeRevision: vi.fn((listener: () => void) => {
			revisionListeners.add(listener);
			return () => {
				revisionListeners.delete(listener);
			};
		}),
		resetTypographyFacadeForTests: vi.fn(() => {
			revisionListeners.clear();
			runPlanByText.clear();
			primaryTypeface = { id: "primary-typeface" };
		}),
		emitRevision: () => {
			for (const listener of [...revisionListeners]) {
				listener();
			}
		},
		setRunPlan: (
			text: string,
			runPlan: Array<{
				text: string;
				fontFamilies: string[];
				status: "primary" | "fallback";
			}>,
		) => {
			runPlanByText.set(text, runPlan);
		},
		setPrimaryTypeface: (nextTypeface: { id: string } | null) => {
			primaryTypeface = nextTypeface;
		},
		skiaColor: vi.fn((value: string) => value),
		makeFont: vi.fn(),
		paragraphBuilderMake: vi.fn(),
		clearState: () => {
			revisionListeners.clear();
			runPlanByText.clear();
			primaryTypeface = { id: "primary-typeface" };
			mocks.resolveRenderContext.mockClear();
			mocks.subscribeRevision.mockClear();
			mocks.resetTypographyFacadeForTests.mockClear();
			mocks.skiaColor.mockClear();
			mocks.makeFont.mockClear();
			mocks.paragraphBuilderMake.mockClear();
		},
	};
});

vi.mock("@/typography/textTypographyFacade", () => ({
	__resetTextTypographyFacadeForTests: mocks.resetTypographyFacadeForTests,
	textTypographyFacade: {
		resolveRenderContext: mocks.resolveRenderContext,
		subscribeRevision: mocks.subscribeRevision,
	},
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
					return [{ segment: text, index: 0, isWordLike: true }];
				}
				return [
					{ segment: "Hello", index: 0, isWordLike: true },
					{ segment: " ", index: 5, isWordLike: false },
					{ segment: "world", index: 6, isWordLike: true },
				];
			},
		}));

	beforeEach(() => {
		mocks.clearState();
		__resetFancyTextFontProviderCacheForTests();

		const segmenterMock = createSegmenterMock();
		vi.stubGlobal("Intl", {
			...globalThis.Intl,
			Segmenter: segmenterMock,
		});

		mocks.resolveRenderContext.mockImplementation(async (text: string) => ({
			fontProvider: { registerFont: vi.fn() },
			primaryTypeface: { id: "primary-typeface" },
			runPlan: [
				{
					text,
					fontFamilies: ["Noto Sans SC"],
					status: "primary",
				},
			],
			primaryFamily: "Noto Sans SC",
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

	it("init 会通过 facade 构建主字体 run", async () => {
		const store = createFancyTextModel(
			"fancy-text-1",
			{
				text: "Hello world",
			},
			runtime,
		);

		await store.getState().init();
		const builder = mocks.paragraphBuilderMake.mock.results[0]?.value as
			| {
					pushStyle: ReturnType<typeof vi.fn>;
					addText: ReturnType<typeof vi.fn>;
			  }
			| undefined;

		expect(mocks.resolveRenderContext).toHaveBeenCalledWith("Hello world");
		expect(builder?.pushStyle).toHaveBeenCalledWith(
			expect.objectContaining({
				fontFamilies: ["Noto Sans SC"],
			}),
		);
		expect(builder?.addText).toHaveBeenCalledWith("Hello world");
		expect(store.getState().internal.wordSegments).toEqual([
			{ text: "Hello", start: 0, end: 5 },
			{ text: "world", start: 6, end: 11 },
		]);
		expect(store.getState().internal.isReady).toBe(true);
	});

	it("revision 更新后会重建并切换 fallback run", async () => {
		const text = "中文🙂";
		let currentRunPlan: Array<{
			text: string;
			fontFamilies: string[];
			status: "primary" | "fallback";
		}> = [{ text, fontFamilies: ["Noto Sans SC"], status: "primary" }];
		const store = createFancyTextModel(
			"fancy-text-2",
			{
				text,
			},
			runtime,
		);
		mocks.resolveRenderContext.mockImplementation(async () => ({
			fontProvider: { registerFont: vi.fn() },
			primaryTypeface: { id: "primary-typeface" },
			runPlan: currentRunPlan,
			primaryFamily: "Noto Sans SC",
		}));
		await store.getState().init();
		currentRunPlan = [
			{ text: "中文", fontFamilies: ["Noto Sans SC"], status: "primary" },
			{
				text: "🙂",
				fontFamilies: ["Noto Sans SC", "Noto Color Emoji"],
				status: "fallback",
			},
		];
		mocks.emitRevision();

		await waitForCondition(() => {
			return (
				mocks.paragraphBuilderMake.mock.calls.length >= 2 &&
				store.getState().constraints.isLoading === false
			);
		});

		const builder = mocks.paragraphBuilderMake.mock.results.at(-1)?.value as
			| {
					pushStyle: ReturnType<typeof vi.fn>;
					addText: ReturnType<typeof vi.fn>;
			  }
			| undefined;
		expect(builder?.pushStyle).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				fontFamilies: ["Noto Sans SC"],
			}),
		);
		expect(builder?.pushStyle).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				fontFamilies: ["Noto Sans SC", "Noto Color Emoji"],
			}),
		);
		expect(builder?.addText).toHaveBeenNthCalledWith(1, "中文");
		expect(builder?.addText).toHaveBeenNthCalledWith(2, "🙂");
	});

	it("unknown/pending 字符不会提前 fallback", async () => {
		mocks.resolveRenderContext.mockImplementation(async (text: string) => ({
			fontProvider: { registerFont: vi.fn() },
			primaryTypeface: { id: "primary-typeface" },
			runPlan: [{ text, fontFamilies: ["Noto Sans SC"], status: "primary" }],
			primaryFamily: "Noto Sans SC",
		}));
		const store = createFancyTextModel(
			"fancy-text-3",
			{
				text: "🧪",
			},
			runtime,
		);
		await store.getState().init();

		const builder = mocks.paragraphBuilderMake.mock.results.at(-1)?.value as
			| {
					pushStyle: ReturnType<typeof vi.fn>;
			  }
			| undefined;
		expect(builder?.pushStyle).toHaveBeenCalledTimes(1);
		expect(builder?.pushStyle).toHaveBeenCalledWith(
			expect.objectContaining({
				fontFamilies: ["Noto Sans SC"],
			}),
		);
	});

	it("setProps 归一化后无变化时不会触发重建", async () => {
		const store = createFancyTextModel(
			"fancy-text-noop",
			{
				text: "same",
				fontSize: 48,
				color: "#FFFFFF",
				textAlign: "left",
				lineHeight: 1.2,
				locale: "zh-CN",
				highlightColor: "#F59E0B",
				waveRadius: 48,
				waveTranslateY: 8,
				waveScale: 0.16,
			},
			runtime,
		);
		await store.getState().init();
		const rebuildCallCount = mocks.resolveRenderContext.mock.calls.length;
		store.getState().setProps({ text: "same" });
		store.getState().setProps({ fontSize: 48 });
		store.getState().setProps({ waveScale: 0.16 });
		expect(mocks.resolveRenderContext.mock.calls.length).toBe(rebuildCallCount);
	});

	it("epoch 竞争下保留最新文本构建结果", async () => {
		let resolveFirstContext:
			| ((value: {
					fontProvider: { registerFont: ReturnType<typeof vi.fn> };
					primaryTypeface: { id: string };
					runPlan: Array<{
						text: string;
						fontFamilies: string[];
						status: "primary";
					}>;
					primaryFamily: "Noto Sans SC";
			  }) => void)
			| null = null;
		const firstContextPromise = new Promise<{
			fontProvider: { registerFont: ReturnType<typeof vi.fn> };
			primaryTypeface: { id: string };
			runPlan: Array<{
				text: string;
				fontFamilies: string[];
				status: "primary";
			}>;
			primaryFamily: "Noto Sans SC";
		}>((resolve) => {
			resolveFirstContext = resolve;
		});
		mocks.resolveRenderContext
			.mockImplementationOnce(() => firstContextPromise)
			.mockImplementation(async (text: string) => ({
				fontProvider: { registerFont: vi.fn() },
				primaryTypeface: { id: "primary-typeface" },
				runPlan: [{ text, fontFamilies: ["Noto Sans SC"], status: "primary" }],
				primaryFamily: "Noto Sans SC",
			}));

		const store = createFancyTextModel(
			"fancy-text-4",
			{
				text: "first",
			},
			runtime,
		);
		const initPromise = store.getState().init();
		store.getState().setProps({ text: "second" });
		if (!resolveFirstContext) {
			throw new Error("resolveFirstContext is not initialized");
		}
		resolveFirstContext({
			fontProvider: { registerFont: vi.fn() },
			primaryTypeface: { id: "primary-typeface" },
			runPlan: [
				{ text: "first", fontFamilies: ["Noto Sans SC"], status: "primary" },
			],
			primaryFamily: "Noto Sans SC",
		});
		await initPromise;

		await waitForCondition(() => {
			return store.getState().constraints.isLoading === false;
		});

		const builder = mocks.paragraphBuilderMake.mock.results.at(-1)?.value as
			| {
					addText: ReturnType<typeof vi.fn>;
			  }
			| undefined;
		expect(store.getState().props.text).toBe("second");
		expect(builder?.addText).toHaveBeenCalledWith("second");
	});
});
