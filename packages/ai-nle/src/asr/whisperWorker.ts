import { pipeline } from "@xenova/transformers";
import type {
	AsrModelSize,
	WhisperWorkerMessage,
	WhisperWorkerResponse,
	WhisperWorkerWord,
} from "./types";

const MODEL_MAP: Record<AsrModelSize, string> = {
	tiny: "Xenova/whisper-tiny",
	small: "Xenova/whisper-small",
	medium: "Xenova/whisper-medium",
};

let asrPipeline: any = null;
let currentModel: AsrModelSize | null = null;
let currentLanguage = "";

const toNumber = (value: unknown): number => {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const normalizeWords = (output: any, duration: number): WhisperWorkerWord[] => {
	const rawChunks =
		(Array.isArray(output?.chunks) && output.chunks) ||
		(Array.isArray(output?.words) && output.words) ||
		[];

	if (Array.isArray(rawChunks) && rawChunks.length > 0) {
		return rawChunks
			.map((chunk: any) => {
				const timestamp =
					chunk?.timestamp ?? chunk?.timestamps ?? chunk?.time ?? [];
				const start = toNumber(Array.isArray(timestamp) ? timestamp[0] : 0);
				const end = toNumber(Array.isArray(timestamp) ? timestamp[1] : 0);
				if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
				return {
					text: String(chunk?.text ?? ""),
					start,
					end,
					confidence:
						Number.isFinite(chunk?.confidence)
							? chunk.confidence
							: Number.isFinite(chunk?.score)
								? chunk.score
								: undefined,
				} satisfies WhisperWorkerWord;
			})
			.filter(Boolean) as WhisperWorkerWord[];
	}

	if (typeof output?.text === "string" && output.text.trim()) {
		return [
			{
				text: output.text,
				start: 0,
				end: Math.max(0, duration),
			},
		];
	}

	return [];
};

const initPipeline = async (model: AsrModelSize, language: string) => {
	if (!asrPipeline || model !== currentModel) {
		asrPipeline = await pipeline(
			"automatic-speech-recognition",
			MODEL_MAP[model],
		);
		currentModel = model;
	}
	currentLanguage = language;
};

self.onmessage = async (event: MessageEvent<WhisperWorkerMessage>) => {
	const data = event.data;
	try {
		if (data.type === "init") {
			await initPipeline(data.model, data.language);
			self.postMessage({ type: "ready" } satisfies WhisperWorkerResponse);
			return;
		}

		if (data.type === "transcribe") {
			if (!asrPipeline) {
				await initPipeline("small", currentLanguage || "auto");
			}
			const audio = data.audio;
			const output = await asrPipeline(audio, {
				return_timestamps: "word",
				language: currentLanguage || "auto",
				task: "transcribe",
			});
			const duration = audio.length / data.sampleRate;
			const words = normalizeWords(output, duration);
			self.postMessage({
				type: "result",
				startTime: data.startTime,
				words,
			} satisfies WhisperWorkerResponse);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		self.postMessage({ type: "error", message } satisfies WhisperWorkerResponse);
	}
};
