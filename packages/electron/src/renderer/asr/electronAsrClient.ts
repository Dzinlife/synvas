import type {
	AsrClient,
	AsrModelSize,
	TranscribeAudioFileOptions,
	TranscriptSegment,
	TranscriptWord,
} from "@ai-nle/editor/asr";
import { exportWav16kMonoFromFile } from "@ai-nle/editor/asr";
import type { WhisperJsonOutput, WhisperSegment } from "../electron";

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
			const text = String(s?.text ?? "").trim();
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
								const wt = String(t?.text ?? "").trim();
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
			? String((raw[0] as { text?: string }).text ?? "").trim()
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
	const cleaned = (value as string).trim().replace(",", ".");
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
	const bridge = window.aiNleElectron;
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
		zh: "zh-CN",
		en: "en-US",
		ja: "ja-JP",
		ko: "ko-KR",
	};
	return map[language] ?? "en-US";
};

const normalizeToken = (value: string): string => String(value ?? "").trim();

const toTranscriptWords = (segment: WhisperSegment): TranscriptWord[] => {
	const text = normalizeToken(segment.text ?? "");
	if (!text) return [];

	if (Array.isArray(segment.words) && segment.words.length > 0) {
		return segment.words
			.filter(
				(word) =>
					Number.isFinite(word.start) &&
					Number.isFinite(word.end) &&
					word.end >= word.start,
			)
			.map((word) => ({
				text: word.text,
				start: word.start,
				end: word.end,
			}));
	}

	// 退化：没有词级时间戳时，把整段当作一个 word。
	return [
		{
			text,
			start: segment.start,
			end: segment.end,
		},
	];
};

/** 单字符语系（不以空格分词）：汉、平假名、片假名、泰、老挝、高棉；韩语为空格语系故不包含 */
const CHAR_SCRIPT_RE =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}]/u;
const containsCharScript = (text: string): boolean =>
	CHAR_SCRIPT_RE.test(text ?? "");

/**
 * 用 Intl.Segmenter 按句切分：一句话一个 segment。
 * 若词中包含单字符语系（汉/假名/泰/老挝/高棉），则该词单独作为一个 segment。
 */
const wordsToSegments = (
	words: TranscriptWord[],
	locale: string,
): TranscriptSegment[] => {
	if (words.length === 0) return [];

	const segments: TranscriptSegment[] = [];
	let segmentIndex = 0;

	const flushRun = (
		runWords: TranscriptWord[],
		runParts: string[],
		runRanges: { wordIndex: number; start: number; end: number }[],
	) => {
		if (runWords.length === 0) return;
		const fullText = runParts.join(" ");
		if (!fullText.trim()) return;
		const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
		for (const seg of segmenter.segment(fullText)) {
			const segStart = seg.index;
			const segEnd = seg.index + seg.segment.length;
			const sentenceWords: TranscriptWord[] = [];
			for (const wr of runRanges) {
				if (wr.start < segEnd && wr.end > segStart) {
					sentenceWords.push(runWords[wr.wordIndex]);
				}
			}
			if (sentenceWords.length === 0) continue;
			const start = Math.min(...sentenceWords.map((w) => w.start));
			const end = Math.max(...sentenceWords.map((w) => w.end));
			segments.push({
				id: `segment-${segmentIndex}`,
				start,
				end,
				text: seg.segment.trim(),
				words: sentenceWords,
			});
			segmentIndex += 1;
		}
	};

	let runWords: TranscriptWord[] = [];
	let runParts: string[] = [];
	const runRanges: { wordIndex: number; start: number; end: number }[] = [];
	let pos = 0;

	for (let i = 0; i < words.length; i++) {
		const w = words[i];
		const t = w.text.trim();
		if (!t) continue;
		if (containsCharScript(t)) {
			flushRun(runWords, runParts, runRanges);
			runWords = [];
			runParts = [];
			runRanges.length = 0;
			pos = 0;
			segments.push({
				id: `segment-${segmentIndex}`,
				start: w.start,
				end: w.end,
				text: t,
				words: [w],
			});
			segmentIndex += 1;
		} else {
			runRanges.push({
				wordIndex: runWords.length,
				start: pos,
				end: pos + t.length,
			});
			runWords.push(w);
			runParts.push(t);
			pos += t.length + 1;
		}
	}
	flushRun(runWords, runParts, runRanges);
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

		// 流式：累积词，以词为单位更新 UI；用 Intl.Segmenter 按句切分，一句一个 segment
		const streamWords: TranscriptWord[] = [];
		let prevSegmentCount = 0;
		const locale = languageToLocale(language);
		let hasStream = false;
		const disposeStream = bridge.asr.whisperOnSegment((event) => {
			if (event.requestId !== requestId) return;
			const rawSeg = parseSegmentFromConsoleLine(event.raw);
			if (!rawSeg) return;
			const words = toTranscriptWords(rawSeg);
			if (words.length === 0) return;
			hasStream = true;
			for (const word of words) {
				if (!Number.isFinite(word.start) || !Number.isFinite(word.end))
					continue;
				streamWords.push(word);
				const segments = wordsToSegments(streamWords, locale);
				// 只推送当前句及新完成的句（以词为单位更新 UI）
				for (let i = prevSegmentCount; i < segments.length; i += 1) {
					onChunk(segments[i]);
				}
				prevSegmentCount = Math.max(0, segments.length - 1);
				reportTranscribeProgress(
					progressFromSegments({
						index: 0,
						total: 0,
						segmentEnd: word.end,
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
			const allWords: TranscriptWord[] = [];
			for (const seg of rawSegments) {
				const words = toTranscriptWords(seg);
				for (const w of words) {
					if (Number.isFinite(w.start) && Number.isFinite(w.end))
						allWords.push(w);
				}
			}
			const segments = wordsToSegments(allWords, languageToLocale(language));
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
