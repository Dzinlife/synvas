import { describe, expect, it } from "vitest";
import {
	buildFancyGlyphSlices,
	resolveFancyTextActiveWordState,
	segmentFancyTextWords,
	sliceGlyphRunByTextRange,
} from "./helpers";

describe("FancyText helpers", () => {
	it("会按单词切分文本", () => {
		const segments = segmentFancyTextWords("Hello world!", "en-US");

		expect(segments).toEqual([
			{ text: "Hello", start: 0, end: 5 },
			{ text: "world", start: 6, end: 11 },
		]);
	});

	it("会按时长平均推进当前高亮单词", () => {
		expect(
			resolveFancyTextActiveWordState({
				currentTime: 45,
				start: 0,
				end: 90,
				wordCount: 3,
			}),
		).toEqual({
			activeWordIndex: 1,
			activeWordProgress: 0.5,
		});
	});

	it("切分 glyph run 时会保留尾部 glyph", () => {
		const run = {
			typeface: null,
			size: 48,
			fakeBold: false,
			fakeItalic: false,
			glyphs: new Uint16Array([11, 12, 13, 14]),
			positions: new Float32Array([0, 20, 10, 20, 20, 20, 30, 20, 40, 20]),
			offsets: new Uint32Array([0, 1, 2, 3, 4]),
			flags: 0,
		};

		expect(sliceGlyphRunByTextRange(run, 0, 4)).toEqual({
			start: 0,
			end: 4,
			glyphIds: [11, 12, 13, 14],
			positions: [
				{ x: 0, y: 20 },
				{ x: 10, y: 20 },
				{ x: 20, y: 20 },
				{ x: 30, y: 20 },
			],
			advances: [10, 10, 10, 10],
			textStarts: [0, 1, 2, 3],
			textEnds: [1, 2, 3, 4],
		});
	});

	it("会把活动单词切成独立 glyph slice", () => {
		const lines = [
			{
				textRange: { first: 0, last: 4 },
				top: 0,
				bottom: 40,
				baseline: 30,
				runs: [
					{
						typeface: null,
						size: 48,
						fakeBold: false,
						fakeItalic: false,
						glyphs: new Uint16Array([1, 2, 3, 4]),
						positions: new Float32Array([
							0, 20, 10, 20, 20, 20, 30, 20, 40, 20,
						]),
						offsets: new Uint32Array([0, 1, 2, 3, 4]),
						flags: 0,
					},
				],
			},
		];

		const result = buildFancyGlyphSlices(lines, { start: 1, end: 3 });

		expect(result.inactiveSlices).toEqual([
			{
				start: 0,
				end: 1,
				glyphIds: [1],
				positions: [{ x: 0, y: 20 }],
				advances: [10],
				textStarts: [0],
				textEnds: [1],
			},
			{
				start: 3,
				end: 4,
				glyphIds: [4],
				positions: [{ x: 30, y: 20 }],
				advances: [10],
				textStarts: [3],
				textEnds: [4],
			},
		]);
		expect(result.activeSlices).toEqual([
			{
				start: 1,
				end: 3,
				glyphIds: [2, 3],
				positions: [
					{ x: 10, y: 20 },
					{ x: 20, y: 20 },
				],
				advances: [10, 10],
				textStarts: [1, 2],
				textEnds: [2, 3],
			},
		]);
	});
});
