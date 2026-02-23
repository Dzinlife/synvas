import { useEffect, useMemo, useRef } from "react";
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

const toTimelineSignature = (value: unknown): string => {
	return JSON.stringify(value);
};

type BridgeState = {
	readonly subscriptions: Map<string, () => void>;
	readonly writingRuntimeIds: Set<string>;
	readonly runtimeSignatures: Map<string, string>;
	readonly projectSignatures: Map<string, string>;
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
		runtimeSignatures: new Map(),
		projectSignatures: new Map(),
	});

	useEffect(() => {
		const bridgeState = bridgeStateRef.current;
		if (!currentProject) {
			for (const unsubscribe of bridgeState.subscriptions.values()) {
				unsubscribe();
			}
			bridgeState.subscriptions.clear();
			bridgeState.runtimeSignatures.clear();
			bridgeState.projectSignatures.clear();
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
					(state) => [
						state.elements,
						state.tracks,
						state.fps,
						state.canvasSize,
						state.snapEnabled,
						state.autoAttach,
						state.rippleEditingEnabled,
						state.previewAxisEnabled,
						state.audioSettings,
					],
					() => {
						if (bridgeState.writingRuntimeIds.has(runtimeId)) return;
						const timeline = snapshotTimelineFromStore(runtime.timelineStore);
						const runtimeSignature = toTimelineSignature(timeline);
						const projectSignature =
							bridgeState.projectSignatures.get(runtimeId);
						bridgeState.runtimeSignatures.set(runtimeId, runtimeSignature);
						if (projectSignature === runtimeSignature) return;
						writeTimelineByRef(projectWriter, ref, timeline, {
							recordHistory: false,
						});
						bridgeState.projectSignatures.set(runtimeId, runtimeSignature);
					},
				);
				bridgeState.subscriptions.set(runtimeId, unsubscribe);
			}

			const timeline = readTimelineByRef(currentProject, ref);
			if (!timeline) continue;
			const projectSignature = toTimelineSignature(timeline);
			bridgeState.projectSignatures.set(runtimeId, projectSignature);

			const knownRuntimeSignature =
				bridgeState.runtimeSignatures.get(runtimeId);
			const runtimeSignature =
				knownRuntimeSignature ??
				toTimelineSignature(snapshotTimelineFromStore(runtime.timelineStore));
			if (runtimeSignature === projectSignature) {
				bridgeState.runtimeSignatures.set(runtimeId, runtimeSignature);
				continue;
			}

			bridgeState.writingRuntimeIds.add(runtimeId);
			try {
				applyTimelineJsonToStore(timeline, runtime.timelineStore);
			} finally {
				bridgeState.writingRuntimeIds.delete(runtimeId);
			}
			bridgeState.runtimeSignatures.set(runtimeId, projectSignature);
		}

		const ownerRuntimeId = usePlaybackOwnerStore.getState().ownerRuntimeId;
		for (const runtime of runtimeManager.listTimelineRuntimes()) {
			if (expectedRuntimeIds.has(runtime.id)) continue;
			bridgeState.subscriptions.get(runtime.id)?.();
			bridgeState.subscriptions.delete(runtime.id);
			bridgeState.runtimeSignatures.delete(runtime.id);
			bridgeState.projectSignatures.delete(runtime.id);
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
