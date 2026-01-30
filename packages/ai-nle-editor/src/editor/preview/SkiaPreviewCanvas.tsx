import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, type CanvasRef } from "react-skia-lite";
import type { TimelineElement } from "@nle/dsl/types";
import { useTimelineStore } from "@nle/editor/contexts/TimelineContext";
import type { TimelineTrack } from "@nle/editor/timeline/types";
import { buildSkiaTree } from "./buildSkiaTree";

interface SkiaPreviewCanvasProps {
	canvasWidth: number;
	canvasHeight: number;
	tracks: TimelineTrack[];
	getTrackIndexForElement: (element: TimelineElement) => number;
	sortByTrackIndex: (elements: TimelineElement[]) => TimelineElement[];
	getElements: () => TimelineElement[];
	getDisplayTime: () => number;
	canvasRef?: React.RefObject<CanvasRef | null>;
}

export const SkiaPreviewCanvas: React.FC<SkiaPreviewCanvasProps> = ({
	canvasWidth,
	canvasHeight,
	tracks,
	getTrackIndexForElement,
	sortByTrackIndex,
	getElements,
	getDisplayTime,
	canvasRef,
}) => {
	const internalCanvasRef = useRef<CanvasRef>(null);
	const targetCanvasRef = canvasRef ?? internalCanvasRef;
	const renderTokenRef = useRef(0);
	const disposeRef = useRef<(() => void) | null>(null);

	const runRender = useCallback(
		(elements: TimelineElement[], displayTime: number) => {
			const renderToken = renderTokenRef.current + 1;
			renderTokenRef.current = renderToken;

			buildSkiaTree({
				elements,
				displayTime,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 0,
					canvasSize: { width: canvasWidth, height: canvasHeight },
					prepareTransitionPictures: true,
				},
			})
				.then(({ children, dispose }) => {
					if (renderTokenRef.current !== renderToken) {
						dispose?.();
						return;
					}
					const root = targetCanvasRef.current?.getRoot();
					if (!root) {
						dispose?.();
						return;
					}
					root.render(children);
					disposeRef.current?.();
					disposeRef.current = dispose ?? null;
				})
				.catch((error) => {
					console.error("Failed to build skia preview tree:", error);
				});
		},
		[
			canvasHeight,
			canvasWidth,
			getTrackIndexForElement,
			sortByTrackIndex,
			targetCanvasRef,
			tracks,
		],
	);

	const renderSkia = useCallback(() => {
		runRender(getElements(), getDisplayTime());
	}, [getDisplayTime, getElements, runRender]);

	useEffect(() => {
		const unsub1 = useTimelineStore.subscribe(
			(state) => state.currentTime,
			renderSkia,
		);
		const unsub2 = useTimelineStore.subscribe(
			(state) => state.previewTime,
			renderSkia,
		);
		return () => {
			unsub1();
			unsub2();
		};
	}, [renderSkia]);

	useEffect(() => {
		return useTimelineStore.subscribe(
			(state) => state.elements,
			(newElements) => {
				runRender(newElements, getDisplayTime());
			},
			{
				fireImmediately: true,
			},
		);
	}, [getDisplayTime, runRender]);

	useEffect(() => {
		return () => {
			disposeRef.current?.();
			disposeRef.current = null;
		};
	}, []);

	const skiaCanvas = useMemo(() => {
		return (
			<Canvas
				style={{
					width: canvasWidth,
					height: canvasHeight,
					overflow: "hidden",
				}}
				ref={targetCanvasRef}
			/>
		);
	}, [canvasWidth, canvasHeight, targetCanvasRef]);

	return skiaCanvas;
};
