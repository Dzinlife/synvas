import type {
	AsrClient,
	AsrModelSize,
	TranscribeAudioFileOptions,
	TranscriptSegment,
	TranscriptWord,
} from "@synvas/editor/asr";
import { exportWav16kMonoFromFile } from "@synvas/editor/asr";
import type { WhisperJsonOutput, WhisperSegment } from "../electron";

type TimedCharRange = {
	start: number;
	end: number;
	startTime: number;
	endTime: number;
	text: string;
};

type TimedToken = {
	startTime: number;
	endTime: number;
	text: string;
};

type RepairedTokenRange = TimedToken & {
	charStart: number;
	charEnd: number;
	repairedText: string;
};

type TextRange = {
	start: number;
	end: number;
	text: string;
};

type IndexedWord = TranscriptWord & {
	startChar: number;
	endChar: number;
};

type SegmentDraft = {
	start: number;
	end: number;
	text: string;
	words: TranscriptWord[];
};

/** whisper.cpp -oj 原始 JSON 转为 WhisperSegment[] */
function normalizeSegmentsFromJson(
	data: WhisperJsonOutput,
	durationSeconds?: number,
): WhisperSegment[] {
	const raw = data?.transcription ?? [];
	if (!Array.isArray(raw)) return [];

	const segs = raw
		.map((s): WhisperSegment | null => {
			const from = s.offsets?.from;
			const to = s.offsets?.to;
			const start =
				typeof from === "number" && Number.isFinite(from) ? from / 1000 : null;
			const end =
				typeof to === "number" && Number.isFinite(to) ? to / 1000 : null;
			const text = String(s?.text ?? "");
			if (start === null || end === null) return null;
			const words =
				Array.isArray(s.tokens) && s.tokens.length > 0
					? s.tokens
							.map((t) => {
								const of = t.offsets;
								const ws =
									typeof of?.from === "number" && Number.isFinite(of.from)
										? of.from / 1000
										: null;
								const we =
									typeof of?.to === "number" && Number.isFinite(of.to)
										? of.to / 1000
										: null;
								const wt = String(t.text ?? "");
								if (ws === null || we === null) return null;
								return { start: ws, end: we, text: wt };
							})
							.filter((x): x is { start: number; end: number; text: string } =>
								Boolean(x),
							)
					: undefined;
			return { start, end, text, words };
		})
		.filter((x): x is WhisperSegment => x != null);

	if (segs.length > 0) return segs;

	const end =
		typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
			? durationSeconds
			: 0;
	const firstText =
		raw[0] && typeof raw[0] === "object" && "text" in raw[0]
			? String((raw[0] as { text?: string }).text ?? "")
			: "";
	if (!firstText) return [];
	return [{ start: 0, end, text: firstText }];
}

/** whisper-cli stdout 行格式：[0.0 --> 1.5] 文本 */
function parseSegmentFromConsoleLine(
	line: string | null | undefined,
): WhisperSegment | null {
	if (!line?.trim()) return null;
	const match = line.match(/^\s*\[(.+?)\s*-->\s*(.+?)\]\s*(.*)$/);
	if (!match) return null;
	const start = parseTimestampToSeconds(match[1]);
	const end = parseTimestampToSeconds(match[2]);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	const text = match[3]?.trim() ?? "";
	if (!text) return null;
	return { start: start!, end: end!, text };
}

function parseTimestampToSeconds(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return null;
	const cleaned = value.trim().replace(",", ".");
	if (!cleaned) return null;
	const asNumber = Number(cleaned);
	if (Number.isFinite(asNumber)) return asNumber;
	const parts = cleaned.split(":");
	if (parts.length >= 2 && parts.length <= 3) {
		const nums = parts.map((p) => Number(p));
		if (nums.some((n) => !Number.isFinite(n))) return null;
		const [a, b, c] =
			parts.length === 3
				? [Number(parts[0]), Number(parts[1]), Number(parts[2])]
				: [0, Number(parts[0]), Number(parts[1])];
		return a * 3600 + b * 60 + c;
	}
	return null;
}

const createId = (prefix: string): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const getBridge = () => {
	const bridge = window.synvasElectron;
	if (!bridge) {
		throw new Error("当前不是 Electron 环境，无法使用本地 Whisper 引擎");
	}
	return bridge;
};

