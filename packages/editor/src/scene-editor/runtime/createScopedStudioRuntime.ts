import type { EditorRuntime, StudioRuntimeManager, TimelineRef } from "./types";

interface CreateScopedStudioRuntimeParams {
	runtimeManager: EditorRuntime & StudioRuntimeManager;
	activeSceneId: string | null | (() => string | null);
}

const toSceneTimelineRef = (sceneId: string): TimelineRef => ({
	kind: "scene",
	sceneId,
});

const resolveScopedTimelineRuntime = (
	runtimeManager: EditorRuntime & StudioRuntimeManager,
	activeSceneId: string | null,
) => {
	if (activeSceneId) {
		return runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef(activeSceneId),
		);
	}
	return runtimeManager.getActiveEditTimelineRuntime();
};

const resolveActiveSceneId = (
	value: string | null | (() => string | null),
): string | null => {
	if (typeof value === "function") {
		return value();
	}
	return value;
};

export const createScopedStudioRuntime = (
	params: CreateScopedStudioRuntimeParams,
): EditorRuntime & StudioRuntimeManager => {
	const { runtimeManager, activeSceneId } = params;

	return {
		id: runtimeManager.id,
		get timelineStore() {
			const resolvedActiveSceneId = resolveActiveSceneId(activeSceneId);
			return (
				resolveScopedTimelineRuntime(runtimeManager, resolvedActiveSceneId)
					?.timelineStore ?? runtimeManager.timelineStore
			);
		},
		get modelRegistry() {
			const resolvedActiveSceneId = resolveActiveSceneId(activeSceneId);
			return (
				resolveScopedTimelineRuntime(runtimeManager, resolvedActiveSceneId)
					?.modelRegistry ?? runtimeManager.modelRegistry
			);
		},
		ensureTimelineRuntime: runtimeManager.ensureTimelineRuntime,
		removeTimelineRuntime: runtimeManager.removeTimelineRuntime,
		getTimelineRuntime: runtimeManager.getTimelineRuntime,
		listTimelineRuntimes: runtimeManager.listTimelineRuntimes,
		setActiveEditTimeline: runtimeManager.setActiveEditTimeline,
		getActiveEditTimelineRef: () => {
			const resolvedActiveSceneId = resolveActiveSceneId(activeSceneId);
			return resolvedActiveSceneId
				? toSceneTimelineRef(resolvedActiveSceneId)
				: runtimeManager.getActiveEditTimelineRef();
		},
		getActiveEditTimelineRuntime: () => {
			return resolveScopedTimelineRuntime(
				runtimeManager,
				resolveActiveSceneId(activeSceneId),
			);
		},
	};
};
