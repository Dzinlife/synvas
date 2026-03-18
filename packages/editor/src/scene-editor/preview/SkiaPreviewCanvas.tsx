import {
	toDisplayTimeFromFrameIndex,
	toFrameIndex,
} from "core/editor/preview/framePrecompileBuffer";
import { createFramePrecompileController } from "core/editor/preview/framePrecompileController";
import { schedulePrecompileTask } from "core/editor/preview/framePrecompileScheduler";
import type { TimelineElement } from "core/element/types";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
	Canvas,
	type CanvasRef,
	Fill,
	Picture,
	RenderTarget,
	getSkiaRenderBackend,
	useContextBridge,
} from "react-skia-lite";
import { useTimelineStore } from "@/scene-editor/contexts/TimelineContext";
import {
	EditorRuntimeContext,
	useEditorRuntime,
	useModelRegistry,
	useTimelineStoreApi,
} from "@/scene-editor/runtime/EditorRuntimeProvider";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import type { TimelineTrack } from "@/scene-editor/timeline/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { buildSkiaFrameSnapshot, buildSkiaRenderState } from "./buildSkiaTree";

interface SkiaPreviewCanvasProps {
	canvasWidth: number;
	canvasHeight: number;
	tracks: TimelineTrack[];
	getTrackIndexForElement: (element: TimelineElement) => number;
	sortByTrackIndex: (elements: TimelineElement[]) => TimelineElement[];
	getElements: () => TimelineElement[];
	getRenderTime: () => number;
	canvasRef?: React.RefObject<CanvasRef | null>;
}

const PRECOMPILE_LOOKAHEAD_FRAMES = 2;

type SkiaFrameSnapshot = Awaited<ReturnType<typeof buildSkiaFrameSnapshot>>;
type PreviewFrameState =
	| {
			kind: "picture";
			picture: NonNullable<SkiaFrameSnapshot["picture"]>;
			dispose?: (() => void) | undefined;
	  }
	| {
			kind: "render-target";
			node: React.ReactNode;
			dispose?: (() => void) | undefined;
	  };
