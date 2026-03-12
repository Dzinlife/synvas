import {
	type OtCommand,
	type OtOpEnvelope,
	type OtStreamId,
	createOtEngine,
} from "core/editor/ot";
import type { TimelineJSON } from "core/editor/timelineLoader";
import { mergeStudioOtSnapshot } from "core/studio/ot";
import type { CanvasNode, SceneDocument } from "core/studio/types";
import { create } from "zustand";
import { useProjectStore } from "@/projects/projectStore";
import type { TimelineStoreApi } from "@/scene-editor/contexts/TimelineContext";
import type {
	StudioRuntimeManager,
	TimelineRef,
} from "@/scene-editor/runtime/types";
import {
	toSceneTimelineRef,
	writeTimelineByRef,
} from "@/studio/scene/timelineRefAdapter";
import { applyTimelineJsonToStore } from "@/studio/scene/timelineSession";

export type CanvasNodeLayoutSnapshot = Pick<
	CanvasNode,
	"x" | "y" | "width" | "height" | "zIndex" | "hidden" | "locked"
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

export type StudioHistoryEntry =
	| SceneTimelineHistoryEntry
	| SceneTimelineBatchHistoryEntry
	| {
			kind: "canvas.node-layout";
			nodeId: string;
			before: CanvasNodeLayoutSnapshot;
			after: CanvasNodeLayoutSnapshot;
			focusNodeId: string | null;
	  }
	| {
			kind: "canvas.node-layout.batch";
			entries: Array<{
				nodeId: string;
				before: CanvasNodeLayoutSnapshot;
				after: CanvasNodeLayoutSnapshot;
			}>;
			focusNodeId: string | null;
	  }
	| {
			kind: "canvas.node-create";
			node: CanvasNode;
			scene?: SceneDocument;
			focusNodeId: string | null;
	  }
	| {
			kind: "canvas.node-create.batch";
			entries: CanvasGraphHistoryItem[];
			focusNodeId: string | null;
	  }
	| {
			kind: "canvas.node-delete";
			node: CanvasNode;
			scene?: SceneDocument;
			focusNodeId: string | null;
	  }
	| {
			kind: "canvas.node-delete.batch";
			entries: CanvasGraphHistoryItem[];
			focusNodeId: string | null;
	  };

type StudioHistoryEntryWithMeta = StudioHistoryEntry & {
	__otOpId?: string;
	__streamId?: OtStreamId;
};

type StudioOtCommand = OtCommand & {
	id:
		| "scene.timeline"
		| "scene.timeline.batch"
		| "canvas.node-layout"
		| "canvas.node-layout.batch"
		| "canvas.node-create"
		| "canvas.node-create.batch"
		| "canvas.node-delete"
		| "canvas.node-delete.batch";
};

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
	push: (entry: StudioHistoryEntry) => void;
	undo: (options?: HistoryApplyOptions) => void;
	redo: (options?: HistoryApplyOptions) => void;
	clear: () => void;
	getLatestTimelineOpId: (sceneId: string) => string | undefined;
}

const HISTORY_LIMIT = 200;
const CANVAS_STREAM_ID: OtStreamId = "canvas";

interface HistoryApplyOptions {
	timelineStore?: TimelineStoreApi;
	runtimeManager?: StudioRuntimeManager;
	streamId?: OtStreamId;
}

const createHistoryEngine = () => {
	return createOtEngine<StudioOtCommand>({
		actorId: "studio-local",
	});
};

let historyEngine = createHistoryEngine();

