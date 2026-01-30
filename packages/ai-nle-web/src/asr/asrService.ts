import { NonRealTimeVAD } from "@ricky0123/vad-web";
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import type {
	AsrModelSize,
	TranscriptSegment,
	TranscriptWord,
	WhisperWorkerResponse,
	WhisperWorkerWord,
} from "./types";

const TARGET_SAMPLE_RATE = 16000;
const DUPLICATE_WINDOW_SECONDS = 0.05;
const WORD_GAP_SECONDS = 0.9;
const MAX_WORDS_PER_SEGMENT = 60;
const MAX_TEXT_LENGTH = 240;
const PREP_PROGRESS_RATIO = 0.2;
const STREAM_DEFAULT_STEP_MS = 55;
const STREAM_MIN_STEP_MS = 30;
const STREAM_MAX_STEP_MS = 160;
const VAD_PRE_PAD_MS = 200;
const VAD_POST_PAD_MS = 180;
const VAD_MERGE_GAP_MS = 350;

const NO_SPACE_LANGS = new Set(["zh", "ja", "ko"]);
const PUNCT_ONLY_RE = /^[,.;:!?，。？！、…]+$/;
const NO_SPACE_PREFIX_RE = /^[’'"“”\-–—]/;
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

const createId = (prefix: string): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const mixToMono = (buffer: AudioBuffer): Float32Array => {
	if (buffer.numberOfChannels === 1) {
		return buffer.getChannelData(0).slice();
	}
	const length = buffer.length;
	const output = new Float32Array(length);
	for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
		const data = buffer.getChannelData(channel);
		for (let i = 0; i < length; i += 1) {
			output[i] += data[i];
		}
	}
	for (let i = 0; i < length; i += 1) {
		output[i] /= buffer.numberOfChannels;
	}
	return output;
};

const resampleToTarget = async (
	samples: Float32Array,
	sourceRate: number,
): Promise<Float32Array> => {
	if (sourceRate === TARGET_SAMPLE_RATE) {
		return samples;
	}
	const OfflineAudioContextImpl =
		window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
	if (!OfflineAudioContextImpl) {
		return samples;
	}
	const duration = samples.length / sourceRate;
	const targetLength = Math.max(1, Math.round(duration * TARGET_SAMPLE_RATE));
	const context = new OfflineAudioContextImpl(
		1,
		targetLength,
		TARGET_SAMPLE_RATE,
	);
	const buffer = context.createBuffer(1, samples.length, sourceRate);
	// TS 的 TypedArray 泛型默认允许 SharedArrayBuffer，这里收窄到 ArrayBuffer 以满足 WebAudio API 签名。
	buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
	const source = context.createBufferSource();
	source.buffer = buffer;
	source.connect(context.destination);
	source.start(0);
	const rendered = await context.startRendering();
	return rendered.getChannelData(0);
};

const normalizeToken = (value: string): string => String(value ?? "").trim();

const isCjk = (value: string): boolean => {
	if (!value) return false;
	return CJK_RE.test(value);
};

