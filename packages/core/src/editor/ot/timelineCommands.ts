import type { TimelineElement } from "../../element/types";
import type { TimelineTrack } from "../timeline/types";
import type {
	AudioTrackControlState,
	AudioTrackControlStateMap,
} from "../utils/audioTrackState";
import { getAudioTrackControlState } from "../utils/audioTrackState";
import type { OtCommand } from "./types";

export type TimelineOtIntent = "root" | "derived";

export interface TimelineOtSnapshotState {
	elements: TimelineElement[];
	tracks: TimelineTrack[];
	audioTrackStates: AudioTrackControlStateMap;
	rippleEditingEnabled: boolean;
}

export type TimelineElementOp =
	| {
			kind: "add";
			element: TimelineElement;
	  }
	| {
			kind: "remove";
			elementId: string;
			before: TimelineElement;
	  }
	| {
			kind: "update";
			elementId: string;
			before: TimelineElement;
			after: TimelineElement;
	  };

export type TimelineTrackOp =
	| {
			kind: "add";
			track: TimelineTrack;
	  }
	| {
			kind: "remove";
			trackId: string;
			before: TimelineTrack;
	  }
	| {
			kind: "update";
			trackId: string;
			before: TimelineTrack;
			after: TimelineTrack;
	  };

export type TimelineAudioTrackOp =
	| {
			kind: "add";
			trackIndex: number;
			state: AudioTrackControlState;
	  }
	| {
			kind: "remove";
			trackIndex: number;
			before: AudioTrackControlState;
	  }
	| {
			kind: "update";
			trackIndex: number;
			before: AudioTrackControlState;
			after: AudioTrackControlState;
	  };

export type TimelineSettingOp = {
	field: "rippleEditingEnabled";
	before: boolean;
	after: boolean;
};

export interface TimelineBatchApplyArgs extends Record<string, unknown> {
	elementOps: TimelineElementOp[];
	trackOps: TimelineTrackOp[];
	audioTrackOps: TimelineAudioTrackOp[];
	settingOps: TimelineSettingOp[];
	conflicts?: string[];
}

export type TimelineOtCommand =
	| {
			id: "timeline.batch.apply";
			args: TimelineBatchApplyArgs;
	  }
	| {
			id: "timeline.element.add";
			args: Record<string, unknown> & { element: TimelineElement };
	  }
	| {
			id: "timeline.element.remove";
			args: Record<string, unknown> & {
				elementId: string;
				before: TimelineElement;
			};
	  }
	| {
			id: "timeline.element.update" | "timeline.element.move" | "timeline.element.trim";
			args: Record<string, unknown> & {
				elementId: string;
				before: TimelineElement;
				after: TimelineElement;
			};
	  }
	| {
			id: "timeline.element.split";
			args: Record<string, unknown> & {
				before: TimelineElement;
				left: TimelineElement;
				right: TimelineElement;
			};
	  }
	| {
			id: "timeline.track.patch";
			args: Record<string, unknown> & { trackOps: TimelineTrackOp[] };
	  }
	| {
			id: "timeline.audioTrack.patch";
			args: Record<string, unknown> & { audioTrackOps: TimelineAudioTrackOp[] };
	  }
	| {
			id: "timeline.setting.patch";
			args: Record<string, unknown> & { settingOps: TimelineSettingOp[] };
	  };

const EMPTY_BATCH_ARGS: TimelineBatchApplyArgs = {
	elementOps: [],
	trackOps: [],
	audioTrackOps: [],
	settingOps: [],
};

const cloneAudioTrackState = (
	state: AudioTrackControlState,
): AudioTrackControlState => ({
	locked: state.locked,
	muted: state.muted,
	solo: state.solo,
});

const isAudioTrackStateEqual = (
	left: AudioTrackControlState,
	right: AudioTrackControlState,
): boolean => {
	return (
		left.locked === right.locked &&
		left.muted === right.muted &&
		left.solo === right.solo
	);
};

