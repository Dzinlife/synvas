import { createTrackLockedMap } from "core/editor/command/move";
import { pruneAudioTrackStates } from "core/editor/command/postProcess";
import {
	applyTimelineOtCommand,
	createOtEngine,
	invertTimelineOtCommand,
	isTimelineOtCommand,
	type OtCommand,
	type OtOpEnvelope,
	type OtStreamId,
	type TimelineOtCommand,
	type TimelineOtIntent,
	transformTimelineOtCommand,
} from "core/editor/ot";
import type { TimelineTrack } from "core/editor/timeline/types";
import {
	DEFAULT_TIMELINE_SETTINGS,
	loadTimelineFromObject,
	saveTimelineToObject,
	type TimelineJSON,
	type TimelineTrackJSON,
} from "core/editor/timelineLoader";
import { mergeStudioOtSnapshot } from "core/studio/ot";
import type {
	CanvasDocument,
	CanvasNode,
	SceneDocument,
	StudioProject,
} from "core/studio/types";
import { create } from "zustand";
import { useProjectStore } from "@/projects/projectStore";
import type { TimelineStoreApi } from "@/scene-editor/contexts/TimelineContext";
import type {
	StudioRuntimeManager,
	TimelineRef,
} from "@/scene-editor/runtime/types";
import { findAttachments } from "@/scene-editor/utils/attachments";
import { finalizeTimelineElements } from "@/scene-editor/utils/mainTrackMagnet";
import { reconcileTracks } from "@/scene-editor/utils/trackState";
import {
	toSceneTimelineRef,
	writeTimelineByRef,
} from "@/studio/scene/timelineRefAdapter";
import { applyTimelineJsonToStore } from "@/studio/scene/timelineSession";

export type CanvasNodeLayoutSnapshot = Pick<
	CanvasNode,
	"x" | "y" | "width" | "height" | "zIndex" | "hidden" | "locked" | "parentId"
>;

type CanvasGraphHistoryItem = {
	node: CanvasNode;
	scene?: SceneDocument;
};

type SceneTimelineHistoryItem = {
	timelineRef?: TimelineRef;
	/**
	 * 兼容旧历史数据：历史栈中可能只有 sceneId。
	 */
	sceneId?: string;
	before: TimelineJSON;
	after: TimelineJSON;
};

type SceneTimelineHistoryEntry = SceneTimelineHistoryItem & {
	kind: "scene.timeline";
	opId?: string;
};

type SceneTimelineBatchHistoryEntry = {
	kind: "scene.timeline.batch";
	entries: SceneTimelineHistoryItem[];
	opId?: string;
};

type TimelineOtHistoryEntry = {
	kind: "timeline.ot";
	timelineRef?: TimelineRef;
	sceneId?: string;
	command: TimelineOtCommand;
	txnId?: string;
	causedBy?: string[];
	intent?: TimelineOtIntent;
};

export type StudioHistoryEntry =
	| TimelineOtHistoryEntry
	| SceneTimelineHistoryEntry
	| SceneTimelineBatchHistoryEntry
	| {
			kind: "canvas.node-layout";
			nodeId: string;
			before: CanvasNodeLayoutSnapshot;
			after: CanvasNodeLayoutSnapshot;
			focusNodeId?: string | null;
	  }
	| {
			kind: "canvas.node-update";
			nodeId: string;
			before: CanvasNode;
			after: CanvasNode;
			focusNodeId?: string | null;
	  }
	| {
			kind: "canvas.node-layout.batch";
			entries: Array<{
				nodeId: string;
				before: CanvasNodeLayoutSnapshot;
				after: CanvasNodeLayoutSnapshot;
			}>;
			focusNodeId?: string | null;
	  }
	| {
			kind: "canvas.node-create";
			node: CanvasNode;
			scene?: SceneDocument;
			focusNodeId?: string | null;
	  }
	| {
			kind: "canvas.node-create.batch";
			entries: CanvasGraphHistoryItem[];
			focusNodeId?: string | null;
	  }
	| {
			kind: "canvas.node-delete";
			node: CanvasNode;
			scene?: SceneDocument;
			focusNodeId?: string | null;
	  }
	| {
			kind: "canvas.node-delete.batch";
			entries: CanvasGraphHistoryItem[];
			focusNodeId?: string | null;
	  }
	| {
			kind: "canvas.frame-create";
			createdFrame: CanvasNode;
			reparentChanges: Array<{
				nodeId: string;
				beforeParentId: string | null;
				afterParentId: string | null;
				beforeZIndex: number;
				afterZIndex: number;
			}>;
			focusNodeId?: string | null;
	  };

export type LabActorId = "user-1" | "user-2" | "user-3" | "user-4";

export const LAB_ACTOR_IDS: readonly LabActorId[] = [
	"user-1",
	"user-2",
	"user-3",
	"user-4",
];

type StudioHistoryEntryWithMeta = StudioHistoryEntry & {
	__otOpId?: string;
	__streamId?: OtStreamId;
	__actorId?: LabActorId;
	__seq?: number;
	__intent?: TimelineOtIntent;
	__causedBy?: string[];
};

type CanvasOtCommand = OtCommand & {
	id:
		| "canvas.node-layout"
		| "canvas.node-update"
		| "canvas.node-layout.batch"
		| "canvas.node-create"
		| "canvas.node-create.batch"
		| "canvas.node-delete"
		| "canvas.node-delete.batch"
		| "canvas.frame-create";
};

type StudioNoopOtCommand = OtCommand & {
	id: "studio.noop";
	args: { reason: string };
};

type LegacyTimelineSnapshotOtCommand = OtCommand & {
	id: "scene.timeline" | "scene.timeline.batch";
	args: Record<string, unknown>;
};

type StudioOtCommand =
	| TimelineOtCommand
	| CanvasOtCommand
	| StudioNoopOtCommand
	| LegacyTimelineSnapshotOtCommand;

interface HistoryApplyOptions {
	timelineStore?: TimelineStoreApi;
	runtimeManager?: StudioRuntimeManager;
	streamId?: OtStreamId;
}

interface ActorHistoryStacks {
	past: StudioHistoryEntryWithMeta[];
	future: StudioHistoryEntryWithMeta[];
}

type ActorRedoClosureMap = Record<string, StudioHistoryEntryWithMeta[]>;

interface StudioHistoryState {
	past: StudioHistoryEntryWithMeta[];
	future: StudioHistoryEntryWithMeta[];
	pastByStream: Record<string, StudioHistoryEntryWithMeta[]>;
	futureByStream: Record<string, StudioHistoryEntryWithMeta[]>;
	opLog: OtOpEnvelope<StudioOtCommand>[];
	isApplying: boolean;
	canUndo: boolean;
	canRedo: boolean;
	latestTimelineOpIds: Record<string, string | undefined>;
	activeActorId: LabActorId;
	actorStacks: Record<LabActorId, ActorHistoryStacks>;
	redoClosures: Record<LabActorId, ActorRedoClosureMap>;
	projectId: string | null;
	baselineCanvas: CanvasDocument | null;
	baselineScenes: Record<string, SceneDocument> | null;
	push: (entry: StudioHistoryEntry) => void;
	undo: (options?: HistoryApplyOptions) => void;
	redo: (options?: HistoryApplyOptions) => void;
	clear: () => void;
	setActiveActor: (actorId: LabActorId) => void;
	getLatestTimelineOpId: (sceneId: string) => string | undefined;
	getActorStacks: (actorId: LabActorId) => ActorHistoryStacks;
	getActorOps: (actorId: LabActorId) => OtOpEnvelope<StudioOtCommand>[];
}

