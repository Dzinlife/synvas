export type OtStreamId = "canvas" | `timeline:${string}`;

export interface OtCommand {
	id: string;
	args: Record<string, unknown>;
}

export interface OtOpEnvelope<TCommand extends OtCommand = OtCommand> {
	opId: string;
	txnId: string;
	streamId: OtStreamId;
	actorId: string;
	seq: number;
	lamport: number;
	createdAt: number;
	command: TCommand;
	causedBy: string[];
	inverseOf?: string;
}

export interface OtTransaction<TCommand extends OtCommand = OtCommand> {
	txnId: string;
	opIds: string[];
	createdAt: number;
	ops: OtOpEnvelope<TCommand>[];
}

export interface OtStreamCursorState {
	opIds: string[];
	undoStack: string[];
	redoStack: string[];
}

export interface OtEngineSnapshot<TCommand extends OtCommand = OtCommand> {
	actorId: string;
	lamport: number;
	txns: OtTransaction<TCommand>[];
	opLog: OtOpEnvelope<TCommand>[];
	streams: Record<OtStreamId, OtStreamCursorState>;
}

export interface OtLocalApplyInput<TCommand extends OtCommand = OtCommand> {
	streamId: OtStreamId;
	command: TCommand;
	txnId?: string;
	causedBy?: string[];
	inverseOf?: string;
	trackUndo?: boolean;
}

export interface OtEngineOptions<TCommand extends OtCommand = OtCommand> {
	actorId: string;
	now?: () => number;
	transform?: (
		left: TCommand,
		right: TCommand,
		side: "left" | "right",
	) => TCommand;
}

export interface OtEngine<TCommand extends OtCommand = OtCommand> {
	applyLocal: (input: OtLocalApplyInput<TCommand>) => OtOpEnvelope<TCommand>;
	applyRemote: (op: OtOpEnvelope<TCommand>) => OtOpEnvelope<TCommand>;
	undo: (
		streamId: OtStreamId,
		buildInverse: (op: OtOpEnvelope<TCommand>) => TCommand | null,
	) => OtOpEnvelope<TCommand> | null;
	redo: (
		streamId: OtStreamId,
		buildForward: (op: OtOpEnvelope<TCommand>) => TCommand | null,
	) => OtOpEnvelope<TCommand> | null;
	getOp: (opId: string) => OtOpEnvelope<TCommand> | null;
	getStreamState: (streamId: OtStreamId) => OtStreamCursorState;
	getSnapshot: () => OtEngineSnapshot<TCommand>;
	subscribe: (listener: (tx: OtTransaction<TCommand>) => void) => () => void;
}
