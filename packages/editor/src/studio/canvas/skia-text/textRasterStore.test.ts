// @vitest-environment jsdom

import type { SkImage } from "react-skia-lite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	makeImageFromNativeBuffer: vi.fn(),
}));

vi.mock("react-skia-lite", () => ({
	Skia: {
		Image: {
			MakeImageFromNativeBuffer: mocks.makeImageFromNativeBuffer,
		},
	},
}));

import {
	__cleanupFinalizedTextEntryForTests,
	__getSkiaUiTextStoreStatsForTests,
	__hasWeakIndexSignatureForTests,
	__injectCollectedWeakRefForTests,
	__peekTextRasterEntryForTests,
	__processSkiaUiTextRasterQueueFrameForTests,
	__resetSkiaUiTextStoreForTests,
	__setSkiaUiTextRasterNowProviderForTests,
	__sweepWeakTextIndexForTests,
	enqueueTextRaster,
	normalizeTextSignature,
	resolveTextRasterEntry,
} from "./textRasterStore";

const measureTextMock = vi.fn();
const clearRectMock = vi.fn();
const fillTextMock = vi.fn();
const setTransformMock = vi.fn();

const createCanvasContext = (): CanvasRenderingContext2D => {
	return {
		font: "",
		textAlign: "left",
		textBaseline: "alphabetic",
		fillStyle: "#000",
		measureText: measureTextMock,
		clearRect: clearRectMock,
		fillText: fillTextMock,
		setTransform: setTransformMock,
	} as unknown as CanvasRenderingContext2D;
};

