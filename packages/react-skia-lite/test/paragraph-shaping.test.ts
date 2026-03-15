import { describe, expect, it, vi } from "vitest";
import { JsiSkParagraph } from "../src/skia/web/JsiSkParagraph";
import { JsiSkParagraphBuilderFactory } from "../src/skia/web/JsiSkParagraphBuilderFactory";
import { JsiSkTypeface } from "../src/skia/web/JsiSkTypeface";

const createFakeTypefaceRef = () =>
	({
		delete: vi.fn(),
		getGlyphIDs: vi.fn(),
	}) as never;

const createRawShapedLines = (typefaceRef = createFakeTypefaceRef()) => [
	{
		textRange: { first: 0, last: 2 },
		top: 0,
		bottom: 20,
		baseline: 16,
		runs: [
			{
				typeface: typefaceRef,
				size: 32,
				fakeBold: false,
				fakeItalic: false,
				glyphs: new Uint16Array([11, 12]),
				positions: new Float32Array([0, 12, 10, 12, 18, 12]),
				offsets: new Uint32Array([0, 1, 2]),
				flags: 0,
			},
		],
	},
];

describe("paragraph shaping wrappers", () => {
	it("JsiSkParagraph 会标准化 glyph info 和 shaped lines", () => {
		const canvasKit = {} as never;
		const rawTypefaceRef = createFakeTypefaceRef();
		const paragraph = new JsiSkParagraph(canvasKit, {
			delete: vi.fn(),
			layout: vi.fn(),
			paint: vi.fn(),
			getGlyphPositionAtCoordinate: vi.fn(() => ({ pos: 0 })),
			getClosestGlyphInfoAtCoordinate: vi.fn(() => ({
				graphemeLayoutBounds: new Float32Array([5, 6, 15, 26]),
				graphemeClusterTextRange: { start: 1, end: 2 },
				dir: { value: 1 },
				isEllipsis: false,
			})),
			getGlyphInfoAt: vi.fn(() => ({
				graphemeLayoutBounds: new Float32Array([0, 0, 10, 20]),
				graphemeClusterTextRange: { start: 0, end: 1 },
				dir: { value: 0 },
				isEllipsis: false,
			})),
			getRectsForPlaceholders: vi.fn(() => []),
			getRectsForRange: vi.fn(() => []),
			getHeight: vi.fn(() => 20),
			getLongestLine: vi.fn(() => 20),
			getMaxIntrinsicWidth: vi.fn(() => 20),
			getMaxWidth: vi.fn(() => 20),
			getMinIntrinsicWidth: vi.fn(() => 20),
			getLineMetrics: vi.fn(() => []),
			getShapedLines: vi.fn(() => createRawShapedLines(rawTypefaceRef)),
		} as never);

		const glyphInfo = paragraph.getGlyphInfoAt(0);
		const closestGlyphInfo = paragraph.getClosestGlyphInfoAtCoordinate(12, 8);
		const shapedLines = paragraph.getShapedLines();

		expect(glyphInfo?.graphemeLayoutBounds.width).toBe(10);
		expect(glyphInfo?.graphemeClusterTextRange).toEqual({ start: 0, end: 1 });
		expect(closestGlyphInfo?.dir).toBe(1);
		expect(shapedLines[0]?.runs[0]?.typeface?.__typename__).toBe("Typeface");
		expect(shapedLines[0]?.runs[0]?.positions[4]).toBe(18);
	});

	it("ShapeText 会透传原始 typeface ref 并返回标准化结果", () => {
		const rawTypefaceRef = createFakeTypefaceRef();
		const canvasKit = {
			ParagraphBuilder: {
				ShapeText: vi.fn(() => createRawShapedLines(rawTypefaceRef)),
			},
		} as never;
		const factory = new JsiSkParagraphBuilderFactory(canvasKit);
		const typeface = new JsiSkTypeface(canvasKit, rawTypefaceRef);

		const result = factory.ShapeText(
			"AB",
			[
				{
					length: 2,
					typeface,
					size: 32,
					fakeBold: false,
					fakeItalic: false,
				},
			],
			200,
		);

		expect(canvasKit.ParagraphBuilder.ShapeText).toHaveBeenCalledWith(
			"AB",
			[
				{
					length: 2,
					typeface: rawTypefaceRef,
					size: 32,
					fakeBold: false,
					fakeItalic: false,
				},
			],
			200,
		);
		expect(result[0]?.runs[0]?.typeface?.__typename__).toBe("Typeface");
		expect(result[0]?.runs[0]?.glyphs).toEqual(new Uint16Array([11, 12]));
	});
});