const toBatchArgs = (command: TimelineOtCommand): TimelineBatchApplyArgs => {
	if (command.id === "timeline.batch.apply") {
		return command.args;
	}
	if (command.id === "timeline.element.add") {
		return {
			...EMPTY_BATCH_ARGS,
			elementOps: [
				{
					kind: "add",
					element: command.args.element,
				},
			],
		};
	}
	if (command.id === "timeline.element.remove") {
		return {
			...EMPTY_BATCH_ARGS,
			elementOps: [
				{
					kind: "remove",
					elementId: command.args.elementId,
					before: command.args.before,
				},
			],
		};
	}
	if (
		command.id === "timeline.element.update" ||
		command.id === "timeline.element.move" ||
		command.id === "timeline.element.trim"
	) {
		return {
			...EMPTY_BATCH_ARGS,
			elementOps: [
				{
					kind: "update",
					elementId: command.args.elementId,
					before: command.args.before,
					after: command.args.after,
				},
			],
		};
	}
	if (command.id === "timeline.element.split") {
		return {
			...EMPTY_BATCH_ARGS,
			elementOps: [
				{
					kind: "remove",
					elementId: command.args.before.id,
					before: command.args.before,
				},
				{
					kind: "add",
					element: command.args.left,
				},
				{
					kind: "add",
					element: command.args.right,
				},
			],
		};
	}
	if (command.id === "timeline.track.patch") {
		return {
			...EMPTY_BATCH_ARGS,
			trackOps: command.args.trackOps,
		};
	}
	if (command.id === "timeline.audioTrack.patch") {
		return {
			...EMPTY_BATCH_ARGS,
			audioTrackOps: command.args.audioTrackOps,
		};
	}
	if (command.id === "timeline.setting.patch") {
		return {
			...EMPTY_BATCH_ARGS,
			settingOps: command.args.settingOps,
		};
	}
	return {
		...EMPTY_BATCH_ARGS,
	};
};

const fromBatchArgs = (args: TimelineBatchApplyArgs): TimelineOtCommand => ({
	id: "timeline.batch.apply",
	args,
});

const withConflict = (
	args: TimelineBatchApplyArgs,
	conflict: string | null,
): TimelineBatchApplyArgs => {
	if (!conflict) return args;
	return {
		...args,
		conflicts: [...(args.conflicts ?? []), conflict],
	};
};

const resolveElementKey = (op: TimelineElementOp): string => {
	if (op.kind === "add") return `element:${op.element.id}`;
	return `element:${op.elementId}`;
};

const resolveTrackKey = (op: TimelineTrackOp): string => {
	if (op.kind === "add") return `track:${op.track.id}`;
	return `track:${op.trackId}`;
};

const resolveAudioTrackKey = (op: TimelineAudioTrackOp): string => {
	return `audioTrack:${op.trackIndex}`;
};

const resolveElementKind = (op: TimelineElementOp): "add" | "remove" | "update" =>
	op.kind;

const resolveTrackKind = (op: TimelineTrackOp): "add" | "remove" | "update" =>
	op.kind;

const resolveAudioTrackKind = (
	op: TimelineAudioTrackOp,
): "add" | "remove" | "update" => op.kind;

const resolveWinner = (side: "left" | "right"): "left" | "right" => {
	return side;
};

const shouldDropByConflict = (params: {
	leftKind: "add" | "remove" | "update";
	rightKind: "add" | "remove" | "update";
	side: "left" | "right";
}): boolean => {
	const { leftKind, rightKind, side } = params;
	if (leftKind === "remove") return false;
	if (rightKind === "remove") return true;
	if (leftKind === "add" && rightKind === "add") {
		return resolveWinner(side) === "left";
	}
	if (leftKind === "update" && rightKind === "update") {
		return resolveWinner(side) === "left";
	}
	return false;
};

export const isTimelineBatchNoop = (command: TimelineOtCommand): boolean => {
	const args = toBatchArgs(command);
	return (
		args.elementOps.length === 0 &&
		args.trackOps.length === 0 &&
		args.audioTrackOps.length === 0 &&
		args.settingOps.length === 0
	);
};