const appendToken = (
	base: string,
	token: string,
	language: string,
): string => {
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

const createWordAssembler = (language: string) => {
	let currentId = "";
	let currentStart = 0;
	let currentEnd = 0;
	let currentText = "";
	let currentWords: TranscriptWord[] = [];
	const segments: TranscriptSegment[] = [];

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

const createWordStreamer = (
	language: string,
	onChunk: (segment: TranscriptSegment) => void,
) => {
	const assembler = createWordAssembler(language);
	const queue: Array<{ word: TranscriptWord | null; delayMs: number }> = [];
	const idleWaiters: Array<() => void> = [];
	let timerId: number | null = null;
	let running = false;
	const clampPace = (paceMs: number) => {
		return Math.min(
			STREAM_MAX_STEP_MS,
			Math.max(STREAM_MIN_STEP_MS, paceMs),
		);
	};

	const scheduleNext = (delayMs: number) => {
		timerId = window.setTimeout(flush, Math.max(0, delayMs));
	};

	const notifyIdle = () => {
		if (queue.length > 0 || timerId !== null || running) return;
		if (idleWaiters.length === 0) return;
		const waiters = idleWaiters.splice(0, idleWaiters.length);
		waiters.forEach((resolve) => resolve());
	};

	const flush = () => {
		timerId = null;
		if (queue.length === 0) {
			running = false;
			notifyIdle();
			return;
		}
		running = true;
		const item = queue.shift();
		if (item?.word) {
			const segment = assembler.pushWord(item.word);
			onChunk(segment);
		}
		scheduleNext(item?.delayMs ?? STREAM_DEFAULT_STEP_MS);
	};

	const pushSegment = (
		words: TranscriptWord[],
		options?: { paceMs?: number; initialDelayMs?: number },
	) => {
		if (words.length === 0) return;
		const paceMs = clampPace(options?.paceMs ?? STREAM_DEFAULT_STEP_MS);
		const initialDelayMs = Math.max(0, options?.initialDelayMs ?? 0);
		if (initialDelayMs > 0) {
			queue.push({ word: null, delayMs: initialDelayMs });
		}
		for (const word of words) {
			queue.push({ word, delayMs: paceMs });
		}
		if (!running && timerId === null) {
			scheduleNext(0);
		}
	};

	const dispose = () => {
		if (timerId !== null) {
			window.clearTimeout(timerId);
			timerId = null;
		}
		queue.length = 0;
		running = false;
		// 释放等待，避免悬挂
		notifyIdle();
	};

	return {
		pushSegment,
		getSegments: assembler.getSegments,
		waitForIdle: () =>
			new Promise<void>((resolve) => {
				if (queue.length === 0 && timerId === null && !running) {
					resolve();
					return;
				}
				idleWaiters.push(resolve);
			}),
		dispose,
	};
};

const normalizeWorkerWords = (
	words: WhisperWorkerWord[],
	startTime: number,
): TranscriptWord[] => {
	return words
		.filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end))
		.map((word) => ({
			id: createId("word"),
			text: word.text,
			start: word.start + startTime,
			end: word.end + startTime,
			...(word.confidence !== undefined
				? { confidence: word.confidence }
				: {}),
		}));
};

const createWorkerClient = async (
	model: AsrModelSize,
	language: string,
	signal: AbortSignal,
) => {
	const worker = new Worker(new URL("./whisperWorker.ts", import.meta.url), {
		type: "module",
	});

	const waitForInit = new Promise<void>((resolve, reject) => {
		const handleMessage = (event: MessageEvent<WhisperWorkerResponse>) => {
			if (event.data.type === "error") {
				worker.removeEventListener("message", handleMessage);
				reject(new Error(event.data.message));
				return;
			}
			if (event.data.type === "ready") {
				worker.removeEventListener("message", handleMessage);
				resolve();
			}
		};
		worker.addEventListener("message", handleMessage);
		worker.postMessage({ type: "init", model, language });
	});

	const waitForAbort = new Promise<never>((_, reject) => {
		signal.addEventListener(
			"abort",
			() => {
				worker.terminate();
				reject(new DOMException("已取消", "AbortError"));
			},
			{ once: true },
		);
	});

	try {
		await Promise.race([waitForInit, waitForAbort]);
	} catch (error) {
		worker.terminate();
		throw error;
	}

	const transcribe = (
		audio: Float32Array,
		startTime: number,
	): Promise<WhisperWorkerWord[]> => {
		return new Promise((resolve, reject) => {
			const handleMessage = (event: MessageEvent<WhisperWorkerResponse>) => {
				const payload = event.data;
				if (payload.type === "error") {
					cleanup();
					reject(new Error(payload.message));
					return;
				}
				if (payload.type === "result") {
					cleanup();
					resolve(payload.words);
				}
			};

			const handleError = (event: ErrorEvent) => {
				cleanup();
				reject(event.error ?? new Error("Worker 执行失败"));
			};

			const cleanup = () => {
				worker.removeEventListener("message", handleMessage);
				worker.removeEventListener("error", handleError);
			};

			worker.addEventListener("message", handleMessage);
			worker.addEventListener("error", handleError);
			worker.postMessage(
				{
					type: "transcribe",
					audio,
					startTime,
					sampleRate: TARGET_SAMPLE_RATE,
				},
				[audio.buffer],
			);
		});
	};

	const dispose = () => {
		worker.terminate();
	};

	return { transcribe, dispose };
};