const normalizeLanguage = (language: string): string => {
	// whisper.cpp 一般不需要显式传 auto；这里保留给 main 端决定是否省略参数。
	return language || "auto";
};

const PREP_PROGRESS_RATIO = 0.2;

/** Intl.Segmenter 用的 locale，按语言码映射 */
const languageToLocale = (language: string): string => {
	const map: Record<string, string> = {
		auto: "und",
		zh: "zh-CN",
		en: "en-US",
		ja: "ja-JP",
		ko: "ko-KR",
		fr: "fr-FR",
		de: "de-DE",
	};
	return map[language] ?? "und";
};

const normalizeToken = (value: string): string => value;

const REPLACEMENT_CHAR = "\uFFFD";
const TOKEN_WEIGHT_EPSILON = 0.001;
const SENTENCE_PUNCTUATION_RE = /[。！？.!?…]/u;
const WORD_CONTENT_RE = /[\p{L}\p{N}]/u;
const HAN_RE = /\p{Script=Han}/u;
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL_RE = /\p{Script=Hangul}/u;
const WHITESPACE_RE = /\s/u;

const toTranscriptWords = (words: IndexedWord[]): TranscriptWord[] =>
	words.map((word) => ({
		text: word.text,
		start: word.start,
		end: word.end,
	}));

const containsWordContent = (text: string): boolean =>
	WORD_CONTENT_RE.test(text);

const hasReplacementChar = (text: string): boolean =>
	text.includes(REPLACEMENT_CHAR);

const trimWhitespaceRange = (
	text: string,
	start: number,
	end: number,
): TextRange | null => {
	let left = start;
	let right = end;
	while (left < right && WHITESPACE_RE.test(text.charAt(left))) {
		left += 1;
	}
	while (right > left && WHITESPACE_RE.test(text.charAt(right - 1))) {
		right -= 1;
	}
	if (right <= left) return null;
	return {
		start: left,
		end: right,
		text: text.slice(left, right),
	};
};

const tokenWeight = (token: TimedToken): number => {
	const duration = token.endTime - token.startTime;
	if (Number.isFinite(duration) && duration > 0) return duration;
	return TOKEN_WEIGHT_EPSILON;
};

const clampRange = (
	start: number,
	end: number,
	textLength: number,
): { start: number; end: number } => {
	const clampedStart = Math.max(0, Math.min(textLength, start));
	const clampedEnd = Math.max(clampedStart, Math.min(textLength, end));
	return { start: clampedStart, end: clampedEnd };
};

const shouldRepairTokenText = (
	segmentText: string,
	tokens: TimedToken[],
): boolean => {
	if (!segmentText) return false;
	if (hasReplacementChar(segmentText)) return false;
	return tokens.some((token) => hasReplacementChar(token.text));
};

const collectRepairBoundaries = (
	segmentText: string,
	left: number,
	right: number,
	locale: string,
): number[] => {
	const boundaries = new Set<number>([left, right]);
	try {
		const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
		for (const item of segmenter.segment(segmentText)) {
			const segStart = item.index;
			const segEnd = segStart + item.segment.length;
			if (segEnd <= left || segStart >= right) continue;
			const clippedStart = Math.max(left, Math.min(right, segStart));
			const clippedEnd = Math.max(left, Math.min(right, segEnd));
			boundaries.add(clippedStart);
			boundaries.add(clippedEnd);
		}
	} catch {
		// Intl.Segmenter 不可用时走字符级兜底。
	}
	if (boundaries.size <= 2) {
		let cursor = left;
		while (cursor < right) {
			const codePoint = segmentText.codePointAt(cursor);
			if (codePoint === undefined) break;
			const length = codePoint > 0xffff ? 2 : 1;
			cursor = Math.min(right, cursor + length);
			boundaries.add(cursor);
		}
	}
	return [...boundaries].sort((a, b) => a - b);
};