export const applyTimelineOtCommand = (
	state: TimelineOtSnapshotState,
	command: TimelineOtCommand,
): TimelineOtSnapshotState => {
	const args = toBatchArgs(command);
	let nextElements = state.elements;
	let nextTracks = state.tracks;
	let nextAudioTrackStates = state.audioTrackStates;
	let nextRippleEditingEnabled = state.rippleEditingEnabled;

	for (const op of args.elementOps) {
		if (op.kind === "add") {
			nextElements = [
				...nextElements.filter((item) => item.id !== op.element.id),
				op.element,
			];
			continue;
		}
		if (op.kind === "remove") {
			nextElements = nextElements.filter((item) => item.id !== op.elementId);
			continue;
		}
		let didChange = false;
		nextElements = nextElements.map((item) => {
			if (item.id !== op.elementId) return item;
			didChange = true;
			return op.after;
		});
		if (!didChange) {
			nextElements = [...nextElements, op.after];
		}
	}

	for (const op of args.trackOps) {
		if (op.kind === "add") {
			nextTracks = [...nextTracks.filter((item) => item.id !== op.track.id), op.track];
			continue;
		}
		if (op.kind === "remove") {
			nextTracks = nextTracks.filter((item) => item.id !== op.trackId);
			continue;
		}
		let didChange = false;
		nextTracks = nextTracks.map((item) => {
			if (item.id !== op.trackId) return item;
			didChange = true;
			return op.after;
		});
		if (!didChange) {
			nextTracks = [...nextTracks, op.after];
		}
	}

	for (const op of args.audioTrackOps) {
		if (op.kind === "add") {
			nextAudioTrackStates = {
				...nextAudioTrackStates,
				[op.trackIndex]: cloneAudioTrackState(op.state),
			};
			continue;
		}
		if (op.kind === "remove") {
			const { [op.trackIndex]: _removed, ...rest } = nextAudioTrackStates;
			nextAudioTrackStates = rest;
			continue;
		}
		nextAudioTrackStates = {
			...nextAudioTrackStates,
			[op.trackIndex]: cloneAudioTrackState(op.after),
		};
	}

	for (const op of args.settingOps) {
		if (op.field === "rippleEditingEnabled") {
			nextRippleEditingEnabled = op.after;
		}
	}

	return {
		elements: nextElements,
		tracks: nextTracks,
		audioTrackStates: nextAudioTrackStates,
		rippleEditingEnabled: nextRippleEditingEnabled,
	};
};

export const invertTimelineOtCommand = (
	command: TimelineOtCommand,
): TimelineOtCommand | null => {
	const args = toBatchArgs(command);
	if (
		args.elementOps.length === 0 &&
		args.trackOps.length === 0 &&
		args.audioTrackOps.length === 0 &&
		args.settingOps.length === 0
	) {
		return null;
	}

	const inverted: TimelineBatchApplyArgs = {
		elementOps: [...args.elementOps]
			.reverse()
			.map<TimelineElementOp>((op) => {
				if (op.kind === "add") {
					return {
						kind: "remove",
						elementId: op.element.id,
						before: op.element,
					};
				}
				if (op.kind === "remove") {
					return {
						kind: "add",
						element: op.before,
					};
				}
				return {
					kind: "update",
					elementId: op.elementId,
					before: op.after,
					after: op.before,
				};
			}),
		trackOps: [...args.trackOps]
			.reverse()
			.map<TimelineTrackOp>((op) => {
				if (op.kind === "add") {
					return {
						kind: "remove",
						trackId: op.track.id,
						before: op.track,
					};
				}
				if (op.kind === "remove") {
					return {
						kind: "add",
						track: op.before,
					};
				}
				return {
					kind: "update",
					trackId: op.trackId,
					before: op.after,
					after: op.before,
				};
			}),
		audioTrackOps: [...args.audioTrackOps]
			.reverse()
			.map<TimelineAudioTrackOp>((op) => {
				if (op.kind === "add") {
					return {
						kind: "remove",
						trackIndex: op.trackIndex,
						before: op.state,
					};
				}
				if (op.kind === "remove") {
					return {
						kind: "add",
						trackIndex: op.trackIndex,
						state: op.before,
					};
				}
				return {
					kind: "update",
					trackIndex: op.trackIndex,
					before: op.after,
					after: op.before,
				};
			}),
		settingOps: args.settingOps
			.slice()
			.reverse()
			.map<TimelineSettingOp>((op) => ({
				field: op.field,
				before: op.after,
				after: op.before,
			})),
	};
	return fromBatchArgs(inverted);
};

