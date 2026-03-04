import type { TimelineElement } from "../../element/types";
import { buildSplitElements } from "./split";
import { applyMoveCommand, type CommandRoleOptions } from "./move";
import type {
	ParsedCommand,
	TimelineCommandApplyResult,
	TimelineCommandSnapshot,
} from "./types";
import {
	type AudioTrackControlStateMap,
	getAudioTrackControlState,
} from "../utils/audioTrackState";
import { updateElementTime } from "../utils/timelineTime";

const META_COMMANDS = new Set(["help", "schema", "examples"]);
const HISTORY_COMMANDS = new Set(["timeline.undo", "timeline.redo"]);

type TrackFlag = "hidden" | "locked" | "muted" | "solo";
type AudioTrackFlag = Exclude<TrackFlag, "hidden">;

const isTrackFlag = (value: string): value is TrackFlag => {
	return ["hidden", "locked", "muted", "solo"].includes(value);
};

const cloneSnapshot = (
	snapshot: TimelineCommandSnapshot,
): TimelineCommandSnapshot => {
	return {
		...snapshot,
		elements: [...snapshot.elements],
		tracks: [...snapshot.tracks],
		audioTrackStates: { ...snapshot.audioTrackStates },
	};
};

const toFiniteNumber = (value: unknown): number | null => {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return value;
};

const toBoolean = (value: unknown): boolean | null => {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		if (value === "true") return true;
		if (value === "false") return false;
	}
	return null;
};

const toStringValue = (value: unknown): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	return trimmed;
};

const toIdList = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value
			.map((item) => toStringValue(item))
			.filter((item): item is string => item !== null);
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}
	return [];
};

const createElementId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const applyAddElement = (
	snapshot: TimelineCommandSnapshot,
	args: Record<string, unknown>,
): TimelineCommandApplyResult => {
	const elementValue = args.element;
	if (!elementValue || typeof elementValue !== "object") {
		return { ok: false, changed: false, snapshot, error: "缺少 element 参数" };
	}
	const element = elementValue as TimelineElement;
	if (!element.id || typeof element.id !== "string") {
		return { ok: false, changed: false, snapshot, error: "element.id 无效" };
	}
	if (snapshot.elements.some((item) => item.id === element.id)) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: `元素已存在: ${element.id}`,
		};
	}
	return {
		ok: true,
		changed: true,
		snapshot: {
			...snapshot,
			elements: [...snapshot.elements, element],
		},
	};
};

const applyRemoveElement = (
	snapshot: TimelineCommandSnapshot,
	args: Record<string, unknown>,
): TimelineCommandApplyResult => {
	const ids = toIdList(args.ids);
	if (ids.length === 0) {
		return { ok: false, changed: false, snapshot, error: "缺少 ids 参数" };
	}
	const removeSet = new Set(ids);
	const nextElements = snapshot.elements.filter((element) => !removeSet.has(element.id));
	if (nextElements.length === snapshot.elements.length) {
		return {
			ok: true,
			changed: false,
			snapshot,
		};
	}
	return {
		ok: true,
		changed: true,
		snapshot: {
			...snapshot,
			elements: nextElements,
		},
	};
};

const applyTrimElement = (
	snapshot: TimelineCommandSnapshot,
	args: Record<string, unknown>,
): TimelineCommandApplyResult => {
	const id = toStringValue(args.id);
	if (!id) {
		return { ok: false, changed: false, snapshot, error: "缺少 id 参数" };
	}
	const requestedStart = toFiniteNumber(args.start);
	const requestedEnd = toFiniteNumber(args.end);
	let didChange = false;
	const nextElements = snapshot.elements.map((element) => {
		if (element.id !== id) return element;
		const start = requestedStart ?? element.timeline.start;
		const end = requestedEnd ?? element.timeline.end;
		const next = updateElementTime(element, start, end, snapshot.fps);
		if (next !== element) {
			didChange = true;
		}
		return next;
	});
	if (!didChange) {
		return {
			ok: true,
			changed: false,
			snapshot,
		};
	}
	return {
		ok: true,
		changed: true,
		snapshot: {
			...snapshot,
			elements: nextElements,
		},
	};
};

const applySplitElement = (
	snapshot: TimelineCommandSnapshot,
	args: Record<string, unknown>,
): TimelineCommandApplyResult => {
	const id = toStringValue(args.id);
	const frame = toFiniteNumber(args.frame);
	if (!id || frame === null) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: "缺少 id/frame 参数",
		};
	}
	const targetIndex = snapshot.elements.findIndex((element) => element.id === id);
	if (targetIndex < 0) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: `未找到元素: ${id}`,
		};
	}
	const target = snapshot.elements[targetIndex];
	if (frame <= target.timeline.start || frame >= target.timeline.end) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: "切分帧必须位于元素区间内",
		};
	}
	const rightId = toStringValue(args.newId) ?? createElementId();
	const { left, right } = buildSplitElements(target, frame, snapshot.fps, rightId);
	const nextElements = [...snapshot.elements];
	nextElements[targetIndex] = left;
	nextElements.splice(targetIndex + 1, 0, right);
	return {
		ok: true,
		changed: true,
		snapshot: {
			...snapshot,
			elements: nextElements,
		},
	};
};

