import type {
	OtCommand,
	OtEngine,
	OtEngineOptions,
	OtEngineSnapshot,
	OtLocalApplyInput,
	OtOpEnvelope,
	OtStreamCursorState,
	OtStreamId,
	OtTransaction,
} from "./types";

const createTxnId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `txn-${crypto.randomUUID()}`;
	}
	return `txn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const ensureStreamState = (
	streams: Map<OtStreamId, OtStreamCursorState>,
	streamId: OtStreamId,
): OtStreamCursorState => {
	const existed = streams.get(streamId);
	if (existed) return existed;
	const created: OtStreamCursorState = {
		opIds: [],
		undoStack: [],
		redoStack: [],
	};
	streams.set(streamId, created);
	return created;
};

const cloneStreamState = (
	state: OtStreamCursorState,
): OtStreamCursorState => ({
	opIds: [...state.opIds],
	undoStack: [...state.undoStack],
	redoStack: [...state.redoStack],
});

export const createOtEngine = <TCommand extends OtCommand>(
	options: OtEngineOptions<TCommand>,
): OtEngine<TCommand> => {
	const now = options.now ?? Date.now;
	const opLog: OtOpEnvelope<TCommand>[] = [];
	const txns: OtTransaction<TCommand>[] = [];
	const opById = new Map<string, OtOpEnvelope<TCommand>>();
	const streams = new Map<OtStreamId, OtStreamCursorState>();
	const listeners = new Set<(tx: OtTransaction<TCommand>) => void>();
	let lamport = 0;
	let seq = 0;

	const emitTxn = (tx: OtTransaction<TCommand>) => {
		for (const listener of listeners) {
			listener(tx);
		}
	};

	const nextOpEnvelope = (
		input: OtLocalApplyInput<TCommand>,
	): OtOpEnvelope<TCommand> => {
		seq += 1;
		lamport += 1;
		const actorId = input.actorId ?? options.actorId;
		return {
			opId: `${actorId}:${seq}`,
			txnId: input.txnId ?? createTxnId(),
			streamId: input.streamId,
			actorId,
			seq,
			lamport,
			createdAt: now(),
			command: input.command,
			causedBy: input.causedBy ?? [],
			...(input.inverseOf ? { inverseOf: input.inverseOf } : {}),
		};
	};

	const appendOp = (
		op: OtOpEnvelope<TCommand>,
		trackUndo = true,
	): OtTransaction<TCommand> => {
		opLog.push(op);
		opById.set(op.opId, op);
		const streamState = ensureStreamState(streams, op.streamId);
		streamState.opIds.push(op.opId);
		if (trackUndo) {
			streamState.undoStack.push(op.opId);
			streamState.redoStack = [];
		}
		const tx: OtTransaction<TCommand> = {
			txnId: op.txnId,
			opIds: [op.opId],
			createdAt: op.createdAt,
			ops: [op],
		};
		txns.push(tx);
		emitTxn(tx);
		return tx;
	};

	const applyLocal = (input: OtLocalApplyInput<TCommand>): OtOpEnvelope<TCommand> => {
		const op = nextOpEnvelope(input);
		appendOp(op, input.trackUndo !== false);
		return op;
	};

	const applyRemote = (op: OtOpEnvelope<TCommand>): OtOpEnvelope<TCommand> => {
		lamport = Math.max(lamport, op.lamport) + 1;
		let transformedCommand = op.command;
		if (options.transform) {
			for (const localOp of opLog) {
				if (localOp.streamId !== op.streamId) continue;
				transformedCommand = options.transform(
					transformedCommand,
					localOp.command,
					"left",
				);
			}
		}
		const transformedOp: OtOpEnvelope<TCommand> = {
			...op,
			command: transformedCommand,
		};
		// 远端回放默认不进入本地 undo 栈。
		appendOp(transformedOp, false);
		return transformedOp;
	};

	const undo = (
		streamId: OtStreamId,
		buildInverse: (op: OtOpEnvelope<TCommand>) => TCommand | null,
	): OtOpEnvelope<TCommand> | null => {
		const streamState = ensureStreamState(streams, streamId);
		const targetOpId = streamState.undoStack.pop();
		if (!targetOpId) return null;
		const targetOp = opById.get(targetOpId);
		if (!targetOp) return null;
		const inverseCommand = buildInverse(targetOp);
		if (!inverseCommand) {
			streamState.undoStack.push(targetOpId);
			return null;
		}
		streamState.redoStack.push(targetOpId);
		const inverseOp = applyLocal({
			streamId,
			command: inverseCommand,
			causedBy: [targetOpId],
			inverseOf: targetOpId,
			trackUndo: false,
		});
		return inverseOp;
	};

	const redo = (
		streamId: OtStreamId,
		buildForward: (op: OtOpEnvelope<TCommand>) => TCommand | null,
	): OtOpEnvelope<TCommand> | null => {
		const streamState = ensureStreamState(streams, streamId);
		const targetOpId = streamState.redoStack.pop();
		if (!targetOpId) return null;
		const targetOp = opById.get(targetOpId);
		if (!targetOp) return null;
		const forwardCommand = buildForward(targetOp);
		if (!forwardCommand) {
			streamState.redoStack.push(targetOpId);
			return null;
		}
		streamState.undoStack.push(targetOpId);
		const redoOp = applyLocal({
			streamId,
			command: forwardCommand,
			causedBy: [targetOpId],
			trackUndo: false,
		});
		return redoOp;
	};

	const getStreamState = (streamId: OtStreamId): OtStreamCursorState => {
		return cloneStreamState(ensureStreamState(streams, streamId));
	};

	const getSnapshot = (): OtEngineSnapshot<TCommand> => {
		const streamEntries = Array.from(streams.entries()).map(([id, state]) => [
			id,
			cloneStreamState(state),
		]);
		return {
			actorId: options.actorId,
			lamport,
			txns: [...txns],
			opLog: [...opLog],
			streams: Object.fromEntries(streamEntries) as Record<
				OtStreamId,
				OtStreamCursorState
			>,
		};
	};

	return {
		applyLocal,
		applyRemote,
		undo,
		redo,
		getOp: (opId) => opById.get(opId) ?? null,
		getStreamState,
		getSnapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
};
