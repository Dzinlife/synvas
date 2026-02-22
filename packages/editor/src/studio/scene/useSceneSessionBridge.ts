import { saveTimelineToObject, type TimelineJSON } from "core/editor/timelineLoader";
import { useEffect, useRef } from "react";
import type { TimelineStore } from "@/editor/contexts/TimelineContext";
import {
	useModelRegistry,
	useTimelineStoreApi,
} from "@/editor/runtime/EditorRuntimeProvider";
import { useProjectStore } from "@/projects/projectStore";
import {
	useStudioHistoryStore,
	type StudioHistoryEntry,
} from "@/studio/history/studioHistoryStore";
import {
	applyTimelineJsonToStore,
	snapshotTimelineFromStore,
} from "@/studio/scene/timelineSession";

type TimelineHistorySnapshot = TimelineStore["historyPast"][number];

const cloneAudioSettings = (
	audio: TimelineStore["audioSettings"],
) => ({
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
		snapshot.assets,
	);
};

const isTimelineEqual = (a: TimelineJSON, b: TimelineJSON): boolean => {
	return JSON.stringify(a) === JSON.stringify(b);
};

type ModelReadyState = {
	props?: {
		uri?: unknown;
	};
	constraints?: {
		hasError?: boolean;
	};
	internal?: {
		isReady?: boolean;
	};
	waitForReady?: () => Promise<void>;
};

const sleep = (ms: number): Promise<void> => {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
};

const waitForSceneModelsReady = async (
	timeline: TimelineJSON,
	getModelStore: (id: string) => { getState: () => ModelReadyState } | undefined,
	timeoutMs = 5000,
): Promise<void> => {
	const ids = Array.from(new Set(timeline.elements.map((element) => element.id)));
	if (ids.length === 0) return;
	const deadline = Date.now() + timeoutMs;

	await Promise.all(
		ids.map(async (id) => {
			let store: { getState: () => ModelReadyState } | undefined;
			const storeDeadline = Math.min(deadline, Date.now() + 250);
			while (Date.now() < storeDeadline) {
				store = getModelStore(id);
				if (store) break;
				await sleep(16);
			}
			if (!store) return;
			const state = store.getState();
			if (!state.waitForReady) return;
			if (state.props && "uri" in state.props && !state.props.uri) return;
			if (state.internal?.isReady || state.constraints?.hasError) return;
			const rest = deadline - Date.now();
			if (rest <= 0) return;
			await Promise.race([
				state.waitForReady().catch(() => undefined),
				sleep(rest),
			]);
		}),
	);
};

export const useSceneSessionBridge = (): void => {
	const timelineStore = useTimelineStoreApi();
	const modelRegistry = useModelRegistry();
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
	const preloadEpochRef = useRef(0);

	useEffect(() => {
		previousFocusedSceneIdRef.current = null;
	}, [currentProjectId]);

	useEffect(() => {
		const previousFocusedSceneId = previousFocusedSceneIdRef.current;
		if (previousFocusedSceneId && previousFocusedSceneId !== focusedSceneId) {
			const draft = snapshotTimelineFromStore(timelineStore);
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
			applyTimelineJsonToStore(focusedTimeline, timelineStore);
			const preloadEpoch = preloadEpochRef.current + 1;
			preloadEpochRef.current = preloadEpoch;
			void waitForSceneModelsReady(
				focusedTimeline,
				(id) =>
					modelRegistry.get(id) as { getState: () => ModelReadyState } | undefined,
			).then(() => {
				if (preloadEpochRef.current !== preloadEpoch) return;
				const latestFocusedSceneId =
					useProjectStore.getState().currentProject?.ui.focusedSceneId ?? null;
				if (latestFocusedSceneId !== focusedSceneId) return;
				timelineStore.setState((state) => ({
					// 模型异步就绪后强制触发一次渲染，修复跨 scene 首次 focus 白屏。
					elements: [...state.elements],
				}));
			});
		} else {
			preloadEpochRef.current += 1;
		}
		previousFocusedSceneIdRef.current = focusedSceneId;
	}, [
		currentProjectId,
		focusedSceneId,
		setActiveScene,
		setFocusedSceneDraft,
		updateSceneTimeline,
		modelRegistry,
		timelineStore,
	]);

	useEffect(() => {
		return timelineStore.subscribe(
			(state) => state.historyPast,
			(historyPast, prevHistoryPast) => {
				if (!focusedSceneId) return;
				if (useStudioHistoryStore.getState().isApplying) return;
				if (historyPast.length === 0 || historyPast.length <= prevHistoryPast.length) {
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
	}, [
		focusedSceneId,
		pushHistory,
		setFocusedSceneDraft,
		updateSceneTimeline,
		timelineStore,
	]);

	useEffect(() => {
		return () => {
			flushFocusedSceneDraft();
		};
	}, [flushFocusedSceneDraft]);
};
