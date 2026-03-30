// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetTextTypographyFacadeForTests,
	textTypographyFacade,
} from "./textTypographyFacade";

const mocks = vi.hoisted(() => {
	const registryListeners = new Set<() => void>();
	return {
		ensureCoverage: vi.fn(),
		getFontProvider: vi.fn(),
		getParagraphRunPlan: vi.fn(),
		getPrimaryTypeface: vi.fn(),
		subscribe: vi.fn((listener: () => void) => {
			registryListeners.add(listener);
			return () => {
				registryListeners.delete(listener);
			};
		}),
		emitRegistryUpdate: () => {
			for (const listener of [...registryListeners]) {
				listener();
			}
		},
		reset: () => {
			registryListeners.clear();
			mocks.ensureCoverage.mockReset();
			mocks.getFontProvider.mockReset();
			mocks.getParagraphRunPlan.mockReset();
			mocks.getPrimaryTypeface.mockReset();
			mocks.subscribe.mockClear();
		},
	};
});

vi.mock("./fontRegistry", () => ({
	FONT_REGISTRY_PRIMARY_FAMILY: "Inter",
	fontRegistry: {
		ensureCoverage: mocks.ensureCoverage,
		getFontProvider: mocks.getFontProvider,
		getParagraphRunPlan: mocks.getParagraphRunPlan,
		getPrimaryTypeface: mocks.getPrimaryTypeface,
		subscribe: mocks.subscribe,
	},
}));

describe("textTypographyFacade", () => {
	let rafQueue: FrameRequestCallback[] = [];

	beforeEach(() => {
		rafQueue = [];
		mocks.reset();
		__resetTextTypographyFacadeForTests();
		mocks.ensureCoverage.mockResolvedValue(undefined);
		mocks.getFontProvider.mockResolvedValue({ registerFont: vi.fn() });
		mocks.getParagraphRunPlan.mockImplementation((text: string) => {
			if (!text) return [];
			return [
				{
					text,
					fontFamilies: ["Inter"],
					status: "primary",
				},
			];
		});
		mocks.getPrimaryTypeface.mockReturnValue({ id: "primary-typeface" });
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			rafQueue.push(callback);
			return rafQueue.length;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((requestId) => {
			const index = Number(requestId) - 1;
			if (index < 0 || index >= rafQueue.length) return;
			rafQueue[index] = () => undefined;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		__resetTextTypographyFacadeForTests();
	});

	const flushRaf = () => {
		const callbacks = [...rafQueue];
		rafQueue = [];
		for (const callback of callbacks) {
			callback(performance.now());
		}
	};

	it("resolveRenderContext 会封装底层字体调用", async () => {
		const context = await textTypographyFacade.resolveRenderContext("中文🙂");
		expect(mocks.ensureCoverage).toHaveBeenCalledWith({ text: "中文🙂" });
		expect(mocks.getFontProvider).toHaveBeenCalledTimes(1);
		expect(mocks.getParagraphRunPlan).toHaveBeenCalledWith("中文🙂");
		expect(mocks.getPrimaryTypeface).toHaveBeenCalledTimes(1);
		expect(context).toEqual({
			fontProvider: { registerFont: expect.any(Function) },
			primaryTypeface: { id: "primary-typeface" },
			runPlan: [
				{
					text: "中文🙂",
					fontFamilies: ["Inter"],
					status: "primary",
				},
			],
			primaryFamily: "Inter",
		});
	});

	it("revision 通知会在同一帧内合并", () => {
		const listener = vi.fn();
		const unsubscribe = textTypographyFacade.subscribeRevision(listener);
		mocks.emitRegistryUpdate();
		mocks.emitRegistryUpdate();
		expect(listener).toHaveBeenCalledTimes(0);
		flushRaf();
		expect(listener).toHaveBeenCalledTimes(1);

		mocks.emitRegistryUpdate();
		flushRaf();
		expect(listener).toHaveBeenCalledTimes(2);
		unsubscribe();
	});
});
