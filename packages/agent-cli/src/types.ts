import type {
	CommandDescriptor,
	CommandHelpDoc,
	ParsedCommand,
	ParsedCommandError,
	TimelineCommandSnapshot,
} from "core/editor/command/types";
import type { ResolveRole } from "core/editor/utils/trackAssignment";

export type {
	CommandDescriptor,
	CommandHelpDoc,
	ParsedCommand,
	ParsedCommandError,
	TimelineCommandSnapshot,
};

export interface PlanContext {
	baseRevision: number;
}

export interface PlanDraft {
	id: string;
	baseRevision: number;
	commands: ParsedCommand[];
	summaryText: string;
}

export interface DryRunChange {
	field: string;
	before: string;
	after: string;
}

export interface DryRunReport {
	ok: boolean;
	summaryText: string;
	changes: DryRunChange[];
	rebasedFromRevision?: number;
	error?: string;
}

export interface ConfirmedPlan extends PlanDraft {
	confirmedAt: number;
}

export interface UndoToken {
	historyIndexBefore: number;
	historyIndexAfter: number;
}

export interface ApplyResult {
	ok: boolean;
	revision: number;
	executed: number;
	undoToken?: UndoToken;
	rebasedFromRevision?: number;
	rebaseRequired?: boolean;
	plan?: PlanDraft;
	summaryText?: string;
	error?: string;
}

export interface RuntimeCommandResult {
	ok: boolean;
	changed: boolean;
	summaryText?: string;
	error?: string;
}

export interface AgentCliHost {
	getSnapshot(): TimelineCommandSnapshot;
	applySnapshot(
		snapshot: TimelineCommandSnapshot,
		options?: { history?: boolean },
	): void;
	getRevision(): number;
	getHistoryPastLength(): number;
	undo(): void;
	redo(): void;
	executeRuntimeCommand?: (
		command: ParsedCommand,
	) => Promise<RuntimeCommandResult>;
}

export interface AgentCliRuntime {
	listCommands(): CommandDescriptor[];
	getCommandHelp(id?: string): CommandHelpDoc;
	parseShellCommand(input: string): ParsedCommand | ParsedCommandError;
	parseShellCommandBatch(input: string): {
		commands: ParsedCommand[];
		errors: ParsedCommandError[];
	};
	createPlan(commands: ParsedCommand[], context?: { baseRevision?: number }): PlanDraft;
	getPlanDraft(planId: string): PlanDraft | undefined;
	dryRunPlan(plan: PlanDraft, snapshot?: TimelineCommandSnapshot): DryRunReport;
	confirmPlan(planId: string): ConfirmedPlan | null;
	applyPlan(plan: ConfirmedPlan): ApplyResult;
	applyPlanAsync(plan: ConfirmedPlan): Promise<ApplyResult>;
	executeMetaCommandText(command: ParsedCommand): string | null;
}

export interface AgentCliRuntimeOptions {
	resolveRole?: ResolveRole;
}
