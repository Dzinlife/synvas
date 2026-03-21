import { useEffect } from "react";
import { useProjectStore } from "@/projects/projectStore";
import {
	useStudioRuntimeManager,
	useTimelineStoreApi,
} from "@/scene-editor/runtime/EditorRuntimeProvider";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import {
	dispatchActivePlaybackTarget,
	resolveActivePlaybackTarget,
} from "@/studio/playback/activeNodePlayback";
import { usePlaybackOwnerController } from "@/studio/scene/usePlaybackOwnerController";

export const useStudioHotkeys = (): void => {
	const runtimeManager = useStudioRuntimeManager();
	const { togglePlayback } = usePlaybackOwnerController();
	const currentProject = useProjectStore((state) => state.currentProject);
	const activeNodeId = useProjectStore(
		(state) => state.currentProject?.ui.activeNodeId ?? null,
	);
	const timelineStore = useTimelineStoreApi();
	const undo = useStudioHistoryStore((state) => state.undo);
	const redo = useStudioHistoryStore((state) => state.redo);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement ||
				(e.target as HTMLElement | null)?.isContentEditable
			) {
				return;
			}
			if (e.code === "Space" && !e.repeat) {
				e.preventDefault();
				const playbackTarget = resolveActivePlaybackTarget({
					currentProject,
					activeNodeId,
					assets: currentProject?.assets ?? [],
				});
				void dispatchActivePlaybackTarget({
					target: playbackTarget,
					runtimeManager,
					toggleScenePlayback: togglePlayback,
				});
				return;
			}
			const isModifier = e.metaKey || e.ctrlKey;
			if (!isModifier) return;
			const key = e.key.toLowerCase();
			if (key === "z") {
				e.preventDefault();
				if (e.shiftKey) {
					redo({ timelineStore, runtimeManager });
					return;
				}
				undo({ timelineStore, runtimeManager });
				return;
			}
			if (key === "y") {
				e.preventDefault();
				redo({ timelineStore, runtimeManager });
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [
		activeNodeId,
		currentProject,
		redo,
		runtimeManager,
		timelineStore,
		togglePlayback,
		undo,
	]);
};
