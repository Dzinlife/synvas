import { saveTimelineToObject, type TimelineJSON } from "core/editor/timelineLoader";
import { useEffect, useRef } from "react";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import { useProjectStore } from "@/projects/projectStore";
import {
	useStudioHistoryStore,
	type StudioHistoryEntry,
} from "@/studio/history/studioHistoryStore";
import {
	applyTimelineJsonToStore,
	snapshotTimelineFromStore,
} from "@/studio/scene/timelineSession";

type TimelineHistorySnapshot = ReturnType<
	typeof useTimelineStore.getState
>["historyPast"][number];

const cloneAudioSettings = (
	audio: ReturnType<typeof useTimelineStore.getState>["audioSettings"],
) => ({
	...audio,
	compressor: { ...audio.compressor },
});

const buildTimelineFromHistorySnapshot = (
	snapshot: TimelineHistorySnapshot,
): TimelineJSON => {
	const state = useTimelineStore.getState();
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
		snapshot.assets,
	);
};

const isTimelineEqual = (a: TimelineJSON, b: TimelineJSON): boolean => {
	return JSON.stringify(a) === JSON.stringify(b);
};

export const useSceneSessionBridge = (): void => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const focusedSceneId = useProjectStore(
		(state) => state.currentProject?.ui.focusedSceneId ?? null,
	);
	const updateSceneTimeline = useProjectStore((state) => state.updateSceneTimeline);
	const setActiveScene = useProjectStore((state) => state.setActiveScene);
	const setFocusedSceneDraft = useProjectStore(
		(state) => state.setFocusedSceneDraft,
	);
	const flushFocusedSceneDraft = useProjectStore(
		(state) => state.flushFocusedSceneDraft,
	);
	const pushHistory = useStudioHistoryStore((state) => state.push);
	const previousFocusedSceneIdRef = useRef<string | null>(null);

	useEffect(() => {
		previousFocusedSceneIdRef.current = null;
	}, [currentProjectId]);

	useEffect(() => {
		const previousFocusedSceneId = previousFocusedSceneIdRef.current;
		if (previousFocusedSceneId && previousFocusedSceneId !== focusedSceneId) {
			const draft = snapshotTimelineFromStore();
			setFocusedSceneDraft(previousFocusedSceneId, draft);
			updateSceneTimeline(previousFocusedSceneId, draft, {
				recordHistory: false,
			});
		}
		if (focusedSceneId) {
			const focusedTimeline =
				useProjectStore.getState().currentProject?.scenes[focusedSceneId]?.timeline ??
				null;
			if (!focusedTimeline) {
				previousFocusedSceneIdRef.current = focusedSceneId;
				return;
			}
			setActiveScene(focusedSceneId);
			applyTimelineJsonToStore(focusedTimeline);
		}
		previousFocusedSceneIdRef.current = focusedSceneId;
	}, [
		currentProjectId,
		focusedSceneId,
		setActiveScene,
		setFocusedSceneDraft,
		updateSceneTimeline,
	]);

	useEffect(() => {
		return useTimelineStore.subscribe(
			(state) => state.historyPast,
			(historyPast, prevHistoryPast) => {
				if (!focusedSceneId) return;
				if (useStudioHistoryStore.getState().isApplying) return;
				if (historyPast.length === 0 || historyPast.length <= prevHistoryPast.length) {
					return;
				}
				const beforeSnapshot = historyPast[historyPast.length - 1];
				if (!beforeSnapshot) return;
				const beforeTimeline = buildTimelineFromHistorySnapshot(beforeSnapshot);
				const afterTimeline = snapshotTimelineFromStore();
				if (isTimelineEqual(beforeTimeline, afterTimeline)) {
					return;
				}
				const nextEntry: StudioHistoryEntry = {
					kind: "scene.timeline",
					sceneId: focusedSceneId,
					before: beforeTimeline,
					after: afterTimeline,
					focusSceneId: focusedSceneId,
				};
				setFocusedSceneDraft(focusedSceneId, afterTimeline);
				updateSceneTimeline(focusedSceneId, afterTimeline, {
					recordHistory: false,
				});
				pushHistory(nextEntry);
			},
		);
	}, [focusedSceneId, pushHistory, setFocusedSceneDraft, updateSceneTimeline]);

	useEffect(() => {
		return () => {
			flushFocusedSceneDraft();
		};
	}, [flushFocusedSceneDraft]);
};
