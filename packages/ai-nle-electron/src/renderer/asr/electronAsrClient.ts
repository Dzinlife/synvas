import type {
	AsrClient,
	AsrModelSize,
	TranscribeAudioFileOptions,
	TranscriptSegment,
	TranscriptWord,
} from "ai-nle-editor/asr";
import { exportWav16kMonoFromFile } from "ai-nle-editor/asr";
import type { WhisperSegment } from "../electron";

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

const NO_SPACE_LANGS = new Set(["zh", "ja", "ko"]);
const PUNCT_ONLY_RE = /^[,.;:!?，。？！、…]+$/;
const NO_SPACE_PREFIX_RE = /^[’'"“”\-–—]/;
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

const normalizeToken = (value: string): string => String(value ?? "").trim();

const isCjk = (value: string): boolean => {
	if (!value) return false;
	return CJK_RE.test(value);
};

const appendToken = (base: string, token: string, language: string): string => {
	const cleaned = normalizeToken(token);
	if (!cleaned) return base;
	if (!base) return cleaned;
	if (NO_SPACE_LANGS.has(language)) return base + cleaned;
	if (PUNCT_ONLY_RE.test(cleaned) || NO_SPACE_PREFIX_RE.test(cleaned)) {
		return base + cleaned;
	}
	if (isCjk(cleaned) || isCjk(base.slice(-1))) {
		return base + cleaned;
	}
	return `${base} ${cleaned}`;
};

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
				id: createId("word"),
				text: String(word.text ?? ""),
				start: word.start,
				end: word.end,
			}));
	}

	// 退化：没有词级时间戳时，把整段当作一个 word。
	return [
		{
			id: createId("word"),
			text,
			start: segment.start,
			end: segment.end,
		},
	];
};

const WORD_GAP_SECONDS = 0.9;
const MAX_WORDS_PER_SEGMENT = 60;
const MAX_TEXT_LENGTH = 240;

const createWordAssembler = (language: string) => {
	let currentId = "";
	let currentStart = 0;
	let currentEnd = 0;
	let currentText = "";
	let currentWords: TranscriptWord[] = [];
	let segments: TranscriptSegment[] = [];

	const shouldSplit = (word: TranscriptWord) => {
		if (!currentId) return true;
		if (word.start - currentEnd >= WORD_GAP_SECONDS) return true;
		if (currentWords.length >= MAX_WORDS_PER_SEGMENT) return true;
		if (currentText.length >= MAX_TEXT_LENGTH) return true;
		return false;
	};

	const startSegment = (word: TranscriptWord) => {
		currentId = createId("segment");
		currentStart = word.start;
		currentEnd = word.end;
		currentText = normalizeToken(word.text);
		currentWords = [word];
		const segment: TranscriptSegment = {
			id: currentId,
			start: currentStart,
			end: currentEnd,
			text: currentText,
			words: currentWords,
		};
		segments.push(segment);
		return segment;
	};

	const pushWord = (word: TranscriptWord) => {
		if (shouldSplit(word)) {
			return startSegment(word);
		}
		const nextText = appendToken(currentText, word.text, language);
		const nextWords = [...currentWords, word];
		const segment: TranscriptSegment = {
			id: currentId,
			start: currentStart,
			end: word.end,
			text: nextText,
			words: nextWords,
		};
		currentEnd = word.end;
		currentText = nextText;
		currentWords = nextWords;
		segments[segments.length - 1] = segment;
		return segment;
	};

	const getSegments = () => segments.slice();

	return { pushWord, getSegments };
};

const mergeWhisperSegments = (
	raw: WhisperSegment[],
	language: string,
): TranscriptSegment[] => {
	const assembler = createWordAssembler(language);
	for (const seg of raw) {
		const words = toTranscriptWords(seg);
		for (const word of words) {
			if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) continue;
			assembler.pushWord(word);
		}
	}
	return assembler.getSegments();
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
		backend?: "coreml" | "metal" | "gpu" | "cpu";
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

		const streamAssembler = createWordAssembler(language);
		let hasStream = false;
		const disposeStream = bridge.asr.whisperOnSegment((event) => {
			if (event.requestId !== requestId) return;
			const words = toTranscriptWords(event.segment);
			if (words.length === 0) return;
			hasStream = true;
			for (const word of words) {
				if (!Number.isFinite(word.start) || !Number.isFinite(word.end))
					continue;
				const segment = streamAssembler.pushWord(word);
				onChunk(segment);
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

			const raw = Array.isArray(result.segments) ? result.segments : [];
			const segments = mergeWhisperSegments(raw, language);
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
