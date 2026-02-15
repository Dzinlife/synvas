import type {
	ApplyResult,
	ConfirmedPlan,
	DryRunChange,
	DryRunReport,
	ParsedCommand,
	PlanDraft,
} from "./types";
import { getPlanDraft, upsertPlanDraft } from "./planner";
import { rebasePlan } from "./rebaser";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import {
	applyTimelineCommandToSnapshot,
	isHistoryCommand,
	isMetaCommand,
	type TimelineCommandSnapshot,
} from "@/editor/contexts/timelineCommandAdapters";
import { createTrackLockedMap } from "@/editor/contexts/timelineMoveEngine";
import { findAttachments } from "@/editor/utils/attachments";
import { pruneAudioTrackStates } from "@/editor/utils/audioTrackStatePrune";
import { finalizeTimelineElements } from "@/editor/utils/mainTrackMagnet";
import { reconcileTracks } from "@/editor/utils/trackState";

interface SnapshotExecutionResult {
	ok: boolean;
	executed: number;
	snapshot: TimelineCommandSnapshot;
	error?: string;
}

const hasSnapshotStateChange = (
	prev: TimelineCommandSnapshot,
	next: TimelineCommandSnapshot,
): boolean => {
	return (
		prev.currentTime !== next.currentTime ||
		prev.elements !== next.elements ||
		prev.tracks !== next.tracks ||
		prev.audioTrackStates !== next.audioTrackStates ||
		prev.autoAttach !== next.autoAttach ||
		prev.rippleEditingEnabled !== next.rippleEditingEnabled
	);
};

const postProcessSnapshot = (
	snapshot: TimelineCommandSnapshot,
): TimelineCommandSnapshot => {
	const trackLockedMap = createTrackLockedMap(
		snapshot.tracks,
		snapshot.audioTrackStates,
	);
	const finalizedElements = finalizeTimelineElements(snapshot.elements, {
		rippleEditingEnabled: snapshot.rippleEditingEnabled,
		attachments: findAttachments(snapshot.elements),
		autoAttach: snapshot.autoAttach,
		fps: snapshot.fps,
		trackLockedMap,
	});
	const reconcileResult = reconcileTracks(finalizedElements, snapshot.tracks);
	const nextAudioTrackStates = pruneAudioTrackStates(
		reconcileResult.elements,
		snapshot.audioTrackStates,
	);
	if (
		finalizedElements === snapshot.elements &&
		reconcileResult.tracks === snapshot.tracks &&
		reconcileResult.elements === snapshot.elements &&
		nextAudioTrackStates === snapshot.audioTrackStates
	) {
		return snapshot;
	}
	return {
		...snapshot,
		elements: reconcileResult.elements,
		tracks: reconcileResult.tracks,
		audioTrackStates: nextAudioTrackStates,
	};
};

const executePlanOnSnapshot = (
	commands: ParsedCommand[],
	baseSnapshot: TimelineCommandSnapshot,
): SnapshotExecutionResult => {
	let snapshot = baseSnapshot;
	let executed = 0;
	for (const command of commands) {
		const beforeCommand = snapshot;
		const result = applyTimelineCommandToSnapshot(snapshot, command);
		if (!result.ok) {
			return {
				ok: false,
				executed,
				snapshot,
				error: result.error,
			};
		}
		let nextSnapshot = result.snapshot;
		if (!isMetaCommand(command.id) && !isHistoryCommand(command.id)) {
			nextSnapshot = postProcessSnapshot(nextSnapshot);
		}
		snapshot = nextSnapshot;
		if (hasSnapshotStateChange(beforeCommand, nextSnapshot)) {
			executed += 1;
		}
	}
	return {
		ok: true,
		executed,
		snapshot,
	};
};

const buildChanges = (
	before: TimelineCommandSnapshot,
	after: TimelineCommandSnapshot,
): DryRunChange[] => {
	const changes: DryRunChange[] = [];
	if (before.elements !== after.elements) {
		changes.push({
			field: "elements",
			before: `${before.elements.length}`,
			after: `${after.elements.length}`,
		});
	}
	if (before.tracks !== after.tracks) {
		changes.push({
			field: "tracks",
			before: `${before.tracks.length}`,
			after: `${after.tracks.length}`,
		});
	}
	if (before.audioTrackStates !== after.audioTrackStates) {
		changes.push({
			field: "audioTrackStates",
			before: JSON.stringify(before.audioTrackStates),
			after: JSON.stringify(after.audioTrackStates),
		});
	}
	if (before.currentTime !== after.currentTime) {
		changes.push({
			field: "currentTime",
			before: `${before.currentTime}`,
			after: `${after.currentTime}`,
		});
	}
	if (before.rippleEditingEnabled !== after.rippleEditingEnabled) {
		changes.push({
			field: "rippleEditingEnabled",
			before: `${before.rippleEditingEnabled}`,
			after: `${after.rippleEditingEnabled}`,
		});
	}
	if (before.autoAttach !== after.autoAttach) {
		changes.push({
			field: "autoAttach",
			before: `${before.autoAttach}`,
			after: `${after.autoAttach}`,
		});
	}
	return changes;
};