export const transformTimelineOtCommand = (
	left: TimelineOtCommand,
	right: TimelineOtCommand,
	side: "left" | "right",
): TimelineOtCommand => {
	const leftArgs = toBatchArgs(left);
	const rightArgs = toBatchArgs(right);
	const rightElementKinds = new Map<string, "add" | "remove" | "update">(
		rightArgs.elementOps.map((op) => [resolveElementKey(op), resolveElementKind(op)]),
	);
	const rightTrackKinds = new Map<string, "add" | "remove" | "update">(
		rightArgs.trackOps.map((op) => [resolveTrackKey(op), resolveTrackKind(op)]),
	);
	const rightAudioTrackKinds = new Map<string, "add" | "remove" | "update">(
		rightArgs.audioTrackOps.map((op) => [
			resolveAudioTrackKey(op),
			resolveAudioTrackKind(op),
		]),
	);
	const rightSettingFields = new Set(
		rightArgs.settingOps.map((op) => `setting:${op.field}`),
	);

	let transformed = leftArgs;
	transformed = {
		...transformed,
		elementOps: transformed.elementOps.filter((op) => {
			const key = resolveElementKey(op);
			const rightKind = rightElementKinds.get(key);
			if (!rightKind) return true;
			const shouldDrop = shouldDropByConflict({
				leftKind: resolveElementKind(op),
				rightKind,
				side,
			});
			if (!shouldDrop) return true;
			transformed = withConflict(
				transformed,
				`element-conflict:${key}:${resolveElementKind(op)}:${rightKind}`,
			);
			return false;
		}),
		trackOps: transformed.trackOps.filter((op) => {
			const key = resolveTrackKey(op);
			const rightKind = rightTrackKinds.get(key);
			if (!rightKind) return true;
			const shouldDrop = shouldDropByConflict({
				leftKind: resolveTrackKind(op),
				rightKind,
				side,
			});
			if (!shouldDrop) return true;
			transformed = withConflict(
				transformed,
				`track-conflict:${key}:${resolveTrackKind(op)}:${rightKind}`,
			);
			return false;
		}),
		audioTrackOps: transformed.audioTrackOps.filter((op) => {
			const key = resolveAudioTrackKey(op);
			const rightKind = rightAudioTrackKinds.get(key);
			if (!rightKind) return true;
			const shouldDrop = shouldDropByConflict({
				leftKind: resolveAudioTrackKind(op),
				rightKind,
				side,
			});
			if (!shouldDrop) return true;
			transformed = withConflict(
				transformed,
				`audio-track-conflict:${key}:${resolveAudioTrackKind(op)}:${rightKind}`,
			);
			return false;
		}),
		settingOps: transformed.settingOps.filter((op) => {
			const key = `setting:${op.field}`;
			if (!rightSettingFields.has(key)) return true;
			const shouldDrop = resolveWinner(side) === "left";
			if (!shouldDrop) return true;
			transformed = withConflict(transformed, `setting-conflict:${key}`);
			return false;
		}),
	};
	return fromBatchArgs(transformed);
};

