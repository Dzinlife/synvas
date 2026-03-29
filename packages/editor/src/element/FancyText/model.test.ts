// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEditorRuntime } from "@/scene-editor/runtime/testUtils";
import {
	__resetFancyTextFontProviderCacheForTests,
	createFancyTextModel,
} from "./model";

const mocks = vi.hoisted(() => {
	const registryListeners = new Set<() => void>();
	const runPlanByText = new Map<
		string,
		Array<{ text: string; fontFamilies: string[] }>
	>();
	return {
		ensureCoverage: vi.fn(),
		getFontProvider: vi.fn(),
		getPrimaryTypeface: vi.fn(),
		getParagraphRunPlan: vi.fn((text: string) => {
			if (!text) return [];
			return (
				runPlanByText.get(text) ?? [{ text, fontFamilies: ["Noto Sans SC"] }]
			);
		}),
		subscribe: vi.fn((listener: () => void) => {
			registryListeners.add(listener);
			return () => {
				registryListeners.delete(listener);
			};
		}),
		resetRegistryForTests: vi.fn(() => {
			registryListeners.clear();
			runPlanByText.clear();
		}),
		setRunPlan: (
			text: string,
			runPlan: Array<{ text: string; fontFamilies: string[] }>,
		) => {
			runPlanByText.set(text, runPlan);
		},
		emitRegistryUpdate: () => {
			for (const listener of [...registryListeners]) {
				listener();
			}
		},
		skiaColor: vi.fn((value: string) => value),
		makeFont: vi.fn(),
		paragraphBuilderMake: vi.fn(),
	};
});

vi.mock("@/typography/fontRegistry", () => ({
	FONT_REGISTRY_PRIMARY_FAMILY: "Noto Sans SC",
	__resetFontRegistryForTests: mocks.resetRegistryForTests,
	fontRegistry: {
		ensureCoverage: mocks.ensureCoverage,
		getFontProvider: mocks.getFontProvider,
		getPrimaryTypeface: mocks.getPrimaryTypeface,
		getParagraphRunPlan: mocks.getParagraphRunPlan,
		subscribe: mocks.subscribe,
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
		vi.clearAllMocks();
		__resetFancyTextFontProviderCacheForTests();

		const segmenterMock = createSegmenterMock();
		vi.stubGlobal("Intl", {
			...globalThis.Intl,
			Segmenter: segmenterMock,
		});

		mocks.ensureCoverage.mockResolvedValue(undefined);
		mocks.getFontProvider.mockResolvedValue({ registerFont: vi.fn() });
		mocks.getPrimaryTypeface.mockReturnValue({ id: "primary-typeface" });
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

	it("init 会先触发 coverage 并按主字体 run 构建 paragraph", async () => {
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

		expect(mocks.ensureCoverage).toHaveBeenCalledWith({ text: "Hello world" });
		expect(mocks.getFontProvider).toHaveBeenCalledTimes(1);
		expect(mocks.getParagraphRunPlan).toHaveBeenCalledWith("Hello world");
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

	it("registry 更新后会重建并把 confirmed unsupported 字符切到 fallback run", async () => {
		mocks.setRunPlan("中文🙂", [
			{ text: "中文🙂", fontFamilies: ["Noto Sans SC"] },
		]);
		const store = createFancyTextModel(
			"fancy-text-2",
			{
				text: "中文🙂",
			},
			runtime,
		);
		await store.getState().init();

		mocks.setRunPlan("中文🙂", [
			{ text: "中文", fontFamilies: ["Noto Sans SC"] },
			{ text: "🙂", fontFamilies: ["Noto Sans SC", "Noto Color Emoji"] },
		]);
		mocks.emitRegistryUpdate();

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

	it("unknown 或 pending 字符不会提前 fallback", async () => {
		mocks.setRunPlan("🧪", [{ text: "🧪", fontFamilies: ["Noto Sans SC"] }]);
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

	it("epoch 竞争下会保留最新文本的构建结果", async () => {
		let resolveFirstProvider:
			| ((provider: { registerFont: ReturnType<typeof vi.fn> }) => void)
			| null = null;
		const firstProviderPromise = new Promise<{
			registerFont: ReturnType<typeof vi.fn>;
		}>((resolve) => {
			resolveFirstProvider = resolve;
		});
		mocks.getFontProvider
			.mockImplementationOnce(() => firstProviderPromise)
			.mockResolvedValue({ registerFont: vi.fn() });

		const store = createFancyTextModel(
			"fancy-text-4",
			{
				text: "first",
			},
			runtime,
		);
		const initPromise = store.getState().init();
		store.getState().setProps({ text: "second" });
		resolveFirstProvider?.({ registerFont: vi.fn() });
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