const HISTORY_LIMIT = 200;
const CANVAS_STREAM_ID: OtStreamId = "canvas";

const cloneJson = <T>(value: T): T => {
	if (typeof structuredClone === "function") {
		return structuredClone(value);
	}
	return JSON.parse(JSON.stringify(value)) as T;
};

const createEmptyActorStacks = (): Record<LabActorId, ActorHistoryStacks> => {
	return {
		"user-1": { past: [], future: [] },
		"user-2": { past: [], future: [] },
		"user-3": { past: [], future: [] },
		"user-4": { past: [], future: [] },
	};
};

const createEmptyRedoClosures = (): Record<LabActorId, ActorRedoClosureMap> => {
	return {
		"user-1": {},
		"user-2": {},
		"user-3": {},
		"user-4": {},
	};
};

const createHistoryEngine = () => {
	return createOtEngine<StudioOtCommand>({
		actorId: "studio-local",
		transform: (left, right, side) => {
			if (isTimelineOtCommand(left) && isTimelineOtCommand(right)) {
				return transformTimelineOtCommand(left, right, side);
			}
			return left;
		},
	});
};

let historyEngine = createHistoryEngine();

const createCompensationTxnId = (prefix: "undo" | "redo"): string => {
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const resolveTimelineRef = (
	entry: Pick<SceneTimelineHistoryItem, "timelineRef" | "sceneId">,
): TimelineRef | null => {
	if (entry.timelineRef) return entry.timelineRef;
	if (entry.sceneId) return toSceneTimelineRef(entry.sceneId);
	return null;
};

const resolveSceneTimelineKey = (
	entry: Pick<SceneTimelineHistoryItem, "timelineRef" | "sceneId">,
): string | null => {
	if (entry.timelineRef) {
		return `${entry.timelineRef.kind}:${entry.timelineRef.sceneId}`;
	}
	if (entry.sceneId) return `scene:${entry.sceneId}`;
	return null;
};

const toSceneTimelineHistoryItem = (
	entry: SceneTimelineHistoryEntry,
): SceneTimelineHistoryItem => ({
	timelineRef: entry.timelineRef,
	sceneId: entry.sceneId,
	before: entry.before,
	after: entry.after,
});

const mergeSceneTimelineBatchEntries = (
	existingEntries: SceneTimelineHistoryItem[],
	nextEntry: SceneTimelineHistoryItem,
): SceneTimelineHistoryItem[] => {
	const nextKey = resolveSceneTimelineKey(nextEntry);
	if (!nextKey) {
		return [...existingEntries, nextEntry];
	}
	const targetIndex = existingEntries.findIndex((entry) => {
		const existingKey = resolveSceneTimelineKey(entry);
		return existingKey === nextKey;
	});
	if (targetIndex < 0) {
		return [...existingEntries, nextEntry];
	}
	return existingEntries.map((entry, index) =>
		index === targetIndex
			? {
					...entry,
					after: nextEntry.after,
				}
			: entry,
	);
};

const resolveHistoryStreamId = (entry: StudioHistoryEntry): OtStreamId => {
	if (entry.kind === "timeline.ot") {
		const sceneId = entry.timelineRef?.sceneId ?? entry.sceneId ?? "";
		if (!sceneId) return CANVAS_STREAM_ID;
		return `timeline:${sceneId}` as OtStreamId;
	}
	if (entry.kind === "scene.timeline") {
		const key = resolveSceneTimelineKey(entry);
		if (!key) return CANVAS_STREAM_ID;
		const sceneId = key.split(":")[1] ?? "";
		if (!sceneId) return CANVAS_STREAM_ID;
		return `timeline:${sceneId}` as OtStreamId;
	}
	if (entry.kind === "scene.timeline.batch") {
		const first = entry.entries[0];
		if (!first) return CANVAS_STREAM_ID;
		const key = resolveSceneTimelineKey(first);
		const sceneId = key?.split(":")[1] ?? "";
		if (!sceneId) return CANVAS_STREAM_ID;
		return `timeline:${sceneId}` as OtStreamId;
	}
	return CANVAS_STREAM_ID;
};

const resolveEntryStreamIds = (
	entry: StudioHistoryEntryWithMeta,
): OtStreamId[] => {
	if (entry.kind === "timeline.ot") {
		const sceneId = entry.timelineRef?.sceneId ?? entry.sceneId ?? "";
		if (!sceneId) return [entry.__streamId ?? CANVAS_STREAM_ID];
		return [`timeline:${sceneId}` as OtStreamId];
	}
	if (entry.kind === "scene.timeline.batch") {
		const streamIds = Array.from(
			new Set(
				entry.entries
					.map((item) => item.timelineRef?.sceneId ?? item.sceneId)
					.filter((sceneId): sceneId is string => Boolean(sceneId))
					.map((sceneId) => `timeline:${sceneId}` as OtStreamId),
			),
		);
		return streamIds.length > 0 ? streamIds : [CANVAS_STREAM_ID];
	}
	return [entry.__streamId ?? resolveHistoryStreamId(entry)];
};

const toEntryWithMeta = (
	entry: StudioHistoryEntry,
	meta: {
		opId: string;
		streamId: OtStreamId;
		actorId: LabActorId;
		seq: number;
		causedBy: string[];
		intent: TimelineOtIntent;
	},
): StudioHistoryEntryWithMeta => {
	return {
		...entry,
		__otOpId: meta.opId,
		__streamId: meta.streamId,
		__actorId: meta.actorId,
		__seq: meta.seq,
		__causedBy: meta.causedBy,
		__intent: meta.intent,
	};
};

const getEntryOpId = (
	entry: StudioHistoryEntryWithMeta,
): string | undefined => {
	if (
		entry.kind === "scene.timeline" ||
		entry.kind === "scene.timeline.batch"
	) {
		return entry.opId ?? entry.__otOpId;
	}
	return entry.__otOpId;
};

const stripUiStateFromHistoryEntry = (
	entry: StudioHistoryEntry,
): StudioHistoryEntry => {
	// 历史只记录数据层变化，不记录 UI 焦点态。
	if (!("focusNodeId" in entry)) return entry;
	const { focusNodeId: _focusNodeId, ...rest } = entry;
	return rest as StudioHistoryEntry;
};

const toOtCommand = (entry: StudioHistoryEntry): StudioOtCommand => {
	if (entry.kind === "timeline.ot") {
		return {
			...entry.command,
			args: {
				...entry.command.args,
				__intent: entry.intent ?? "root",
				__rootTxnId: entry.txnId ?? null,
			},
		} as StudioOtCommand;
	}
	return {
		id: entry.kind,
		args: { entry } as Record<string, unknown>,
	};
};

const trimEntries = <T>(entries: T[]): T[] => {
	if (entries.length <= HISTORY_LIMIT) return entries;
	return entries.slice(entries.length - HISTORY_LIMIT);
};

const resolveEntryIntent = (entry: StudioHistoryEntry): TimelineOtIntent => {
	if (entry.kind === "timeline.ot") {
		return entry.intent ?? "root";
	}
	return "root";
};

const isRootEntry = (entry: StudioHistoryEntryWithMeta): boolean => {
	return entry.__intent !== "derived";
};

const isSameEntryIdentity = (
	left: StudioHistoryEntryWithMeta,
	right: StudioHistoryEntryWithMeta,
): boolean => {
	const leftOtOpId = left.__otOpId;
	const rightOtOpId = right.__otOpId;
	if (leftOtOpId && rightOtOpId) {
		return leftOtOpId === rightOtOpId;
	}
	const leftLogicalOpId = getEntryOpId(left);
	const rightLogicalOpId = getEntryOpId(right);
	if (leftLogicalOpId && rightLogicalOpId) {
		return leftLogicalOpId === rightLogicalOpId && left.kind === right.kind;
	}
	return left === right;
};

const removeEntryFromList = (
	entries: StudioHistoryEntryWithMeta[],
	target: StudioHistoryEntryWithMeta,
): StudioHistoryEntryWithMeta[] => {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const candidate = entries[index];
		if (!candidate || !isSameEntryIdentity(candidate, target)) continue;
		return [...entries.slice(0, index), ...entries.slice(index + 1)];
	}
	return entries;
};

