import { createFramePrecompileController } from "core/render-system/framePrecompileController";
import { schedulePrecompileTask } from "core/render-system/framePrecompileScheduler";
import type { TimelineElement } from "core/timeline-system/types";
import type { SceneNode } from "@/studio/project/types";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
	Group,
	ImageShader,
	Picture,
	Rect,
	Skia,
	type SkPicture,
	useSharedValue,
} from "react-skia-lite";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { textTypographyFacade } from "@/typography/textTypographyFacade";
import { useCanvasNodeThumbnailImage } from "../thumbnail/useCanvasNodeThumbnailImage";
import type { CanvasNodeSkiaRenderProps } from "../types";
import {
	buildSceneNodeFrameSnapshot,
	resolveSceneNodeDisplayTimeFromFrame,
	resolveSceneNodeFrameIndex,
	type SceneNodeFrameSnapshot,
} from "./frameSnapshot";
import {
	clearSceneNodeLastLiveFrame,
	recordSceneNodeLastLiveFrame,
} from "./lastLiveFrame";

const PRECOMPILE_LOOKAHEAD_FRAMES = 2;

type ScenePreviewFrame = SceneNodeFrameSnapshot;
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

const createEmptyPicture = (): SkPicture => {
	const recorder = Skia.PictureRecorder();
	let canvas: ReturnType<typeof recorder.beginRecording> | null = null;
	try {
		canvas = recorder.beginRecording();
		return recorder.finishRecordingAsPicture();
	} finally {
		(canvas as { dispose?: () => void } | null)?.dispose?.();
		recorder.dispose?.();
	}
};

