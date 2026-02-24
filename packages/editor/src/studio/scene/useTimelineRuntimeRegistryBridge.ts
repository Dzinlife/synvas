import { useEffect, useMemo, useRef } from "react";
import type { TimelineJSON } from "core/editor/timelineLoader";
import { useStudioRuntimeManager } from "@/editor/runtime/EditorRuntimeProvider";
import { useProjectStore } from "@/projects/projectStore";
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

type BridgeState = {
	readonly subscriptions: Map<string, () => void>;
	readonly writingRuntimeIds: Set<string>;
	readonly projectTimelineRefs: Map<string, TimelineJSON>;
};

export const useTimelineRuntimeRegistryBridge = (): void => {
	const runtimeManager = useStudioRuntimeManager();
	const currentProject = useProjectStore((state) => state.currentProject);
	const updateSceneTimeline = useProjectStore(
		(state) => state.updateSceneTimeline,
	);

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
				const unsubscribe = runtime.timelineStore.subscribe(
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
				bridgeState.subscriptions.set(runtimeId, unsubscribe);
			}

			const timeline = readTimelineByRef(currentProject, ref);
			if (!timeline) continue;
			const knownProjectTimelineRef = bridgeState.projectTimelineRefs.get(runtimeId);
			if (knownProjectTimelineRef === timeline) continue;

			bridgeState.writingRuntimeIds.add(runtimeId);
			try {
				applyTimelineJsonToStore(timeline, runtime.timelineStore);
				bridgeState.projectTimelineRefs.set(runtimeId, timeline);
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
			runtimeManager.removeTimelineRuntime(runtime.ref);
		}
		if (ownerRuntimeId && !expectedRuntimeIds.has(ownerRuntimeId)) {
			usePlaybackOwnerStore.getState().clearOwner();
		}
	}, [currentProject, projectWriter, runtimeManager]);

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
