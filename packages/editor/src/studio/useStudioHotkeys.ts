import { useEffect } from "react";
import {
	useActiveTimelineRuntime,
	useStudioRuntimeManager,
	useTimelineStoreApi,
} from "@/editor/runtime/EditorRuntimeProvider";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import { usePlaybackOwnerController } from "@/studio/scene/usePlaybackOwnerController";

export const useStudioHotkeys = (): void => {
	const activeTimelineRuntime = useActiveTimelineRuntime();
	const runtimeManager = useStudioRuntimeManager();
	const { togglePlayback } = usePlaybackOwnerController();
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
				if (activeTimelineRuntime) {
					togglePlayback(activeTimelineRuntime.ref);
				}
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
		activeTimelineRuntime,
		redo,
		runtimeManager,
		timelineStore,
		togglePlayback,
		undo,
	]);
};
