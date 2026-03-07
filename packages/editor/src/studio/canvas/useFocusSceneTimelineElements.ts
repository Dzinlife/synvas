import type { TimelineElement } from "core/element/types";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioRuntimeManager, TimelineRuntime } from "@/scene-editor/runtime/types";
import { buildKonvaTree } from "@/scene-editor/preview/buildSkiaTree";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";

interface UseFocusSceneTimelineElementsOptions {
	runtimeManager: StudioRuntimeManager;
	sceneId: string | null;
}

export interface FocusSceneTimelineElementsResult {
	runtime: TimelineRuntime | null;
	renderElements: TimelineElement[];
	renderElementsRef: React.MutableRefObject<TimelineElement[]>;
	sourceWidth: number;
	sourceHeight: number;
}

const sortByTrackIndex = (elements: TimelineElement[]): TimelineElement[] => {
	return elements
		.map((element, index) => ({
			element,
			index,
			trackIndex: element.timeline.trackIndex ?? 0,
		}))
		.sort((left, right) => {
			if (left.trackIndex !== right.trackIndex) {
				return left.trackIndex - right.trackIndex;
			}
			return left.index - right.index;
		})
		.map((item) => item.element);
};

export const useFocusSceneTimelineElements = ({
	runtimeManager,
	sceneId,
}: UseFocusSceneTimelineElementsOptions): FocusSceneTimelineElementsResult => {
	const runtime = useMemo(() => {
		if (!sceneId) return null;
		const ensureTimelineRuntime = (
			runtimeManager as Partial<StudioRuntimeManager>
		).ensureTimelineRuntime;
		if (typeof ensureTimelineRuntime !== "function") return null;
		return ensureTimelineRuntime(toSceneTimelineRef(sceneId));
	}, [runtimeManager, sceneId]);
	const timelineStore = runtime?.timelineStore ?? null;
	const renderElementsRef = useRef<TimelineElement[]>([]);
	const [renderElements, setRenderElements] = useState<TimelineElement[]>([]);
	const [canvasSize, setCanvasSize] = useState(() => {
		return timelineStore?.getState().canvasSize ?? { width: 1, height: 1 };
	});

	useEffect(() => {
		if (!timelineStore) {
			renderElementsRef.current = [];
			setRenderElements([]);
			return;
		}
		const updateVisibleElements = () => {
			const state = timelineStore.getState();
			const ordered = buildKonvaTree({
				elements: state.elements,
				displayTime: state.getRenderTime(),
				tracks: state.tracks,
				sortByTrackIndex,
			});
			const previous = renderElementsRef.current;
			if (
				previous.length !== ordered.length ||
				ordered.some((element, index) => previous[index] !== element)
			) {
				renderElementsRef.current = ordered;
				setRenderElements(ordered);
			}
		};

		const unsubscribeCurrentTime = timelineStore.subscribe(
			(state) => state.currentTime,
			updateVisibleElements,
		);
		const unsubscribePreviewTime = timelineStore.subscribe(
			(state) => state.previewTime,
			updateVisibleElements,
		);
		const unsubscribeElements = timelineStore.subscribe(
			(state) => state.elements,
			updateVisibleElements,
		);
		const unsubscribeTracks = timelineStore.subscribe(
			(state) => state.tracks,
			updateVisibleElements,
		);

		updateVisibleElements();

		return () => {
			unsubscribeCurrentTime();
			unsubscribePreviewTime();
			unsubscribeElements();
			unsubscribeTracks();
		};
	}, [timelineStore]);

	useEffect(() => {
		if (!timelineStore) {
			setCanvasSize({ width: 1, height: 1 });
			return;
		}
		return timelineStore.subscribe(
			(state) => state.canvasSize,
			(nextCanvasSize) => {
				setCanvasSize(nextCanvasSize);
			},
			{ fireImmediately: true },
		);
	}, [timelineStore]);

	return {
		runtime,
		renderElements,
		renderElementsRef,
		sourceWidth: Math.max(1, canvasSize.width),
		sourceHeight: Math.max(1, canvasSize.height),
	};
};
