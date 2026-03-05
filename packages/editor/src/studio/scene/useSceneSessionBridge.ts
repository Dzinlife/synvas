import { useEffect, useMemo } from "react";
import { useProjectStore } from "@/projects/projectStore";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import { toSceneTimelineRef } from "./timelineRefAdapter";

export const useSceneSessionBridge = (): void => {
	const runtimeManager = useStudioRuntimeManager();
	const activeSceneId = useProjectStore(
		(state) => state.currentProject?.ui.activeSceneId ?? null,
	);

	const activeTimelineRef = useMemo(
		() => (activeSceneId ? toSceneTimelineRef(activeSceneId) : null),
		[activeSceneId],
	);

	useEffect(() => {
		runtimeManager.setActiveEditTimeline(activeTimelineRef);
	}, [activeTimelineRef, runtimeManager]);
};
