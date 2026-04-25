// @vitest-environment jsdom

import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEditorRuntime } from "@/scene-editor/runtime/testUtils";
import { __resetTextFontProviderCacheForTests, createTextModel } from "./model";

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
	let paragraphId = 0;
	const paragraphs: Array<{ id: string; dispose: ReturnType<typeof vi.fn> }> =
		[];
	return {
		resolveRenderContext: vi.fn(async (text: string) => ({
			fontProvider: { registerFont: vi.fn<() => void>() },
			primaryTypeface: null,
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
		paragraphBuilderMake: vi.fn(() => {
			const paragraph = {
				id: `paragraph-${paragraphId++}`,
				dispose: vi.fn(),
			};
			paragraphs.push(paragraph);
			const builder = {
				pushStyle: vi.fn(() => builder),
				addText: vi.fn(() => builder),
				pop: vi.fn(() => builder),
				build: vi.fn(() => paragraph),
				dispose: vi.fn(),
			};
			return builder;
		}),
		skiaColor: vi.fn((value: string) => value),
		paragraphs,
		clearState: () => {
			revisionListeners.clear();
			runPlanByText.clear();
			paragraphs.length = 0;
			paragraphId = 0;
			mocks.resolveRenderContext.mockClear();
			mocks.subscribeRevision.mockClear();
			mocks.resetTypographyFacadeForTests.mockClear();
			mocks.paragraphBuilderMake.mockClear();
			mocks.skiaColor.mockClear();
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
	TextAlign: {
		Left: 0,
		Right: 1,
		Center: 2,
		Justify: 3,
		Start: 4,
		End: 5,
	},
	Skia: {
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
		mocks.clearState();
		mocks.resolveRenderContext.mockImplementation(async (text: string) => ({
			fontProvider: { registerFont: vi.fn<() => void>() },
			primaryTypeface: null,
			runPlan: [
				{
					text,
					fontFamilies: ["Noto Sans SC"],
					status: "primary",
				},
			],
			primaryFamily: "Noto Sans SC",
		}));
		__resetTextFontProviderCacheForTests();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("init 会通过 facade 构建 run-based paragraph", async () => {
		const store = createTextModel(
			"text-1",
			{
				text: "Hello Text",
			},
			runtime,
		);
		await store.getState().init();

		expect(mocks.resolveRenderContext).toHaveBeenCalledWith("Hello Text", {
			fallbackChain: undefined,
		});
		const builder = mocks.paragraphBuilderMake.mock.results[0]?.value as
			| {
					pushStyle: ReturnType<typeof vi.fn>;
					addText: ReturnType<typeof vi.fn>;
			  }
			| undefined;
		expect(builder?.pushStyle).toHaveBeenCalledWith(
			expect.objectContaining({
				fontFamilies: ["Noto Sans SC"],
			}),
		);
		expect(builder?.addText).toHaveBeenCalledWith("Hello Text");
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

	it("setProps 归一化后无变化时不会触发重建", async () => {
		const store = createTextModel(
			"text-noop",
			{
				text: "same",
				fontSize: 48,
				color: "#FFFFFF",
				lineHeight: 1.2,
				textAlign: "left",
			},
			runtime,
		);
		await store.getState().init();
		const rebuildCallCount = mocks.resolveRenderContext.mock.calls.length;
		store.getState().setProps({ fontSize: 48 });
		store.getState().setProps({ text: "same" });
		store.getState().setProps({ lineHeight: 1.2 });
		expect(mocks.resolveRenderContext.mock.calls.length).toBe(rebuildCallCount);
	});

	it("字体 revision 更新会触发重建", async () => {
		const store = createTextModel(
			"text-3",
			{
				text: "中文🙂",
			},
			runtime,
		);
		await store.getState().init();
		const rebuildCallCount = mocks.resolveRenderContext.mock.calls.length;
		mocks.emitRevision();
		await waitForCondition(() => {
			return mocks.resolveRenderContext.mock.calls.length > rebuildCallCount;
		});
	});

	it("waitForReady 会等待当前重建周期完成", async () => {
		const deferred = createDeferred<{
			fontProvider: { registerFont: Mock<() => void> };
			primaryTypeface: null;
			runPlan: Array<{
				text: string;
				fontFamilies: string[];
				status: "primary";
			}>;
			primaryFamily: "Noto Sans SC";
		}>();
		mocks.resolveRenderContext.mockImplementationOnce(() => deferred.promise);
		const store = createTextModel(
			"text-4",
			{
				text: "slow",
			},
			runtime,
		);
		const initPromise = store.getState().init();
		let readyResolved = false;
		const readyPromise = store
			.getState()
			.waitForReady?.()
			.then(() => {
				readyResolved = true;
			});
		await Promise.resolve();
		expect(readyResolved).toBe(false);

		deferred.resolve({
			fontProvider: { registerFont: vi.fn<() => void>() },
			primaryTypeface: null,
			runPlan: [
				{
					text: "slow",
					fontFamilies: ["Noto Sans SC"],
					status: "primary",
				},
			],
			primaryFamily: "Noto Sans SC",
		});
		await initPromise;
		await readyPromise;
		expect(readyResolved).toBe(true);
	});
});
