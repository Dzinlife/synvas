import type { TranscriptSegment, TranscriptWord } from "./types";

const createId = (prefix: string): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const buildSegmentText = (words: TranscriptWord[]): string => {
	return words
		.map((word) => word.text)
		.join("")
		.replace(/\s+/g, " ")
		.trim();
};

export function buildSegmentsFromWords(
	words: TranscriptWord[],
	options?: {
		maxSegmentSeconds?: number;
		gapSeconds?: number;
		maxWords?: number;
	},
): TranscriptSegment[] {
	if (words.length === 0) return [];
	const maxSegmentSeconds = options?.maxSegmentSeconds ?? 6;
	const gapSeconds = options?.gapSeconds ?? 0.8;
	const maxWords = options?.maxWords ?? 40;

	const segments: TranscriptSegment[] = [];

	let current: TranscriptWord[] = [];
	let segmentStart = 0;
	let lastEnd = -Infinity;

	const flush = () => {
		if (current.length === 0) return;
		const segment: TranscriptSegment = {
			id: createId("segment"),
			start: current[0].start,
			end: current[current.length - 1].end,
			text: buildSegmentText(current),
			words: current,
		};
		segments.push(segment);
		current = [];
	};

	for (const word of words) {
		if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) continue;
		if (current.length === 0) {
			current = [word];
			segmentStart = word.start;
			lastEnd = word.end;
			continue;
		}

		const gap = word.start - lastEnd;
		const duration = word.end - segmentStart;

		if (
			gap > gapSeconds ||
			duration > maxSegmentSeconds ||
			current.length >= maxWords
		) {
			flush();
			current = [word];
			segmentStart = word.start;
			lastEnd = word.end;
			continue;
		}

		current.push(word);
		lastEnd = word.end;
	}

	flush();
	return segments;
}
