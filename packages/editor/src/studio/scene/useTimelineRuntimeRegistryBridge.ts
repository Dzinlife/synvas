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

type TimelineHistorySnapshot = NonNullable<
	TimelineStore["lastHistoryCommitSnapshot"]
>;

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
	commitRevision: number;
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
					const timelineState = runtime.timelineStore.getState();
					bridgeState.persistHistoryMeta.set(runtimeId, {
						commitRevision: timelineState.historyCommitRevision,
					});

					const unsubscribePersist = runtime.timelineStore.subscribe(
						(state) => state.persistRevision,
						() => {
							if (bridgeState.writingRuntimeIds.has(runtimeId)) return;
							try {
								const timeline = snapshotTimelineFromStore(runtime.timelineStore);
								writeTimelineByRef(projectWriter, ref, timeline, {
									recordHistory: false,
								});
								bridgeState.projectTimelineRefs.set(runtimeId, timeline);
							} catch (error) {
								console.error(
									`Failed to write runtime timeline (${runtimeId}) to project:`,
								error,
							);
						}
					},
					);

					const unsubscribeHistory = runtime.timelineStore.subscribe(
						(state) => state.historyCommitRevision,
						(historyCommitRevision) => {
							if (bridgeState.writingRuntimeIds.has(runtimeId)) return;
							if (useStudioHistoryStore.getState().isApplying) return;
							const timelineStoreState = runtime.timelineStore.getState();
							const previousMeta = bridgeState.persistHistoryMeta.get(runtimeId);
							if (
								previousMeta &&
								historyCommitRevision <= previousMeta.commitRevision
							) {
								return;
							}
							const snapshot = timelineStoreState.lastHistoryCommitSnapshot;
							if (!snapshot) return;
							const beforeTimeline = buildTimelineFromHistorySnapshot(
								snapshot,
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
								opId: timelineStoreState.lastCommittedHistoryOpId ?? undefined,
							};
							pushHistory(nextEntry);
							bridgeState.persistHistoryMeta.set(runtimeId, {
								commitRevision: historyCommitRevision,
							});
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
					const timelineState = runtime.timelineStore.getState();
					bridgeState.persistHistoryMeta.set(runtimeId, {
						commitRevision: timelineState.historyCommitRevision,
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