const mergeVadSegments = (options: {
	segments: Array<{ start: number; end: number }>;
	totalMs: number;
}) => {
	const merged: Array<{ start: number; end: number }> = [];
	for (const segment of options.segments) {
		const start = Math.max(0, segment.start - VAD_PRE_PAD_MS);
		const end = Math.min(options.totalMs, segment.end + VAD_POST_PAD_MS);
		const last = merged[merged.length - 1];
		if (last && start - last.end <= VAD_MERGE_GAP_MS) {
			last.end = Math.max(last.end, end);
			continue;
		}
		merged.push({ start, end });
	}
	return merged;
};

const VAD_MODEL_URL =
	typeof window === "undefined"
		? "/silero_vad_legacy.onnx"
		: new URL("/silero_vad_legacy.onnx", window.location.href).toString();
const ORT_WASM_MJS_URL =
	typeof window === "undefined"
		? "/ort/ort-wasm-simd-threaded.jsep.mjs"
		: new URL(
				"/ort/ort-wasm-simd-threaded.jsep.mjs",
				window.location.href,
			).toString();
const ORT_WASM_URL =
	typeof window === "undefined"
		? "/ort/ort-wasm-simd-threaded.jsep.wasm"
		: new URL(
				"/ort/ort-wasm-simd-threaded.jsep.wasm",
				window.location.href,
			).toString();

