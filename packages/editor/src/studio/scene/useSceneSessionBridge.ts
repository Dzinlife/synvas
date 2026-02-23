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
	applyTimelineJsonToStore,
	snapshotTimelineFromStore,
} from "@/studio/scene/timelineSession";
import {
	readTimelineByRef,
	toSceneTimelineRef,
	writeTimelineByRef,
} from "./timelineRefAdapter";

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

const isTimelineEqual = (a: TimelineJSON, b: TimelineJSON): boolean => {
	return JSON.stringify(a) === JSON.stringify(b);
};

export const useSceneSessionBridge = (): void => {
	const runtimeManager = useStudioRuntimeManager();
	const currentProject = useProjectStore((state) => state.currentProject);
	const activeSceneId = useProjectStore(
		(state) => state.currentProject?.ui.activeSceneId ?? null,
	);
	const updateSceneTimeline = useProjectStore(
		(state) => state.updateSceneTimeline,
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
		if (!activeTimelineRef || !currentProject) return;
		const timeline = readTimelineByRef(currentProject, activeTimelineRef);
		if (!timeline) return;
		const activeRuntime =
			runtimeManager.ensureTimelineRuntime(activeTimelineRef);
		const runtimeTimeline = snapshotTimelineFromStore(
			activeRuntime.timelineStore,
		);
		if (isTimelineEqual(runtimeTimeline, timeline)) return;
		applyTimelineJsonToStore(timeline, activeRuntime.timelineStore);
	}, [activeTimelineRef, currentProject, runtimeManager]);

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
				if (isTimelineEqual(beforeTimeline, afterTimeline)) {
					return;
				}

				const projectState = useProjectStore.getState();
				const currentProject = projectState.currentProject;
				if (!currentProject) return;

				const currentTimeline = readTimelineByRef(
					currentProject,
					activeTimelineRef,
				);
				if (
					!currentTimeline ||
					!isTimelineEqual(currentTimeline, afterTimeline)
				) {
					writeTimelineByRef(
						{
							updateSceneTimeline,
						},
						activeTimelineRef,
						afterTimeline,
						{ recordHistory: false },
					);
				}

				const nextEntry: StudioHistoryEntry = {
					kind: "scene.timeline",
					timelineRef: activeTimelineRef,
					sceneId: activeTimelineRef.sceneId,
					before: beforeTimeline,
					after: afterTimeline,
					focusSceneId: currentProject.ui.focusedSceneId,
				};
				pushHistory(nextEntry);
			},
		);
	}, [activeTimelineRef, pushHistory, runtimeManager, updateSceneTimeline]);
};
