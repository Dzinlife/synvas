import type { TimelineElement } from "core/dsl/types";
import {
	toDisplayTimeFromFrameIndex,
	toFrameIndex,
} from "core/editor/preview/framePrecompileBuffer";
import { createFramePrecompileController } from "core/editor/preview/framePrecompileController";
import { schedulePrecompileTask } from "core/editor/preview/framePrecompileScheduler";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, type CanvasRef } from "react-skia-lite";
import { modelRegistry } from "@/dsl/model/registry";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import type { TimelineTrack } from "@/editor/timeline/types";
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

const PRECOMPILE_LOOKAHEAD_FRAMES = 0;

type SkiaRenderState = Awaited<ReturnType<typeof buildSkiaTree>>;

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
	const frameControllerRef = useRef(
		createFramePrecompileController<SkiaRenderState>({
			lookaheadFrames: PRECOMPILE_LOOKAHEAD_FRAMES,
			scheduleTask: schedulePrecompileTask,
			onPrefetchError: (error, frameIndex) => {
				console.error(
					`Failed to precompile preview frame ${frameIndex}:`,
					error,
				);
			},
			onCacheEvent: (_event) => {
				// if (event.type === "miss") {
				// 	console.log(`[SkiaPreviewCache] miss frame=${event.frameIndex}`);
				// 	return;
				// }
				// console.log(
				// 	`[SkiaPreviewCache] ${event.type} frame=${event.frameIndex} status=${event.status}`,
				// );
			},
		}),
	);
	const fps = useTimelineStore((state) => state.fps);

	const invalidateBuffer = useCallback(() => {
		frameControllerRef.current.invalidateAll();
	}, []);

	const runRender = useCallback(
		(elements: TimelineElement[], displayTime: number) => {
			const renderToken = renderTokenRef.current + 1;
			renderTokenRef.current = renderToken;

			const normalizedFps = Number.isFinite(fps) ? Math.round(fps) : 0;
			const frameIndex = toFrameIndex(displayTime, normalizedFps);
			frameControllerRef.current.reconcileFrame(frameIndex);

			const buildFrameState = (targetFrame: number) => {
				const targetDisplayTime =
					targetFrame === frameIndex
						? displayTime
						: toDisplayTimeFromFrameIndex(
								targetFrame,
								normalizedFps,
								displayTime,
							);
				return buildSkiaTree({
					elements,
					displayTime: targetDisplayTime,
					tracks,
					getTrackIndexForElement,
					sortByTrackIndex,
					prepare: {
						isExporting: false,
						// 预览态也要带上 fps，保证帧时间换算一致
						fps: normalizedFps,
						canvasSize: { width: canvasWidth, height: canvasHeight },
						prepareTransitionPictures: true,
						// 提供模型索引，供预览态准备帧使用
						getModelStore: (id) => modelRegistry.get(id),
					},
				});
			};

			frameControllerRef.current
				.getOrBuildCurrent(frameIndex, buildFrameState)
				.then((entry) => {
					if (renderTokenRef.current !== renderToken) {
						return;
					}
					const root = targetCanvasRef.current?.getRoot();
					if (!root) {
						return;
					}
					const frameState = entry.state;
					if (!frameState) {
						return;
					}
					root.render(frameState.children);
					const nextDispose = frameControllerRef.current.takeDispose(entry);
					disposeRef.current?.();
					disposeRef.current = nextDispose ?? null;
					frameControllerRef.current.commitFrame(frameIndex, buildFrameState);
				})
				.catch((error) => {
					if (renderTokenRef.current !== renderToken) {
						return;
					}
					console.error("Failed to build skia preview tree:", error);
				});
		},
		[
			canvasHeight,
			canvasWidth,
			fps,
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
				invalidateBuffer();
				runRender(newElements, getDisplayTime());
			},
			{
				fireImmediately: true,
			},
		);
	}, [getDisplayTime, invalidateBuffer, runRender]);

	useEffect(() => {
		// 构建输入（fps/轨道/尺寸等）变化时保守失效，避免复用旧条件下的缓存。
		invalidateBuffer();
	}, [invalidateBuffer]);

	useEffect(() => {
		return () => {
			frameControllerRef.current.disposeAll();
			disposeRef.current?.();
			disposeRef.current = null;
		};
	}, []);

	const skiaCanvas = useMemo(() => {
		return (
			<Canvas
				pd={1}
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