const repairTokenTextsWithAnchors = (
	segmentText: string,
	tokens: TimedToken[],
	locale: string,
): RepairedTokenRange[] => {
	const textLength = segmentText.length;
	const tokenCount = tokens.length;
	const charRanges: Array<{ start: number; end: number } | null> = Array.from<{
		start: number;
		end: number;
	} | null>({
		length: tokenCount,
	}).fill(null);
	let cursor = 0;
	const pendingIndices: number[] = [];

	// 先按分词边界顺序分配未知 token；边界不足时再按时间权重回退。
	const flushPending = (from: number, to: number) => {
		if (pendingIndices.length === 0) return;
		const left = Math.max(0, Math.min(textLength, from));
		const right = Math.max(left, Math.min(textLength, to));
		const length = right - left;
		const indices = pendingIndices.splice(0, pendingIndices.length);
		if (length === 0) {
			for (const idx of indices) {
				charRanges[idx] = { start: left, end: left };
			}
			return;
		}
		const boundaries = collectRepairBoundaries(
			segmentText,
			left,
			right,
			locale,
		);
		const weights = indices.map((idx) => tokenWeight(tokens[idx]));
		const totalWeight =
			weights.reduce((sum, value) => sum + value, 0) ||
			indices.length * TOKEN_WEIGHT_EPSILON;
		let consumedWeight = 0;
		let current = left;
		for (let i = 0; i < indices.length; i += 1) {
			const idx = indices[i];
			const isLast = i === indices.length - 1;
			if (isLast) {
				charRanges[idx] = { start: current, end: right };
				current = right;
				continue;
			}
			consumedWeight += weights[i];
			const rawEnd = left + Math.round((consumedWeight / totalWeight) * length);
			let next = Math.max(current, Math.min(right, rawEnd));
			const snapped = boundaries.find(
				(boundary) => boundary >= next && boundary > current,
			);
			if (snapped !== undefined) {
				next = Math.max(current, Math.min(right, snapped));
			}
			charRanges[idx] = { start: current, end: next };
			current = next;
		}
	};

	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i];
		const tokenText = token.text;
		const isAnchor = tokenText.length > 0 && !hasReplacementChar(tokenText);
		if (!isAnchor) {
			pendingIndices.push(i);
			continue;
		}
		const foundIndex = segmentText.indexOf(tokenText, cursor);
		if (foundIndex < 0) {
			pendingIndices.push(i);
			continue;
		}
		flushPending(cursor, foundIndex);
		const anchorRange = clampRange(
			foundIndex,
			foundIndex + tokenText.length,
			textLength,
		);
		charRanges[i] = anchorRange;
		cursor = anchorRange.end;
	}

	flushPending(cursor, textLength);

	return tokens.map((token, index) => {
		const rawRange = charRanges[index] ?? { start: 0, end: 0 };
		const range = clampRange(rawRange.start, rawRange.end, textLength);
		const repairedText = segmentText.slice(range.start, range.end);
		return {
			startTime: token.startTime,
			endTime: token.endTime,
			text: token.text,
			charStart: range.start,
			charEnd: range.end,
			repairedText: repairedText || token.text,
		};
	});
};

const collectTimedTokens = (segment: WhisperSegment): TimedToken[] => {
	if (!Array.isArray(segment.words) || segment.words.length === 0) return [];
	const tokens: TimedToken[] = [];
	for (const token of segment.words) {
		if (
			!Number.isFinite(token.start) ||
			!Number.isFinite(token.end) ||
			token.end <= token.start
		) {
			continue;
		}
		const tokenText = normalizeToken(String(token.text ?? ""));
		if (!tokenText) continue;
		tokens.push({
			startTime: token.start,
			endTime: token.end,
			text: tokenText,
		});
	}
	return tokens;
};

const buildTimedCharRangesFromTokenText = (
	tokens: TimedToken[],
	segmentText: string,
): { baseText: string; ranges: TimedCharRange[] } => {
	const ranges: TimedCharRange[] = [];
	let cursor = 0;
	let baseText = "";
	for (const token of tokens) {
		const start = cursor;
		const end = start + token.text.length;
		ranges.push({
			start,
			end,
			startTime: token.startTime,
			endTime: token.endTime,
			text: token.text,
		});
		baseText += token.text;
		cursor = end;
	}
	if (!baseText) {
		return { baseText: segmentText, ranges: [] };
	}
	return { baseText, ranges };
};