const insertEntryBySeq = (
	entries: StudioHistoryEntryWithMeta[],
	target: StudioHistoryEntryWithMeta,
): StudioHistoryEntryWithMeta[] => {
	if (entries.some((entry) => isSameEntryIdentity(entry, target)))
		return entries;
	const targetSeq = target.__seq ?? Number.MAX_SAFE_INTEGER;
	for (let index = 0; index < entries.length; index += 1) {
		const currentSeq = entries[index]?.__seq ?? Number.MAX_SAFE_INTEGER;
		if (targetSeq < currentSeq) {
			return [...entries.slice(0, index), target, ...entries.slice(index)];
		}
	}
	return [...entries, target];
};

const collectCausalClosureOpIds = (
	entries: StudioHistoryEntryWithMeta[],
	seedOpIds: string[],
): Set<string> => {
	const closure = new Set(seedOpIds.filter((item) => item.length > 0));
	if (closure.size === 0) return closure;
	let didChange = true;
	while (didChange) {
		didChange = false;
		for (const entry of entries) {
			const opId = entry.__otOpId;
			if (!opId) continue;
			if (closure.has(opId)) continue;
			const causedBy = entry.__causedBy ?? [];
			if (!causedBy.some((source) => closure.has(source))) continue;
			closure.add(opId);
			didChange = true;
		}
	}
	return closure;
};

const mergeLatestTimelineEntry = (
	existing: StudioHistoryEntryWithMeta[],
	nextEntry: StudioHistoryEntryWithMeta,
): StudioHistoryEntryWithMeta[] => {
	if (nextEntry.kind !== "scene.timeline") {
		return [...existing, nextEntry];
	}
	const lastEntry = existing[existing.length - 1];
	if (!lastEntry || lastEntry.kind !== "scene.timeline") {
		return [...existing, nextEntry];
	}
	const lastOpId = getEntryOpId(lastEntry);
	const nextOpId = getEntryOpId(nextEntry);
	if (!lastOpId || !nextOpId || lastOpId !== nextOpId) {
		return [...existing, nextEntry];
	}
	const lastKey = resolveSceneTimelineKey(lastEntry);
	const nextKey = resolveSceneTimelineKey(nextEntry);
	if (!lastKey || !nextKey || lastKey !== nextKey) {
		return [...existing, nextEntry];
	}
	const merged: StudioHistoryEntryWithMeta = {
		...lastEntry,
		after: nextEntry.after,
		__otOpId: nextEntry.__otOpId ?? lastEntry.__otOpId,
		__streamId: nextEntry.__streamId ?? lastEntry.__streamId,
		__seq: Math.min(
			nextEntry.__seq ?? Number.MAX_SAFE_INTEGER,
			lastEntry.__seq ?? Number.MAX_SAFE_INTEGER,
		),
	};
	return [...existing.slice(0, -1), merged];
};

const mergeGlobalTimelineEntry = (
	existing: StudioHistoryEntryWithMeta[],
	nextEntry: StudioHistoryEntryWithMeta,
): StudioHistoryEntryWithMeta[] => {
	if (nextEntry.kind !== "scene.timeline" || !nextEntry.opId) {
		return [...existing, nextEntry];
	}
	const lastEntry = existing[existing.length - 1];
	if (!lastEntry) {
		return [...existing, nextEntry];
	}
	if (
		lastEntry.kind === "scene.timeline" &&
		lastEntry.opId === nextEntry.opId
	) {
		const mergedItems = mergeSceneTimelineBatchEntries(
			[toSceneTimelineHistoryItem(lastEntry)],
			toSceneTimelineHistoryItem(nextEntry),
		);
		if (mergedItems.length === 1) {
			const mergedSingle: StudioHistoryEntryWithMeta = {
				...lastEntry,
				after: nextEntry.after,
				__otOpId: nextEntry.__otOpId ?? lastEntry.__otOpId,
				__streamId: nextEntry.__streamId ?? lastEntry.__streamId,
				__seq: Math.min(
					nextEntry.__seq ?? Number.MAX_SAFE_INTEGER,
					lastEntry.__seq ?? Number.MAX_SAFE_INTEGER,
				),
			};
			return [...existing.slice(0, -1), mergedSingle];
		}
		const mergedBatch: StudioHistoryEntryWithMeta = {
			kind: "scene.timeline.batch",
			entries: mergedItems,
			opId: nextEntry.opId,
			__otOpId: nextEntry.__otOpId ?? lastEntry.__otOpId,
			__streamId: nextEntry.__streamId ?? lastEntry.__streamId,
			__actorId: nextEntry.__actorId ?? lastEntry.__actorId,
			__seq: Math.min(
				nextEntry.__seq ?? Number.MAX_SAFE_INTEGER,
				lastEntry.__seq ?? Number.MAX_SAFE_INTEGER,
			),
		};
		return [...existing.slice(0, -1), mergedBatch];
	}
	if (
		lastEntry.kind === "scene.timeline.batch" &&
		lastEntry.opId &&
		lastEntry.opId === nextEntry.opId
	) {
		const mergedBatch: StudioHistoryEntryWithMeta = {
			...lastEntry,
			entries: mergeSceneTimelineBatchEntries(
				lastEntry.entries,
				toSceneTimelineHistoryItem(nextEntry),
			),
			__otOpId: nextEntry.__otOpId ?? lastEntry.__otOpId,
			__streamId: nextEntry.__streamId ?? lastEntry.__streamId,
			__actorId: nextEntry.__actorId ?? lastEntry.__actorId,
			__seq: Math.min(
				nextEntry.__seq ?? Number.MAX_SAFE_INTEGER,
				lastEntry.__seq ?? Number.MAX_SAFE_INTEGER,
			),
		};
		return [...existing.slice(0, -1), mergedBatch];
	}
	return [...existing, nextEntry];
};

const cloneTimelineAudioSettings = (
	audio: TimelineJSON["settings"]["audio"] | undefined,
): TimelineJSON["settings"]["audio"] => {
	const defaultAudio = DEFAULT_TIMELINE_SETTINGS.audio;
	const compressor = {
		...defaultAudio.compressor,
		...(audio?.compressor ?? {}),
	};
	return {
		exportSampleRate: audio?.exportSampleRate ?? defaultAudio.exportSampleRate,
		exportBlockSize: audio?.exportBlockSize ?? defaultAudio.exportBlockSize,
		masterGainDb: audio?.masterGainDb ?? defaultAudio.masterGainDb,
		compressor: {
			enabled: compressor.enabled,
			thresholdDb: compressor.thresholdDb,
			ratio: compressor.ratio,
			kneeDb: compressor.kneeDb,
			attackMs: compressor.attackMs,
			releaseMs: compressor.releaseMs,
			makeupGainDb: compressor.makeupGainDb,
		},
	};
};

