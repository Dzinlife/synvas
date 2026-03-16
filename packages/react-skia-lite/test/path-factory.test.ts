import { describe, expect, it, vi } from "vitest";

import { JsiSkFont } from "../src/skia/web/JsiSkFont";
import { JsiSkPath } from "../src/skia/web/JsiSkPath";
import { JsiSkPathFactory } from "../src/skia/web/JsiSkPathFactory";
import { JsiSkRSXform } from "../src/skia/web/JsiSkRSXform";

describe("JsiSkPathFactory", () => {
	it("会把 glyph positions 扁平化后下发给 CanvasKit", () => {
		const nativePath = { delete: vi.fn() };
		const nativeFont = {};
		const canvasKit = {
			Path: {
				MakeFromGlyphs: vi.fn(() => nativePath),
				MakeFromRSXformGlyphs: vi.fn(),
				MakeFromText: vi.fn(),
			},
		} as any;
		const factory = new JsiSkPathFactory(canvasKit);
		const font = new JsiSkFont(canvasKit, nativeFont as any);

		const path = factory.MakeFromGlyphs(
			[1, 2],
			[
				{ x: 10, y: 20 },
				{ x: 30, y: 40 },
			],
			font,
		);

		expect(canvasKit.Path.MakeFromGlyphs).toHaveBeenCalledWith(
			[1, 2],
			[10, 20, 30, 40],
			nativeFont,
		);
		expect(path).toBeInstanceOf(JsiSkPath);
	});

	it("会把 rsxforms 扁平化后下发给 CanvasKit", () => {
		const nativePath = { delete: vi.fn() };
		const nativeFont = {};
		const canvasKit = {
			Path: {
				MakeFromGlyphs: vi.fn(),
				MakeFromRSXformGlyphs: vi.fn(() => nativePath),
				MakeFromText: vi.fn(),
			},
		} as any;
		const factory = new JsiSkPathFactory(canvasKit);
		const font = new JsiSkFont(canvasKit, nativeFont as any);
		const rsxformA = new JsiSkRSXform(canvasKit, Float32Array.of(1, 0, 10, 20));
		const rsxformB = new JsiSkRSXform(canvasKit, Float32Array.of(0.5, 0, 30, 40));

		const path = factory.MakeFromRSXformGlyphs([7, 8], [rsxformA, rsxformB], font);

		expect(canvasKit.Path.MakeFromRSXformGlyphs).toHaveBeenCalledWith(
			[7, 8],
			[1, 0, 10, 20, 0.5, 0, 30, 40],
			nativeFont,
		);
		expect(path).toBeInstanceOf(JsiSkPath);
	});

	it("MakeFromText 不再抛出未实现错误", () => {
		const nativePath = { delete: vi.fn() };
		const nativeFont = {};
		const canvasKit = {
			Path: {
				MakeFromGlyphs: vi.fn(),
				MakeFromRSXformGlyphs: vi.fn(),
				MakeFromText: vi.fn(() => nativePath),
			},
		} as any;
		const factory = new JsiSkPathFactory(canvasKit);
		const font = new JsiSkFont(canvasKit, nativeFont as any);

		const path = factory.MakeFromText("Hello", 12, 34, font);

		expect(canvasKit.Path.MakeFromText).toHaveBeenCalledWith(
			"Hello",
			12,
			34,
			nativeFont,
		);
		expect(path).toBeInstanceOf(JsiSkPath);
	});
});
