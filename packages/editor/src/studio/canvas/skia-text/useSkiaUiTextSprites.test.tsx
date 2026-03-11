// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
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
	__getSkiaUiTextStoreStatsForTests,
	__processSkiaUiTextRasterQueueFrameForTests,
	__resetSkiaUiTextStoreForTests,
} from "./textRasterStore";
import type { SkiaUiTextRequest } from "./types";
import { useSkiaUiTextSprites } from "./useSkiaUiTextSprites";

describe("useSkiaUiTextSprites", () => {
	beforeEach(() => {
		__resetSkiaUiTextStoreForTests();
		vi.clearAllMocks();
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
			(() =>
				({
					font: "",
					textAlign: "left",
					textBaseline: "alphabetic",
					fillStyle: "#000",
					measureText: (text: string) => ({
						width: Math.max(8, text.length * 8),
						actualBoundingBoxAscent: 7,
						actualBoundingBoxDescent: 3,
					}),
					clearRect: vi.fn(),
					fillText: vi.fn(),
					setTransform: vi.fn(),
				}) as unknown as CanvasRenderingContext2D) as unknown as HTMLCanvasElement["getContext"],
		);
		mocks.makeImageFromNativeBuffer.mockImplementation(() => ({
			dispose: vi.fn(),
		}));
	});

	afterEach(() => {
		__resetSkiaUiTextStoreForTests();
		vi.restoreAllMocks();
	});

	it("占位渲染后会在栅格完成时刷新为 ready", () => {
		const stableRequests = [
			{
				text: "focus-label",
				style: {
					fontSizePx: 12,
					lineHeightPx: 16,
					paddingPx: 1,
				},
				dprBucket: 1,
			},
		];
		const { result, unmount } = renderHook(() =>
			useSkiaUiTextSprites(stableRequests),
		);
		expect(result.current[0]?.ready).toBe(false);
		expect(__getSkiaUiTextStoreStatsForTests().retainedKeyCount).toBe(1);
		act(() => {
			__processSkiaUiTextRasterQueueFrameForTests();
		});
		expect(result.current[0]?.ready).toBe(true);
		expect(result.current[0]?.image).not.toBeNull();
		expect(__getSkiaUiTextStoreStatsForTests().retainedKeyCount).toBe(1);
		unmount();
		expect(__getSkiaUiTextStoreStatsForTests().retainedKeyCount).toBe(0);
	});

	it("同一槽位切换到新请求后会继续显示上一张 ready 图片直到新图完成", () => {
		const stableStyle = {
			fontSizePx: 12,
			lineHeightPx: 16,
			paddingPx: 1,
		};
		const initialProps: { requests: SkiaUiTextRequest[] } = {
			requests: [
				{
					slotKey: "focus-label",
					text: "focus-label",
					style: stableStyle,
					dprBucket: 1,
				},
			],
		};
		const { result, rerender } = renderHook(
			({ requests }: { requests: SkiaUiTextRequest[] }) =>
				useSkiaUiTextSprites(requests),
			{
				initialProps,
			},
		);

		act(() => {
			__processSkiaUiTextRasterQueueFrameForTests();
		});
		const previousImage = result.current[0]?.image;
		const previousWidth = result.current[0]?.textWidth;
		expect(result.current[0]?.ready).toBe(true);
		expect(previousImage).not.toBeNull();
		expect(previousWidth).toBeGreaterThan(0);

		rerender({
			requests: [
				{
					slotKey: "focus-label",
					text: "focus-label",
					maxWidthPx: 40,
					style: stableStyle,
					dprBucket: 1,
				},
			],
		});

		expect(result.current[0]?.ready).toBe(false);
		expect(result.current[0]?.image).toBe(previousImage);
		expect(result.current[0]?.textWidth).toBe(previousWidth);

		act(() => {
			__processSkiaUiTextRasterQueueFrameForTests();
		});

		expect(result.current[0]?.ready).toBe(true);
		expect(result.current[0]?.image).not.toBe(previousImage);
		expect(result.current[0]?.textWidth).toBeLessThan(previousWidth ?? 0);
	});

	it("maxWidth sharedValue 变化时会自动重算文本栅格", () => {
		let widthValue = 200;
		const listeners = new Map<number, (value: number) => void>();
		const maxWidthShared = {
			get value() {
				return widthValue;
			},
			set value(nextValue: number) {
				widthValue = nextValue;
				for (const listener of listeners.values()) {
					listener(nextValue);
				}
			},
			addListener(listenerID: number, listener: (value: number) => void) {
				listeners.set(listenerID, listener);
			},
			removeListener(listenerID: number) {
				listeners.delete(listenerID);
			},
			_isSharedValue: true as const,
		};
		const stableRequests = [
			{
				slotKey: "focus-label",
				text: "focus-label",
				maxWidthPx: maxWidthShared,
				style: {
					fontSizePx: 12,
					lineHeightPx: 16,
					paddingPx: 1,
				},
				dprBucket: 1,
			},
		];
		const { result } = renderHook(() => useSkiaUiTextSprites(stableRequests));

		act(() => {
			__processSkiaUiTextRasterQueueFrameForTests();
		});
		const previousImage = result.current[0]?.image;
		const previousWidth = result.current[0]?.textWidth ?? 0;
		expect(result.current[0]?.ready).toBe(true);
		expect(previousImage).not.toBeNull();

		act(() => {
			maxWidthShared.value = 40;
		});

		expect(result.current[0]?.ready).toBe(false);
		expect(result.current[0]?.image).toBe(previousImage);
		expect(result.current[0]?.textWidth).toBe(previousWidth);

		act(() => {
			__processSkiaUiTextRasterQueueFrameForTests();
		});

		expect(result.current[0]?.ready).toBe(true);
		expect(result.current[0]?.textWidth).toBeLessThan(previousWidth);
	});
});