const normalizeStoredTracks = (
	tracks: TimelineJSON["tracks"],
): TimelineTrack[] => {
	return (tracks ?? []).map((track: TimelineTrackJSON, index) => ({
		id: track.id,
		role: track.role ?? (index === 0 ? "clip" : "overlay"),
		hidden: track.hidden ?? false,
		locked: track.locked ?? false,
		muted: track.muted ?? false,
		solo: track.solo ?? false,
	}));
};

const stabilizeTimelineAfterOtApply = (params: {
	elements: TimelineJSON["elements"];
	tracks: TimelineJSON["tracks"];
	audioTrackStates: Record<
		number,
		{ locked: boolean; muted: boolean; solo: boolean }
	>;
	rippleEditingEnabled: boolean;
	fps: number;
	autoAttach: boolean;
}) => {
	const {
		elements,
		tracks = [],
		audioTrackStates,
		rippleEditingEnabled,
		fps,
		autoAttach,
	} = params;
	const normalizedTracks = normalizeStoredTracks(tracks);
	const trackLockedMap = createTrackLockedMap(
		normalizedTracks,
		audioTrackStates,
	);
	const finalizedElements = finalizeTimelineElements(elements, {
		rippleEditingEnabled,
		attachments: findAttachments(elements),
		autoAttach,
		fps,
		trackLockedMap,
	});
	const reconcileResult = reconcileTracks(finalizedElements, normalizedTracks);
	const nextAudioTrackStates = pruneAudioTrackStates(
		reconcileResult.elements,
		audioTrackStates,
	);
	return {
		elements: reconcileResult.elements,
		tracks: reconcileResult.tracks,
		audioTrackStates: nextAudioTrackStates,
		rippleEditingEnabled,
	};
};

const applyTimelineOtCommandToTimeline = (params: {
	timeline: TimelineJSON;
	command: TimelineOtCommand;
	mode: "undo" | "redo";
}): TimelineJSON => {
	const { timeline, command, mode } = params;
	const data = loadTimelineFromObject(timeline);
	const targetCommand =
		mode === "undo" ? invertTimelineOtCommand(command) : command;
	if (!targetCommand) {
		return timeline;
	}
	const next = applyTimelineOtCommand(
		{
			elements: data.elements,
			tracks: data.tracks,
			audioTrackStates: {},
			rippleEditingEnabled: data.settings.rippleEditingEnabled,
		},
		targetCommand,
	);
	const stabilized = stabilizeTimelineAfterOtApply({
		elements: next.elements,
		tracks: next.tracks,
		audioTrackStates: {},
		rippleEditingEnabled: next.rippleEditingEnabled,
		fps: data.fps,
		autoAttach: data.settings.autoAttach,
	});
	return saveTimelineToObject(
		stabilized.elements,
		data.fps,
		data.canvas,
		stabilized.tracks,
		{
			snapEnabled: data.settings.snapEnabled,
			autoAttach: data.settings.autoAttach,
			rippleEditingEnabled: stabilized.rippleEditingEnabled,
			previewAxisEnabled: data.settings.previewAxisEnabled,
			audio: cloneTimelineAudioSettings(data.settings.audio),
		},
	);
};

const applyTimelineOtCommandToStore = (params: {
	timelineStore: TimelineStoreApi;
	command: TimelineOtCommand;
	mode: "undo" | "redo";
}): void => {
	const { timelineStore, command, mode } = params;
	const targetCommand =
		mode === "undo" ? invertTimelineOtCommand(command) : command;
	if (!targetCommand) return;
	const state = timelineStore.getState();
	const next = applyTimelineOtCommand(
		{
			elements: state.elements,
			tracks: state.tracks,
			audioTrackStates: state.audioTrackStates,
			rippleEditingEnabled: state.rippleEditingEnabled,
		},
		targetCommand,
	);
	const stabilized = stabilizeTimelineAfterOtApply({
		elements: next.elements,
		tracks: next.tracks,
		audioTrackStates: next.audioTrackStates,
		rippleEditingEnabled: next.rippleEditingEnabled,
		fps: state.fps,
		autoAttach: state.autoAttach,
	});
	timelineStore.setState({
		elements: stabilized.elements,
		tracks: stabilized.tracks,
		audioTrackStates: stabilized.audioTrackStates,
		rippleEditingEnabled: stabilized.rippleEditingEnabled,
	});
};

const applyTimelineOtEntry = (
	entry: TimelineOtHistoryEntry,
	mode: "undo" | "redo",
	options?: HistoryApplyOptions,
): void => {
	const projectStore = useProjectStore.getState();
	const timelineRef =
		entry.timelineRef ??
		(entry.sceneId ? toSceneTimelineRef(entry.sceneId) : null);
	if (!timelineRef) return;
	const currentProject = useProjectStore.getState().currentProject;
	if (!currentProject) return;
	const scene = currentProject.scenes[timelineRef.sceneId];
	if (!scene) return;
	const nextTimeline = applyTimelineOtCommandToTimeline({
		timeline: scene.timeline,
		command: entry.command,
		mode,
	});
	writeTimelineByRef(projectStore, timelineRef, nextTimeline, {
		recordHistory: false,
		txnId: entry.txnId,
	});
	if (options?.runtimeManager) {
		const runtime = options.runtimeManager.ensureTimelineRuntime(timelineRef);
		applyTimelineOtCommandToStore({
			timelineStore: runtime.timelineStore,
			command: entry.command,
			mode,
		});
		return;
	}
	const focusedNodeId = currentProject.ui.focusedNodeId;
	const focusedNode =
		currentProject.canvas.nodes.find((node) => node.id === focusedNodeId) ??
		null;
	if (
		focusedNode?.type === "scene" &&
		focusedNode.sceneId === timelineRef.sceneId &&
		options?.timelineStore
	) {
		applyTimelineOtCommandToStore({
			timelineStore: options.timelineStore,
			command: entry.command,
			mode,
		});
	}
};

const applySceneTimelineHistoryItem = (
	entry: SceneTimelineHistoryItem,
	mode: "undo" | "redo",
	options?: HistoryApplyOptions,
): void => {
	const projectStore = useProjectStore.getState();
	const timelineRef = resolveTimelineRef(entry);
	if (!timelineRef) return;
	const timeline = mode === "undo" ? entry.before : entry.after;

	writeTimelineByRef(projectStore, timelineRef, timeline, {
		recordHistory: false,
	});

	if (options?.runtimeManager) {
		const runtime = options.runtimeManager.ensureTimelineRuntime(timelineRef);
		applyTimelineJsonToStore(timeline, runtime.timelineStore);
		return;
	}

	const currentProject = useProjectStore.getState().currentProject;
	const focusedNodeId = currentProject?.ui.focusedNodeId;
	const focusedNode =
		currentProject?.canvas.nodes.find((node) => node.id === focusedNodeId) ??
		null;
	if (
		timelineRef.kind === "scene" &&
		focusedNode?.type === "scene" &&
		focusedNode.sceneId === timelineRef.sceneId &&
		options?.timelineStore
	) {
		applyTimelineJsonToStore(timeline, options.timelineStore);
	}
};

