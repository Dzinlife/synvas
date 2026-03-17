import type { TimelineElement } from "core/element/types";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveInteractiveTimelineElements } from "@/scene-editor/preview/buildSkiaTree";
import type {
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";

interface UseFocusSceneTimelineElementsOptions {
	runtimeManager: StudioRuntimeManager;
	sceneId: string | null;
}

export interface FocusSceneTimelineElementsResult {
	runtime: TimelineRuntime | null;
	interactiveElements: TimelineElement[];
	interactiveElementsRef: React.MutableRefObject<TimelineElement[]>;
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
	const interactiveElementsRef = useRef<TimelineElement[]>([]);
	const [interactiveElements, setInteractiveElements] = useState<
		TimelineElement[]
	>([]);
	const [canvasSize, setCanvasSize] = useState(() => {
		return timelineStore?.getState().canvasSize ?? { width: 1, height: 1 };
	});

	useEffect(() => {
		if (!timelineStore) {
			interactiveElementsRef.current = [];
			setInteractiveElements([]);
			return;
		}
		const updateInteractiveElements = () => {
			const state = timelineStore.getState();
			const ordered = resolveInteractiveTimelineElements({
				elements: state.elements,
				displayTime: state.getRenderTime(),
				tracks: state.tracks,
				sortByTrackIndex,
			});
			const previous = interactiveElementsRef.current;
			if (
				previous.length !== ordered.length ||
				ordered.some((element, index) => previous[index] !== element)
			) {
				interactiveElementsRef.current = ordered;
				setInteractiveElements(ordered);
			}
		};

		const unsubscribeCurrentTime = timelineStore.subscribe(
			(state) => state.currentTime,
			updateInteractiveElements,
		);
		const unsubscribePreviewTime = timelineStore.subscribe(
			(state) => state.previewTime,
			updateInteractiveElements,
		);
		const unsubscribeElements = timelineStore.subscribe(
			(state) => state.elements,
			updateInteractiveElements,
		);
		const unsubscribeTracks = timelineStore.subscribe(
			(state) => state.tracks,
			updateInteractiveElements,
		);

		updateInteractiveElements();

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
		interactiveElements,
		interactiveElementsRef,
		sourceWidth: Math.max(1, canvasSize.width),
		sourceHeight: Math.max(1, canvasSize.height),
	};
};