export const buildTimelineBatchCommandFromSnapshots = (params: {
	before: TimelineOtSnapshotState;
	after: TimelineOtSnapshotState;
}): TimelineOtCommand | null => {
	const { before, after } = params;
	const beforeElementsById = new Map(before.elements.map((item) => [item.id, item]));
	const afterElementsById = new Map(after.elements.map((item) => [item.id, item]));
	const beforeTracksById = new Map(before.tracks.map((item) => [item.id, item]));
	const afterTracksById = new Map(after.tracks.map((item) => [item.id, item]));
	const elementOps: TimelineElementOp[] = [];
	const trackOps: TimelineTrackOp[] = [];
	const audioTrackOps: TimelineAudioTrackOp[] = [];
	const settingOps: TimelineSettingOp[] = [];

	for (const [elementId, beforeElement] of beforeElementsById.entries()) {
		const afterElement = afterElementsById.get(elementId);
		if (!afterElement) {
			elementOps.push({
				kind: "remove",
				elementId,
				before: beforeElement,
			});
			continue;
		}
		if (beforeElement !== afterElement) {
			elementOps.push({
				kind: "update",
				elementId,
				before: beforeElement,
				after: afterElement,
			});
		}
	}
	for (const [elementId, afterElement] of afterElementsById.entries()) {
		if (beforeElementsById.has(elementId)) continue;
		elementOps.push({
			kind: "add",
			element: afterElement,
		});
	}

	for (const [trackId, beforeTrack] of beforeTracksById.entries()) {
		const afterTrack = afterTracksById.get(trackId);
		if (!afterTrack) {
			trackOps.push({
				kind: "remove",
				trackId,
				before: beforeTrack,
			});
			continue;
		}
		if (beforeTrack !== afterTrack) {
			trackOps.push({
				kind: "update",
				trackId,
				before: beforeTrack,
				after: afterTrack,
			});
		}
	}
	for (const [trackId, afterTrack] of afterTracksById.entries()) {
		if (beforeTracksById.has(trackId)) continue;
		trackOps.push({
			kind: "add",
			track: afterTrack,
		});
	}

	const audioTrackIndexSet = new Set<number>([
		...Object.keys(before.audioTrackStates).map((raw) => Number(raw)),
		...Object.keys(after.audioTrackStates).map((raw) => Number(raw)),
	]);
	for (const trackIndex of audioTrackIndexSet) {
		if (!Number.isFinite(trackIndex)) continue;
		const hasBefore =
			before.audioTrackStates[trackIndex] !== undefined ||
			Object.prototype.hasOwnProperty.call(before.audioTrackStates, trackIndex);
		const hasAfter =
			after.audioTrackStates[trackIndex] !== undefined ||
			Object.prototype.hasOwnProperty.call(after.audioTrackStates, trackIndex);
		const beforeState = getAudioTrackControlState(
			before.audioTrackStates,
			trackIndex,
		);
		const afterState = getAudioTrackControlState(
			after.audioTrackStates,
			trackIndex,
		);
		if (!hasBefore && hasAfter) {
			audioTrackOps.push({
				kind: "add",
				trackIndex,
				state: afterState,
			});
			continue;
		}
		if (hasBefore && !hasAfter) {
			audioTrackOps.push({
				kind: "remove",
				trackIndex,
				before: beforeState,
			});
			continue;
		}
		if (!isAudioTrackStateEqual(beforeState, afterState)) {
			audioTrackOps.push({
				kind: "update",
				trackIndex,
				before: beforeState,
				after: afterState,
			});
		}
	}

	if (before.rippleEditingEnabled !== after.rippleEditingEnabled) {
		settingOps.push({
			field: "rippleEditingEnabled",
			before: before.rippleEditingEnabled,
			after: after.rippleEditingEnabled,
		});
	}

	if (
		elementOps.length === 0 &&
		trackOps.length === 0 &&
		audioTrackOps.length === 0 &&
		settingOps.length === 0
	) {
		return null;
	}
	return {
		id: "timeline.batch.apply",
		args: {
			elementOps,
			trackOps,
			audioTrackOps,
			settingOps,
		},
	};
};

export const isTimelineOtCommand = (command: OtCommand): command is TimelineOtCommand =>
	command.id.startsWith("timeline.");