const applyEntry = (
	entry: StudioHistoryEntry,
	mode: "undo" | "redo",
	options?: HistoryApplyOptions,
): void => {
	const projectStore = useProjectStore.getState();
	if (entry.kind === "timeline.ot") {
		applyTimelineOtEntry(entry, mode, options);
		return;
	}
	if (entry.kind === "scene.timeline") {
		applySceneTimelineHistoryItem(entry, mode, options);
		return;
	}
	if (entry.kind === "scene.timeline.batch") {
		for (const timelineEntry of entry.entries) {
			applySceneTimelineHistoryItem(timelineEntry, mode, options);
		}
		return;
	}
	if (entry.kind === "canvas.node-layout") {
		const patch = mode === "undo" ? entry.before : entry.after;
		projectStore.updateCanvasNodeLayout(entry.nodeId, patch);
		return;
	}
	if (entry.kind === "canvas.node-update") {
		const patch = mode === "undo" ? entry.before : entry.after;
		projectStore.updateCanvasNode(entry.nodeId, patch as never);
		return;
	}
	if (entry.kind === "canvas.node-layout.batch") {
		for (const layoutEntry of entry.entries) {
			const patch = mode === "undo" ? layoutEntry.before : layoutEntry.after;
			projectStore.updateCanvasNodeLayout(layoutEntry.nodeId, patch);
		}
		return;
	}
	if (entry.kind === "canvas.node-create") {
		if (entry.node.type === "scene" && entry.scene) {
			if (mode === "undo") {
				projectStore.removeSceneGraphForHistory(entry.scene.id, entry.node.id);
				return;
			}
			projectStore.restoreSceneGraphForHistory(entry.scene, entry.node);
			return;
		}
		if (mode === "undo") {
			projectStore.removeCanvasNodeForHistory(entry.node.id);
			return;
		}
		projectStore.restoreCanvasNodeForHistory(entry.node);
		return;
	}
	if (entry.kind === "canvas.node-create.batch") {
		if (mode === "undo") {
			projectStore.removeCanvasGraphBatch(
				entry.entries.map((item) => item.node.id),
			);
			return;
		}
		projectStore.appendCanvasGraphBatch(entry.entries);
		return;
	}
	if (entry.kind === "canvas.node-delete") {
		if (entry.node.type === "scene" && entry.scene) {
			if (mode === "undo") {
				projectStore.restoreSceneGraphForHistory(entry.scene, entry.node);
				return;
			}
			projectStore.removeSceneGraphForHistory(entry.scene.id, entry.node.id);
			return;
		}
		if (mode === "undo") {
			projectStore.restoreCanvasNodeForHistory(entry.node);
			return;
		}
		projectStore.removeCanvasNodeForHistory(entry.node.id);
		return;
	}
	if (entry.kind === "canvas.node-delete.batch") {
		if (mode === "undo") {
			projectStore.appendCanvasGraphBatch(entry.entries);
			return;
		}
		projectStore.removeCanvasGraphBatch(
			entry.entries.map((item) => item.node.id),
		);
		return;
	}
	if (entry.kind === "canvas.frame-create") {
		if (mode === "undo") {
			projectStore.removeCanvasNodeForHistory(entry.createdFrame.id);
			if (entry.reparentChanges.length > 0) {
				projectStore.updateCanvasNodeLayoutBatch(
					entry.reparentChanges.map((change) => ({
						nodeId: change.nodeId,
						patch: {
							parentId: change.beforeParentId,
							zIndex: change.beforeZIndex,
						},
					})),
				);
			}
			return;
		}
		projectStore.restoreCanvasNodeForHistory(entry.createdFrame);
		if (entry.reparentChanges.length > 0) {
			projectStore.updateCanvasNodeLayoutBatch(
				entry.reparentChanges.map((change) => ({
					nodeId: change.nodeId,
					patch: {
						parentId: change.afterParentId,
						zIndex: change.afterZIndex,
					},
				})),
			);
		}
	}
};

const resolveSceneIdFromTimelineItem = (
	entry: Pick<SceneTimelineHistoryItem, "timelineRef" | "sceneId">,
): string | null => {
	if (entry.timelineRef?.sceneId) return entry.timelineRef.sceneId;
	if (entry.sceneId) return entry.sceneId;
	return null;
};