const buildTimedCharRanges = (
	segment: WhisperSegment,
	locale: string,
): { baseText: string; ranges: TimedCharRange[] } => {
	const segmentText = normalizeToken(segment.text ?? "");
	const tokens = collectTimedTokens(segment);
	if (tokens.length === 0) {
		return {
			baseText: segmentText,
			ranges: [],
		};
	}

	// whisper.cpp 可能把 token 文本损坏成 �，优先用 segment.text 修复 token 字符范围。
	if (shouldRepairTokenText(segmentText, tokens)) {
		try {
			const repaired = repairTokenTextsWithAnchors(segmentText, tokens, locale);
			if (repaired.length > 0) {
				return {
					baseText: segmentText,
					ranges: repaired.map((token) => ({
						start: token.charStart,
						end: token.charEnd,
						startTime: token.startTime,
						endTime: token.endTime,
						text: token.repairedText,
					})),
				};
			}
		} catch {
			// 修复失败时回退到原 token 拼接逻辑，避免影响整体转写。
		}
	}

	return buildTimedCharRangesFromTokenText(tokens, segmentText);
};

const splitWordRanges = (text: string, locale: string): TextRange[] => {
	const ranges: TextRange[] = [];
	try {
		const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
		for (const item of segmenter.segment(text)) {
			const isWordLike = (item as { isWordLike?: boolean }).isWordLike;
			if (isWordLike === false) continue;
			const start = item.index;
			const end = start + item.segment.length;
			const trimmed = trimWhitespaceRange(text, start, end);
			if (!trimmed) continue;
			if (!containsWordContent(trimmed.text)) continue;
			ranges.push(trimmed);
		}
	} catch {
		// 兜底逻辑会处理。
	}
	if (ranges.length > 0) return ranges;

	for (const match of text.matchAll(/\S+/g)) {
		const value = match[0];
		const start = match.index ?? -1;
		if (start < 0) continue;
		const end = start + value.length;
		const trimmed = trimWhitespaceRange(text, start, end);
		if (!trimmed) continue;
		if (!containsWordContent(trimmed.text)) continue;
		ranges.push(trimmed);
	}
	return ranges;
};

const shouldSplitHanToChar = (language: string, text: string): boolean => {
	if (!HAN_RE.test(text)) return false;
	if (language === "zh") return true;
	if (language !== "auto") return false;
	if (KANA_RE.test(text) || HANGUL_RE.test(text)) return false;
	return true;
};

const splitRangeByHanChar = (
	range: TextRange,
	fullText: string,
): TextRange[] => {
	const pieces: TextRange[] = [];
	let cursor = range.start;
	let pendingStart = -1;
	let pendingEnd = -1;

	while (cursor < range.end) {
		const codePoint = fullText.codePointAt(cursor);
		if (codePoint === undefined) break;
		const charLen = codePoint > 0xffff ? 2 : 1;
		const next = cursor + charLen;
		const charText = fullText.slice(cursor, next);
		const isHan = HAN_RE.test(charText);
		if (isHan) {
			if (pendingStart >= 0 && pendingEnd > pendingStart) {
				const value = fullText.slice(pendingStart, pendingEnd);
				if (containsWordContent(value)) {
					pieces.push({
						start: pendingStart,
						end: pendingEnd,
						text: value,
					});
				}
			}
			pendingStart = -1;
			pendingEnd = -1;
			pieces.push({
				start: cursor,
				end: next,
				text: charText,
			});
		} else {
			if (pendingStart < 0) {
				pendingStart = cursor;
			}
			pendingEnd = next;
		}
		cursor = next;
	}

	if (pendingStart >= 0 && pendingEnd > pendingStart) {
		const value = fullText.slice(pendingStart, pendingEnd);
		if (containsWordContent(value)) {
			pieces.push({
				start: pendingStart,
				end: pendingEnd,
				text: value,
			});
		}
	}

	return pieces;
};

