import {
	saveTimelineToObject,
	type TimelineJSON,
} from "core/editor/timelineLoader";
import { useEffect, useMemo } from "react";
import type { TimelineStore } from "@/editor/contexts/TimelineContext";
import { useStudioRuntimeManager } from "@/editor/runtime/EditorRuntimeProvider";
import { useProjectStore } from "@/projects/projectStore";
import {
	type StudioHistoryEntry,
	useStudioHistoryStore,
} from "@/studio/history/studioHistoryStore";
import {
	snapshotTimelineFromStore,
} from "@/studio/scene/timelineSession";
import { toSceneTimelineRef } from "./timelineRefAdapter";

type TimelineHistorySnapshot = TimelineStore["historyPast"][number];

const cloneAudioSettings = (audio: TimelineStore["audioSettings"]) => ({
	...audio,
	compressor: { ...audio.compressor },
});

const buildTimelineFromHistorySnapshot = (
	snapshot: TimelineHistorySnapshot,
	state: TimelineStore,
): TimelineJSON => {
	return saveTimelineToObject(
		snapshot.elements,
		state.fps,
		state.canvasSize,
		snapshot.tracks,
		{
			snapEnabled: state.snapEnabled,
			autoAttach: state.autoAttach,
			rippleEditingEnabled: snapshot.rippleEditingEnabled,
			previewAxisEnabled: state.previewAxisEnabled,
			audio: cloneAudioSettings(state.audioSettings),
		},
	);
};

export const useSceneSessionBridge = (): void => {
	const runtimeManager = useStudioRuntimeManager();
	const activeSceneId = useProjectStore(
		(state) => state.currentProject?.ui.activeSceneId ?? null,
	);
	const pushHistory = useStudioHistoryStore((state) => state.push);

	const activeTimelineRef = useMemo(
		() => (activeSceneId ? toSceneTimelineRef(activeSceneId) : null),
		[activeSceneId],
	);

	useEffect(() => {
		runtimeManager.setActiveEditTimeline(activeTimelineRef);
	}, [activeTimelineRef, runtimeManager]);

	useEffect(() => {
		if (!activeTimelineRef) return;
		const activeRuntime =
			runtimeManager.ensureTimelineRuntime(activeTimelineRef);
		const timelineStore = activeRuntime.timelineStore;
		return timelineStore.subscribe(
			(state) => state.historyPast,
			(historyPast, prevHistoryPast) => {
				if (useStudioHistoryStore.getState().isApplying) return;
				if (
					historyPast.length === 0 ||
					historyPast.length <= prevHistoryPast.length
				) {
					return;
				}

				const beforeSnapshot = historyPast[historyPast.length - 1];
				if (!beforeSnapshot) return;

				const beforeTimeline = buildTimelineFromHistorySnapshot(
					beforeSnapshot,
					timelineStore.getState(),
				);
				const afterTimeline = snapshotTimelineFromStore(timelineStore);

				const projectState = useProjectStore.getState();
				const currentProject = projectState.currentProject;
				if (!currentProject) return;

				const nextEntry: StudioHistoryEntry = {
					kind: "scene.timeline",
					timelineRef: activeTimelineRef,
					sceneId: activeTimelineRef.sceneId,
					before: beforeTimeline,
					after: afterTimeline,
					focusNodeId: currentProject.ui.focusedNodeId,
				};
				pushHistory(nextEntry);
			},
		);
	}, [activeTimelineRef, pushHistory, runtimeManager]);
};
