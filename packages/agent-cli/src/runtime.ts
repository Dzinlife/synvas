import {
	getCommandExamplesText,
	getCommandHelp,
	getCommandSchemaText,
} from "core/editor/command/help";
import { executePlanOnSnapshot } from "core/editor/command/postProcess";
import { isHistoryCommand, isMetaCommand } from "core/editor/command/reducer";
import { listCommands } from "core/editor/command/registry";
import {
	parseShellCommand,
	parseShellCommandBatch,
} from "core/editor/command/shellParser";
import { createPlannerStore } from "./planner";
import { rebasePlan } from "./rebaser";
import type {
	AgentCliHost,
	AgentCliRuntime,
	AgentCliRuntimeOptions,
	ApplyResult,
	DryRunChange,
	DryRunReport,
	ParsedCommand,
	PlanDraft,
	TimelineCommandSnapshot,
} from "./types";

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

const dryRunPlanInternal = (
	plan: PlanDraft,
	snapshot: TimelineCommandSnapshot,
	options?: AgentCliRuntimeOptions,
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
	const execution = executePlanOnSnapshot(plan.commands, snapshot, {
		resolveRole: options?.resolveRole,
	});
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

export const createAgentCliRuntime = (
	host: AgentCliHost,
	options?: AgentCliRuntimeOptions,
): AgentCliRuntime => {
	const planner = createPlannerStore();

	const executeHistoryCommand = (commandId: string): boolean => {
		if (commandId === "timeline.undo") {
			host.undo();
			return true;
		}
		if (commandId === "timeline.redo") {
			host.redo();
			return true;
		}
		return false;
	};

	return {
		listCommands() {
			return listCommands();
		},
		getCommandHelp(id?: string) {
			return getCommandHelp(id);
		},
		parseShellCommand(input: string) {
			return parseShellCommand(input);
		},
		parseShellCommandBatch(input: string) {
			return parseShellCommandBatch(input);
		},
		createPlan(commands: ParsedCommand[], context?: { baseRevision?: number }) {
			const baseRevision = context?.baseRevision ?? host.getRevision();
			return planner.createPlan(commands, { baseRevision });
		},
		getPlanDraft(planId: string) {
			return planner.getPlanDraft(planId);
		},
		dryRunPlan(plan: PlanDraft, snapshot?: TimelineCommandSnapshot): DryRunReport {
			const currentSnapshot = snapshot ?? host.getSnapshot();
			return dryRunPlanInternal(plan, currentSnapshot, options);
		},
		confirmPlan(planId: string) {
			return planner.confirmPlan(planId);
		},
		applyPlan(plan): ApplyResult {
			const baseSnapshot = host.getSnapshot();
			if (plan.baseRevision !== baseSnapshot.revision) {
				const rebasedPlan = planner.upsertPlanDraft(
					rebasePlan(plan, baseSnapshot.revision),
				);
				const report = dryRunPlanInternal(rebasedPlan, baseSnapshot, options);
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
				return {
					ok: true,
					revision: host.getRevision(),
					executed,
					summaryText: `已执行 ${executed} 条历史命令。`,
				};
			}

			const execution = executePlanOnSnapshot(plan.commands, baseSnapshot, {
				resolveRole: options?.resolveRole,
			});
			if (!execution.ok) {
				return {
					ok: false,
					revision: baseSnapshot.revision,
					executed: execution.executed,
					error: execution.error,
				};
			}

			const historyIndexBefore = host.getHistoryPastLength();
			if (execution.executed > 0) {
				host.applySnapshot(execution.snapshot, { history: true });
			}
			const historyIndexAfter = host.getHistoryPastLength();
			return {
				ok: true,
				revision: host.getRevision(),
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
		},
		executeMetaCommandText(command: ParsedCommand): string | null {
			if (!isMetaCommand(command.id)) return null;
			if (command.id === "help") {
				const id =
					typeof command.args.id === "string" ? command.args.id : undefined;
				return getCommandHelp(id).text;
			}
			if (command.id === "schema") {
				if (typeof command.args.id !== "string") {
					return "schema 命令缺少 --id 参数";
				}
				return getCommandSchemaText(command.args.id);
			}
			if (command.id === "examples") {
				if (typeof command.args.id !== "string") {
					return "examples 命令缺少 --id 参数";
				}
				return getCommandExamplesText(command.args.id);
			}
			return null;
		},
	};
};
