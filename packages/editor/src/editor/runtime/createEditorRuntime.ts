import { createModelRegistry } from "@/dsl/model/registry";
import { createTimelineStore } from "@/editor/contexts/TimelineContext";
import type {
	EditorRuntime,
	StudioRuntime,
	TimelineRef,
	TimelineRuntime,
	TimelineRuntimeId,
} from "./types";

const createRuntimeId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `runtime-${crypto.randomUUID()}`;
	}
	return `runtime-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const buildTimelineRuntimeId = (ref: TimelineRef): TimelineRuntimeId => {
	return `${ref.kind}:${ref.sceneId}`;
};

const isTimelineRefEqual = (a: TimelineRef, b: TimelineRef): boolean => {
	return a.kind === b.kind && a.sceneId === b.sceneId;
};

const createTimelineRuntime = (ref: TimelineRef): TimelineRuntime => ({
	id: buildTimelineRuntimeId(ref),
	ref,
	timelineStore: createTimelineStore(),
	modelRegistry: createModelRegistry(),
});

const FALLBACK_REF: TimelineRef = {
	kind: "scene",
	sceneId: "__fallback__",
};

export const createEditorRuntime = (options?: {
	id?: string;
}): EditorRuntime => {
	const runtimes = new Map<TimelineRuntimeId, TimelineRuntime>();
	const fallbackRuntime = createTimelineRuntime(FALLBACK_REF);
	let activeEditRef: TimelineRef | null = null;

	const ensureTimelineRuntime = (ref: TimelineRef): TimelineRuntime => {
		const id = buildTimelineRuntimeId(ref);
		const existed = runtimes.get(id);
		if (existed) return existed;
		const created = createTimelineRuntime(ref);
		runtimes.set(id, created);
		return created;
	};

	const getTimelineRuntime = (ref: TimelineRef): TimelineRuntime | null => {
		return runtimes.get(buildTimelineRuntimeId(ref)) ?? null;
	};

	const removeTimelineRuntime = (ref: TimelineRef): void => {
		const id = buildTimelineRuntimeId(ref);
		const target = runtimes.get(id);
		if (!target) return;
		for (const modelId of target.modelRegistry.getIds()) {
			target.modelRegistry.unregister(modelId);
		}
		runtimes.delete(id);
		if (activeEditRef && isTimelineRefEqual(activeEditRef, ref)) {
			activeEditRef = null;
		}
	};

	const getActiveEditTimelineRuntime = (): TimelineRuntime | null => {
		if (!activeEditRef) return null;
		return getTimelineRuntime(activeEditRef);
	};

	const setActiveEditTimeline = (ref: TimelineRef | null): void => {
		if (!ref) {
			activeEditRef = null;
			return;
		}
		ensureTimelineRuntime(ref);
		activeEditRef = ref;
	};

	const runtime: StudioRuntime = {
		id: options?.id ?? createRuntimeId(),
		get timelineStore() {
			return (
				getActiveEditTimelineRuntime()?.timelineStore ??
				fallbackRuntime.timelineStore
			);
		},
		get modelRegistry() {
			return (
				getActiveEditTimelineRuntime()?.modelRegistry ??
				fallbackRuntime.modelRegistry
			);
		},
		ensureTimelineRuntime,
		removeTimelineRuntime,
		getTimelineRuntime,
		listTimelineRuntimes: () => Array.from(runtimes.values()),
		setActiveEditTimeline,
		getActiveEditTimelineRef: () => activeEditRef,
		getActiveEditTimelineRuntime,
	};

	return runtime;
};