const createCompensationTxnId = (prefix: "undo" | "redo"): string => {
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
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

const toEntryWithMeta = (
	entry: StudioHistoryEntry,
	opId: string,
	streamId: OtStreamId,
): StudioHistoryEntryWithMeta => {
	return {
		...entry,
		__otOpId: opId,
		__streamId: streamId,
	};
};

const toOtCommand = (entry: StudioHistoryEntry): StudioOtCommand => {
	return {
		id: entry.kind,
		args: { entry } as Record<string, unknown>,
	};
};

const getEntryOpId = (entry: StudioHistoryEntryWithMeta): string | undefined => {
	if (entry.kind === "scene.timeline" || entry.kind === "scene.timeline.batch") {
		return entry.opId ?? entry.__otOpId;
	}
	return entry.__otOpId;
};

const trimEntries = <T,>(entries: T[]): T[] => {
	if (entries.length <= HISTORY_LIMIT) return entries;
	return entries.slice(entries.length - HISTORY_LIMIT);
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
	const nextFocusNodeId = entry.focusNodeId;
	projectStore.setFocusedNode(nextFocusNodeId);
	if (entry.kind === "canvas.node-layout") {
		const patch = mode === "undo" ? entry.before : entry.after;
		projectStore.updateCanvasNodeLayout(entry.nodeId, patch);
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
			projectStore.removeCanvasGraphBatch(entry.entries.map((item) => item.node.id));
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
		projectStore.removeCanvasGraphBatch(entry.entries.map((item) => item.node.id));
	}
};

const updateLatestTimelineOpIds = (
	latest: Record<string, string | undefined>,
	entry: StudioHistoryEntryWithMeta,
): Record<string, string | undefined> => {
	if (entry.kind === "scene.timeline") {
		const sceneId = entry.timelineRef?.sceneId ?? entry.sceneId;
		if (!sceneId) return latest;
		return {
			...latest,
			[sceneId]: getEntryOpId(entry),
		};
	}
	if (entry.kind === "scene.timeline.batch") {
		let next = latest;
		for (const item of entry.entries) {
			const sceneId = item.timelineRef?.sceneId ?? item.sceneId;
			if (!sceneId) continue;
			next = {
				...next,
				[sceneId]: entry.opId,
			};
		}
		return next;
	}
	return latest;
};

const collectLinkedEntries = (
	entriesByStream: Record<string, StudioHistoryEntryWithMeta[]>,
	seedEntry: StudioHistoryEntryWithMeta,
	mode: "undo" | "redo",
): Array<{ streamId: OtStreamId; entry: StudioHistoryEntryWithMeta }> => {
	const seedOpId = getEntryOpId(seedEntry);
	if (!seedOpId) return [];
	const result: Array<{ streamId: OtStreamId; entry: StudioHistoryEntryWithMeta }> = [];
	for (const [streamIdRaw, entries] of Object.entries(entriesByStream)) {
		const streamId = streamIdRaw as OtStreamId;
		if (entries.length === 0) continue;
		if (mode === "undo") {
			for (let index = entries.length - 1; index >= 0; index -= 1) {
				const candidate = entries[index];
				if (getEntryOpId(candidate) !== seedOpId) continue;
				result.push({ streamId, entry: candidate });
				break;
			}
			continue;
		}
		for (const candidate of entries) {
			if (getEntryOpId(candidate) !== seedOpId) continue;
			result.push({ streamId, entry: candidate });
			break;
		}
	}
	return result;
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
	if (lastEntry.kind === "scene.timeline" && lastEntry.opId === nextEntry.opId) {
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
			};
			return [...existing.slice(0, -1), mergedSingle];
		}
		const mergedBatch: StudioHistoryEntryWithMeta = {
			kind: "scene.timeline.batch",
			entries: mergedItems,
			opId: nextEntry.opId,
			__otOpId: nextEntry.__otOpId ?? lastEntry.__otOpId,
			__streamId: nextEntry.__streamId ?? lastEntry.__streamId,
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
		};
		return [...existing.slice(0, -1), mergedBatch];
	}
	return [...existing, nextEntry];
};

const recomputeFlags = (
	past: StudioHistoryEntryWithMeta[],
	future: StudioHistoryEntryWithMeta[],
) => {
	const canUndo = past.length > 0;
	const canRedo = future.length > 0;
	return { canUndo, canRedo };
};

const removeEntryFromList = <T,>(entries: T[], target: T): T[] => {
	const index = entries.lastIndexOf(target);
	if (index < 0) return entries;
	return [...entries.slice(0, index), ...entries.slice(index + 1)];
};

const resolveTrackedEntries = (
	entriesByStream: Record<string, StudioHistoryEntryWithMeta[]>,
	targetEntry: StudioHistoryEntryWithMeta,
	mode: "undo" | "redo",
): Array<{ streamId: OtStreamId; entry: StudioHistoryEntryWithMeta }> => {
	const linkedEntries = collectLinkedEntries(entriesByStream, targetEntry, mode);
	if (linkedEntries.length > 0) return linkedEntries;

	const fallbackStreamId = targetEntry.__streamId ?? resolveHistoryStreamId(targetEntry);
	const fallbackEntries = entriesByStream[fallbackStreamId] ?? [];
	if (fallbackEntries.length === 0) return [];
	if (mode === "undo") {
		const tail = fallbackEntries[fallbackEntries.length - 1];
		return tail ? [{ streamId: fallbackStreamId, entry: tail }] : [];
	}
	const head = fallbackEntries[0];
	return head ? [{ streamId: fallbackStreamId, entry: head }] : [];
};

