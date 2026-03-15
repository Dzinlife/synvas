// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEditorRuntime } from "@/scene-editor/runtime/testUtils";
import { __resetTextFontProviderCacheForTests, createTextModel } from "./model";

const mocks = vi.hoisted(() => ({
	dataFromURI: vi.fn(),
	makeFreeTypeFaceFromData: vi.fn(),
	makeTypefaceFontProvider: vi.fn(),
	paragraphBuilderMake: vi.fn(),
	skiaColor: vi.fn((value: string) => value),
}));

vi.mock("react-skia-lite", () => ({
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
		ParagraphBuilder: {
			Make: mocks.paragraphBuilderMake,
		},
		Color: mocks.skiaColor,
	},
}));

const createDeferred = <T>() => {
	let resolvePromise: ((value: T) => void) | null = null;
	let rejectPromise: ((reason?: unknown) => void) | null = null;
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		promise,
		resolve: (value: T) => resolvePromise?.(value),
		reject: (reason?: unknown) => rejectPromise?.(reason),
	};
};

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

describe("Text model", () => {
	const runtime = createTestEditorRuntime("text-model-test");

	beforeEach(() => {
		vi.clearAllMocks();
		__resetTextFontProviderCacheForTests();

		mocks.dataFromURI.mockResolvedValue({ id: "font-data" });
		mocks.makeFreeTypeFaceFromData.mockReturnValue({ id: "roboto-typeface" });
		mocks.makeTypefaceFontProvider.mockImplementation(() => ({
			registerFont: vi.fn(),
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

	it("init 会加载 Roboto provider 并构建 paragraph", async () => {
		const store = createTextModel(
			"text-1",
			{
				text: "Hello Text",
			},
			runtime,
		);

		await store.getState().init();
		const provider = mocks.makeTypefaceFontProvider.mock.results[0]?.value as
			| { registerFont: ReturnType<typeof vi.fn> }
			| undefined;

		expect(mocks.dataFromURI).toHaveBeenCalledWith("/Roboto-Medium.ttf");
		expect(mocks.makeFreeTypeFaceFromData).toHaveBeenCalled();
		expect(provider?.registerFont).toHaveBeenCalledWith(
			{ id: "roboto-typeface" },
			"Roboto",
		);
		expect(store.getState().internal.paragraph).toBeTruthy();
		expect(store.getState().internal.isReady).toBe(true);
		expect(store.getState().constraints.hasError).toBe(false);
	});

	it("setProps 会重建 paragraph 并释放旧实例", async () => {
		const store = createTextModel(
			"text-2",
			{
				text: "before",
			},
			runtime,
		);
		await store.getState().init();
		const firstParagraph = store.getState().internal.paragraph;
		expect(firstParagraph).toBeTruthy();

		store.getState().setProps({ text: "after" });
		await waitForCondition(() => {
			return (
				store.getState().props.text === "after" &&
				store.getState().internal.paragraph !== firstParagraph &&
				store.getState().constraints.isLoading === false
			);
		});

		expect(
			(firstParagraph as unknown as { dispose: ReturnType<typeof vi.fn> })
				.dispose,
		).toHaveBeenCalledTimes(1);
		expect(store.getState().internal.paragraph).toBeTruthy();
	});

	it("字体加载失败时会回退到默认字体并继续渲染", async () => {
		mocks.dataFromURI.mockRejectedValueOnce(new Error("font not found"));
		const store = createTextModel(
			"text-3",
			{
				text: "fallback",
			},
			runtime,
		);

		await store.getState().init();

		expect(store.getState().internal.paragraph).toBeTruthy();
		expect(store.getState().internal.isReady).toBe(true);
		expect(store.getState().constraints.hasError).toBe(false);
	});

	it("dispose 后不会应用异步加载结果", async () => {
		const deferred = createDeferred<{ id: string }>();
		mocks.dataFromURI.mockReturnValueOnce(deferred.promise);
		const store = createTextModel(
			"text-4",
			{
				text: "slow",
			},
			runtime,
		);

		const initPromise = store.getState().init();
		store.getState().dispose();
		deferred.resolve({ id: "font-data" });
		await initPromise;

		expect(store.getState().internal.paragraph).toBeNull();
		expect(store.getState().internal.isReady).toBe(false);
	});
});
