import type { ShapedLine, SkPoint } from "react-skia-lite";

export interface FancyTextWordSegment {
	text: string;
	start: number;
	end: number;
}

export interface FancyTextActiveWordState {
	activeWordIndex: number;
	activeWordProgress: number;
}

export interface FancyGlyphSlice {
	start: number;
	end: number;
	glyphIds: number[];
	positions: SkPoint[];
	advances: number[];
	textStarts: number[];
	textEnds: number[];
}

export interface FancyGlyphSlices {
	inactiveSlices: FancyGlyphSlice[];
	activeSlices: FancyGlyphSlice[];
}

const clamp01 = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	if (value <= 0) return 0;
	if (value >= 1) return 1;
	return value;
};

export const segmentFancyTextWords = (
	text: string,
	locale: string,
): FancyTextWordSegment[] => {
	if (!text) return [];
	const Segmenter = globalThis.Intl?.Segmenter;
	if (!Segmenter) {
		const trimmed = text.trim();
		if (!trimmed) return [];
		const start = text.indexOf(trimmed);
		return [{ text: trimmed, start, end: start + trimmed.length }];
	}
	const segmenter = new Segmenter(locale, { granularity: "word" });
	const segments: FancyTextWordSegment[] = [];
	for (const segment of segmenter.segment(text)) {
		if (!segment.isWordLike) continue;
		const wordText = segment.segment;
		const start = segment.index;
		const end = start + wordText.length;
		if (end <= start) continue;
		segments.push({
			text: wordText,
			start,
			end,
		});
	}
	return segments;
};

export const resolveFancyTextActiveWordState = (params: {
	currentTime: number;
	start: number;
	end: number;
	wordCount: number;
}): FancyTextActiveWordState => {
	const { currentTime, start, end, wordCount } = params;
	if (wordCount <= 0) {
		return { activeWordIndex: -1, activeWordProgress: 0 };
	}
	const duration = end - start;
	if (!Number.isFinite(duration) || duration <= 0) {
		return { activeWordIndex: 0, activeWordProgress: 1 };
	}
	const relativeTime = Math.min(
		Math.max(0, currentTime - start),
		Math.max(0, duration - Number.EPSILON),
	);
	const wordDuration = duration / wordCount;
	if (!Number.isFinite(wordDuration) || wordDuration <= 0) {
		return { activeWordIndex: 0, activeWordProgress: 1 };
	}
	const activeWordIndex = Math.min(
		wordCount - 1,
		Math.max(0, Math.floor(relativeTime / wordDuration)),
	);
	const wordStartTime = wordDuration * activeWordIndex;
	return {
		activeWordIndex,
		activeWordProgress: clamp01((relativeTime - wordStartTime) / wordDuration),
	};
};

const resolveRunTextStart = (offsets: Uint32Array): number => offsets[0] ?? 0;

const resolveRunTextEnd = (
	offsets: Uint32Array,
	glyphCount: number,
): number => offsets[glyphCount] ?? offsets[offsets.length - 1] ?? 0;

const findGlyphBoundary = (
	offsets: Uint32Array,
	value: number,
	startIndex: number,
	glyphCount: number,
): number => {
	for (let index = startIndex; index <= glyphCount; index += 1) {
		if ((offsets[index] ?? 0) >= value) {
			return index;
		}
	}
	return glyphCount;
};

export const sliceGlyphRunByTextRange = (
	run: ShapedLine["runs"][number],
	start: number,
	end: number,
): FancyGlyphSlice | null => {
	if (run.glyphs.length === 0 || run.offsets.length === 0) return null;
	if (end <= start) return null;

	const runStart = resolveRunTextStart(run.offsets);
	const runEnd = resolveRunTextEnd(run.offsets, run.glyphs.length);
	const sliceStart = Math.max(start, runStart);
	const sliceEnd = Math.min(end, runEnd);
	if (sliceEnd <= sliceStart) return null;

	const glyphStartIndex = findGlyphBoundary(
		run.offsets,
		sliceStart,
		0,
		run.glyphs.length,
	);
	const glyphEndIndex = findGlyphBoundary(
		run.offsets,
		sliceEnd,
		Math.min(glyphStartIndex + 1, run.glyphs.length),
		run.glyphs.length,
	);
	if (glyphEndIndex <= glyphStartIndex) return null;

	const glyphIds = Array.from(run.glyphs.slice(glyphStartIndex, glyphEndIndex));
	if (glyphIds.length === 0) return null;

	const positions: SkPoint[] = [];
	const advances: number[] = [];
	const textStarts: number[] = [];
	const textEnds: number[] = [];
	for (let index = glyphStartIndex; index < glyphEndIndex; index += 1) {
		const currentX = run.positions[index * 2] ?? 0;
		const currentY = run.positions[index * 2 + 1] ?? 0;
		const nextX = run.positions[index * 2 + 2] ?? currentX;
		const nextY = run.positions[index * 2 + 3] ?? currentY;
		const textStart = run.offsets[index] ?? 0;
		const textEnd = run.offsets[index + 1] ?? textStart;
		positions.push({
			x: currentX,
			y: currentY,
		});
		advances.push(Math.max(1, Math.hypot(nextX - currentX, nextY - currentY)));
		textStarts.push(textStart);
		textEnds.push(textEnd);
	}

	return {
		start: sliceStart,
		end: sliceEnd,
		glyphIds,
		positions,
		advances,
		textStarts,
		textEnds,
	};
};

export const buildFancyGlyphSlices = (
	lines: ShapedLine[],
	activeRange: { start: number; end: number } | null,
): FancyGlyphSlices => {
	const inactiveSlices: FancyGlyphSlice[] = [];
	const activeSlices: FancyGlyphSlice[] = [];

	for (const line of lines) {
		for (const run of line.runs) {
			const runStart = resolveRunTextStart(run.offsets);
			const runEnd = resolveRunTextEnd(run.offsets, run.glyphs.length);
			if (runEnd <= runStart) continue;

			if (!activeRange) {
				const wholeSlice = sliceGlyphRunByTextRange(run, runStart, runEnd);
				if (wholeSlice) {
					inactiveSlices.push(wholeSlice);
				}
				continue;
			}

			const beforeSlice = sliceGlyphRunByTextRange(
				run,
				runStart,
				Math.min(activeRange.start, runEnd),
			);
			if (beforeSlice) {
				inactiveSlices.push(beforeSlice);
			}

			const activeSlice = sliceGlyphRunByTextRange(
				run,
				Math.max(activeRange.start, runStart),
				Math.min(activeRange.end, runEnd),
			);
			if (activeSlice) {
				activeSlices.push(activeSlice);
			}

			const afterSlice = sliceGlyphRunByTextRange(
				run,
				Math.max(activeRange.end, runStart),
				runEnd,
			);
			if (afterSlice) {
				inactiveSlices.push(afterSlice);
			}
		}
	}

	return {
		inactiveSlices,
		activeSlices,
	};
};
