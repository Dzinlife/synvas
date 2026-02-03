import { useMemo } from "react";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import { transformMetaToRenderLayout } from "./layout";
import type { RenderLayout } from "./types";

const EMPTY_LAYOUT: RenderLayout = {
	cx: 0,
	cy: 0,
	w: 0,
	h: 0,
	rotation: 0,
};

export const useRenderLayout = (id: string): RenderLayout => {
	const transform = useTimelineStore(
		(state) => state.getElementById(id)?.transform,
	);
	const canvasSize = useTimelineStore((state) => state.canvasSize);

	return useMemo(() => {
		if (!transform) return EMPTY_LAYOUT;
		return transformMetaToRenderLayout(transform, canvasSize, canvasSize);
	}, [transform, canvasSize]);
};
