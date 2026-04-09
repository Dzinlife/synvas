import type { TextEditingSelection } from "./session";

export interface TextEditingHistorySnapshot {
	text: string;
	selection: TextEditingSelection;
}

export interface TextEditingLocalHistory {
	past: TextEditingHistorySnapshot[];
	future: TextEditingHistorySnapshot[];
	maxLength: number;
}

const DEFAULT_MAX_LENGTH = 200;

const cloneSelection = (
	selection: TextEditingSelection,
): TextEditingSelection => {
	return {
		start: selection.start,
		end: selection.end,
		direction: selection.direction,
	};
};

const cloneSnapshot = (
	snapshot: TextEditingHistorySnapshot,
): TextEditingHistorySnapshot => {
	return {
		text: snapshot.text,
		selection: cloneSelection(snapshot.selection),
	};
};

const isSelectionEqual = (
	left: TextEditingSelection,
	right: TextEditingSelection,
): boolean => {
	return (
		left.start === right.start &&
		left.end === right.end &&
		(left.direction ?? "none") === (right.direction ?? "none")
	);
};

const isSnapshotEqual = (
	left: TextEditingHistorySnapshot,
	right: TextEditingHistorySnapshot,
): boolean => {
	return (
		left.text === right.text &&
		isSelectionEqual(left.selection, right.selection)
	);
};

const trimPast = (
	past: TextEditingHistorySnapshot[],
	maxLength: number,
): TextEditingHistorySnapshot[] => {
	if (past.length <= maxLength) return past;
	return past.slice(past.length - maxLength);
};

const trimFuture = (
	future: TextEditingHistorySnapshot[],
	maxLength: number,
): TextEditingHistorySnapshot[] => {
	if (future.length <= maxLength) return future;
	return future.slice(0, maxLength);
};

export const createTextEditingLocalHistory = (
	maxLength = DEFAULT_MAX_LENGTH,
): TextEditingLocalHistory => {
	return {
		past: [],
		future: [],
		maxLength: Math.max(1, Math.round(maxLength)),
	};
};

export const clearTextEditingLocalHistory = (
	history: TextEditingLocalHistory,
): TextEditingLocalHistory => {
	if (history.past.length === 0 && history.future.length === 0) {
		return history;
	}
	return {
		...history,
		past: [],
		future: [],
	};
};

export const canUndoTextEditingLocalHistory = (
	history: TextEditingLocalHistory,
): boolean => {
	return history.past.length > 0;
};

export const canRedoTextEditingLocalHistory = (
	history: TextEditingLocalHistory,
): boolean => {
	return history.future.length > 0;
};

export const pushTextEditingLocalHistory = (
	history: TextEditingLocalHistory,
	snapshot: TextEditingHistorySnapshot,
): TextEditingLocalHistory => {
	const safeSnapshot = cloneSnapshot(snapshot);
	const lastSnapshot = history.past[history.past.length - 1] ?? null;
	if (lastSnapshot && isSnapshotEqual(lastSnapshot, safeSnapshot)) {
		if (history.future.length === 0) return history;
		return {
			...history,
			future: [],
		};
	}
	return {
		...history,
		past: trimPast([...history.past, safeSnapshot], history.maxLength),
		future: [],
	};
};

export const undoTextEditingLocalHistory = (
	history: TextEditingLocalHistory,
	current: TextEditingHistorySnapshot,
): {
	history: TextEditingLocalHistory;
	snapshot: TextEditingHistorySnapshot | null;
} => {
	if (history.past.length <= 0) {
		return {
			history,
			snapshot: null,
		};
	}
	const previousSnapshot = history.past[history.past.length - 1];
	if (!previousSnapshot) {
		return {
			history,
			snapshot: null,
		};
	}
	const snapshot = cloneSnapshot(previousSnapshot);
	const nextHistory: TextEditingLocalHistory = {
		...history,
		past: history.past.slice(0, -1),
		future: trimFuture(
			[cloneSnapshot(current), ...history.future],
			history.maxLength,
		),
	};
	return {
		history: nextHistory,
		snapshot,
	};
};

export const redoTextEditingLocalHistory = (
	history: TextEditingLocalHistory,
	current: TextEditingHistorySnapshot,
): {
	history: TextEditingLocalHistory;
	snapshot: TextEditingHistorySnapshot | null;
} => {
	if (history.future.length <= 0) {
		return {
			history,
			snapshot: null,
		};
	}
	const [nextSnapshot, ...restFuture] = history.future;
	if (!nextSnapshot) {
		return {
			history,
			snapshot: null,
		};
	}
	const safeSnapshot = cloneSnapshot(nextSnapshot);
	const nextHistory: TextEditingLocalHistory = {
		...history,
		past: trimPast(
			[...history.past, cloneSnapshot(current)],
			history.maxLength,
		),
		future: restFuture,
	};
	return {
		history: nextHistory,
		snapshot: safeSnapshot,
	};
};
