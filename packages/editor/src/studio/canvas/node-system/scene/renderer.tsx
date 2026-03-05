import {
	toDisplayTimeFromFrameIndex,
	toFrameIndex,
} from "core/editor/preview/framePrecompileBuffer";
import { createFramePrecompileController } from "core/editor/preview/framePrecompileController";
import { schedulePrecompileTask } from "core/editor/preview/framePrecompileScheduler";
import type { TimelineElement } from "core/element/types";
import type { SceneNode } from "core/studio/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Picture, Rect, type SkPicture } from "react-skia-lite";
import { buildSkiaFrameSnapshot } from "@/scene-editor/preview/buildSkiaTree";
import { EditorRuntimeProvider } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type {
	EditorRuntime,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import type { CanvasNodeSkiaRenderProps } from "../types";

const PRECOMPILE_LOOKAHEAD_FRAMES = 2;

type SceneFrameSnapshot = Awaited<ReturnType<typeof buildSkiaFrameSnapshot>>;

const createScopedRuntime = (runtime: TimelineRuntime): EditorRuntime => ({
	id: `${runtime.id}:infinite-scene-render`,
	timelineStore: runtime.timelineStore,
	modelRegistry: runtime.modelRegistry,
});

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

const getTrackIndexForElement = (element: TimelineElement): number => {
	return element.timeline.trackIndex ?? 0;
};

export const SceneNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<SceneNode>
> = ({ node, scene, runtimeManager }) => {
	const runtime = useMemo(() => {
		if (!scene) return null;
		return runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef(node.sceneId),
		);
	}, [node.sceneId, runtimeManager, scene]);
	const [picture, setPicture] = useState<SkPicture | null>(null);
	const renderTokenRef = useRef(0);
	const lastRequestedFrameRef = useRef<number | null>(null);
	const disposeRef = useRef<(() => void) | null>(null);
	const hasRenderedContentRef = useRef(false);
	const buildQueueRef = useRef<Promise<void>>(Promise.resolve());
	const frameControllerRef = useRef(
		createFramePrecompileController<SceneFrameSnapshot>({
			lookaheadFrames: PRECOMPILE_LOOKAHEAD_FRAMES,
			scheduleTask: schedulePrecompileTask,
			onPrefetchError: (error, frameIndex) => {
				console.error(
					`Failed to precompile scene preview frame ${frameIndex}:`,
					error,
				);
			},
			onCacheEvent: (_event) => {
				// scene 缩略渲染暂不需要输出缓存日志，避免噪音。
			},
		}),
	);

	const invalidateBuffer = useCallback(() => {
		frameControllerRef.current.invalidateAll();
	}, []);

	const enqueueBuild = useCallback(
		<T,>(build: () => Promise<T>): Promise<T> => {
			const pending = buildQueueRef.current;
			const next = pending.then(build, build);
			buildQueueRef.current = next.then(
				() => undefined,
				() => undefined,
			);
			return next;
		},
		[],
	);

	const renderFallback = useCallback(() => {
		if (hasRenderedContentRef.current) return;
		hasRenderedContentRef.current = true;
		setPicture(null);
	}, []);

	const runRender = useCallback(
		(elements: TimelineElement[], displayTime: number) => {
			if (!runtime) return;
			const state = runtime.timelineStore.getState();
			const renderToken = renderTokenRef.current + 1;
			renderTokenRef.current = renderToken;

			const normalizedFps = Number.isFinite(state.fps)
				? Math.round(state.fps)
				: 30;
			const frameIndex = toFrameIndex(displayTime, normalizedFps);
			const previousRequestedFrame = lastRequestedFrameRef.current;
			const isDiscontinuousSeek =
				previousRequestedFrame !== null &&
				(frameIndex < previousRequestedFrame ||
					frameIndex > previousRequestedFrame + 1);
			lastRequestedFrameRef.current = frameIndex;
			frameControllerRef.current.reconcileFrame(frameIndex);

			const buildFrameSnapshot = (targetFrame: number, useQueue = true) => {
				const targetDisplayTime =
					targetFrame === frameIndex
						? displayTime
						: toDisplayTimeFromFrameIndex(
								targetFrame,
								normalizedFps,
								displayTime,
							);
				const safeCanvasSize = {
					width: Math.max(
						1,
						state.canvasSize.width || scene?.timeline.canvas.width || 1,
					),
					height: Math.max(
						1,
						state.canvasSize.height || scene?.timeline.canvas.height || 1,
					),
				};
				const build = () =>
					buildSkiaFrameSnapshot(
						{
							elements,
							displayTime: targetDisplayTime,
							tracks: state.tracks,
							getTrackIndexForElement,
							sortByTrackIndex,
							prepare: {
								isExporting: false,
								fps: normalizedFps,
								canvasSize: safeCanvasSize,
								prepareTransitionPictures: true,
								forcePrepareFrames: true,
								awaitReady: true,
								getModelStore: (id) => runtime.modelRegistry.get(id),
								compositionPath: [node.sceneId],
							},
						},
						{
							wrapRenderNode: (renderNode) => (
								<EditorRuntimeProvider runtime={createScopedRuntime(runtime)}>
									{renderNode}
								</EditorRuntimeProvider>
							),
							resolveCompositionTimeline: (sceneId) => {
								const childRuntime = runtimeManager.getTimelineRuntime(
									toSceneTimelineRef(sceneId),
								);
								if (!childRuntime) return null;
								const childState = childRuntime.timelineStore.getState();
								return {
									sceneId,
									elements: childState.elements,
									tracks: childState.tracks,
									fps: childState.fps,
									canvasSize: childState.canvasSize,
									getModelStore: (id: string) =>
										childRuntime.modelRegistry.get(id),
									wrapRenderNode: (childNode) => (
										<EditorRuntimeProvider
											runtime={createScopedRuntime(childRuntime)}
										>
											{childNode}
										</EditorRuntimeProvider>
									),
								};
							},
						},
					);
				return useQueue ? enqueueBuild(build) : build();
			};

			const commitCurrentFrame = (
				frameState: SceneFrameSnapshot | undefined,
			): boolean => {
				if (!frameState?.picture) {
					renderFallback();
					return false;
				}
				setPicture(frameState.picture);
				hasRenderedContentRef.current = true;
				return true;
			};

			if (!state.isPlaying) {
				// 暂停/拖拽时直接渲染当前帧，避免 lookahead 造成视觉延迟。
				frameControllerRef.current.invalidateAll();
				buildFrameSnapshot(frameIndex, false)
					.then((frameState) => {
						if (renderTokenRef.current !== renderToken) {
							frameState.dispose?.();
							return;
						}
						const rendered = commitCurrentFrame(frameState);
						if (!rendered) {
							frameState.dispose?.();
							return;
						}
						disposeRef.current?.();
						disposeRef.current = frameState.dispose ?? null;
					})
					.catch((error) => {
						if (renderTokenRef.current !== renderToken) return;
						console.error(
							`Failed to build scene skia frame snapshot (${node.sceneId}):`,
							error,
						);
						renderFallback();
					});
				return;
			}

			if (isDiscontinuousSeek) {
				// 播放时发生跳帧/seek，优先直出当前帧并重建 lookahead。
				frameControllerRef.current.invalidateAll();
				buildFrameSnapshot(frameIndex, false)
					.then((frameState) => {
						if (renderTokenRef.current !== renderToken) {
							frameState.dispose?.();
							return;
						}
						const rendered = commitCurrentFrame(frameState);
						if (!rendered) {
							frameState.dispose?.();
							return;
						}
						disposeRef.current?.();
						disposeRef.current = frameState.dispose ?? null;
						frameControllerRef.current.commitFrame(
							frameIndex,
							buildFrameSnapshot,
						);
					})
					.catch((error) => {
						if (renderTokenRef.current !== renderToken) return;
						console.error(
							`Failed to build scene skia frame snapshot (${node.sceneId}):`,
							error,
						);
						renderFallback();
					});
				return;
			}

			frameControllerRef.current
				.getOrBuildCurrent(frameIndex, buildFrameSnapshot)
				.then((entry) => {
					if (renderTokenRef.current !== renderToken) return;
					const rendered = commitCurrentFrame(entry.state);
					if (!rendered) return;
					const nextDispose = frameControllerRef.current.takeDispose(entry);
					disposeRef.current?.();
					disposeRef.current = nextDispose ?? null;
					frameControllerRef.current.commitFrame(
						frameIndex,
						buildFrameSnapshot,
					);
				})
				.catch((error) => {
					if (renderTokenRef.current !== renderToken) return;
					console.error(
						`Failed to build scene skia frame snapshot (${node.sceneId}):`,
						error,
					);
					renderFallback();
				});
		},
		[
			enqueueBuild,
			node.sceneId,
			renderFallback,
			runtime,
			runtimeManager,
			scene,
		],
	);

	useEffect(() => {
		renderTokenRef.current += 1;
		invalidateBuffer();
		frameControllerRef.current.disposeAll();
		disposeRef.current?.();
		disposeRef.current = null;
		hasRenderedContentRef.current = false;
		lastRequestedFrameRef.current = null;
		setPicture(null);

		if (!runtime) return;

		const timelineStore = runtime.timelineStore;
		const renderSkia = () => {
			const state = timelineStore.getState();
			runRender(state.elements, state.getRenderTime());
		};

		const unsubCurrentTime = timelineStore.subscribe(
			(state) => state.currentTime,
			renderSkia,
		);
		const unsubPreviewTime = timelineStore.subscribe(
			(state) => state.previewTime,
			renderSkia,
		);
		const unsubElements = timelineStore.subscribe(
			(state) => state.elements,
			(newElements) => {
				invalidateBuffer();
				runRender(newElements, timelineStore.getState().getRenderTime());
			},
			{ fireImmediately: true },
		);
		const unsubTracks = timelineStore.subscribe(
			(state) => state.tracks,
			() => {
				invalidateBuffer();
				renderSkia();
			},
		);
		const unsubFps = timelineStore.subscribe(
			(state) => state.fps,
			() => {
				invalidateBuffer();
				renderSkia();
			},
		);
		const unsubCanvasSize = timelineStore.subscribe(
			(state) => state.canvasSize,
			() => {
				invalidateBuffer();
				renderSkia();
			},
		);
		const unsubIsPlaying = timelineStore.subscribe(
			(state) => state.isPlaying,
			renderSkia,
		);

		return () => {
			unsubCurrentTime();
			unsubPreviewTime();
			unsubElements();
			unsubTracks();
			unsubFps();
			unsubCanvasSize();
			unsubIsPlaying();
			renderTokenRef.current += 1;
			frameControllerRef.current.disposeAll();
			disposeRef.current?.();
			disposeRef.current = null;
			hasRenderedContentRef.current = false;
			lastRequestedFrameRef.current = null;
		};
	}, [invalidateBuffer, runRender, runtime]);

	if (!scene) {
		return (
			<Rect
				x={0}
				y={0}
				width={Math.max(1, node.width)}
				height={Math.max(1, node.height)}
				color="#171717"
			/>
		);
	}

	const sourceWidth = Math.max(1, scene.timeline.canvas.width);
	const sourceHeight = Math.max(1, scene.timeline.canvas.height);
	const scaleX = node.width / sourceWidth;
	const scaleY = node.height / sourceHeight;

	return (
		<Group transform={[{ scaleX }, { scaleY }]}>
			{picture ? (
				<Picture picture={picture} />
			) : (
				<Rect
					x={0}
					y={0}
					width={sourceWidth}
					height={sourceHeight}
					color="#171717"
				/>
			)}
		</Group>
	);
};
