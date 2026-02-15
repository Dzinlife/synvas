export type CommandMode = "state" | "runtime";

export type CommandSchemaValueType =
	| "string"
	| "number"
	| "boolean"
	| "object"
	| "array";

export interface CommandSchemaProperty {
	type: CommandSchemaValueType;
	description: string;
	required?: boolean;
}

export interface CommandSchema {
	type: "object";
	properties: Record<string, CommandSchemaProperty>;
	required?: string[];
}

export interface CommandDescriptor {
	id: string;
	summary: string;
	mode: CommandMode;
	schema: CommandSchema;
	examples: string[];
	requiresShell: false;
}

export interface ParsedCommand {
	id: string;
	args: Record<string, unknown>;
	raw: string;
}

export interface ParsedCommandError {
	ok: false;
	error: string;
	raw: string;
}

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

export interface CommandHelpDoc {
	commandId?: string;
	text: string;
	commands?: CommandDescriptor[];
}
