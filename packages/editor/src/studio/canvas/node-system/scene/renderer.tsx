import {
	toDisplayTimeFromFrameIndex,
	toFrameIndex,
} from "core/editor/preview/framePrecompileBuffer";
import { createFramePrecompileController } from "core/editor/preview/framePrecompileController";
import { schedulePrecompileTask } from "core/editor/preview/framePrecompileScheduler";
import type { TimelineElement } from "core/element/types";
import type { SceneNode } from "core/studio/types";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Group,
	Picture,
	Rect,
} from "react-skia-lite";
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
type ScenePreviewFrame = {
	kind: "picture";
	picture: NonNullable<SceneFrameSnapshot["picture"]>;
	dispose?: (() => void) | undefined;
};
const preemptedBuildErrorSymbol = Symbol("scene-build-preempted");
type PreemptedBuildError = Error & {
	[preemptedBuildErrorSymbol]: true;
};
const createPreemptedBuildError = (): PreemptedBuildError => {
	const error = new Error("Scene frame build preempted") as PreemptedBuildError;
	error[preemptedBuildErrorSymbol] = true;
	return error;
};
const isPreemptedBuildError = (
	error: unknown,
): error is PreemptedBuildError => {
	return Boolean(
		error &&
			typeof error === "object" &&
			preemptedBuildErrorSymbol in (error as Record<PropertyKey, unknown>),
	);
};

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
	type ResolveCompositionTimeline = NonNullable<
		NonNullable<
			Parameters<typeof buildSkiaFrameSnapshot>[1]
		>["resolveCompositionTimeline"]
	>;
	const sceneCanvasWidth = scene?.timeline.canvas.width ?? 1;
	const sceneCanvasHeight = scene?.timeline.canvas.height ?? 1;
	const runtime = useMemo(() => {
		if (!scene) return null;
		return runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef(node.sceneId),
		);
	}, [node.sceneId, runtimeManager, scene]);
	const [currentFrame, setCurrentFrame] = useState<ScenePreviewFrame | null>(
		null,
	);
	const renderTokenRef = useRef(0);
	const lastRequestedFrameRef = useRef<number | null>(null);
	const disposeRef = useRef<(() => void) | null>(null);
	const deferredDisposeFrameRef = useRef<number | null>(null);
	const deferredDisposeQueueRef = useRef<Array<() => void>>([]);
	const hasRenderedContentRef = useRef(false);
	const buildQueueRef = useRef<Promise<void>>(Promise.resolve());
	const buildQueueEpochRef = useRef(0);
	const frameControllerRef = useRef(
		createFramePrecompileController<ScenePreviewFrame>({
			lookaheadFrames: PRECOMPILE_LOOKAHEAD_FRAMES,
			scheduleTask: schedulePrecompileTask,
			onPrefetchError: (error, frameIndex) => {
				if (isPreemptedBuildError(error)) return;
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

	const flushDeferredDisposeQueue = useCallback(() => {
		const pending = deferredDisposeQueueRef.current;
		deferredDisposeQueueRef.current = [];
		for (const dispose of pending) {
			dispose();
		}
	}, []);

	const cancelDeferredDisposeFrame = useCallback(() => {
		if (deferredDisposeFrameRef.current === null) return;
		if (
			typeof window !== "undefined" &&
			typeof window.cancelAnimationFrame === "function"
		) {
			window.cancelAnimationFrame(deferredDisposeFrameRef.current);
		}
		deferredDisposeFrameRef.current = null;
	}, []);

	const scheduleDeferredDispose = useCallback(
		(dispose: (() => void) | null | undefined) => {
			if (typeof dispose !== "function") return;
			if (
				typeof window === "undefined" ||
				typeof window.requestAnimationFrame !== "function"
			) {
				dispose();
				return;
			}
			deferredDisposeQueueRef.current.push(dispose);
			if (deferredDisposeFrameRef.current !== null) {
				return;
			}
			deferredDisposeFrameRef.current = window.requestAnimationFrame(() => {
				deferredDisposeFrameRef.current = null;
				// 延后一帧再释放旧渲染资源，避免父画布尚未 present 新帧时读到已释放对象。
				flushDeferredDisposeQueue();
			});
		},
		[flushDeferredDisposeQueue],
	);

	const replaceCurrentFrame = useCallback(
		(nextFrame: ScenePreviewFrame, nextDispose: (() => void) | null = null) => {
			const previousDispose = disposeRef.current;
			setCurrentFrame(nextFrame);
			hasRenderedContentRef.current = true;
			disposeRef.current = nextDispose;
			scheduleDeferredDispose(previousDispose);
		},
		[scheduleDeferredDispose],
	);

	const preemptBuildQueue = useCallback(() => {
		buildQueueEpochRef.current += 1;
		buildQueueRef.current = Promise.resolve();
	}, []);

	const invalidateBuffer = useCallback(() => {
		frameControllerRef.current.invalidateAll();
		preemptBuildQueue();
	}, [preemptBuildQueue]);

	const enqueueBuild = useCallback(
		<T,>(build: () => Promise<T>, queueEpoch: number): Promise<T> => {
			const run = async () => {
				if (queueEpoch !== buildQueueEpochRef.current) {
					throw createPreemptedBuildError();
				}
				return build();
			};
			const pending = buildQueueRef.current;
			const next = pending.then(run, run);
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
		setCurrentFrame(null);
	}, []);

	const runRender = useCallback(
		(elements: TimelineElement[], displayTime: number) => {
			if (!runtime) return;
			const state = runtime.timelineStore.getState();
			const renderToken = renderTokenRef.current + 1;
			renderTokenRef.current = renderToken;
			const queueEpoch = buildQueueEpochRef.current;

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

			const buildFrameState = (targetFrame: number, useQueue = true) => {
				const targetDisplayTime =
					targetFrame === frameIndex
						? displayTime
						: toDisplayTimeFromFrameIndex(
								targetFrame,
								normalizedFps,
								displayTime,
							);
				const safeCanvasSize = {
					width: Math.max(1, state.canvasSize.width || sceneCanvasWidth || 1),
					height: Math.max(
						1,
						state.canvasSize.height || sceneCanvasHeight || 1,
					),
				};
				const resolveCompositionTimeline: ResolveCompositionTimeline = (sceneId) => {
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
						getModelStore: (id: string) => childRuntime.modelRegistry.get(id),
						wrapRenderNode: (childNode: ReactNode) => (
							<EditorRuntimeProvider runtime={createScopedRuntime(childRuntime)}>
								{childNode}
							</EditorRuntimeProvider>
						),
					};
				};
				const build = async (): Promise<ScenePreviewFrame> => {
					const frameSnapshot = await buildSkiaFrameSnapshot(
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
							resolveCompositionTimeline,
						},
					);
					if (!frameSnapshot.picture) {
						throw new Error("Scene preview frame picture is null");
					}
					return {
						kind: "picture",
						picture: frameSnapshot.picture,
						dispose: frameSnapshot.dispose,
					};
				};
				const guardedBuild = async () => {
					if (renderTokenRef.current !== renderToken) {
						throw createPreemptedBuildError();
					}
					const frameSnapshot = await build();
					if (renderTokenRef.current !== renderToken) {
						frameSnapshot.dispose?.();
						throw createPreemptedBuildError();
					}
					return frameSnapshot;
				};
				return useQueue
					? enqueueBuild(guardedBuild, queueEpoch)
					: guardedBuild();
			};

			if (!state.isPlaying) {
				// 暂停/拖拽时直接渲染当前帧，避免 lookahead 造成视觉延迟。
				preemptBuildQueue();
				frameControllerRef.current.invalidateAll();
				buildFrameState(frameIndex, false)
					.then((frameState) => {
						if (renderTokenRef.current !== renderToken) {
							frameState.dispose?.();
							return;
						}
						replaceCurrentFrame(frameState, frameState.dispose ?? null);
					})
					.catch((error) => {
						if (renderTokenRef.current !== renderToken) return;
						if (isPreemptedBuildError(error)) return;
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
				preemptBuildQueue();
				frameControllerRef.current.invalidateAll();
				buildFrameState(frameIndex, false)
					.then((frameState) => {
						if (renderTokenRef.current !== renderToken) {
							frameState.dispose?.();
							return;
						}
						replaceCurrentFrame(frameState, frameState.dispose ?? null);
						frameControllerRef.current.commitFrame(
							frameIndex,
							buildFrameState,
						);
					})
					.catch((error) => {
						if (renderTokenRef.current !== renderToken) return;
						if (isPreemptedBuildError(error)) return;
						console.error(
							`Failed to build scene skia frame snapshot (${node.sceneId}):`,
							error,
						);
						renderFallback();
					});
				return;
			}

			frameControllerRef.current
				.getOrBuildCurrent(frameIndex, buildFrameState)
				.then((entry) => {
					if (renderTokenRef.current !== renderToken) return;
					if (!entry.state) return;
					replaceCurrentFrame(entry.state, frameControllerRef.current.takeDispose(entry) ?? null);
					frameControllerRef.current.commitFrame(
						frameIndex,
						buildFrameState,
					);
				})
				.catch((error) => {
					if (renderTokenRef.current !== renderToken) return;
					if (isPreemptedBuildError(error)) return;
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
			preemptBuildQueue,
			replaceCurrentFrame,
			renderFallback,
			runtime,
			runtimeManager,
			sceneCanvasHeight,
			sceneCanvasWidth,
		],
	);

	useEffect(() => {
		renderTokenRef.current += 1;
		invalidateBuffer();
		frameControllerRef.current.disposeAll();
		lastRequestedFrameRef.current = null;

		if (!runtime) {
			cancelDeferredDisposeFrame();
			flushDeferredDisposeQueue();
			disposeRef.current?.();
			disposeRef.current = null;
			hasRenderedContentRef.current = false;
			setCurrentFrame(null);
			return;
		}

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
			lastRequestedFrameRef.current = null;
		};
	}, [
		cancelDeferredDisposeFrame,
		flushDeferredDisposeQueue,
		invalidateBuffer,
		runRender,
		runtime,
	]);

	useEffect(() => {
		return () => {
			renderTokenRef.current += 1;
			cancelDeferredDisposeFrame();
			flushDeferredDisposeQueue();
			frameControllerRef.current.disposeAll();
			disposeRef.current?.();
			disposeRef.current = null;
			hasRenderedContentRef.current = false;
			lastRequestedFrameRef.current = null;
		};
	}, [cancelDeferredDisposeFrame, flushDeferredDisposeQueue]);

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

	const sourceWidth = Math.max(1, sceneCanvasWidth);
	const sourceHeight = Math.max(1, sceneCanvasHeight);
	const scaleX = node.width / sourceWidth;
	const scaleY = node.height / sourceHeight;

	return (
		<Group transform={[{ scaleX }, { scaleY }]}>
			<Rect
				x={0}
				y={0}
				width={sourceWidth}
				height={sourceHeight}
				color="#171717"
			/>
			{currentFrame?.kind === "picture" ? (
				<Picture picture={currentFrame.picture} />
			) : null}
		</Group>
	);
};
