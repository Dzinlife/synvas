import type { ModelRegistryClass } from "@/dsl/model/registry";
import type { TimelineStoreApi } from "@/editor/contexts/TimelineContext";

export type TimelineRef = {
	kind: "scene";
	sceneId: string;
};

export type TimelineRuntimeId = string;

export interface TimelineRuntime {
	id: TimelineRuntimeId;
	ref: TimelineRef;
	timelineStore: TimelineStoreApi;
	modelRegistry: ModelRegistryClass;
}

export interface StudioRuntimeManager {
	ensureTimelineRuntime: (ref: TimelineRef) => TimelineRuntime;
	removeTimelineRuntime: (ref: TimelineRef) => void;
	getTimelineRuntime: (ref: TimelineRef) => TimelineRuntime | null;
	listTimelineRuntimes: () => TimelineRuntime[];
	setActiveEditTimeline: (ref: TimelineRef | null) => void;
	getActiveEditTimelineRef: () => TimelineRef | null;
	getActiveEditTimelineRuntime: () => TimelineRuntime | null;
}

export interface EditorRuntime {
	id: string;
	/**
	 * 为兼容存量调用保留：
	 * 返回当前 active timeline runtime（若不存在则返回 fallback runtime）。
	 */
	timelineStore: TimelineStoreApi;
	/**
	 * 为兼容存量调用保留：
	 * 返回当前 active timeline runtime（若不存在则返回 fallback runtime）。
	 */
	modelRegistry: ModelRegistryClass;
}

export interface StudioRuntime extends EditorRuntime, StudioRuntimeManager {}