const resolveCompensationStreamIds = (
	targetEntry: StudioHistoryEntryWithMeta,
	trackedEntries: Array<{ streamId: OtStreamId; entry: StudioHistoryEntryWithMeta }>,
): OtStreamId[] => {
	if (trackedEntries.length > 0) {
		return Array.from(new Set(trackedEntries.map((item) => item.streamId)));
	}
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
	push: (entry) => {
		const streamId = resolveHistoryStreamId(entry);
		const incomingOpId =
			entry.kind === "scene.timeline" || entry.kind === "scene.timeline.batch"
				? entry.opId
				: undefined;
		const otOp = historyEngine.applyLocal({
			streamId,
			command: toOtCommand(entry),
			txnId: incomingOpId,
		});
		set((state) => {
			const nextEntry = toEntryWithMeta(entry, otOp.opId, streamId);
			const existingStreamPast = state.pastByStream[streamId] ?? [];
			const mergedStreamPast = mergeLatestTimelineEntry(existingStreamPast, nextEntry);
			const trimmedStreamPast = trimEntries(mergedStreamPast);
			const nextPastByStream = {
				...state.pastByStream,
				[streamId]: trimmedStreamPast,
			};
			const nextFutureByStream: Record<string, StudioHistoryEntryWithMeta[]> = {};
			const nextPast = trimEntries(mergeGlobalTimelineEntry(state.past, nextEntry));
			const nextFuture: StudioHistoryEntryWithMeta[] = [];
			const flags = recomputeFlags(nextPast, nextFuture);
			return {
				pastByStream: nextPastByStream,
				futureByStream: nextFutureByStream,
				past: nextPast,
				future: nextFuture,
				opLog: historyEngine.getSnapshot().opLog,
				latestTimelineOpIds: updateLatestTimelineOpIds(
					state.latestTimelineOpIds,
					nextEntry,
				),
				...flags,
			};
		});
		syncProjectOtSnapshot();
	},
	undo: (options) => {
		const stateSnapshot = get();
		const targetEntry = stateSnapshot.past[stateSnapshot.past.length - 1];
		if (!targetEntry) return;
		set({ isApplying: true });
		try {
			const undoItems = resolveTrackedEntries(
				stateSnapshot.pastByStream,
				targetEntry,
				"undo",
			);
			applyEntry(targetEntry, "undo", options);
			const undoTxnId = createCompensationTxnId("undo");
			const compensationStreamIds = resolveCompensationStreamIds(
				targetEntry,
				undoItems,
			);
			for (const streamId of compensationStreamIds) {
				const sourceOpId = targetEntry.__otOpId;
				historyEngine.applyLocal({
					streamId,
					command: {
						id: targetEntry.kind,
						args: {
							mode: "undo",
							entry: targetEntry,
						},
					},
					causedBy: sourceOpId ? [sourceOpId] : [],
					inverseOf: sourceOpId,
					txnId: undoTxnId,
					trackUndo: false,
				});
			}

			set((state) => {
				const nextPastByStream = { ...state.pastByStream };
				const nextFutureByStream = { ...state.futureByStream };
				const nextPast = state.past.slice(0, -1);
				const nextFuture = [targetEntry, ...state.future];
				for (const item of undoItems) {
					const entries = nextPastByStream[item.streamId] ?? [];
					nextPastByStream[item.streamId] = removeEntryFromList(entries, item.entry);
					nextFutureByStream[item.streamId] = [
						item.entry,
						...(nextFutureByStream[item.streamId] ?? []),
					];
				}
				const flags = recomputeFlags(nextPast, nextFuture);
				return {
					pastByStream: nextPastByStream,
					futureByStream: nextFutureByStream,
					past: nextPast,
					future: nextFuture,
					...flags,
				};
			});
			syncProjectOtSnapshot();
		} finally {
			set({ isApplying: false });
		}
	},
	redo: (options) => {
		const stateSnapshot = get();
		const targetEntry = stateSnapshot.future[0];
		if (!targetEntry) return;
		set({ isApplying: true });
		try {
			const redoItems = resolveTrackedEntries(
				stateSnapshot.futureByStream,
				targetEntry,
				"redo",
			);
			applyEntry(targetEntry, "redo", options);
			const redoTxnId = createCompensationTxnId("redo");
			const compensationStreamIds = resolveCompensationStreamIds(
				targetEntry,
				redoItems,
			);
			for (const streamId of compensationStreamIds) {
				const sourceOpId = targetEntry.__otOpId;
				historyEngine.applyLocal({
					streamId,
					command: {
						id: targetEntry.kind,
						args: {
							mode: "redo",
							entry: targetEntry,
						},
					},
					causedBy: sourceOpId ? [sourceOpId] : [],
					txnId: redoTxnId,
					trackUndo: false,
				});
			}

			set((state) => {
				const nextPastByStream = { ...state.pastByStream };
				const nextFutureByStream = { ...state.futureByStream };
				const nextPast = trimEntries([...state.past, targetEntry]);
				const nextFuture = state.future.slice(1);
				for (const item of redoItems) {
					const entries = nextFutureByStream[item.streamId] ?? [];
					const nextEntries = [...entries];
					const index = nextEntries.indexOf(item.entry);
					if (index >= 0) {
						nextEntries.splice(index, 1);
					}
					nextFutureByStream[item.streamId] = nextEntries;
					nextPastByStream[item.streamId] = trimEntries([
						...(nextPastByStream[item.streamId] ?? []),
						item.entry,
					]);
				}
				const flags = recomputeFlags(nextPast, nextFuture);
				return {
					pastByStream: nextPastByStream,
					futureByStream: nextFutureByStream,
					past: nextPast,
					future: nextFuture,
					...flags,
				};
			});
			syncProjectOtSnapshot();
		} finally {
			set({ isApplying: false });
		}
	},
	clear: () => {
		historyEngine = createHistoryEngine();
		set({
			past: [],
			future: [],
			pastByStream: {},
			futureByStream: {},
			opLog: [],
			canUndo: false,
			canRedo: false,
			latestTimelineOpIds: {},
		});
		syncProjectOtSnapshot();
	},
	getLatestTimelineOpId: (sceneId) => {
		return get().latestTimelineOpIds[sceneId];
	},
}));
