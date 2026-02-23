import type { TimelineAsset } from "core/dsl/types";
import { readVideoMetadata } from "@/editor/utils/externalVideo";
import type { AsrClient } from "./AsrContext";
import { resolveAssetMediaFile } from "./assetMediaFile";
import { readAudioMetadata } from "./opfsAudio";
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

const resolveAssetKind = (
	asset: TimelineAsset,
): "video" | "audio" => {
	if (asset.kind === "video" || asset.kind === "audio") {
		return asset.kind;
	}
	throw new Error(`当前 asset kind 不支持转写: ${asset.kind}`);
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
	assetKind: "video" | "audio";
	file: File;
}): Promise<number> => {
	const { assetKind, file } = options;
	if (assetKind === "audio") {
		const metadata = await readAudioMetadata(file);
		return metadata.duration;
	}
	const metadata = await readVideoMetadata(file);
	return metadata.duration;
};

export interface TranscribeAssetByIdOptions {
	assetId: string;
	asrClient: AsrClient;
	language?: string;
	force?: boolean;
	model?: AsrModelSize;
	signal: AbortSignal;
	getProjectAssetById: (assetId: string) => TimelineAsset | null;
	updateProjectAssetMeta: (
		assetId: string,
		updater: (
			prevMeta: TimelineAsset["meta"] | undefined,
		) => TimelineAsset["meta"] | undefined,
	) => void;
	onStatus?: (status: AsrJobStatus) => void;
	onProgress?: (progress: number) => void;
	onChunk?: (segment: TranscriptSegment) => void;
}

export interface TranscribeAssetByIdResult {
	status: "done" | "canceled" | "skipped";
	changed: boolean;
	summaryText: string;
	record: TranscriptRecord | null;
	backend?: "gpu" | "cpu";
	durationMs?: number;
}

export const transcribeAssetById = async (
	options: TranscribeAssetByIdOptions,
): Promise<TranscribeAssetByIdResult> => {
	const {
		assetId,
		asrClient,
		signal,
		getProjectAssetById,
		updateProjectAssetMeta,
		onStatus,
		onProgress,
		onChunk,
	} = options;
	const language = options.language?.trim() || "auto";
	const force = options.force === true;
	const model = options.model ?? resolveDefaultModel();

	const asset = getProjectAssetById(assetId);
	if (!asset) {
		throw new Error(`未找到 asset: ${assetId}`);
	}
	const assetKind = resolveAssetKind(asset);
	const existedRecord = asset.meta?.asr ?? null;
	if (existedRecord && !force) {
		return {
			status: "skipped",
			changed: false,
			summaryText: "当前 asset 已有转写，已跳过。",
			record: existedRecord,
		};
	}

	const { file, fileName } = await resolveAssetMediaFile(asset);
	const duration = await resolveDuration({ assetKind, file });
	const now = Date.now();
	const transcriptId = createId("transcript");
	const baseRecord: TranscriptRecord = {
		id: transcriptId,
		source: {
			type: "asset",
			assetId: asset.id,
			kind: assetKind,
			uri: asset.uri,
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
		updateProjectAssetMeta(
			assetId,
			(prevData) => ({
				...(prevData ?? {}),
				asr: {
					...baseRecord,
					segments,
					updatedAt,
				},
			}),
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
		const currentRecord = getProjectAssetById(assetId)?.meta?.asr ?? null;
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
			const currentRecord = getProjectAssetById(assetId)?.meta?.asr ?? null;
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