const preemptedBuildErrorSymbol = Symbol("preview-build-preempted");
type PreemptedBuildError = Error & {
	[preemptedBuildErrorSymbol]: true;
};
const createPreemptedBuildError = (): PreemptedBuildError => {
	const error = new Error(
		"Preview frame build preempted",
	) as PreemptedBuildError;
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

export const SkiaPreviewCanvas: React.FC<SkiaPreviewCanvasProps> = ({
	canvasWidth,
	canvasHeight,
	tracks,
	getTrackIndexForElement,
	sortByTrackIndex,
	getElements,
	getRenderTime,
	canvasRef,
}) => {
	type ResolveCompositionTimeline = NonNullable<
		NonNullable<Parameters<typeof buildSkiaRenderState>[1]>["resolveCompositionTimeline"]
	>;
	const RuntimeContextBridge = useContextBridge(EditorRuntimeContext);
	const runtime = useEditorRuntime();
	const timelineStore = useTimelineStoreApi();
	const modelRegistry = useModelRegistry();
	const runtimeManager = useMemo<StudioRuntimeManager | null>(() => {
		const manager = runtime as Partial<StudioRuntimeManager>;
		if (
			!manager.ensureTimelineRuntime ||
			!manager.getTimelineRuntime ||
			!manager.getActiveEditTimelineRuntime
		) {
			return null;
		}
		return manager as StudioRuntimeManager;
	}, [runtime]);
	const rootSceneId = useMemo(() => {
		return runtimeManager?.getActiveEditTimelineRuntime()?.ref.sceneId ?? null;
	}, [runtimeManager]);
	const useLiveRenderTarget = useMemo(() => {
		return getSkiaRenderBackend().kind === "webgpu";
	}, []);
	const internalCanvasRef = useRef<CanvasRef>(null);
	const targetCanvasRef = canvasRef ?? internalCanvasRef;
	const renderTokenRef = useRef(0);
	const lastRequestedFrameRef = useRef<number | null>(null);
	const disposeRef = useRef<(() => void) | null>(null);
	const hasRenderedContentRef = useRef(false);
	const buildQueueRef = useRef<Promise<void>>(Promise.resolve());
	const buildQueueEpochRef = useRef(0);
	const frameControllerRef = useRef(
		createFramePrecompileController<PreviewFrameState>({
			lookaheadFrames: PRECOMPILE_LOOKAHEAD_FRAMES,
			scheduleTask: schedulePrecompileTask,
			onPrefetchError: (error, frameIndex) => {
				if (isPreemptedBuildError(error)) return;
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
	const isPlaying = useTimelineStore((state) => state.isPlaying);

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

	const renderBlackFrame = useCallback(() => {
		const root = targetCanvasRef.current?.getRoot();
		if (!root) return;
		root.render(<Fill color="black" key="preview-fallback-black" />);
	}, [targetCanvasRef]);

	const runRender = useCallback(
		(elements: TimelineElement[], displayTime: number) => {
			const renderToken = renderTokenRef.current + 1;
			renderTokenRef.current = renderToken;
			const queueEpoch = buildQueueEpochRef.current;

			const normalizedFps = Number.isFinite(fps) ? Math.round(fps) : 0;
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
				const build = async () => {
					if (renderTokenRef.current !== renderToken) {
						throw createPreemptedBuildError();
					}
					const resolveCompositionTimeline: ResolveCompositionTimeline = (
						sceneId,
					) => {
						if (!runtimeManager) return null;
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
							wrapRenderNode: (childNode: React.ReactNode) => (
								<EditorRuntimeContext.Provider
									value={{
										id: `${childRuntime.id}:composition-preview`,
										timelineStore: childRuntime.timelineStore,
										modelRegistry: childRuntime.modelRegistry,
									}}
								>
									{childNode}
								</EditorRuntimeContext.Provider>
							),
						};
					};
					let frameState: PreviewFrameState;
					if (useLiveRenderTarget) {
						const renderState = await buildSkiaRenderState(
							{
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
									forcePrepareFrames: true,
									awaitReady: true,
									// 提供模型索引，供预览态准备帧使用
									getModelStore: (id) => modelRegistry.get(id),
									compositionPath: rootSceneId ? [rootSceneId] : [],
								},
							},
							{
								wrapRenderNode: (node) => (
									<RuntimeContextBridge>{node}</RuntimeContextBridge>
								),
								resolveCompositionTimeline,
							},
						);
						await renderState.ready;
						frameState = {
							kind: "render-target",
							node: (
								<RuntimeContextBridge>{renderState.children}</RuntimeContextBridge>
							),
							dispose: renderState.dispose,
						};
					} else {
						const frameSnapshot = await buildSkiaFrameSnapshot(
							{
								elements,
								displayTime: targetDisplayTime,
								tracks,
								getTrackIndexForElement,
								sortByTrackIndex,
								prepare: {
									isExporting: false,
									fps: normalizedFps,
									canvasSize: { width: canvasWidth, height: canvasHeight },
									prepareTransitionPictures: true,
									forcePrepareFrames: true,
									awaitReady: true,
									getModelStore: (id) => modelRegistry.get(id),
									compositionPath: rootSceneId ? [rootSceneId] : [],
								},
							},
							{
								wrapRenderNode: (node) => (
									<RuntimeContextBridge>{node}</RuntimeContextBridge>
								),
								resolveCompositionTimeline,
							},
						);
						if (!frameSnapshot.picture) {
							throw new Error("Preview frame picture is null");
						}
						frameState = {
							kind: "picture",
							picture: frameSnapshot.picture,
							dispose: frameSnapshot.dispose,
						};
					}
					if (renderTokenRef.current !== renderToken) {
						frameState.dispose?.();
						throw createPreemptedBuildError();
					}
					return frameState;
				};
				return useQueue ? enqueueBuild(build, queueEpoch) : build();
			};

			const commitCurrentFrame = (
				frameState: PreviewFrameState | undefined,
			): boolean => {
				if (!frameState) {
					if (!hasRenderedContentRef.current) {
						renderBlackFrame();
						hasRenderedContentRef.current = true;
					}
					return false;
				}
				const root = targetCanvasRef.current?.getRoot();
				if (!root) return false;
				if (frameState.kind === "render-target") {
					root.render(
						<RenderTarget
							width={canvasWidth}
							height={canvasHeight}
							clearColor="transparent"
							debugLabel="scene-preview"
						>
							{frameState.node}
						</RenderTarget>,
					);
				} else {
					root.render(<Picture picture={frameState.picture} />);
				}
				hasRenderedContentRef.current = true;
				return true;
			};

			if (!isPlaying) {
				// Scrubbing/暂停态不做 lookahead，优先尽快产出当前帧。
				preemptBuildQueue();
				frameControllerRef.current.invalidateAll();
				buildFrameState(frameIndex, false)
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
						if (renderTokenRef.current !== renderToken) {
							return;
						}
						if (isPreemptedBuildError(error)) {
							return;
						}
						console.error(
							"Failed to build skia preview frame snapshot:",
							error,
						);
						if (!hasRenderedContentRef.current) {
							renderBlackFrame();
							hasRenderedContentRef.current = true;
						}
					});
				return;
			}

			if (isDiscontinuousSeek) {
				// 播放中发生 seek/跳帧时，优先直接构建当前帧，避免被旧队列阻塞。
				preemptBuildQueue();
				frameControllerRef.current.invalidateAll();
				buildFrameState(frameIndex, false)
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
							buildFrameState,
						);
					})
					.catch((error) => {
						if (renderTokenRef.current !== renderToken) {
							return;
						}
						if (isPreemptedBuildError(error)) {
							return;
						}
						console.error(
							"Failed to build skia preview frame snapshot:",
							error,
						);
						if (!hasRenderedContentRef.current) {
							renderBlackFrame();
							hasRenderedContentRef.current = true;
						}
					});
				return;
			}

			frameControllerRef.current
				.getOrBuildCurrent(frameIndex, buildFrameState)
				.then((entry) => {
					if (renderTokenRef.current !== renderToken) {
						return;
					}
					const rendered = commitCurrentFrame(entry.state);
					if (!rendered) return;
					const nextDispose = frameControllerRef.current.takeDispose(entry);
					disposeRef.current?.();
					disposeRef.current = nextDispose ?? null;
					frameControllerRef.current.commitFrame(
						frameIndex,
						buildFrameState,
					);
				})
				.catch((error) => {
					if (renderTokenRef.current !== renderToken) {
						return;
					}
					if (isPreemptedBuildError(error)) {
						return;
					}
					console.error("Failed to build skia preview frame snapshot:", error);
					if (!hasRenderedContentRef.current) {
						renderBlackFrame();
						hasRenderedContentRef.current = true;
					}
				});
		},
		[
			canvasHeight,
			canvasWidth,
			enqueueBuild,
			fps,
			getTrackIndexForElement,
			isPlaying,
			modelRegistry,
			preemptBuildQueue,
			renderBlackFrame,
			rootSceneId,
			RuntimeContextBridge,
			runtimeManager,
			sortByTrackIndex,
			targetCanvasRef,
			tracks,
			useLiveRenderTarget,
		],
	);

	const renderSkia = useCallback(() => {
		runRender(getElements(), getRenderTime());
	}, [getElements, getRenderTime, runRender]);

	useEffect(() => {
		// 构建输入（fps/轨道/尺寸等）变化时保守失效，避免复用旧条件下的缓存。
		invalidateBuffer();
	}, [invalidateBuffer, runRender]);

	useEffect(() => {
		const unsub1 = timelineStore.subscribe(
			(state) => state.currentTime,
			renderSkia,
		);
		const unsub2 = timelineStore.subscribe(
			(state) => state.previewTime,
			renderSkia,
		);
		return () => {
			unsub1();
			unsub2();
		};
	}, [renderSkia, timelineStore]);

	useEffect(() => {
		return timelineStore.subscribe(
			(state) => state.elements,
			(newElements) => {
				invalidateBuffer();
				runRender(newElements, getRenderTime());
			},
			{
				fireImmediately: true,
			},
		);
	}, [getRenderTime, invalidateBuffer, runRender, timelineStore]);

	useEffect(() => {
		return () => {
			frameControllerRef.current.disposeAll();
			disposeRef.current?.();
			disposeRef.current = null;
			hasRenderedContentRef.current = false;
			lastRequestedFrameRef.current = null;
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
