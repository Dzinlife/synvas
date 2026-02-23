import type { EditorRuntime, StudioRuntimeManager, TimelineRef } from "./types";

interface CreateScopedStudioRuntimeParams {
	runtimeManager: EditorRuntime & StudioRuntimeManager;
	activeSceneId: string | null;
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
		return runtimeManager.ensureTimelineRuntime(toSceneTimelineRef(activeSceneId));
	}
	return runtimeManager.getActiveEditTimelineRuntime();
};

export const createScopedStudioRuntime = (
	params: CreateScopedStudioRuntimeParams,
): EditorRuntime & StudioRuntimeManager => {
	const { runtimeManager, activeSceneId } = params;
	const activeTimelineRef = activeSceneId
		? toSceneTimelineRef(activeSceneId)
		: null;

	return {
		id: runtimeManager.id,
		get timelineStore() {
			return (
				resolveScopedTimelineRuntime(runtimeManager, activeSceneId)?.timelineStore ??
				runtimeManager.timelineStore
			);
		},
		get modelRegistry() {
			return (
				resolveScopedTimelineRuntime(runtimeManager, activeSceneId)?.modelRegistry ??
				runtimeManager.modelRegistry
			);
		},
		ensureTimelineRuntime: runtimeManager.ensureTimelineRuntime,
		removeTimelineRuntime: runtimeManager.removeTimelineRuntime,
		getTimelineRuntime: runtimeManager.getTimelineRuntime,
		listTimelineRuntimes: runtimeManager.listTimelineRuntimes,
		setActiveEditTimeline: runtimeManager.setActiveEditTimeline,
		getActiveEditTimelineRef: () =>
			activeTimelineRef ?? runtimeManager.getActiveEditTimelineRef(),
		getActiveEditTimelineRuntime: () =>
			resolveScopedTimelineRuntime(runtimeManager, activeSceneId),
	};
};
