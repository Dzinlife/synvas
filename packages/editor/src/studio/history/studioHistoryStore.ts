import type { TimelineJSON } from "core/editor/timelineLoader";
import type { SceneDocument, SceneNode } from "core/studio/types";
import { create } from "zustand";
import { applyTimelineJsonToStore } from "@/studio/scene/timelineSession";
import { useProjectStore } from "@/projects/projectStore";

export type SceneNodeLayoutSnapshot = Pick<
	SceneNode,
	"x" | "y" | "width" | "height" | "zIndex" | "hidden" | "locked"
>;

export type StudioHistoryEntry =
	| {
			kind: "scene.timeline";
			sceneId: string;
			before: TimelineJSON;
			after: TimelineJSON;
			focusSceneId: string | null;
	  }
	| {
			kind: "canvas.scene-node-layout";
			nodeId: string;
			before: SceneNodeLayoutSnapshot;
			after: SceneNodeLayoutSnapshot;
			focusSceneId: string | null;
	  }
	| {
			kind: "canvas.scene-create";
			scene: SceneDocument;
			node: SceneNode;
			focusSceneId: string | null;
	  };

interface StudioHistoryState {
	past: StudioHistoryEntry[];
	future: StudioHistoryEntry[];
	isApplying: boolean;
	canUndo: boolean;
	canRedo: boolean;
	push: (entry: StudioHistoryEntry) => void;
	undo: () => void;
	redo: () => void;
	clear: () => void;
}

const HISTORY_LIMIT = 200;

const applyEntry = (entry: StudioHistoryEntry, mode: "undo" | "redo"): void => {
	const projectStore = useProjectStore.getState();
	const nextFocusSceneId = entry.focusSceneId;
	projectStore.setFocusedScene(nextFocusSceneId);
	if (entry.kind === "scene.timeline") {
		const timeline = mode === "undo" ? entry.before : entry.after;
		projectStore.updateSceneTimeline(entry.sceneId, timeline, {
			recordHistory: false,
		});
		const focusedSceneId = useProjectStore.getState().currentProject?.ui.focusedSceneId;
		if (focusedSceneId === entry.sceneId) {
			applyTimelineJsonToStore(timeline);
		}
		return;
	}
	if (entry.kind === "canvas.scene-node-layout") {
		const patch = mode === "undo" ? entry.before : entry.after;
		projectStore.updateSceneNodeLayout(entry.nodeId, patch);
		return;
	}
	if (entry.kind === "canvas.scene-create") {
		if (mode === "undo") {
			projectStore.removeSceneGraphForHistory(entry.scene.id, entry.node.id);
			return;
		}
		projectStore.restoreSceneGraphForHistory(entry.scene, entry.node);
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
	undo: () => {
		const { past, future } = get();
		if (past.length === 0) return;
		const entry = past[past.length - 1];
		set({ isApplying: true });
		try {
			applyEntry(entry, "undo");
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
	redo: () => {
		const { past, future } = get();
		if (future.length === 0) return;
		const entry = future[0];
		set({ isApplying: true });
		try {
			applyEntry(entry, "redo");
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