describe("skia textRasterStore", () => {
	beforeEach(() => {
		__resetSkiaUiTextStoreForTests();
		vi.clearAllMocks();
		measureTextMock.mockReturnValue({
			width: 40,
			actualBoundingBoxAscent: 7,
			actualBoundingBoxDescent: 3,
		});
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
			(() =>
				createCanvasContext()) as unknown as HTMLCanvasElement["getContext"],
		);
		mocks.makeImageFromNativeBuffer.mockImplementation(() => ({
			dispose: vi.fn(),
		}));
	});

	afterEach(() => {
		__resetSkiaUiTextStoreForTests();
		vi.restoreAllMocks();
	});

	it("相同 text/style/dprBucket 会复用同一缓存项", () => {
		const request = {
			text: "100 × 200",
			style: {
				fontSizePx: 12,
				lineHeightPx: 16,
				paddingPx: 1,
			},
			dprBucket: 1,
		};
		const first = resolveTextRasterEntry(request);
		const second = resolveTextRasterEntry({
			...request,
			style: { ...request.style },
		});
		expect(first).toBe(second);
		expect(first.ready).toBe(false);
	});

	it("同签名并发请求只会触发一次栅格任务", async () => {
		const request = {
			text: "dedupe",
			style: {
				fontSizePx: 12,
				lineHeightPx: 16,
				paddingPx: 1,
			},
			dprBucket: 1,
		};
		const signature = normalizeTextSignature(request);
		const first = enqueueTextRaster(signature, request);
		const second = enqueueTextRaster(signature, request);
		expect(first).toBe(second);
		__processSkiaUiTextRasterQueueFrameForTests();
		await Promise.all([first, second]);
		expect(mocks.makeImageFromNativeBuffer).toHaveBeenCalledTimes(1);
	});

	it("单帧最多处理 8 个栅格任务", () => {
		__setSkiaUiTextRasterNowProviderForTests(() => 0);
		for (let index = 0; index < 20; index += 1) {
			const request = {
				text: `label-${index}`,
				style: {
					fontSizePx: 12,
					lineHeightPx: 16,
					paddingPx: 1,
				},
				dprBucket: 1,
			};
			void enqueueTextRaster(normalizeTextSignature(request), request);
		}
		__processSkiaUiTextRasterQueueFrameForTests();
		expect(mocks.makeImageFromNativeBuffer).toHaveBeenCalledTimes(8);
		expect(__getSkiaUiTextStoreStatsForTests().queueCount).toBe(12);
	});

	it("单帧会受 2ms 预算限制", () => {
		let now = 0;
		__setSkiaUiTextRasterNowProviderForTests(() => {
			const current = now;
			now += 3;
			return current;
		});
		for (let index = 0; index < 5; index += 1) {
			const request = {
				text: `slow-${index}`,
				style: {
					fontSizePx: 12,
					lineHeightPx: 16,
					paddingPx: 1,
				},
				dprBucket: 1,
			};
			void enqueueTextRaster(normalizeTextSignature(request), request);
		}
		__processSkiaUiTextRasterQueueFrameForTests();
		expect(mocks.makeImageFromNativeBuffer).toHaveBeenCalledTimes(1);
		expect(__getSkiaUiTextStoreStatsForTests().queueCount).toBe(4);
	});

	it("占位尺寸与 ready 后尺寸一致，且 glyph 会在 line box 内垂直居中", async () => {
		const request = {
			text: "LineHeight",
			style: {
				fontSizePx: 12,
				lineHeightPx: 20,
				paddingPx: 1,
			},
			dprBucket: 1,
		};
		const placeholder = resolveTextRasterEntry(request);
		expect(placeholder.ready).toBe(false);
		expect(placeholder.textWidth).toBe(42);
		expect(placeholder.textHeight).toBe(22);
		const signature = normalizeTextSignature(request);
		const promise = enqueueTextRaster(signature, request);
		__processSkiaUiTextRasterQueueFrameForTests();
		await promise;
		const ready = __peekTextRasterEntryForTests(signature);
		expect(ready?.ready).toBe(true);
		expect(ready?.textWidth).toBe(placeholder.textWidth);
		expect(ready?.textHeight).toBe(placeholder.textHeight);
		expect(fillTextMock).toHaveBeenCalledWith("LineHeight", 1, 13);
	});

	it("maxWidthPx 会在 store 内部完成单行省略", async () => {
		measureTextMock.mockImplementation((text: string) => ({
			width: text.length * 10,
			actualBoundingBoxAscent: 7,
			actualBoundingBoxDescent: 3,
		}));
		const request = {
			text: "very-long-node-label",
			maxWidthPx: 55,
			style: {
				fontSizePx: 12,
				lineHeightPx: 16,
				paddingPx: 0,
			},
			dprBucket: 1,
		};
		const placeholder = resolveTextRasterEntry(request);
		expect(placeholder.text).toBe("very…");
		expect(placeholder.textWidth).toBe(50);
		const signature = normalizeTextSignature(request);
		const promise = enqueueTextRaster(signature, request);
		__processSkiaUiTextRasterQueueFrameForTests();
		await promise;
		const ready = __peekTextRasterEntryForTests(signature);
		expect(ready?.text).toBe("very…");
		expect(fillTextMock).toHaveBeenCalledWith("very…", 0, 10);
	});

	it("中英混排截断到纯英文后基线保持稳定，不会跟随字形高度抖动", async () => {
		measureTextMock.mockImplementation((text: string) => {
			if (text === "Hg国") {
				return {
					width: 24,
					actualBoundingBoxAscent: 9,
					actualBoundingBoxDescent: 4,
				};
			}
			if (text === "Label中") {
				return {
					width: 48,
					actualBoundingBoxAscent: 10,
					actualBoundingBoxDescent: 4,
				};
			}
			if (text === "Label") {
				return {
					width: 36,
					actualBoundingBoxAscent: 7,
					actualBoundingBoxDescent: 2,
				};
			}
			return {
				width: 40,
				actualBoundingBoxAscent: 7,
				actualBoundingBoxDescent: 3,
			};
		});
		const stableStyle = {
			fontSizePx: 12,
			lineHeightPx: 17,
			paddingPx: 0,
		};
		const mixedRequest = {
			text: "Label中",
			style: stableStyle,
			dprBucket: 1,
		};
		const latinRequest = {
			text: "Label",
			style: stableStyle,
			dprBucket: 1,
		};

		const mixedPromise = enqueueTextRaster(
			normalizeTextSignature(mixedRequest),
			mixedRequest,
		);
		__processSkiaUiTextRasterQueueFrameForTests();
		await mixedPromise;

		const latinPromise = enqueueTextRaster(
			normalizeTextSignature(latinRequest),
			latinRequest,
		);
		__processSkiaUiTextRasterQueueFrameForTests();
		await latinPromise;

		expect(fillTextMock).toHaveBeenNthCalledWith(1, "Label中", 0, 11);
		expect(fillTextMock).toHaveBeenNthCalledWith(2, "Label", 0, 11);
	});

	it("maxWidthPx 太窄时会返回空文本并跳过栅格", () => {
		measureTextMock.mockImplementation((text: string) => ({
			width: text.length * 10,
			actualBoundingBoxAscent: 7,
			actualBoundingBoxDescent: 3,
		}));
		const request = {
			text: "label",
			maxWidthPx: 5,
			style: {
				fontSizePx: 12,
				lineHeightPx: 16,
				paddingPx: 0,
			},
			dprBucket: 1,
		};
		const entry = resolveTextRasterEntry(request);
		expect(entry.text).toBe("");
		expect(entry.ready).toBe(true);
		expect(entry.textWidth).toBe(0);
		expect(entry.textHeight).toBe(0);
		expect(mocks.makeImageFromNativeBuffer).not.toHaveBeenCalled();
	});

	it("sweep 会清理失效 WeakRef 索引", () => {
		__injectCollectedWeakRefForTests("dead-signature");
		expect(__hasWeakIndexSignatureForTests("dead-signature")).toBe(true);
		__sweepWeakTextIndexForTests();
		expect(__hasWeakIndexSignatureForTests("dead-signature")).toBe(false);
	});

	it("finalizer 清理链路会调用 image.dispose 并移除失效索引", () => {
		const dispose = vi.fn();
		__injectCollectedWeakRefForTests("finalized-signature");
		__cleanupFinalizedTextEntryForTests({
			signature: "finalized-signature",
			image: {
				dispose,
			} as unknown as SkImage,
		});
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(__hasWeakIndexSignatureForTests("finalized-signature")).toBe(false);
	});
});
