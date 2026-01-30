import {
	ALL_FORMATS,
	AudioBufferSink,
	BlobSource,
	Input,
} from "mediabunny";
import type {
	AsrModelSize,
	TranscriptSegment,
	TranscriptWord,
	WhisperWorkerResponse,
	WhisperWorkerWord,
} from "./types";

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 30;
const STRIDE_SECONDS = 5;
const MIN_CHUNK_SECONDS = 5;
const DUPLICATE_WINDOW_SECONDS = 0.05;

const createId = (prefix: string): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

class SampleQueue {
	private chunks: Float32Array[] = [];
	length = 0;

	push(chunk: Float32Array) {
		if (chunk.length === 0) return;
		this.chunks.push(chunk);
		this.length += chunk.length;
	}

	peek(count: number): Float32Array {
		const size = Math.min(count, this.length);
		const output = new Float32Array(size);
		let offset = 0;
		for (const chunk of this.chunks) {
			if (offset >= size) break;
			const remaining = size - offset;
			if (chunk.length <= remaining) {
				output.set(chunk, offset);
				offset += chunk.length;
			} else {
				output.set(chunk.subarray(0, remaining), offset);
				offset += remaining;
			}
		}
		return output;
	}

	discard(count: number) {
		let remaining = Math.min(count, this.length);
		while (remaining > 0 && this.chunks.length > 0) {
			const head = this.chunks[0];
			if (head.length <= remaining) {
				remaining -= head.length;
				this.chunks.shift();
			} else {
				this.chunks[0] = head.subarray(remaining);
				remaining = 0;
			}
		}
		this.length -= Math.min(count, this.length);
	}
}

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
	buffer.copyToChannel(samples, 0);
	const source = context.createBufferSource();
	source.buffer = buffer;
	source.connect(context.destination);
	source.start(0);
	const rendered = await context.startRendering();
	return rendered.getChannelData(0);
};

const buildSegmentText = (words: TranscriptWord[]): string => {
	return words.map((word) => word.text).join("").replace(/\s+/g, " ").trim();
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

export async function transcribeAudioFile(options: {
	file: File;
	language: string;
	model: AsrModelSize;
	duration?: number;
	onProgress: (progress: number) => void;
	onChunk: (segment: TranscriptSegment) => void;
	signal: AbortSignal;
}): Promise<{ segments: TranscriptSegment[] }> {
	const { file, language, model, onProgress, onChunk, signal, duration } =
		options;
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

	const queue = new SampleQueue();
	const chunkSamples = Math.round(CHUNK_SECONDS * TARGET_SAMPLE_RATE);
	const strideSamples = Math.round(STRIDE_SECONDS * TARGET_SAMPLE_RATE);
	const stepSamples = Math.max(1, chunkSamples - strideSamples);
	const minChunkSamples = Math.round(MIN_CHUNK_SECONDS * TARGET_SAMPLE_RATE);
	let processedSamples = 0;
	let lastCommittedEnd = -Infinity;
	const segments: TranscriptSegment[] = [];

	const pushSegment = (words: TranscriptWord[]) => {
		if (words.length === 0) return;
		const segment: TranscriptSegment = {
			id: createId("segment"),
			start: words[0].start,
			end: words[words.length - 1].end,
			text: buildSegmentText(words),
			words,
		};
		segments.push(segment);
		onChunk(segment);
	};

	const runChunk = async (samples: Float32Array, startTime: number) => {
		const workerWords = await worker.transcribe(samples, startTime);
		const normalized = normalizeWorkerWords(workerWords, startTime);
		const filtered = normalized.filter(
			(word) => word.end > lastCommittedEnd - DUPLICATE_WINDOW_SECONDS,
		);
		if (filtered.length === 0) return;
		lastCommittedEnd = filtered[filtered.length - 1].end;
		pushSegment(filtered);
	};

	try {
		for await (const wrappedBuffer of audioSink.buffers(0, totalDuration)) {
			if (signal.aborted) {
				throw new DOMException("已取消", "AbortError");
			}
			const buffer = wrappedBuffer?.buffer;
			if (!buffer) continue;
			const mono = mixToMono(buffer);
			const resampled = await resampleToTarget(mono, buffer.sampleRate);
			queue.push(resampled);

			while (queue.length >= chunkSamples) {
				if (signal.aborted) {
					throw new DOMException("已取消", "AbortError");
				}
				const chunk = queue.peek(chunkSamples);
				const startTime = processedSamples / TARGET_SAMPLE_RATE;
				await runChunk(chunk, startTime);
				queue.discard(stepSamples);
				processedSamples += stepSamples;
				onProgress(
					Math.min(1, (processedSamples / TARGET_SAMPLE_RATE) / totalDuration),
				);
			}
		}

		if (queue.length >= minChunkSamples) {
			const tail = queue.peek(queue.length);
			const startTime = processedSamples / TARGET_SAMPLE_RATE;
			await runChunk(tail, startTime);
		}

		onProgress(1);
		worker.dispose();
		return { segments };
	} catch (error) {
		worker.dispose();
		throw error;
	}
}