const applyTrackFlag = (
	snapshot: TimelineCommandSnapshot,
	args: Record<string, unknown>,
): TimelineCommandApplyResult => {
	const rawFlag = toStringValue(args.flag);
	const value = toBoolean(args.value);
	const trackId = toStringValue(args.trackId);
	const trackIndexValue = toFiniteNumber(args.trackIndex);
	if (!rawFlag || value === null) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: "缺少 flag/value 参数",
		};
	}
	if (!isTrackFlag(rawFlag)) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: `不支持的 flag: ${rawFlag}`,
		};
	}
	const flag = rawFlag;
	if (trackId) {
		let didChange = false;
		const nextTracks = snapshot.tracks.map((track) => {
			if (track.id !== trackId) return track;
			if (track[flag] === value) return track;
			didChange = true;
			return {
				...track,
				[flag]: value,
			};
		});
		if (!didChange) {
			return {
				ok: true,
				changed: false,
				snapshot,
			};
		}
		return {
			ok: true,
			changed: true,
			snapshot: {
				...snapshot,
				tracks: nextTracks,
			},
		};
	}
	if (trackIndexValue === null) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: "请提供 trackId 或 trackIndex",
		};
	}
	if (trackIndexValue >= 0) {
		if (trackIndexValue >= snapshot.tracks.length) {
			return {
				ok: false,
				changed: false,
				snapshot,
				error: `trackIndex 超出范围: ${trackIndexValue}`,
			};
		}
		const targetTrack = snapshot.tracks[trackIndexValue];
		if (targetTrack?.[flag] === value) {
			return {
				ok: true,
				changed: false,
				snapshot,
			};
		}
		const nextTracks = snapshot.tracks.map((track, index) => {
			if (index !== trackIndexValue) return track;
			return {
				...track,
				[flag]: value,
			};
		});
		return {
			ok: true,
			changed: true,
			snapshot: {
				...snapshot,
				tracks: nextTracks,
			},
		};
	}
	if (flag === "hidden") {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: "音频轨道不支持 hidden",
		};
	}
	const audioFlag: AudioTrackFlag = flag;
	const prevState = getAudioTrackControlState(
		snapshot.audioTrackStates,
		trackIndexValue,
	);
	const nextState = {
		...prevState,
		[audioFlag]: value,
	};
	if (prevState[audioFlag] === value) {
		return {
			ok: true,
			changed: false,
			snapshot,
		};
	}
	return {
		ok: true,
		changed: true,
		snapshot: {
			...snapshot,
			audioTrackStates: {
				...snapshot.audioTrackStates,
				[trackIndexValue]: nextState,
			} as AudioTrackControlStateMap,
		},
	};
};

const applySeek = (
	snapshot: TimelineCommandSnapshot,
	args: Record<string, unknown>,
): TimelineCommandApplyResult => {
	const time = toFiniteNumber(args.time);
	if (time === null) {
		return { ok: false, changed: false, snapshot, error: "缺少 time 参数" };
	}
	if (time === snapshot.currentTime) {
		return { ok: true, changed: false, snapshot };
	}
	return {
		ok: true,
		changed: true,
		snapshot: {
			...snapshot,
			currentTime: Math.max(0, Math.round(time)),
		},
	};
};

export const isMetaCommand = (commandId: string): boolean => {
	return META_COMMANDS.has(commandId);
};

export const isHistoryCommand = (commandId: string): boolean => {
	return HISTORY_COMMANDS.has(commandId);
};

export const applyTimelineCommandToSnapshot = (
	snapshot: TimelineCommandSnapshot,
	command: ParsedCommand,
	options?: CommandRoleOptions,
): TimelineCommandApplyResult => {
	if (isMetaCommand(command.id) || isHistoryCommand(command.id)) {
		return {
			ok: true,
			changed: false,
			snapshot,
		};
	}
	const draft = cloneSnapshot(snapshot);
	switch (command.id) {
		case "timeline.element.add":
			return applyAddElement(draft, command.args);
		case "timeline.element.remove":
			return applyRemoveElement(draft, command.args);
		case "timeline.element.move":
			return applyMoveCommand(draft, command.args, options);
		case "timeline.element.trim":
			return applyTrimElement(draft, command.args);
		case "timeline.element.split":
			return applySplitElement(draft, command.args);
		case "timeline.track.set-flag":
			return applyTrackFlag(draft, command.args);
		case "timeline.seek":
			return applySeek(draft, command.args);
		default:
			return {
				ok: false,
				changed: false,
				snapshot,
				error: `不支持的 timeline 命令: ${command.id}`,
			};
	}
};