export const SceneNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<SceneNode>
> = ({ node, scene, runtimeManager, isActive }) => {
	const sceneCanvasWidth = scene?.timeline.canvas.width ?? 1;
	const sceneCanvasHeight = scene?.timeline.canvas.height ?? 1;
	const thumbnailImage = useCanvasNodeThumbnailImage(node.thumbnail);
	const runtime = useMemo(() => {
		if (!scene) return null;
		return runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef(node.sceneId),
		);
	}, [node.sceneId, runtimeManager, scene]);
	const emptyPicture = useMemo(() => {
		return createEmptyPicture();
	}, []);
	const picture = useSharedValue<SkPicture>(emptyPicture);
	const pictureOpacity = useSharedValue(0);
	const fallbackOpacity = useSharedValue(1);
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

	const setPictureSharedValue = useCallback(
		(nextPicture: SkPicture) => {
			const modify = picture.modify as
				| ((
						modifier: (value: SkPicture) => SkPicture,
						forceUpdate?: boolean,
				  ) => void)
				| undefined;
			if (typeof modify === "function") {
				modify(() => nextPicture, true);
				return;
			}
			(picture as { value: SkPicture }).value = nextPicture;
		},
		[picture],
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
				// 延后一帧再释放旧 picture，避免父画布尚未 present 新帧时读到已释放资源。
				flushDeferredDisposeQueue();
			});
		},
		[flushDeferredDisposeQueue],
	);

	const replaceCurrentPicture = useCallback(
		(nextPicture: SkPicture, nextDispose: (() => void) | null = null) => {
			const previousDispose = disposeRef.current;
			// SkPicture 是 JSI 对象，直接走 shared value 赋值会触发深比较，代价很高。
			setPictureSharedValue(nextPicture);
			pictureOpacity.value = 1;
			fallbackOpacity.value = 0;
			hasRenderedContentRef.current = true;
			disposeRef.current = nextDispose;
			scheduleDeferredDispose(previousDispose);
		},
		[
			fallbackOpacity,
			pictureOpacity,
			scheduleDeferredDispose,
			setPictureSharedValue,
		],
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

	const clearCommittedFrame = useCallback(() => {
		disposeRef.current?.();
		disposeRef.current = null;
		hasRenderedContentRef.current = false;
		fallbackOpacity.value = 1;
		pictureOpacity.value = 0;
	}, [fallbackOpacity, pictureOpacity]);

	const commitFrameState = useCallback(
		(frameState: ScenePreviewFrame) => {
			replaceCurrentPicture(frameState.picture, frameState.dispose ?? null);
			if (scene) {
				recordSceneNodeLastLiveFrame({
					node,
					scene,
					frame: frameState,
				});
			}
		},
		[node, replaceCurrentPicture, scene],
	);

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
			const frameIndex = resolveSceneNodeFrameIndex(displayTime, normalizedFps);
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
						: resolveSceneNodeDisplayTimeFromFrame(
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
				const build = async (): Promise<ScenePreviewFrame> => {
					return buildSceneNodeFrameSnapshot({
						node,
						runtime,
						runtimeManager,
						elements,
						tracks: state.tracks,
						displayTime: targetDisplayTime,
						frameIndex: targetFrame,
						fps: normalizedFps,
						canvasSize: safeCanvasSize,
					});
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
						commitFrameState(frameState);
					})
					.catch((error) => {
						if (renderTokenRef.current !== renderToken) return;
						if (isPreemptedBuildError(error)) return;
						console.error(
							`Failed to build scene skia frame snapshot (${node.sceneId}):`,
							error,
						);
						clearSceneNodeLastLiveFrame(node.id);
						clearCommittedFrame();
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
						commitFrameState(frameState);
						frameControllerRef.current.commitFrame(frameIndex, buildFrameState);
					})
					.catch((error) => {
						if (renderTokenRef.current !== renderToken) return;
						if (isPreemptedBuildError(error)) return;
						console.error(
							`Failed to build scene skia frame snapshot (${node.sceneId}):`,
							error,
						);
						clearSceneNodeLastLiveFrame(node.id);
						clearCommittedFrame();
					});
				return;
			}

			frameControllerRef.current
				.getOrBuildCurrent(frameIndex, buildFrameState)
				.then((entry) => {
					if (renderTokenRef.current !== renderToken) return;
					if (!entry.state) return;
					commitFrameState({
						...entry.state,
						dispose: frameControllerRef.current.takeDispose(entry) ?? undefined,
					});
					frameControllerRef.current.commitFrame(frameIndex, buildFrameState);
				})
				.catch((error) => {
					if (renderTokenRef.current !== renderToken) return;
					if (isPreemptedBuildError(error)) return;
					console.error(
						`Failed to build scene skia frame snapshot (${node.sceneId}):`,
						error,
					);
					clearSceneNodeLastLiveFrame(node.id);
					clearCommittedFrame();
				});
		},
		[
			commitFrameState,
			enqueueBuild,
			node,
			preemptBuildQueue,
			clearCommittedFrame,
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
			clearSceneNodeLastLiveFrame(node.id);
			cancelDeferredDisposeFrame();
			flushDeferredDisposeQueue();
			disposeRef.current?.();
			disposeRef.current = null;
			hasRenderedContentRef.current = false;
			setPictureSharedValue(emptyPicture);
			pictureOpacity.value = 0;
			fallbackOpacity.value = 1;
			return;
		}

		if (!isActive) {
			// 非 active 节点只保留当前已提交画面，停止实时构帧与预编译。
			preemptBuildQueue();
			frameControllerRef.current.disposeAll();
			lastRequestedFrameRef.current = null;
			if (!hasRenderedContentRef.current) {
				setPictureSharedValue(emptyPicture);
				pictureOpacity.value = 0;
				fallbackOpacity.value = 1;
			} else {
				pictureOpacity.value = 1;
				fallbackOpacity.value = 0;
			}
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
		emptyPicture,
		fallbackOpacity,
		flushDeferredDisposeQueue,
		invalidateBuffer,
		isActive,
		node.id,
		pictureOpacity,
		preemptBuildQueue,
		runRender,
		runtime,
		setPictureSharedValue,
	]);

	useEffect(() => {
		if (!runtime || !isActive) return;
		let pending = false;
		let rafId: number | null = null;
		const flush = () => {
			pending = false;
			rafId = null;
			const timelineState = runtime.timelineStore.getState();
			invalidateBuffer();
			runRender(timelineState.elements, timelineState.getRenderTime());
		};
		const scheduleRefresh = () => {
			if (pending) return;
			pending = true;
			if (
				typeof window !== "undefined" &&
				typeof window.requestAnimationFrame === "function"
			) {
				rafId = window.requestAnimationFrame(() => {
					flush();
				});
				return;
			}
			void Promise.resolve().then(() => {
				flush();
			});
		};
		const unsubscribeTypographyRevision =
			textTypographyFacade.subscribeRevision(() => {
				scheduleRefresh();
			});
		return () => {
			unsubscribeTypographyRevision();
			if (
				rafId !== null &&
				typeof window !== "undefined" &&
				typeof window.cancelAnimationFrame === "function"
			) {
				window.cancelAnimationFrame(rafId);
			}
			rafId = null;
			pending = false;
		};
	}, [invalidateBuffer, isActive, runRender, runtime]);

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
			emptyPicture.dispose?.();
		};
	}, [cancelDeferredDisposeFrame, emptyPicture, flushDeferredDisposeQueue]);

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
				opacity={fallbackOpacity}
			>
				{thumbnailImage ? (
					<ImageShader
						image={thumbnailImage}
						fit="contain"
						x={0}
						y={0}
						width={sourceWidth}
						height={sourceHeight}
					/>
				) : null}
			</Rect>
			<Picture picture={picture} opacity={pictureOpacity} />
		</Group>
	);
};
