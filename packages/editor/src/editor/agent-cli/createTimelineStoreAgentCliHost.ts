import type { AgentCliHost, ParsedCommand } from "@ai-nle/agent-cli";
import type { AsrClient } from "@/asr";
import { isSupportedAssetMediaUri, transcribeAssetById } from "@/asr";
import { useTimelineStore } from "../contexts/TimelineContext";
import {
	analyzeVideoChangeForElement,
	applyQuickSplitFrames,
	isQuickSplitCandidateElement,
	QUICK_SPLIT_DEFAULTS,
	type QuickSplitMode,
} from "../components/timelineQuickSplit";

const toFiniteNumber = (value: unknown): number | null => {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return value;
};

const toStringValue = (value: unknown): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const toBooleanValue = (value: unknown): boolean | null => {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "1") return true;
	if (normalized === "false" || normalized === "0") return false;
	return null;
};

const normalizeQuickSplitMode = (value: unknown): QuickSplitMode => {
	if (value === "fast" || value === "fine") return value;
	return "balanced";
};

const executeQuickSplitCommand = async (command: ParsedCommand) => {
	const id = toStringValue(command.args.id);
	if (!id) {
		return {
			ok: false,
			changed: false,
			error: "timeline.element.quick-split 缺少 --id 参数",
		};
	}

	const snapshot = useTimelineStore.getState().getCommandSnapshot();
	const target = snapshot.elements.find((element) => element.id === id);
	if (!isQuickSplitCandidateElement(target)) {
		return {
			ok: false,
			changed: false,
			error: `未找到可分割的视频片段: ${id}`,
		};
	}

	const sensitivity =
		toFiniteNumber(command.args.sensitivity) ??
		QUICK_SPLIT_DEFAULTS.sensitivity;
	const minSegmentSeconds =
		toFiniteNumber(command.args.minSegmentSeconds) ??
		QUICK_SPLIT_DEFAULTS.minSegmentSeconds;
	const mode = normalizeQuickSplitMode(command.args.mode);

	const analysis = await analyzeVideoChangeForElement({
		element: target,
		fps: snapshot.fps,
		sensitivity,
		minSegmentSeconds,
		mode,
	});
	if (analysis.splitFrames.length === 0) {
		return {
			ok: true,
			changed: false,
			summaryText: "快速分割完成，未检测到明显变化切点。",
		};
	}

	const nextElements = applyQuickSplitFrames({
		elements: snapshot.elements,
		targetId: id,
		splitFrames: analysis.splitFrames,
		fps: snapshot.fps,
	});
	if (nextElements === snapshot.elements) {
		return {
			ok: true,
			changed: false,
			summaryText: "快速分割完成，无状态变化。",
		};
	}

	useTimelineStore.getState().applyCommandSnapshot(
		{
			...snapshot,
			elements: nextElements,
		},
		{ history: true },
	);
	return {
		ok: true,
		changed: true,
		summaryText: `快速分割完成，新增 ${analysis.splitFrames.length} 个切点。`,
	};
};

const executeTranscribeCommand = async (
	command: ParsedCommand,
	asrClient: AsrClient | undefined,
) => {
	if (!asrClient) {
		return {
			ok: false,
			changed: false,
			error: "当前 host 未注入 ASR 客户端",
		};
	}

	const id = toStringValue(command.args.id);
	if (!id) {
		return {
			ok: false,
			changed: false,
			error: "timeline.element.transcribe 缺少 --id 参数",
		};
	}

	const snapshot = useTimelineStore.getState().getCommandSnapshot();
	const target = snapshot.elements.find((element) => element.id === id);
	if (!target || (target.type !== "VideoClip" && target.type !== "AudioClip")) {
		return {
			ok: false,
			changed: false,
			error: `目标元素不是可转写片段: ${id}`,
		};
	}

	const assetId = target.assetId;
	if (!assetId) {
		return {
			ok: false,
			changed: false,
			error: `目标片段缺少 assetId: ${id}`,
		};
	}
	const asset = snapshot.assets.find((item) => item.id === assetId);
	if (!asset) {
		return {
			ok: false,
			changed: false,
			error: `未找到目标 asset: ${assetId}`,
		};
	}
	if (asset.kind !== "video" && asset.kind !== "audio") {
		return {
			ok: false,
			changed: false,
			error: `目标 asset 类型不支持转写: ${asset.kind}`,
		};
	}
	if (!isSupportedAssetMediaUri(asset.uri)) {
		return {
			ok: false,
			changed: false,
			error: `目标 asset URI 不支持转写: ${asset.uri}`,
		};
	}

	const language = toStringValue(command.args.language) ?? "auto";
	const force = toBooleanValue(command.args.force) ?? false;
	if (!force && asset.meta?.asr) {
		return {
			ok: true,
			changed: false,
			summaryText: "当前 asset 已有转写，已跳过。",
		};
	}

	const controller = new AbortController();
	const result = await transcribeAssetById({
		assetId,
		asrClient,
		language,
		force,
		signal: controller.signal,
	});
	if (result.status === "skipped") {
		return {
			ok: true,
			changed: false,
			summaryText: result.summaryText,
		};
	}
	return {
		ok: true,
		changed: result.changed,
		summaryText: result.summaryText,
	};
};

export interface CreateTimelineStoreAgentCliHostOptions {
	asrClient?: AsrClient;
}

export const createTimelineStoreAgentCliHost = (
	options?: CreateTimelineStoreAgentCliHostOptions,
): AgentCliHost => {
	return {
		getSnapshot() {
			return useTimelineStore.getState().getCommandSnapshot();
		},
		applySnapshot(snapshot, applyOptions) {
			useTimelineStore.getState().applyCommandSnapshot(snapshot, applyOptions);
		},
		getRevision() {
			return useTimelineStore.getState().getRevision();
		},
		getHistoryPastLength() {
			return useTimelineStore.getState().historyPast.length;
		},
		undo() {
			useTimelineStore.getState().undo();
		},
		redo() {
			useTimelineStore.getState().redo();
		},
		executeRuntimeCommand(command) {
			if (command.id === "timeline.element.quick-split") {
				return executeQuickSplitCommand(command);
			}
			if (command.id === "timeline.element.transcribe") {
				return executeTranscribeCommand(command, options?.asrClient);
			}
			return Promise.resolve({
				ok: false,
				changed: false,
				error: `不支持的 runtime 命令: ${command.id}`,
			});
		},
	};
};
