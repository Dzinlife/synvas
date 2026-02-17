import type { TimelineElement, TimelineSource } from "../../dsl/types";
import type { TimelineTrack } from "../timeline/types";
import type { AudioTrackControlStateMap } from "../utils/audioTrackState";

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

export interface CommandHelpDoc {
	commandId?: string;
	text: string;
	commands?: CommandDescriptor[];
}

export interface TimelineCommandSnapshot {
	revision: number;
	fps: number;
	currentTime: number;
	elements: TimelineElement[];
	sources: TimelineSource[];
	tracks: TimelineTrack[];
	audioTrackStates: AudioTrackControlStateMap;
	autoAttach: boolean;
	rippleEditingEnabled: boolean;
}

export interface TimelineCommandApplyResult {
	ok: boolean;
	changed: boolean;
	snapshot: TimelineCommandSnapshot;
	error?: string;
}

export interface SnapshotExecutionResult {
	ok: boolean;
	executed: number;
	snapshot: TimelineCommandSnapshot;
	error?: string;
}
