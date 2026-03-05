import {
	saveTimelineToObject,
	type TimelineJSON,
} from "core/editor/timelineLoader";
import { useEffect, useMemo, useRef } from "react";
import { useProjectStore } from "@/projects/projectStore";
import type { TimelineStore } from "@/scene-editor/contexts/TimelineContext";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import {
	type StudioHistoryEntry,
	useStudioHistoryStore,
} from "@/studio/history/studioHistoryStore";
import { usePlaybackOwnerStore } from "./playbackOwnerStore";
import {
	buildTimelineRuntimeIdFromRef,
	listTimelineRefs,
	readTimelineByRef,
	writeTimelineByRef,
} from "./timelineRefAdapter";
import {
	applyTimelineJsonToStore,
	snapshotTimelineFromStore,
} from "./timelineSession";

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

type RuntimePersistHistoryMeta = {
	length: number;
	tail: TimelineHistorySnapshot | undefined;
};

type BridgeState = {
	readonly subscriptions: Map<string, () => void>;
	readonly writingRuntimeIds: Set<string>;
	readonly projectTimelineRefs: Map<string, TimelineJSON>;
	readonly persistHistoryMeta: Map<string, RuntimePersistHistoryMeta>;
};

export const useTimelineRuntimeRegistryBridge = (): void => {
	const runtimeManager = useStudioRuntimeManager();
	const currentProject = useProjectStore((state) => state.currentProject);
	const updateSceneTimeline = useProjectStore(
		(state) => state.updateSceneTimeline,
	);
	const pushHistory = useStudioHistoryStore((state) => state.push);

	const projectWriter = useMemo(
		() => ({
			updateSceneTimeline,
		}),
		[updateSceneTimeline],
	);

	const bridgeStateRef = useRef<BridgeState>({
		subscriptions: new Map(),
		writingRuntimeIds: new Set(),
		projectTimelineRefs: new Map(),
		persistHistoryMeta: new Map(),
	});

	useEffect(() => {
		const bridgeState = bridgeStateRef.current;
		if (!currentProject) {
			for (const unsubscribe of bridgeState.subscriptions.values()) {
				unsubscribe();
			}
			bridgeState.subscriptions.clear();
			bridgeState.projectTimelineRefs.clear();
			bridgeState.writingRuntimeIds.clear();
			bridgeState.persistHistoryMeta.clear();
			for (const runtime of runtimeManager.listTimelineRuntimes()) {
				runtimeManager.removeTimelineRuntime(runtime.ref);
			}
			usePlaybackOwnerStore.getState().clearOwner();
			return;
		}

		const timelineRefs = listTimelineRefs(currentProject);
		const expectedRuntimeIds = new Set<string>();

		for (const ref of timelineRefs) {
			const runtime = runtimeManager.ensureTimelineRuntime(ref);
			const runtimeId = buildTimelineRuntimeIdFromRef(ref);
			expectedRuntimeIds.add(runtimeId);

			if (!bridgeState.subscriptions.has(runtimeId)) {
				const historyPast = runtime.timelineStore.getState().historyPast;
				bridgeState.persistHistoryMeta.set(runtimeId, {
					length: historyPast.length,
					tail: historyPast[historyPast.length - 1],
				});

				const unsubscribePersist = runtime.timelineStore.subscribe(
					(state) => state.persistRevision,
					() => {
						if (bridgeState.writingRuntimeIds.has(runtimeId)) return;
						try {
							const timelineState = runtime.timelineStore.getState();
							const history = timelineState.historyPast;
							const historyTail = history[history.length - 1];
							const previousHistoryMeta =
								bridgeState.persistHistoryMeta.get(runtimeId);
							const didCommitHistory =
								(previousHistoryMeta?.length ?? 0) < history.length ||
								previousHistoryMeta?.tail !== historyTail;
							const timeline = snapshotTimelineFromStore(runtime.timelineStore);
							writeTimelineByRef(projectWriter, ref, timeline, {
								recordHistory: false,
								historyOpId: didCommitHistory
									? (timelineState.lastCommittedHistoryOpId ?? undefined)
									: undefined,
							});
							bridgeState.projectTimelineRefs.set(runtimeId, timeline);
							bridgeState.persistHistoryMeta.set(runtimeId, {
								length: history.length,
								tail: historyTail,
							});
						} catch (error) {
							console.error(
								`Failed to write runtime timeline (${runtimeId}) to project:`,
								error,
							);
						}
					},
				);

				const unsubscribeHistory = runtime.timelineStore.subscribe(
					(state) => state.historyPast,
					(historyPast, prevHistoryPast) => {
						if (bridgeState.writingRuntimeIds.has(runtimeId)) return;
						if (useStudioHistoryStore.getState().isApplying) return;
						const nextTop = historyPast[historyPast.length - 1];
						const prevTop = prevHistoryPast[prevHistoryPast.length - 1];
						const didPushHistory =
							historyPast.length > prevHistoryPast.length ||
							nextTop !== prevTop;
						if (!didPushHistory || !nextTop) return;

						const timelineStoreState = runtime.timelineStore.getState();
						const beforeTimeline = buildTimelineFromHistorySnapshot(
							nextTop,
							timelineStoreState,
						);
						const afterTimeline = snapshotTimelineFromStore(
							runtime.timelineStore,
						);
						const latestProject = useProjectStore.getState().currentProject;
						if (!latestProject) return;
						const nextEntry: StudioHistoryEntry = {
							kind: "scene.timeline",
							timelineRef: ref,
							sceneId: ref.sceneId,
							before: beforeTimeline,
							after: afterTimeline,
							focusNodeId: latestProject.ui.focusedNodeId,
							opId: timelineStoreState.lastCommittedHistoryOpId ?? undefined,
						};
						pushHistory(nextEntry);
					},
				);

				bridgeState.subscriptions.set(runtimeId, () => {
					unsubscribePersist();
					unsubscribeHistory();
				});
			}

			const timeline = readTimelineByRef(currentProject, ref);
			if (!timeline) continue;
			const knownProjectTimelineRef =
				bridgeState.projectTimelineRefs.get(runtimeId);
			if (knownProjectTimelineRef === timeline) continue;

			bridgeState.writingRuntimeIds.add(runtimeId);
			try {
				applyTimelineJsonToStore(timeline, runtime.timelineStore);
				bridgeState.projectTimelineRefs.set(runtimeId, timeline);
				const historyPast = runtime.timelineStore.getState().historyPast;
				bridgeState.persistHistoryMeta.set(runtimeId, {
					length: historyPast.length,
					tail: historyPast[historyPast.length - 1],
				});
			} catch (error) {
				console.error(
					`Failed to apply project timeline (${runtimeId}) to runtime:`,
					error,
				);
			} finally {
				bridgeState.writingRuntimeIds.delete(runtimeId);
			}
		}

		const ownerRuntimeId = usePlaybackOwnerStore.getState().ownerRuntimeId;
		for (const runtime of runtimeManager.listTimelineRuntimes()) {
			if (expectedRuntimeIds.has(runtime.id)) continue;
			bridgeState.subscriptions.get(runtime.id)?.();
			bridgeState.subscriptions.delete(runtime.id);
			bridgeState.projectTimelineRefs.delete(runtime.id);
			bridgeState.writingRuntimeIds.delete(runtime.id);
			bridgeState.persistHistoryMeta.delete(runtime.id);
			runtimeManager.removeTimelineRuntime(runtime.ref);
		}
		if (ownerRuntimeId && !expectedRuntimeIds.has(ownerRuntimeId)) {
			usePlaybackOwnerStore.getState().clearOwner();
		}
	}, [currentProject, projectWriter, pushHistory, runtimeManager]);

	useEffect(() => {
		return () => {
			const bridgeState = bridgeStateRef.current;
			for (const unsubscribe of bridgeState.subscriptions.values()) {
				unsubscribe();
			}
			bridgeState.subscriptions.clear();
		};
	}, []);
};
