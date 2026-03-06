import { resolveTimelineEndFrame } from "core/editor/utils/timelineEndFrame";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { useProjectStore } from "@/projects/projectStore";
import {
	useStudioRuntimeManager,
} from "@/scene-editor/runtime/EditorRuntimeProvider";
import type { TimelineRuntime } from "@/scene-editor/runtime/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";

type SceneReferenceRuntimeState = {
	runtime: TimelineRuntime | null;
	revision: number;
	fps: number;
	durationFrames: number;
	canvasSize: { width: number; height: number };
};

const EMPTY_RUNTIME_STATE: SceneReferenceRuntimeState = {
	runtime: null,
	revision: 0,
	fps: 30,
	durationFrames: 0,
	canvasSize: { width: 1920, height: 1080 },
};

const areSnapshotStatesEqual = (
	left: SceneReferenceRuntimeState,
	right: SceneReferenceRuntimeState,
): boolean => {
	return (
		left.runtime === right.runtime &&
		left.revision === right.revision &&
		left.fps === right.fps &&
		left.durationFrames === right.durationFrames &&
		left.canvasSize.width === right.canvasSize.width &&
		left.canvasSize.height === right.canvasSize.height
	);
};

const buildSnapshot = (
	runtime: TimelineRuntime | null,
	fallback: {
		fps: number;
		durationFrames: number;
		canvasSize: { width: number; height: number };
	},
): SceneReferenceRuntimeState => {
	if (!runtime) {
		return {
			...EMPTY_RUNTIME_STATE,
			fps: fallback.fps,
			durationFrames: fallback.durationFrames,
			canvasSize: fallback.canvasSize,
		};
	}
	const state = runtime.timelineStore.getState();
	return {
		runtime,
		revision: state.revision,
		fps: Math.max(1, Math.round(state.fps || fallback.fps || 30)),
		durationFrames: resolveTimelineEndFrame(state.elements),
		canvasSize:
			state.canvasSize.width > 0 && state.canvasSize.height > 0
				? state.canvasSize
				: fallback.canvasSize,
	};
};

export const useSceneReferenceRuntimeState = (
	sceneId: string | null | undefined,
) => {
	const runtimeManager = useStudioRuntimeManager();
	const projectScene = useProjectStore((state) =>
		sceneId ? state.currentProject?.scenes[sceneId] ?? null : null,
	);

	const fallback = useMemo(() => {
		if (!projectScene) {
			return {
				fps: 30,
				durationFrames: 0,
				canvasSize: { width: 1920, height: 1080 },
			};
		}
		return {
			fps: Math.max(1, Math.round(projectScene.timeline.fps || 30)),
			durationFrames: resolveTimelineEndFrame(projectScene.timeline.elements),
			canvasSize:
				projectScene.timeline.canvas.width > 0 &&
				projectScene.timeline.canvas.height > 0
					? projectScene.timeline.canvas
					: { width: 1920, height: 1080 },
		};
	}, [projectScene]);

	const runtime = useMemo(() => {
		if (!sceneId) return null;
		return runtimeManager.getTimelineRuntime(toSceneTimelineRef(sceneId));
	}, [runtimeManager, sceneId]);

	const snapshotRef = useRef<SceneReferenceRuntimeState | null>(null);
	const getSnapshot = useCallback(() => {
		const nextSnapshot = buildSnapshot(runtime, fallback);
		const cachedSnapshot = snapshotRef.current;
		if (cachedSnapshot && areSnapshotStatesEqual(cachedSnapshot, nextSnapshot)) {
			return cachedSnapshot;
		}
		snapshotRef.current = nextSnapshot;
		return nextSnapshot;
	}, [fallback, runtime]);

	const snapshot = useSyncExternalStore(
		(onStoreChange) => {
			if (!runtime) return () => {};
			return runtime.timelineStore.subscribe(onStoreChange);
		},
		getSnapshot,
		getSnapshot,
	);

	return {
		runtimeManager,
		...snapshot,
	};
};
