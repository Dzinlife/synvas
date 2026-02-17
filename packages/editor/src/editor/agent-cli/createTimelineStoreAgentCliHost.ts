import type { AgentCliHost, ParsedCommand } from "@ai-nle/agent-cli";
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

export const createTimelineStoreAgentCliHost = (): AgentCliHost => {
	return {
		getSnapshot() {
			return useTimelineStore.getState().getCommandSnapshot();
		},
		applySnapshot(snapshot, options) {
			useTimelineStore.getState().applyCommandSnapshot(snapshot, options);
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
			return Promise.resolve({
				ok: false,
				changed: false,
				error: `不支持的 runtime 命令: ${command.id}`,
			});
		},
	};
};