const applyEntryToBaselineSnapshot = (
	snapshot: {
		canvas: CanvasDocument;
		scenes: Record<string, SceneDocument>;
	},
	entry: StudioHistoryEntry,
	mode: "undo" | "redo",
): void => {
	if (entry.kind === "timeline.ot") {
		const sceneId = entry.timelineRef?.sceneId ?? entry.sceneId;
		if (!sceneId) return;
		const scene = snapshot.scenes[sceneId];
		if (!scene) return;
		snapshot.scenes[sceneId] = {
			...scene,
			timeline: applyTimelineOtCommandToTimeline({
				timeline: scene.timeline,
				command: entry.command,
				mode,
			}),
		};
		return;
	}
	if (entry.kind === "scene.timeline") {
		const sceneId = resolveSceneIdFromTimelineItem(entry);
		if (!sceneId) return;
		const scene = snapshot.scenes[sceneId];
		if (!scene) return;
		snapshot.scenes[sceneId] = {
			...scene,
			timeline: mode === "undo" ? entry.before : entry.after,
		};
		return;
	}
	if (entry.kind === "scene.timeline.batch") {
		for (const item of entry.entries) {
			const sceneId = resolveSceneIdFromTimelineItem(item);
			if (!sceneId) continue;
			const scene = snapshot.scenes[sceneId];
			if (!scene) continue;
			snapshot.scenes[sceneId] = {
				...scene,
				timeline: mode === "undo" ? item.before : item.after,
			};
		}
		return;
	}
	if (entry.kind === "canvas.node-layout") {
		const patch = mode === "undo" ? entry.before : entry.after;
		snapshot.canvas.nodes = snapshot.canvas.nodes.map((node) =>
			node.id === entry.nodeId ? { ...node, ...patch } : node,
		);
		return;
	}
	if (entry.kind === "canvas.node-update") {
		const nextNode = mode === "undo" ? entry.before : entry.after;
		snapshot.canvas.nodes = snapshot.canvas.nodes.map((node) =>
			node.id === entry.nodeId ? nextNode : node,
		);
		return;
	}
	if (entry.kind === "canvas.node-layout.batch") {
		for (const item of entry.entries) {
			const patch = mode === "undo" ? item.before : item.after;
			snapshot.canvas.nodes = snapshot.canvas.nodes.map((node) =>
				node.id === item.nodeId ? { ...node, ...patch } : node,
			);
		}
		return;
	}
	if (entry.kind === "canvas.node-create") {
		if (mode === "undo") {
			snapshot.canvas.nodes = snapshot.canvas.nodes.filter(
				(node) => node.id !== entry.node.id,
			);
			if (entry.node.type === "scene" && entry.scene) {
				const { [entry.scene.id]: _removed, ...rest } = snapshot.scenes;
				snapshot.scenes = rest;
			}
			return;
		}
		snapshot.canvas.nodes = [
			...snapshot.canvas.nodes.filter((node) => node.id !== entry.node.id),
			entry.node,
		];
		if (entry.node.type === "scene" && entry.scene) {
			snapshot.scenes = {
				...snapshot.scenes,
				[entry.scene.id]: entry.scene,
			};
		}
		return;
	}
	if (entry.kind === "canvas.node-create.batch") {
		if (mode === "undo") {
			const removedIds = new Set(entry.entries.map((item) => item.node.id));
			snapshot.canvas.nodes = snapshot.canvas.nodes.filter(
				(node) => !removedIds.has(node.id),
			);
			for (const item of entry.entries) {
				if (item.node.type !== "scene" || !item.scene) continue;
				const { [item.scene.id]: _removed, ...rest } = snapshot.scenes;
				snapshot.scenes = rest;
			}
			return;
		}
		const removedIds = new Set(entry.entries.map((item) => item.node.id));
		snapshot.canvas.nodes = snapshot.canvas.nodes.filter(
			(node) => !removedIds.has(node.id),
		);
		for (const item of entry.entries) {
			snapshot.canvas.nodes.push(item.node);
			if (item.node.type !== "scene" || !item.scene) continue;
			snapshot.scenes = {
				...snapshot.scenes,
				[item.scene.id]: item.scene,
			};
		}
		return;
	}
	if (entry.kind === "canvas.node-delete") {
		if (mode === "undo") {
			snapshot.canvas.nodes = [
				...snapshot.canvas.nodes.filter((node) => node.id !== entry.node.id),
				entry.node,
			];
			if (entry.node.type === "scene" && entry.scene) {
				snapshot.scenes = {
					...snapshot.scenes,
					[entry.scene.id]: entry.scene,
				};
			}
			return;
		}
		snapshot.canvas.nodes = snapshot.canvas.nodes.filter(
			(node) => node.id !== entry.node.id,
		);
		if (entry.node.type === "scene" && entry.scene) {
			const { [entry.scene.id]: _removed, ...rest } = snapshot.scenes;
			snapshot.scenes = rest;
		}
		return;
	}
	if (entry.kind === "canvas.node-delete.batch") {
		if (mode === "undo") {
			const deletedIds = new Set(entry.entries.map((item) => item.node.id));
			snapshot.canvas.nodes = snapshot.canvas.nodes.filter(
				(node) => !deletedIds.has(node.id),
			);
			for (const item of entry.entries) {
				snapshot.canvas.nodes.push(item.node);
				if (item.node.type !== "scene" || !item.scene) continue;
				snapshot.scenes = {
					...snapshot.scenes,
					[item.scene.id]: item.scene,
				};
			}
			return;
		}
		const deletedIds = new Set(entry.entries.map((item) => item.node.id));
		snapshot.canvas.nodes = snapshot.canvas.nodes.filter(
			(node) => !deletedIds.has(node.id),
		);
		for (const item of entry.entries) {
			if (item.node.type !== "scene" || !item.scene) continue;
			const { [item.scene.id]: _removed, ...rest } = snapshot.scenes;
			snapshot.scenes = rest;
		}
		return;
	}
	if (entry.kind === "canvas.frame-create") {
		if (mode === "undo") {
			snapshot.canvas.nodes = snapshot.canvas.nodes.filter(
				(node) => node.id !== entry.createdFrame.id,
			);
			if (entry.reparentChanges.length > 0) {
				const parentById = new Map(
					entry.reparentChanges.map((change) => [change.nodeId, change]),
				);
				snapshot.canvas.nodes = snapshot.canvas.nodes.map((node) => {
					const change = parentById.get(node.id);
					if (!change) return node;
					return {
						...node,
						parentId: change.beforeParentId,
						zIndex: change.beforeZIndex,
					};
				});
			}
			return;
		}
		snapshot.canvas.nodes = [
			...snapshot.canvas.nodes.filter(
				(node) => node.id !== entry.createdFrame.id,
			),
			entry.createdFrame,
		];
		if (entry.reparentChanges.length > 0) {
			const parentById = new Map(
				entry.reparentChanges.map((change) => [change.nodeId, change]),
			);
			snapshot.canvas.nodes = snapshot.canvas.nodes.map((node) => {
				const change = parentById.get(node.id);
				if (!change) return node;
				return {
					...node,
					parentId: change.afterParentId,
					zIndex: change.afterZIndex,
				};
			});
		}
	}
};

const deriveBaselineFromEntry = (
	project: StudioProject,
	entry: StudioHistoryEntry,
): {
	canvas: CanvasDocument;
	scenes: Record<string, SceneDocument>;
} => {
	const snapshot = {
		canvas: cloneJson(project.canvas),
		scenes: cloneJson(project.scenes),
	};
	applyEntryToBaselineSnapshot(snapshot, entry, "undo");
	return snapshot;
};

const buildEntriesByStream = (
	entries: StudioHistoryEntryWithMeta[],
): Record<string, StudioHistoryEntryWithMeta[]> => {
	const result: Record<string, StudioHistoryEntryWithMeta[]> = {};
	for (const entry of entries) {
		const streamIds = resolveEntryStreamIds(entry);
		for (const streamId of streamIds) {
			const existing = result[streamId] ?? [];
			result[streamId] = trimEntries(mergeLatestTimelineEntry(existing, entry));
		}
	}
	return result;
};

const rebuildLatestTimelineOpIdsFromPast = (
	past: StudioHistoryEntryWithMeta[],
): Record<string, string | undefined> => {
	let latest: Record<string, string | undefined> = {};
	for (const entry of past) {
		if (entry.kind === "timeline.ot") {
			if (!isRootEntry(entry)) continue;
			const sceneId = entry.timelineRef?.sceneId ?? entry.sceneId;
			if (!sceneId) continue;
			latest = {
				...latest,
				[sceneId]: getEntryOpId(entry),
			};
			continue;
		}
		if (entry.kind === "scene.timeline") {
			const sceneId = entry.timelineRef?.sceneId ?? entry.sceneId;
			if (!sceneId) continue;
			latest = {
				...latest,
				[sceneId]: getEntryOpId(entry),
			};
			continue;
		}
		if (entry.kind === "scene.timeline.batch") {
			for (const item of entry.entries) {
				const sceneId = item.timelineRef?.sceneId ?? item.sceneId;
				if (!sceneId) continue;
				latest = {
					...latest,
					[sceneId]: entry.opId,
				};
			}
		}
	}
	return latest;
};

const recomputeActorFlags = (
	actorStacks: Record<LabActorId, ActorHistoryStacks>,
	activeActorId: LabActorId,
): { canUndo: boolean; canRedo: boolean } => {
	const actorStack = actorStacks[activeActorId];
	return {
		canUndo: actorStack.past.length > 0,
		canRedo: actorStack.future.length > 0,
	};
};

const resolveCompensationStreamIds = (
	targetEntry: StudioHistoryEntryWithMeta,
): OtStreamId[] => {
	if (targetEntry.kind === "scene.timeline.batch") {
		return Array.from(
			new Set(
				targetEntry.entries
					.map((item) => item.timelineRef?.sceneId ?? item.sceneId)
					.filter((sceneId): sceneId is string => Boolean(sceneId))
					.map((sceneId) => `timeline:${sceneId}` as OtStreamId),
			),
		);
	}
	return [targetEntry.__streamId ?? resolveHistoryStreamId(targetEntry)];
};

