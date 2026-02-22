import { useEffect } from "react";
import { usePlaybackControl } from "@/editor/contexts/TimelineContext";
import { useTimelineStoreApi } from "@/editor/runtime/EditorRuntimeProvider";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";

export const useStudioHotkeys = (): void => {
	const { togglePlay } = usePlaybackControl();
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
				togglePlay();
				return;
			}
			const isModifier = e.metaKey || e.ctrlKey;
			if (!isModifier) return;
			const key = e.key.toLowerCase();
			if (key === "z") {
				e.preventDefault();
				if (e.shiftKey) {
					redo({ timelineStore });
					return;
				}
				undo({ timelineStore });
				return;
			}
			if (key === "y") {
				e.preventDefault();
				redo({ timelineStore });
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [redo, timelineStore, togglePlay, undo]);
};