export async function transcribeAudioFile(options: {
	file: File;
	language: string;
	model: AsrModelSize;
	duration?: number;
	onProgress: (progress: number) => void;
	onChunk: (segment: TranscriptSegment) => void;
	onStatus?: (status: string) => void;
	signal: AbortSignal;
}): Promise<{ segments: TranscriptSegment[] }> {
	const {
		file,
		language,
		model,
		onProgress,
		onChunk,
		onStatus,
		signal,
		duration,
	} = options;
	if (signal.aborted) {
		throw new DOMException("已取消", "AbortError");
	}
	const input = new Input({
		source: new BlobSource(file),
		formats: ALL_FORMATS,
	});
	const computedDuration = await input.computeDuration();
	const totalDurationRaw =
		Number.isFinite(computedDuration) && computedDuration > 0
			? computedDuration
			: duration && Number.isFinite(duration) && duration > 0
				? duration
				: 0;
	const totalDuration = totalDurationRaw > 0 ? totalDurationRaw : 1;

	const audioTrack = await input.getPrimaryAudioTrack();
	if (!audioTrack) {
		throw new Error("未找到音频轨道");
	}
	if (audioTrack.codec === null) {
		throw new Error("不支持的音频编解码器");
	}
	if (!(await audioTrack.canDecode())) {
		throw new Error("无法解码音频轨道");
	}

	const audioSink = new AudioBufferSink(audioTrack);
	const worker = await createWorkerClient(model, language, signal);
	let lastCommittedEnd = -Infinity;
	const streamer = createWordStreamer(language, onChunk);
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
		const estimatedMs = Math.min(
			8000,
			Math.max(1200, totalDuration * 40),
		);
		const start = performance.now();
		let stopped = false;
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
			if (stopped) return;
			stopped = true;
			window.clearInterval(timer);
			reportProgress(PREP_PROGRESS_RATIO);
		};
	};

	reportProgress(0);
	onStatus?.("转码音频");
	const stopPrepProgress = startPrepProgress();

	try {
		const chunks: Float32Array[] = [];
		let totalSamples = 0;
		for await (const wrappedBuffer of audioSink.buffers(0, totalDuration)) {
			if (signal.aborted) {
				throw new DOMException("已取消", "AbortError");
			}
			const buffer = wrappedBuffer?.buffer;
			if (!buffer) continue;
			const mono = mixToMono(buffer);
			const resampled = await resampleToTarget(mono, buffer.sampleRate);
			chunks.push(resampled);
			totalSamples += resampled.length;
		}
		const audio = new Float32Array(totalSamples);
		let offset = 0;
		for (const chunk of chunks) {
			audio.set(chunk, offset);
			offset += chunk.length;
		}

		onStatus?.("语音分段");
		const vad = await NonRealTimeVAD.new({
			modelURL: VAD_MODEL_URL,
			positiveSpeechThreshold: 0.45,
			negativeSpeechThreshold: 0.3,
			redemptionMs: 1000,
			preSpeechPadMs: 200,
			minSpeechMs: 300,
			ortConfig: (ort) => {
				if (ort?.env?.wasm) {
					ort.env.wasm.wasmPaths = {
						mjs: ORT_WASM_MJS_URL,
						wasm: ORT_WASM_URL,
					};
				}
				if (ort?.env) {
					// 降低日志级别，屏蔽 CPU vendor 警告噪音
					ort.env.logLevel = "error";
				}
			},
		});
		const vadSegments: Array<{ start: number; end: number }> = [];
		for await (const segment of vad.run(audio, TARGET_SAMPLE_RATE)) {
			vadSegments.push({ start: segment.start, end: segment.end });
		}
		const refinedSegments = mergeVadSegments({
			segments: vadSegments,
			totalMs: totalDuration * 1000,
		});
		// VAD 无结果时，回退到整段音频，避免无输出
		const segmentsToTranscribe =
			refinedSegments.length > 0
				? refinedSegments
				: [{ start: 0, end: totalDuration * 1000 }];

		let transcribeStarted = false;
		let lastPaceMs = STREAM_DEFAULT_STEP_MS;

		for (let i = 0; i < segmentsToTranscribe.length; i += 1) {
			if (signal.aborted) {
				throw new DOMException("已取消", "AbortError");
			}
			if (!transcribeStarted) {
				stopPrepProgress();
				onStatus?.("转写中");
				transcribeStarted = true;
			}
			const segment = segmentsToTranscribe[i];
			const startSample = Math.max(
				0,
				Math.floor((segment.start / 1000) * TARGET_SAMPLE_RATE),
			);
			const endSample = Math.min(
				audio.length,
				Math.ceil((segment.end / 1000) * TARGET_SAMPLE_RATE),
			);
			const slice = audio.subarray(
				startSample,
				Math.max(startSample + 1, endSample),
			);
			// 复制一份，避免 transfer 之后主线程的原始音频被 detach
			const sliceCopy = slice.slice();
			const startTime = segment.start / 1000;
			const endTime = segment.end / 1000;
			const workerWords = await worker.transcribe(sliceCopy, startTime);
			const normalized = normalizeWorkerWords(workerWords, startTime);
			const filtered = normalized.filter(
				(word) => word.end > lastCommittedEnd - DUPLICATE_WINDOW_SECONDS,
			);
			if (filtered.length === 0) continue;
			lastCommittedEnd = filtered[filtered.length - 1].end;
			const nextSegment = segmentsToTranscribe[i + 1];
			const gapMs = nextSegment
				? Math.max(0, nextSegment.start - segment.end)
				: 0;
			if (i === 0) {
				streamer.pushSegment(filtered, { paceMs: STREAM_DEFAULT_STEP_MS });
				lastPaceMs = STREAM_DEFAULT_STEP_MS;
			} else {
				const baseDurationMs = filtered.length * lastPaceMs;
				const paceAdjustMs = Math.min(800, gapMs * 0.6);
				const targetDurationMs = baseDurationMs + paceAdjustMs;
				const paceMs = targetDurationMs / Math.max(1, filtered.length);
				const initialDelayMs = Math.min(600, gapMs * 0.4);
				streamer.pushSegment(filtered, {
					paceMs,
					initialDelayMs,
				});
				lastPaceMs = paceMs;
			}
			reportTranscribeProgress(Math.min(1, endTime / totalDuration));
		}

		if (!transcribeStarted) {
			stopPrepProgress();
			onStatus?.("转写中");
			reportProgress(0.1);
		}
		if (!signal.aborted) {
			await streamer.waitForIdle();
		}
		reportProgress(1);
		return { segments: streamer.getSegments() };
	} catch (error) {
		throw error;
	} finally {
		stopPrepProgress();
		streamer.dispose();
		worker.dispose();
	}
}