const resolveTimingFromCharRange = (
	range: TextRange,
	charRanges: TimedCharRange[],
	segmentStart: number,
	segmentEnd: number,
	totalTextLength: number,
): { start: number; end: number } => {
	let start = Number.POSITIVE_INFINITY;
	let end = Number.NEGATIVE_INFINITY;
	for (const token of charRanges) {
		if (token.start >= range.end || token.end <= range.start) continue;
		const overlapStart = Math.max(range.start, token.start);
		const overlapEnd = Math.min(range.end, token.end);
		if (overlapEnd <= overlapStart) continue;
		const tokenChars = Math.max(1, token.end - token.start);
		const ratioStart = (overlapStart - token.start) / tokenChars;
		const ratioEnd = (overlapEnd - token.start) / tokenChars;
		const tokenDuration = Math.max(0, token.endTime - token.startTime);
		const currentStart = token.startTime + tokenDuration * ratioStart;
		const currentEnd = token.startTime + tokenDuration * ratioEnd;
		start = Math.min(start, currentStart);
		end = Math.max(end, currentEnd);
	}

	if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
		return { start, end };
	}

	const length = Math.max(1, totalTextLength);
	const duration = Math.max(0, segmentEnd - segmentStart);
	const startRatio = Math.max(0, Math.min(1, range.start / length));
	const endRatio = Math.max(0, Math.min(1, range.end / length));
	start = segmentStart + duration * startRatio;
	end = segmentStart + duration * endRatio;
	if (!(end > start)) {
		const epsilon = duration > 0 ? Math.min(0.02, duration / length) : 0.02;
		end = start + Math.max(epsilon, 0.001);
	}
	return { start, end };
};

const buildIndexedWords = (
	segment: WhisperSegment,
	locale: string,
	language: string,
): { text: string; words: IndexedWord[] } => {
	const { baseText, ranges: timedCharRanges } = buildTimedCharRanges(
		segment,
		locale,
	);
	const text = baseText;
	if (!text.trim()) {
		return { text, words: [] };
	}

	let wordRanges = splitWordRanges(text, locale);
	if (wordRanges.length === 0) {
		const trimmed = trimWhitespaceRange(text, 0, text.length);
		if (trimmed && containsWordContent(trimmed.text)) {
			wordRanges = [trimmed];
		}
	}

	const splitHanChar = shouldSplitHanToChar(language, text);
	const expandedRanges: TextRange[] = [];
	for (const wordRange of wordRanges) {
		if (!containsWordContent(wordRange.text)) continue;
		if (splitHanChar && HAN_RE.test(wordRange.text)) {
			const pieces = splitRangeByHanChar(wordRange, text);
			if (pieces.length > 0) {
				expandedRanges.push(...pieces);
				continue;
			}
		}
		expandedRanges.push(wordRange);
	}

	const words: IndexedWord[] = [];
	for (const range of expandedRanges) {
		const timing = resolveTimingFromCharRange(
			range,
			timedCharRanges,
			segment.start,
			segment.end,
			text.length,
		);
		if (!Number.isFinite(timing.start) || !Number.isFinite(timing.end))
			continue;
		const start = timing.start;
		let end = timing.end;
		if (!(end > start)) {
			end = start + 0.001;
		}
		words.push({
			text: range.text,
			start,
			end,
			startChar: range.start,
			endChar: range.end,
		});
	}

	if (words.length > 0) return { text, words };

	const trimmed = trimWhitespaceRange(text, 0, text.length);
	if (!trimmed || !containsWordContent(trimmed.text)) {
		return { text, words: [] };
	}
	const fallbackEnd =
		Number.isFinite(segment.end) && segment.end > segment.start
			? segment.end
			: segment.start + 0.001;
	return {
		text,
		words: [
			{
				text: trimmed.text,
				start: segment.start,
				end: fallbackEnd,
				startChar: trimmed.start,
				endChar: trimmed.end,
			},
		],
	};
};

const splitSentenceRanges = (text: string, locale: string): TextRange[] => {
	if (!SENTENCE_PUNCTUATION_RE.test(text)) return [];
	const ranges: TextRange[] = [];
	try {
		const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
		for (const item of segmenter.segment(text)) {
			const start = item.index;
			const end = start + item.segment.length;
			const trimmed = trimWhitespaceRange(text, start, end);
			if (!trimmed) continue;
			ranges.push(trimmed);
		}
	} catch {
		return [];
	}
	return ranges.length > 1 ? ranges : [];
};

