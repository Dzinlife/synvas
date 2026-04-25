// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	canDisplayP3Colors,
	resolveSkiaWebCanvasColorSpace,
	toCanvasKitColorSpace,
	toPredefinedCanvasColorSpace,
} from "../src/skia/web/canvasColorSpace";

const stubColorGamut = (matches: boolean) => {
	const previousMatchMedia = window.matchMedia;
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn((query: string) => ({
			matches: query === "(color-gamut: p3)" ? matches : false,
			media: query,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	});
	return () => {
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: previousMatchMedia,
		});
	};
};

describe("canvasColorSpace", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("仅在设备与 CanvasKit 都支持时启用 P3", () => {
		const restore = stubColorGamut(true);
		try {
			expect(
				resolveSkiaWebCanvasColorSpace("p3", {
					ColorSpace: { SRGB: "srgb", DISPLAY_P3: "display-p3" },
				} as never),
			).toBe("p3");
			expect(
				resolveSkiaWebCanvasColorSpace("p3", {
					ColorSpace: { SRGB: "srgb" },
				} as never),
			).toBe("srgb");
		} finally {
			restore();
		}
	});

	it("设备不支持 P3 时回退到 sRGB", () => {
		const restore = stubColorGamut(false);
		try {
			expect(canDisplayP3Colors()).toBe(false);
			expect(
				resolveSkiaWebCanvasColorSpace("p3", {
					ColorSpace: { SRGB: "srgb", DISPLAY_P3: "display-p3" },
				} as never),
			).toBe("srgb");
		} finally {
			restore();
		}
	});

	it("映射浏览器 canvas 与 CanvasKit 色彩空间", () => {
		const canvasKit = {
			ColorSpace: { SRGB: "srgb", DISPLAY_P3: "display-p3" },
		} as never;

		expect(toPredefinedCanvasColorSpace("srgb")).toBe("srgb");
		expect(toPredefinedCanvasColorSpace("p3")).toBe("display-p3");
		expect(toCanvasKitColorSpace(canvasKit, "srgb")).toBe("srgb");
		expect(toCanvasKitColorSpace(canvasKit, "p3")).toBe("display-p3");
	});
});