export const dryRunPlan = (
	plan: PlanDraft,
	snapshot: TimelineCommandSnapshot,
): DryRunReport => {
	const hasHistoryCommand = plan.commands.some((command) =>
		isHistoryCommand(command.id),
	);
	if (hasHistoryCommand) {
		return {
			ok: true,
			summaryText: "历史命令将在 apply 阶段执行，dry-run 不修改快照。",
			changes: [],
		};
	}
	const execution = executePlanOnSnapshot(plan.commands, snapshot);
	if (!execution.ok) {
		return {
			ok: false,
			summaryText: "Dry-run 失败",
			changes: [],
			error: execution.error,
		};
	}
	const changes = buildChanges(snapshot, execution.snapshot);
	const summaryText =
		execution.executed > 0
			? `Dry-run 成功，预计执行 ${execution.executed} 条状态变更命令。`
			: "Dry-run 成功，无状态变更。";
	return {
		ok: true,
		summaryText,
		changes,
	};
};

export const confirmPlan = (planId: string): ConfirmedPlan | null => {
	const draft = getPlanDraft(planId);
	if (!draft) return null;
	return {
		...draft,
		confirmedAt: Date.now(),
	};
};

const executeHistoryCommand = (commandId: string): boolean => {
	const state = useTimelineStore.getState();
	if (commandId === "timeline.undo") {
		state.undo();
		return true;
	}
	if (commandId === "timeline.redo") {
		state.redo();
		return true;
	}
	return false;
};

export const applyPlan = (plan: ConfirmedPlan): ApplyResult => {
	const stateBefore = useTimelineStore.getState();
	const baseSnapshot = stateBefore.getCommandSnapshot();
	if (plan.baseRevision !== baseSnapshot.revision) {
		const rebasedPlan = upsertPlanDraft(rebasePlan(plan, baseSnapshot.revision));
		const report = dryRunPlan(rebasedPlan, baseSnapshot);
		return {
			ok: false,
			revision: baseSnapshot.revision,
			executed: 0,
			rebaseRequired: true,
			rebasedFromRevision: plan.baseRevision,
			plan: rebasedPlan,
			summaryText: report.summaryText,
			error: report.error,
		};
	}

	const hasHistoryCommand = plan.commands.some((command) =>
		isHistoryCommand(command.id),
	);
	if (hasHistoryCommand && plan.commands.length > 1) {
		return {
			ok: false,
			revision: baseSnapshot.revision,
			executed: 0,
			error: "timeline.undo/redo 不能与其他命令混合批量执行",
		};
	}

	if (hasHistoryCommand) {
		let executed = 0;
		for (const command of plan.commands) {
			if (executeHistoryCommand(command.id)) {
				executed += 1;
			}
		}
		const stateAfterHistory = useTimelineStore.getState();
		return {
			ok: true,
			revision: stateAfterHistory.revision,
			executed,
			summaryText: `已执行 ${executed} 条历史命令。`,
		};
	}

	const execution = executePlanOnSnapshot(plan.commands, baseSnapshot);
	if (!execution.ok) {
		return {
			ok: false,
			revision: baseSnapshot.revision,
			executed: execution.executed,
			error: execution.error,
		};
	}

	const historyIndexBefore = stateBefore.historyPast.length;
	if (execution.executed > 0) {
		useTimelineStore
			.getState()
			.applyCommandSnapshot(execution.snapshot, { history: true });
	}

	const stateAfter = useTimelineStore.getState();
	const historyIndexAfter = stateAfter.historyPast.length;
	return {
		ok: true,
		revision: stateAfter.revision,
		executed: execution.executed,
		undoToken: {
			historyIndexBefore,
			historyIndexAfter,
		},
		summaryText:
			execution.executed > 0
				? `执行完成，共 ${execution.executed} 条命令已生效。`
				: "执行完成，无状态变化。",
	};
};

export const executeMetaCommandText = (
	command: ParsedCommand,
	resolver: {
		help: (id?: string) => string;
		schema: (id: string) => string;
		examples: (id: string) => string;
	},
): string | null => {
	if (!isMetaCommand(command.id)) return null;
	if (command.id === "help") {
		const id = typeof command.args.id === "string" ? command.args.id : undefined;
		return resolver.help(id);
	}
	if (command.id === "schema") {
		if (typeof command.args.id !== "string") {
			return "schema 命令缺少 --id 参数";
		}
		return resolver.schema(command.args.id);
	}
	if (command.id === "examples") {
		if (typeof command.args.id !== "string") {
			return "examples 命令缺少 --id 参数";
		}
		return resolver.examples(command.args.id);
	}
	return null;
};