const restoreBaselineToProject = (params: {
	canvas: CanvasDocument;
	scenes: Record<string, SceneDocument>;
}) => {
	const baselineCanvas = cloneJson(params.canvas);
	const baselineScenes = cloneJson(params.scenes);
	useProjectStore.setState((state) => {
		if (!state.currentProject) return state;
		return {
			currentProject: {
				...state.currentProject,
				canvas: baselineCanvas,
				scenes: baselineScenes,
			},
		};
	});
};

const replayPastEntries = (
	entries: StudioHistoryEntryWithMeta[],
	baseline: {
		canvas: CanvasDocument;
		scenes: Record<string, SceneDocument>;
	},
	options?: HistoryApplyOptions,
) => {
	restoreBaselineToProject(baseline);
	if (options?.runtimeManager) {
		// 撤销/重做前先把 runtime 拉回同一基线，避免在旧 runtime 状态上重复叠加命令。
		for (const [sceneId, scene] of Object.entries(baseline.scenes)) {
			const runtime = options.runtimeManager.ensureTimelineRuntime(
				toSceneTimelineRef(sceneId),
			);
			applyTimelineJsonToStore(scene.timeline, runtime.timelineStore);
		}
	}
	const orderedEntries = [...entries].sort((left, right) => {
		const leftSeq = left.__seq ?? Number.MAX_SAFE_INTEGER;
		const rightSeq = right.__seq ?? Number.MAX_SAFE_INTEGER;
		if (leftSeq !== rightSeq) return leftSeq - rightSeq;
		const leftOpId = left.__otOpId ?? "";
		const rightOpId = right.__otOpId ?? "";
		return leftOpId.localeCompare(rightOpId);
	});
	for (const entry of orderedEntries) {
		applyEntry(entry, "redo", options);
	}
};

const syncProjectOtSnapshot = () => {
	const snapshot = historyEngine.getSnapshot();
	useProjectStore.setState((state) => {
		if (!state.currentProject) return state;
		return {
			currentProject: {
				...state.currentProject,
				ot: mergeStudioOtSnapshot(state.currentProject.ot, snapshot),
			},
		};
	});
};

const ensureProjectScope = (
	state: StudioHistoryState,
	set: (partial: Partial<StudioHistoryState>) => void,
): { ready: boolean; project: StudioProject | null } => {
	const currentProject = useProjectStore.getState().currentProject;
	if (!currentProject) return { ready: false, project: null };
	if (state.projectId === currentProject.id) {
		return { ready: true, project: currentProject };
	}
	historyEngine = createHistoryEngine();
	set({
		past: [],
		future: [],
		pastByStream: {},
		futureByStream: {},
		opLog: [],
		isApplying: false,
		canUndo: false,
		canRedo: false,
		latestTimelineOpIds: {},
		actorStacks: createEmptyActorStacks(),
		redoClosures: createEmptyRedoClosures(),
		projectId: currentProject.id,
		baselineCanvas: cloneJson(currentProject.canvas),
		baselineScenes: cloneJson(currentProject.scenes),
	});
	syncProjectOtSnapshot();
	return { ready: true, project: currentProject };
};

const buildNoopCommand = (reason: string): StudioOtCommand => ({
	id: "studio.noop",
	args: { reason },
});