const buildSegmentDraftsFromWhisperSegment = (
	segment: WhisperSegment,
	locale: string,
	language: string,
): SegmentDraft[] => {
	const { text, words } = buildIndexedWords(segment, locale, language);
	const segmentText = text.trim();
	if (!segmentText) return [];

	if (words.length === 0) {
		return [
			{
				start: segment.start,
				end: segment.end,
				text: segmentText,
				words: [],
			},
		];
	}

	const sentenceRanges = splitSentenceRanges(text, locale);
	if (sentenceRanges.length === 0) {
		return [
			{
				start: Math.min(...words.map((word) => word.start)),
				end: Math.max(...words.map((word) => word.end)),
				text: segmentText,
				words: toTranscriptWords(words),
			},
		];
	}

	const sentenceDrafts: SegmentDraft[] = [];
	for (const sentence of sentenceRanges) {
		const sentenceWords = words.filter(
			(word) =>
				word.startChar < sentence.end &&
				word.endChar > sentence.start &&
				word.end > word.start,
		);
		if (sentenceWords.length === 0) continue;
		const sentenceText = sentence.text.trim();
		if (!sentenceText) continue;
		sentenceDrafts.push({
			start: Math.min(...sentenceWords.map((word) => word.start)),
			end: Math.max(...sentenceWords.map((word) => word.end)),
			text: sentenceText,
			words: toTranscriptWords(sentenceWords),
		});
	}

	if (sentenceDrafts.length > 0) return sentenceDrafts;
	return [
		{
			start: Math.min(...words.map((word) => word.start)),
			end: Math.max(...words.map((word) => word.end)),
			text: segmentText,
			words: toTranscriptWords(words),
		},
	];
};

const buildTranscriptSegments = (options: {
	rawSegments: WhisperSegment[];
	locale: string;
	language: string;
	idPrefix: string;
}): TranscriptSegment[] => {
	const { rawSegments, locale, language, idPrefix } = options;
	const segments: TranscriptSegment[] = [];
	let segmentIndex = 0;
	for (const rawSegment of rawSegments) {
		const drafts = buildSegmentDraftsFromWhisperSegment(
			rawSegment,
			locale,
			language,
		);
		for (const draft of drafts) {
			if (!Number.isFinite(draft.start) || !Number.isFinite(draft.end))
				continue;
			if (!(draft.end > draft.start)) continue;
			segments.push({
				id: `${idPrefix}-${segmentIndex}`,
				start: draft.start,
				end: draft.end,
				text: draft.text,
				words: draft.words,
			});
			segmentIndex += 1;
		}
	}
	return segments;
};

const progressFromSegments = (options: {
	index: number;
	total: number;
	segmentEnd: number;
	duration?: number;
}): number => {
	const { index, total, segmentEnd, duration } = options;
	if (duration && Number.isFinite(duration) && duration > 0) {
		return Math.min(1, Math.max(0, segmentEnd / duration));
	}
	return total > 0 ? (index + 1) / total : 1;
};

