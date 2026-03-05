import type { TimelineJSON } from "core/editor/timelineLoader";
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
	focusNodeId: string | null;
	opId?: string;
};

type SceneTimelineBatchHistoryEntry = {
	kind: "scene.timeline.batch";
	entries: SceneTimelineHistoryItem[];
	focusNodeId: string | null;
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
			kind: "canvas.node-create";
			node: CanvasNode;
			scene?: SceneDocument;
			focusNodeId: string | null;
	  };

interface StudioHistoryState {
	past: StudioHistoryEntry[];
	future: StudioHistoryEntry[];
	isApplying: boolean;
	canUndo: boolean;
	canRedo: boolean;
	push: (entry: StudioHistoryEntry) => void;
	undo: (options?: HistoryApplyOptions) => void;
	redo: (options?: HistoryApplyOptions) => void;
	clear: () => void;
}

const HISTORY_LIMIT = 200;

interface HistoryApplyOptions {
	timelineStore?: TimelineStoreApi;
	runtimeManager?: StudioRuntimeManager;
}

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

const tryMergeSceneTimelineEntry = (
	past: StudioHistoryEntry[],
	nextEntry: SceneTimelineHistoryEntry,
): StudioHistoryEntry | null => {
	const lastEntry = past[past.length - 1];
	if (!lastEntry || !nextEntry.opId) return null;
	if (lastEntry.kind === "scene.timeline") {
		if (lastEntry.opId !== nextEntry.opId) return null;
		const lastKey = resolveSceneTimelineKey(lastEntry);
		const nextKey = resolveSceneTimelineKey(nextEntry);
		if (lastKey && nextKey && lastKey === nextKey) {
			return {
				...lastEntry,
				after: nextEntry.after,
			};
		}
		return {
			kind: "scene.timeline.batch",
			opId: nextEntry.opId,
			focusNodeId: lastEntry.focusNodeId,
			entries: mergeSceneTimelineBatchEntries(
				[toSceneTimelineHistoryItem(lastEntry)],
				toSceneTimelineHistoryItem(nextEntry),
			),
		};
	}
	if (lastEntry.kind === "scene.timeline.batch") {
		if (lastEntry.opId !== nextEntry.opId) return null;
		return {
			...lastEntry,
			entries: mergeSceneTimelineBatchEntries(
				lastEntry.entries,
				toSceneTimelineHistoryItem(nextEntry),
			),
		};
	}
	return null;
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
	const nextFocusNodeId = entry.focusNodeId;
	projectStore.setFocusedNode(nextFocusNodeId);
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
	}
};

export const useStudioHistoryStore = create<StudioHistoryState>((set, get) => ({
	past: [],
	future: [],
	isApplying: false,
	canUndo: false,
	canRedo: false,
	push: (entry) => {
		set((state) => {
			if (entry.kind === "scene.timeline") {
				const mergedEntry = tryMergeSceneTimelineEntry(state.past, entry);
				if (mergedEntry) {
					const nextPast = [...state.past.slice(0, -1), mergedEntry];
					return {
						past: nextPast,
						future: [],
						canUndo: nextPast.length > 0,
						canRedo: false,
					};
				}
			}

			const nextPast = [...state.past, entry];
			const trimmedPast =
				nextPast.length > HISTORY_LIMIT
					? nextPast.slice(nextPast.length - HISTORY_LIMIT)
					: nextPast;
			return {
				past: trimmedPast,
				future: [],
				canUndo: trimmedPast.length > 0,
				canRedo: false,
			};
		});
	},
	undo: (options) => {
		const { past, future } = get();
		if (past.length === 0) return;
		const entry = past[past.length - 1];
		set({ isApplying: true });
		try {
			applyEntry(entry, "undo", options);
			const nextPast = past.slice(0, -1);
			const nextFuture = [entry, ...future];
			set({
				past: nextPast,
				future: nextFuture,
				canUndo: nextPast.length > 0,
				canRedo: nextFuture.length > 0,
			});
		} finally {
			set({ isApplying: false });
		}
	},
	redo: (options) => {
		const { past, future } = get();
		if (future.length === 0) return;
		const entry = future[0];
		set({ isApplying: true });
		try {
			applyEntry(entry, "redo", options);
			const nextFuture = future.slice(1);
			const nextPast = [...past, entry];
			set({
				past: nextPast,
				future: nextFuture,
				canUndo: nextPast.length > 0,
				canRedo: nextFuture.length > 0,
			});
		} finally {
			set({ isApplying: false });
		}
	},
	clear: () => {
		set({
			past: [],
			future: [],
			canUndo: false,
			canRedo: false,
		});
	},
}));
