import type {
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import { buildCompositionAudioGraph } from "./buildCompositionAudioGraph";

const availabilityCache = new Map<string, boolean>();

export const hasSceneAudibleLeafAudio = (params: {
	sceneRuntime: TimelineRuntime | null | undefined;
	runtimeManager: StudioRuntimeManager | null | undefined;
	sceneRevision?: number;
}): boolean => {
	const { sceneRuntime, runtimeManager, sceneRevision } = params;
	if (!sceneRuntime || !runtimeManager) return false;
	const effectiveRevision =
		sceneRevision ?? sceneRuntime.timelineStore.getState().revision;
	const cacheKey = `${sceneRuntime.ref.sceneId}:${effectiveRevision}`;
	const cached = availabilityCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}
	const graph = buildCompositionAudioGraph({
		rootRuntime: sceneRuntime,
		runtimeManager,
	});
	for (const [elementId, enabled] of graph.enabledMap.entries()) {
		if (!enabled) continue;
		if (
			graph.exportAudioSourceMap.has(elementId) ||
			graph.previewTargets.has(elementId)
		) {
			availabilityCache.set(cacheKey, true);
			return true;
		}
	}
	availabilityCache.set(cacheKey, false);
	return false;
};
