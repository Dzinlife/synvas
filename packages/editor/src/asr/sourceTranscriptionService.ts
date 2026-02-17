import type { TimelineSource } from "core/dsl/types";
import { readVideoMetadata } from "@/editor/utils/externalVideo";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import type { AsrClient } from "./AsrContext";
import { readAudioMetadata } from "./opfsAudio";
import { resolveSourceMediaFile } from "./sourceMediaFile";
import type {
	AsrJobStatus,
	AsrModelSize,
	TranscriptRecord,
	TranscriptSegment,
} from "./types";

const createId = (prefix: string): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const resolveDefaultModel = (): AsrModelSize => {
	const isElectron = typeof window !== "undefined" && "aiNleElectron" in window;
	return isElectron ? "large-v3-turbo" : "tiny";
};

const resolveSourceKind = (
	source: TimelineSource,
): "video" | "audio" => {
	if (source.kind === "video" || source.kind === "audio") {
		return source.kind;
	}
	throw new Error(`当前 source kind 不支持转写: ${source.kind}`);
};

const upsertSegment = (
	segments: TranscriptSegment[],
	segment: TranscriptSegment,
): TranscriptSegment[] => {
	const index = segments.findIndex((item) => item.id === segment.id);
	if (index < 0) {
		return [...segments, segment];
	}
	const next = [...segments];
	next[index] = segment;
	return next;
};

const resolveDuration = async (options: {
	sourceKind: "video" | "audio";
	file: File;
}): Promise<number> => {
	const { sourceKind, file } = options;
	if (sourceKind === "audio") {
		const metadata = await readAudioMetadata(file);
		return metadata.duration;
	}
	const metadata = await readVideoMetadata(file);
	return metadata.duration;
};

export interface TranscribeSourceByIdOptions {
	sourceId: string;
	asrClient: AsrClient;
	language?: string;
	force?: boolean;
	model?: AsrModelSize;
	signal: AbortSignal;
	onStatus?: (status: AsrJobStatus) => void;
	onProgress?: (progress: number) => void;
	onChunk?: (segment: TranscriptSegment) => void;
}

export interface TranscribeSourceByIdResult {
	status: "done" | "canceled" | "skipped";
	changed: boolean;
	summaryText: string;
	record: TranscriptRecord | null;
	backend?: "gpu" | "cpu";
	durationMs?: number;
}

export const transcribeSourceById = async (
	options: TranscribeSourceByIdOptions,
): Promise<TranscribeSourceByIdResult> => {
	const {
		sourceId,
		asrClient,
		signal,
		onStatus,
		onProgress,
		onChunk,
	} = options;
	const language = options.language?.trim() || "auto";
	const force = options.force === true;
	const model = options.model ?? resolveDefaultModel();

	const source = useTimelineStore.getState().getSourceById(sourceId);
	if (!source) {
		throw new Error(`未找到 source: ${sourceId}`);
	}
	const sourceKind = resolveSourceKind(source);
	const existedRecord = source.data?.asr ?? null;
	if (existedRecord && !force) {
		return {
			status: "skipped",
			changed: false,
			summaryText: "当前 source 已有转写，已跳过。",
			record: existedRecord,
		};
	}

	const { file, fileName } = await resolveSourceMediaFile(source);
	const duration = await resolveDuration({ sourceKind, file });
	const now = Date.now();
	const transcriptId = createId("transcript");
	const baseRecord: TranscriptRecord = {
		id: transcriptId,
		source: {
			type: "timeline-source",
			sourceId: source.id,
			kind: sourceKind,
			uri: source.uri,
			fileName,
			duration,
		},
		language,
		model,
		createdAt: now,
		updatedAt: now,
		segments: [],
	};

	let changed = false;
	let latestSegments: TranscriptSegment[] = [];
	const delaySwapUntilFirstChunk = existedRecord !== null && force;

	const writeRecord = (segments: TranscriptSegment[]) => {
		latestSegments = segments;
		const updatedAt = Date.now();
		useTimelineStore.getState().updateSourceData(
			sourceId,
			(prevData) => ({
				...(prevData ?? {}),
				asr: {
					...baseRecord,
					segments,
					updatedAt,
				},
			}),
			{ history: false },
		);
		changed = true;
	};

	if (!delaySwapUntilFirstChunk) {
		writeRecord([]);
	}

	try {
		onStatus?.("loading");
		await asrClient.ensureReady?.({
			model,
			language,
			signal,
		});
		onStatus?.("running");

		const result = await asrClient.transcribeAudioFile({
			file,
			language,
			model,
			duration,
			signal,
			onProgress: (progress) => {
				onProgress?.(progress);
			},
			onChunk: (segment: TranscriptSegment) => {
				onChunk?.(segment);
				const nextSegments = upsertSegment(latestSegments, segment);
				writeRecord(nextSegments);
			},
		});

		const finalSegments =
			result.segments.length > 0 ? result.segments : latestSegments;
		if (finalSegments.length > 0) {
			writeRecord(finalSegments);
		}

		onStatus?.("done");
		const currentRecord = useTimelineStore.getState().getSourceById(sourceId)?.data?.asr ?? null;
		return {
			status: "done",
			changed,
			summaryText:
				finalSegments.length > 0
					? `转写完成，共 ${finalSegments.length} 段。`
					: "转写完成，未产出文本。",
			record: currentRecord,
			backend: result.backend,
			durationMs: result.durationMs,
		};
	} catch (error) {
		if (signal.aborted) {
			onStatus?.("canceled");
			const currentRecord = useTimelineStore
				.getState()
				.getSourceById(sourceId)?.data?.asr ?? null;
			return {
				status: "canceled",
				changed,
				summaryText: changed
					? "转写已取消，已保留当前结果。"
					: "转写已取消。",
				record: currentRecord,
			};
		}
		onStatus?.("error");
		throw error;
	}
};