export const electronAsrClient: AsrClient = {
	ensureReady: async (options: {
		model: AsrModelSize;
		language: string;
		signal: AbortSignal;
	}) => {
		const bridge = getBridge();
		if (options.signal.aborted) {
			throw new DOMException("已取消", "AbortError");
		}
		const result = await bridge.asr.whisperCheckReady({
			model: options.model,
			language: normalizeLanguage(options.language),
		});
		if (result.ok) return;
		if (options.signal.aborted) {
			throw new DOMException("已取消", "AbortError");
		}
		if (!result.canDownload) {
			const message = result.message || "Whisper 引擎未就绪";
			window.alert(message);
			throw new Error(message);
		}
		const confirmed = window.confirm(
			`${result.message || "未找到模型文件"}\n需要安装本地引擎并下载模型文件（首次使用会耗时）。\n是否开始下载？`,
		);
		if (!confirmed) {
			throw new Error("已取消模型下载");
		}
		if (options.signal.aborted) {
			throw new DOMException("已取消", "AbortError");
		}
		const downloadResult = await bridge.asr.whisperDownload({
			model: options.model,
		});
		if (!downloadResult.ok) {
			const message = downloadResult.message || "模型下载失败";
			window.alert(message);
			throw new Error(message);
		}
	},
	transcribeAudioFile: async (
		options: TranscribeAudioFileOptions,
	): Promise<{
		segments: TranscriptSegment[];
		backend?: "gpu" | "cpu";
		durationMs?: number;
	}> => {
		const {
			file,
			language,
			model,
			duration,
			onProgress,
			onChunk,
			onStatus,
			signal,
		} = options;
		if (signal.aborted) {
			throw new DOMException("已取消", "AbortError");
		}

		const bridge = getBridge();
		const locale = languageToLocale(language);
		let lastProgress = 0;
		const reportProgress = (value: number) => {
			const next = Math.max(lastProgress, Math.min(1, Math.max(0, value)));
			lastProgress = next;
			onProgress(next);
		};
		const reportTranscribeProgress = (value: number) => {
			reportProgress(
				PREP_PROGRESS_RATIO +
					(1 - PREP_PROGRESS_RATIO) * Math.min(1, Math.max(0, value)),
			);
		};
		const startPrepProgress = () => {
			const estimatedMs = Math.min(5000, Math.max(1200, (duration ?? 20) * 30));
			const start = performance.now();
			const timer = window.setInterval(() => {
				const elapsed = performance.now() - start;
				reportProgress(
					Math.min(
						PREP_PROGRESS_RATIO,
						(elapsed / estimatedMs) * PREP_PROGRESS_RATIO,
					),
				);
			}, 120);
			return () => {
				window.clearInterval(timer);
				reportProgress(PREP_PROGRESS_RATIO);
			};
		};
		reportProgress(0);
		onStatus?.("转码音频");
		const stopPrepProgress = startPrepProgress();
		let wavBytes: Uint8Array;
		try {
			wavBytes = await exportWav16kMonoFromFile({ file, signal });
		} finally {
			stopPrepProgress();
		}
		onStatus?.("转写中");
		if (signal.aborted) {
			throw new DOMException("已取消", "AbortError");
		}

		const requestId = createId("whisper");
		let abortListener: (() => void) | null = null;
		const abortPromise = new Promise<never>((_, reject) => {
			abortListener = () => {
				bridge.asr.whisperAbort(requestId);
				reject(new DOMException("已取消", "AbortError"));
			};
			signal.addEventListener("abort", abortListener, { once: true });
		});

		// 流式：按原始 stdout 行构造临时句段，最终由 JSON 结果覆盖并精修词时间。
		let hasStream = false;
		let streamSegmentIndex = 0;
		const disposeStream = bridge.asr.whisperOnSegment((event) => {
			if (event.requestId !== requestId) return;
			const rawSeg = parseSegmentFromConsoleLine(event.raw);
			if (!rawSeg) return;
			const streamSegments = buildTranscriptSegments({
				rawSegments: [rawSeg],
				locale,
				language,
				idPrefix: "stream-segment",
			});
			if (streamSegments.length === 0) return;
			hasStream = true;
			for (const segment of streamSegments) {
				onChunk({
					...segment,
					id: `stream-segment-${streamSegmentIndex}`,
				});
				streamSegmentIndex += 1;
				reportTranscribeProgress(
					progressFromSegments({
						index: 0,
						total: 0,
						segmentEnd: segment.end,
						duration,
					}),
				);
			}
		});

		try {
			const wavBuffer = wavBytes.buffer.slice(
				wavBytes.byteOffset,
				wavBytes.byteOffset + wavBytes.byteLength,
			) as ArrayBuffer;
			const result = await Promise.race([
				bridge.asr.whisperTranscribe({
					requestId,
					wavBytes: wavBuffer,
					model,
					language: normalizeLanguage(language),
					duration,
				}),
				abortPromise,
			]);

			const rawSegments = normalizeSegmentsFromJson(result.data, duration);
			const segments = buildTranscriptSegments({
				rawSegments,
				locale,
				language,
				idPrefix: "segment",
			});
			if (!hasStream) {
				for (let i = 0; i < segments.length; i += 1) {
					if (signal.aborted) {
						throw new DOMException("已取消", "AbortError");
					}
					const seg = segments[i];
					onChunk(seg);
					reportTranscribeProgress(
						progressFromSegments({
							index: i,
							total: segments.length,
							segmentEnd: seg.end,
							duration,
						}),
					);
				}
			}
			reportProgress(1);
			return {
				segments,
				backend: result.backend,
				durationMs: result.durationMs,
			};
		} catch (error) {
			if (!(error instanceof DOMException && error.name === "AbortError")) {
				const message = error instanceof Error ? error.message : String(error);
				window.alert(message);
			}
			throw error;
		} finally {
			disposeStream?.();
			if (abortListener) {
				signal.removeEventListener("abort", abortListener);
			}
		}
	},
};