export const useStudioHistoryStore = create<StudioHistoryState>((set, get) => ({
	past: [],
	future: [],
	pastByStream: {},
	futureByStream: {},
	opLog: [],
	isApplying: false,
	canUndo: false,
	canRedo: false,
	latestTimelineOpIds: {},
	activeActorId: "user-1",
	actorStacks: createEmptyActorStacks(),
	redoClosures: createEmptyRedoClosures(),
	projectId: null,
	baselineCanvas: null,
	baselineScenes: null,
	push: (entry) => {
		const scope = ensureProjectScope(get(), set);
		if (!scope.ready || !scope.project) return;
		const scopedProject = scope.project;
		const normalizedEntry = stripUiStateFromHistoryEntry(entry);
		const actorId = get().activeActorId;
		const streamId = resolveHistoryStreamId(normalizedEntry);
		const incomingTxnId =
			normalizedEntry.kind === "timeline.ot"
				? normalizedEntry.txnId
				: normalizedEntry.kind === "scene.timeline" ||
						normalizedEntry.kind === "scene.timeline.batch"
					? normalizedEntry.opId
					: undefined;
		const intent = resolveEntryIntent(normalizedEntry);
		const otOp = historyEngine.applyLocal({
			streamId,
			command: toOtCommand(normalizedEntry),
			txnId: incomingTxnId,
			causedBy:
				normalizedEntry.kind === "timeline.ot" ? normalizedEntry.causedBy : [],
			actorId,
		});
		set((state) => {
			const nextEntry = toEntryWithMeta(normalizedEntry, {
				opId: otOp.opId,
				streamId,
				actorId,
				seq: otOp.seq,
				causedBy: otOp.causedBy,
				intent,
			});
			const nextPast = trimEntries(
				mergeGlobalTimelineEntry(state.past, nextEntry),
			);
			const nextActorPast = isRootEntry(nextEntry)
				? trimEntries(
						mergeGlobalTimelineEntry(
							state.actorStacks[actorId].past,
							nextEntry,
						),
					)
				: state.actorStacks[actorId].past;
			const nextActorStacks: Record<LabActorId, ActorHistoryStacks> = {
				...state.actorStacks,
				[actorId]: {
					past: nextActorPast,
					future: [],
				},
			};
			const nextRedoClosures = {
				...state.redoClosures,
				[actorId]: {},
			};

			let baselineCanvas = state.baselineCanvas;
			let baselineScenes = state.baselineScenes;
			if (state.past.length === 0) {
				const baseline = deriveBaselineFromEntry(
					scopedProject,
					normalizedEntry,
				);
				baselineCanvas = baseline.canvas;
				baselineScenes = baseline.scenes;
			}

			const activeActorFuture = nextActorStacks[state.activeActorId].future;
			const flags = recomputeActorFlags(nextActorStacks, state.activeActorId);
			return {
				past: nextPast,
				future: activeActorFuture,
				pastByStream: buildEntriesByStream(nextPast),
				futureByStream: buildEntriesByStream(activeActorFuture),
				opLog: historyEngine.getSnapshot().opLog,
				latestTimelineOpIds: rebuildLatestTimelineOpIdsFromPast(nextPast),
				actorStacks: nextActorStacks,
				redoClosures: nextRedoClosures,
				baselineCanvas,
				baselineScenes,
				...flags,
			};
		});
		syncProjectOtSnapshot();
	},
	undo: (options) => {
		const scope = ensureProjectScope(get(), set);
		if (!scope.ready) return;
		const stateSnapshot = get();
		const actorId = stateSnapshot.activeActorId;
		const actorPast = stateSnapshot.actorStacks[actorId].past;
		const targetEntry = actorPast[actorPast.length - 1];
		if (!targetEntry) return;
		if (!stateSnapshot.baselineCanvas || !stateSnapshot.baselineScenes) {
			return;
		}

		set({ isApplying: true });
		try {
			const targetOpId =
				targetEntry.__otOpId ?? getEntryOpId(targetEntry) ?? "";
			const closureOpIds = collectCausalClosureOpIds(
				stateSnapshot.past,
				targetOpId ? [targetOpId] : [],
			);
			const removedEntries =
				closureOpIds.size > 0
					? stateSnapshot.past.filter((entry) =>
							entry.__otOpId ? closureOpIds.has(entry.__otOpId) : false,
						)
					: [targetEntry];

			const undoTxnId = createCompensationTxnId("undo");
			const compensationStreamIds = Array.from(
				new Set(
					(removedEntries.length > 0 ? removedEntries : [targetEntry]).flatMap(
						(entry) => resolveCompensationStreamIds(entry),
					),
				),
			);
			for (const streamId of compensationStreamIds) {
				const sourceOpId = targetEntry.__otOpId;
				historyEngine.applyLocal({
					streamId,
					command:
						targetEntry.kind === "scene.timeline.batch"
							? buildNoopCommand("undo:timeline-batch")
							: buildNoopCommand(`undo:${targetEntry.kind}`),
					causedBy: sourceOpId ? [sourceOpId] : [],
					inverseOf: sourceOpId,
					txnId: undoTxnId,
					trackUndo: false,
					actorId,
				});
			}

			const nextPast =
				closureOpIds.size > 0
					? stateSnapshot.past.filter((entry) =>
							entry.__otOpId ? !closureOpIds.has(entry.__otOpId) : true,
						)
					: removeEntryFromList(stateSnapshot.past, targetEntry);
			const nextActorPast = actorPast.slice(0, -1);
			const nextActorFuture = [
				targetEntry,
				...stateSnapshot.actorStacks[actorId].future,
			];
			const nextActorStacks: Record<LabActorId, ActorHistoryStacks> = {
				...stateSnapshot.actorStacks,
				[actorId]: {
					past: nextActorPast,
					future: nextActorFuture,
				},
			};
			const actorClosures = stateSnapshot.redoClosures[actorId] ?? {};
			const nextRedoClosures: Record<LabActorId, ActorRedoClosureMap> = {
				...stateSnapshot.redoClosures,
				[actorId]: {
					...actorClosures,
					[targetOpId]: removedEntries,
				},
			};

			replayPastEntries(
				nextPast,
				{
					canvas: stateSnapshot.baselineCanvas,
					scenes: stateSnapshot.baselineScenes,
				},
				options,
			);

			const activeActorFuture =
				nextActorStacks[stateSnapshot.activeActorId].future;
			const flags = recomputeActorFlags(
				nextActorStacks,
				stateSnapshot.activeActorId,
			);
			set({
				past: nextPast,
				future: activeActorFuture,
				pastByStream: buildEntriesByStream(nextPast),
				futureByStream: buildEntriesByStream(activeActorFuture),
				opLog: historyEngine.getSnapshot().opLog,
				latestTimelineOpIds: rebuildLatestTimelineOpIdsFromPast(nextPast),
				actorStacks: nextActorStacks,
				redoClosures: nextRedoClosures,
				...flags,
			});
			syncProjectOtSnapshot();
		} finally {
			set({ isApplying: false });
		}
	},
	redo: (options) => {
		const scope = ensureProjectScope(get(), set);
		if (!scope.ready) return;
		const stateSnapshot = get();
		const actorId = stateSnapshot.activeActorId;
		const actorFuture = stateSnapshot.actorStacks[actorId].future;
		const targetEntry = actorFuture[0];
		if (!targetEntry) return;
		if (!stateSnapshot.baselineCanvas || !stateSnapshot.baselineScenes) {
			return;
		}

		set({ isApplying: true });
		try {
			const targetOpId =
				targetEntry.__otOpId ?? getEntryOpId(targetEntry) ?? "";
			const actorClosures = stateSnapshot.redoClosures[actorId] ?? {};
			const redoEntries =
				targetOpId && actorClosures[targetOpId]
					? actorClosures[targetOpId]
					: [targetEntry];
			const redoTxnId = createCompensationTxnId("redo");
			const compensationStreamIds = Array.from(
				new Set(
					redoEntries.flatMap((entry) => resolveCompensationStreamIds(entry)),
				),
			);
			for (const streamId of compensationStreamIds) {
				const sourceOpId = targetEntry.__otOpId;
				historyEngine.applyLocal({
					streamId,
					command: buildNoopCommand(`redo:${targetEntry.kind}`),
					causedBy: sourceOpId ? [sourceOpId] : [],
					txnId: redoTxnId,
					trackUndo: false,
					actorId,
				});
			}

			const nextPast = redoEntries.reduce(
				(acc, entry) => insertEntryBySeq(acc, entry),
				stateSnapshot.past,
			);
			const nextActorPast = trimEntries([
				...stateSnapshot.actorStacks[actorId].past,
				targetEntry,
			]);
			const nextActorFuture =
				stateSnapshot.actorStacks[actorId].future.slice(1);
			const nextActorStacks: Record<LabActorId, ActorHistoryStacks> = {
				...stateSnapshot.actorStacks,
				[actorId]: {
					past: nextActorPast,
					future: nextActorFuture,
				},
			};
			const { [targetOpId]: _removedClosure, ...restClosures } = actorClosures;
			const nextRedoClosures: Record<LabActorId, ActorRedoClosureMap> = {
				...stateSnapshot.redoClosures,
				[actorId]: restClosures,
			};

			replayPastEntries(
				nextPast,
				{
					canvas: stateSnapshot.baselineCanvas,
					scenes: stateSnapshot.baselineScenes,
				},
				options,
			);

			const activeActorFuture =
				nextActorStacks[stateSnapshot.activeActorId].future;
			const flags = recomputeActorFlags(
				nextActorStacks,
				stateSnapshot.activeActorId,
			);
			set({
				past: nextPast,
				future: activeActorFuture,
				pastByStream: buildEntriesByStream(nextPast),
				futureByStream: buildEntriesByStream(activeActorFuture),
				opLog: historyEngine.getSnapshot().opLog,
				latestTimelineOpIds: rebuildLatestTimelineOpIdsFromPast(nextPast),
				actorStacks: nextActorStacks,
				redoClosures: nextRedoClosures,
				...flags,
			});
			syncProjectOtSnapshot();
		} finally {
			set({ isApplying: false });
		}
	},
	clear: () => {
		historyEngine = createHistoryEngine();
		const currentProject = useProjectStore.getState().currentProject;
		const state = get();
		set({
			past: [],
			future: [],
			pastByStream: {},
			futureByStream: {},
			opLog: [],
			isApplying: false,
			canUndo: false,
			canRedo: false,
			latestTimelineOpIds: {},
			actorStacks: createEmptyActorStacks(),
			redoClosures: createEmptyRedoClosures(),
			projectId: currentProject?.id ?? null,
			baselineCanvas: currentProject ? cloneJson(currentProject.canvas) : null,
			baselineScenes: currentProject ? cloneJson(currentProject.scenes) : null,
			activeActorId: state.activeActorId,
		});
		syncProjectOtSnapshot();
	},
	setActiveActor: (actorId) => {
		set((state) => {
			const flags = recomputeActorFlags(state.actorStacks, actorId);
			return {
				activeActorId: actorId,
				future: state.actorStacks[actorId].future,
				futureByStream: buildEntriesByStream(state.actorStacks[actorId].future),
				...flags,
			};
		});
	},
	getLatestTimelineOpId: (sceneId) => {
		return get().latestTimelineOpIds[sceneId];
	},
	getActorStacks: (actorId) => {
		const stacks = get().actorStacks[actorId];
		return {
			past: stacks.past,
			future: stacks.future,
		};
	},
	getActorOps: (actorId) => {
		return get().opLog.filter((op) => op.actorId === actorId);
	},
}));
