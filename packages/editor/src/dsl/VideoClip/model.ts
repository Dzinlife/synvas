import type { CanvasSink, Input, WrappedCanvas } from "mediabunny";
import { type SkImage, Skia } from "react-skia-lite";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { AssetHandle } from "@/dsl/assets/AssetStore";
import { acquireVideoAsset, type VideoAsset } from "@/dsl/assets/videoAsset";
import type { TimelineElement } from "@/dsl/types";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import {
	framesToSeconds,
	framesToTimecode,
	secondsToFrames,
} from "@/utils/timecode";
import type {
	ComponentModel,
	ComponentModelStore,
	PrepareFrameContext,
	ValidationResult,
} from "../model/types";

// VideoClip Props 类型
export interface VideoClipProps {
	uri?: string;
	reversed?: boolean;
	start: number; // 帧
	end: number; // 帧
}

// VideoClip 内部状态
export interface VideoClipInternal {
	videoSink: CanvasSink | null;
	input: Input | null;
	currentFrame: SkImage | null;
	videoDuration: number; // 秒
	isReady: boolean;
	playbackEpoch: number;
	// 缩略图（用于时间线预览）
	thumbnailCanvas: HTMLCanvasElement | null;
	// 帧缓存
	frameCache: Map<number, SkImage>;
	// seek 方法（用于拖动/跳转）
	seekToTime: (seconds: number) => Promise<void>;
	// 开始流式播放
	startPlayback: (startTime: number) => Promise<void>;
	// 获取下一帧（流式播放时调用）
	getNextFrame: (targetTime: number) => Promise<void>;
	// 播放步进（自动处理启动/回退）
	stepPlayback: (targetTime: number) => Promise<void>;
	// 停止流式播放
	stopPlayback: () => void;
}

// 计算实际要 seek 的视频时间（考虑倒放）
export const calculateVideoTime = ({
	start,
	timelineTime,
	videoDuration,
	reversed,
	offset = 0,
	clipDuration,
}: {
	start: number;
	timelineTime: number;
	videoDuration: number;
	reversed?: boolean;
	offset?: number;
	clipDuration?: number;
}): number => {
	const relativeTime = timelineTime - start;
	const offsetValue = Number.isFinite(offset) ? offset : 0;
	const safeOffset = Math.max(0, offsetValue);
	const safeVideoDuration = Math.max(0, videoDuration);
	const safeClipDuration =
		clipDuration ?? Math.max(0, safeVideoDuration - safeOffset);

	if (reversed) {
		const reversedTime = offsetValue + safeClipDuration - relativeTime;
		return Math.min(safeVideoDuration, Math.max(0, reversedTime));
	} else {
		const forwardTime = offsetValue + relativeTime;
		return Math.min(safeVideoDuration, Math.max(0, forwardTime));
	}
};

const DEFAULT_FPS = 30;
// 目标时间回退超过该帧数则重启流式播放（按时间线 FPS 计算）
const PLAYBACK_BACK_JUMP_FRAMES = 3;
const normalizeOffsetFrames = (offset?: number): number => {
	if (!Number.isFinite(offset ?? NaN)) return 0;
	return Math.max(0, Math.round(offset as number));
};
const computeAvailableDurationFrames = (
	totalFrames: number | null,
	offsetFrames: number,
): number | undefined => {
	if (totalFrames === null || !Number.isFinite(totalFrames)) {
		return undefined;
	}
	const safeTotal = Math.max(0, Math.round(totalFrames));
	if (safeTotal === 0) return 0;
	return Math.max(1, safeTotal - offsetFrames);
};

// 创建 VideoClip Model
export function createVideoClipModel(
	id: string,
	initialProps: VideoClipProps,
): ComponentModelStore<VideoClipProps, VideoClipInternal> {
	const SEEK_PREFETCH_FRAMES = 24;
	// 用于取消异步操作
	let asyncId = 0;
	// init 的取消标记，避免被播放/seek 的 asyncId 误伤
	let initEpoch = 0;
	let isSeekingFlag = false;
	let lastSeekTime: number | null = null;
	let pendingSeekTime: number | null = null;
	let lastPreparedFrameIndex: number | null = null;
	let videoFrameIterator: AsyncGenerator<WrappedCanvas, void, unknown> | null =
		null;

	// 流式播放状态
	let isPlaybackActive = false;
	let nextFrame: WrappedCanvas | null = null;
	let isSteppingPlayback = false;
	let lastPlaybackTargetTime: number | null = null;
	let playbackIdleTimer: ReturnType<typeof setTimeout> | null = null;
	let lastPlaybackTouch = 0;

	const PLAYBACK_IDLE_MS = 500;

	const touchPlayback = () => {
		lastPlaybackTouch = performance.now();
		if (playbackIdleTimer) {
			clearTimeout(playbackIdleTimer);
		}
		// 导出时保持流式解码，不触发空闲停止
		if (useTimelineStore.getState().isExporting) {
			playbackIdleTimer = null;
			return;
		}
		playbackIdleTimer = setTimeout(() => {
			if (useTimelineStore.getState().isExporting) return;
			const now = performance.now();
			if (now - lastPlaybackTouch >= PLAYBACK_IDLE_MS) {
				stopPlayback();
			}
		}, PLAYBACK_IDLE_MS);
	};

	let assetHandle: AssetHandle<VideoAsset> | null = null;
	let unsubscribeTimelineOffset: (() => void) | null = null;
	let unsubscribeElements: (() => void) | null = null;
	let unsubscribeTime: (() => void) | null = null;
	let activeDedicatedSink = false;
	let dedicatedVideoSink: CanvasSink | null = null;
	let lastSinkSwitchFrame: number | null = null;

	const getTimelineFps = () => {
		const fps = useTimelineStore.getState().fps;
		if (!Number.isFinite(fps) || fps <= 0) return DEFAULT_FPS;
		return Math.round(fps);
	};

	const getTimelineOffsetFrames = (): number => {
		const timelineOffset = useTimelineStore
			.getState()
			.elements.find((el) => el.id === id)?.timeline?.offset;
		return normalizeOffsetFrames(timelineOffset);
	};

	const getTimelineClipDurationSeconds = (): number | undefined => {
		const timeline = useTimelineStore
			.getState()
			.elements.find((el) => el.id === id)?.timeline;
		if (!timeline) return undefined;
		const durationFrames = timeline.end - timeline.start;
		if (!Number.isFinite(durationFrames)) return undefined;
		return framesToSeconds(durationFrames, getTimelineFps());
	};

	// 将时间戳对齐到帧间隔（以时间线 FPS 为准）
	const alignTime = (time: number): number => {
		const frameInterval = 1 / getTimelineFps();
		return Math.round(time / frameInterval) * frameInterval;
	};

	const fallbackFrameCache = new Map<number, SkImage>();

	// 将 canvas 转换为 SkImage
	const canvasToSkImage = async (
		canvas: HTMLCanvasElement | OffscreenCanvas,
	): Promise<SkImage | null> => {
		try {
			const imageBitmap = await createImageBitmap(canvas);
			return Skia.Image.MakeImageFromNativeBuffer(imageBitmap);
		} catch (err) {
			console.warn("Canvas to SkImage failed:", err);
			return null;
		}
	};

	// 更新当前帧
	const updateCurrentFrame = (skiaImage: SkImage, timestamp?: number) => {
		// 存入缓存
		if (timestamp !== undefined) {
			const alignedTime = alignTime(timestamp);
			assetHandle?.asset.storeFrame(alignedTime, skiaImage);
		}

		store.setState((state) => ({
			...state,
			internal: {
				...state.internal,
				currentFrame: skiaImage,
				isReady: true,
			},
		}));
	};

	const updateMaxDurationByOffset = () => {
		const { internal, constraints } = store.getState();
		if (
			!Number.isFinite(internal.videoDuration) ||
			internal.videoDuration <= 0
		) {
			return;
		}
		const fps = getTimelineFps();
		const totalFrames = secondsToFrames(internal.videoDuration, fps);
		const offsetFrames = getTimelineOffsetFrames();
		const availableDuration = computeAvailableDurationFrames(
			totalFrames,
			offsetFrames,
		);
		if (
			availableDuration !== undefined &&
			availableDuration !== constraints.maxDuration
		) {
			store.setState((state) => ({
				constraints: {
					...state.constraints,
					maxDuration: availableDuration,
				},
			}));
		}
	};

	const shouldUseDedicatedSink = (
		elements: TimelineElement[],
		clipId: string,
		uri?: string,
		currentTime?: number,
	): boolean => {
		if (!uri) return false;
		const current = elements.find((el) => el.id === clipId);
		if (!current) return false;
		const isCoveredAtTime = (clip: TimelineElement, time?: number): boolean => {
			if (time === undefined) return true;
			const start = clip.timeline?.start ?? 0;
			const end = clip.timeline?.end ?? 0;
			if (time >= start && time < end) return true;

			for (const element of elements) {
				if (element.type !== "Transition") continue;
				const { fromId, toId } = element.transition ?? {};
				if (!fromId || !toId) continue;
				if (fromId !== clip.id && toId !== clip.id) continue;
				const transitionStart = element.timeline.start;
				const transitionEnd = element.timeline.end;
				if (time >= transitionStart && time < transitionEnd) {
					return true;
				}
			}

			return false;
		};

		if (!isCoveredAtTime(current, currentTime)) return false;

		const candidates = elements.filter((element) => {
			if (element.type !== "VideoClip") return false;
			const otherUri = (element.props as { uri?: string } | undefined)?.uri;
			if (!otherUri || otherUri !== uri) return false;
			return isCoveredAtTime(element, currentTime);
		});

		if (candidates.length <= 1) return false;

		const owner = candidates.reduce((prev, next) => {
			if (prev.timeline.start !== next.timeline.start) {
				return prev.timeline.start < next.timeline.start ? prev : next;
			}
			return prev.id.localeCompare(next.id) <= 0 ? prev : next;
		});

		return owner.id !== clipId;
	};

	const resolveVideoSink = (asset: VideoAsset, shouldDedicated: boolean) => {
		if (!shouldDedicated) return asset.videoSink;
		if (!dedicatedVideoSink) {
			try {
				dedicatedVideoSink = asset.createVideoSink();
			} catch (err) {
				// 创建独立 sink 失败时回退到共享 sink
				console.warn("Create video sink failed:", err);
				return asset.videoSink;
			}
		}
		return dedicatedVideoSink;
	};

	const updateVideoSink = () => {
		const handle = assetHandle;
		if (!handle) return;
		const timelineState = useTimelineStore.getState();
		const { props } = store.getState();
		const elements = timelineState.elements;
		const currentTime = timelineState.getDisplayTime();
		const fps = getTimelineFps();
		const minSwitchIntervalFrames = Math.max(2, Math.round(fps / 10));
		if (
			lastSinkSwitchFrame !== null &&
			Math.abs(currentTime - lastSinkSwitchFrame) < minSwitchIntervalFrames
		) {
			return;
		}
		const shouldDedicated = shouldUseDedicatedSink(
			elements,
			id,
			props.uri,
			currentTime,
		);
		if (!shouldDedicated && activeDedicatedSink && currentTime !== undefined) {
			const current = elements.find((el) => el.id === id);
			if (current) {
				const start = current.timeline?.start ?? 0;
				const end = current.timeline?.end ?? 0;
				if (currentTime >= start && currentTime < end) {
					return;
				}
			}
		}
		if (shouldDedicated === activeDedicatedSink) return;
		activeDedicatedSink = shouldDedicated;
		lastSinkSwitchFrame = currentTime;

		const nextSink = resolveVideoSink(handle.asset, shouldDedicated);
		stopPlayback();
		store.setState((state) => ({
			...state,
			internal: {
				...state.internal,
				videoSink: nextSink,
				playbackEpoch: (state.internal.playbackEpoch ?? 0) + 1,
			},
		}));
		if (!shouldDedicated) {
			// 释放独立 sink 引用，减少长期占用
			dedicatedVideoSink = null;
		}
	};

	// 开始流式播放
	const startPlayback = async (startTime: number): Promise<void> => {
		const { internal } = store.getState();
		const { videoSink } = internal;

		if (!videoSink || isPlaybackActive) return;
		touchPlayback();

		// 停止之前的迭代器
		await videoFrameIterator?.return?.();

		isPlaybackActive = true;
		asyncId++;
		const currentAsyncId = asyncId;

		try {
			// 创建新的迭代器
			const iterator = videoSink.canvases(startTime);
			if (!iterator || typeof iterator.next !== "function") {
				isPlaybackActive = false;
				console.warn("Start playback failed: invalid iterator");
				return;
			}
			videoFrameIterator = iterator;

			// 获取第一帧
			const firstFrameResult = await iterator.next();
			if (currentAsyncId !== asyncId) return;

			const firstFrame = firstFrameResult.value ?? null;
			if (firstFrame) {
				const canvas = firstFrame.canvas;
				if (
					canvas instanceof HTMLCanvasElement ||
					canvas instanceof OffscreenCanvas
				) {
					const skiaImage = await canvasToSkImage(canvas);
					if (skiaImage && currentAsyncId === asyncId) {
						updateCurrentFrame(skiaImage, firstFrame.timestamp);
					}
				}
			}

			if (currentAsyncId !== asyncId || !isPlaybackActive) return;
			// 预读下一帧
			const secondFrameResult = await iterator.next();
			if (currentAsyncId !== asyncId) return;
			nextFrame = secondFrameResult.value ?? null;
		} catch (err) {
			console.warn("Start playback failed:", err);
			isPlaybackActive = false;
		}
	};

	// 获取下一帧（流式播放时调用）
	const getNextFrame = async (targetTime: number): Promise<void> => {
		if (!isPlaybackActive || !videoFrameIterator) return;
		if (isSteppingPlayback) return;
		isSteppingPlayback = true;
		touchPlayback();

		const currentAsyncId = asyncId;

		try {
			// 跳过时间戳小于目标时间的帧
			let frameToShow: WrappedCanvas | null = null;

			while (nextFrame && nextFrame.timestamp <= targetTime) {
				frameToShow = nextFrame;

				// 获取下一帧
				const result = await videoFrameIterator.next();
				if (currentAsyncId !== asyncId) return;

				nextFrame = result.value ?? null;
				if (!nextFrame) break; // 迭代器结束
			}

			// 显示找到的帧
			if (frameToShow) {
				const canvas = frameToShow.canvas;
				if (
					canvas instanceof HTMLCanvasElement ||
					canvas instanceof OffscreenCanvas
				) {
					const skiaImage = await canvasToSkImage(canvas);
					if (skiaImage && currentAsyncId === asyncId) {
						updateCurrentFrame(skiaImage, frameToShow.timestamp);
					}
				}
			}
		} catch (err) {
			console.warn("Get next frame failed:", err);
		} finally {
			isSteppingPlayback = false;
		}
	};

	// 停止流式播放
	const stopPlayback = () => {
		asyncId++; // 取消可能在途的播放解码
		isPlaybackActive = false;
		isSteppingPlayback = false;
		nextFrame = null;
		lastPlaybackTargetTime = null;
		if (playbackIdleTimer) {
			clearTimeout(playbackIdleTimer);
			playbackIdleTimer = null;
		}
		videoFrameIterator?.return?.();
		videoFrameIterator = null;
	};

	// 统一的播放步进方法，避免频繁挂载导致状态丢失
	const stepPlayback = async (targetTime: number): Promise<void> => {
		if (!Number.isFinite(targetTime)) return;
		if (!isPlaybackActive) {
			await startPlayback(targetTime);
			lastPlaybackTargetTime = targetTime;
			return;
		}
		if (
			lastPlaybackTargetTime !== null &&
			targetTime <
				lastPlaybackTargetTime - PLAYBACK_BACK_JUMP_FRAMES / getTimelineFps()
		) {
			stopPlayback();
			await startPlayback(targetTime);
			lastPlaybackTargetTime = targetTime;
			return;
		}
		await getNextFrame(targetTime);
		lastPlaybackTargetTime = targetTime;
	};

	// Seek 到指定时间的方法（用于拖动/跳转）
	const seekToTime = async (seconds: number): Promise<void> => {
		const { internal } = store.getState();
		const { videoSink } = internal;

		if (!videoSink) return;

		// 如果正在流式播放，先停止
		if (isPlaybackActive) {
			stopPlayback();
		}

		// 防止并发 seek
		const alignedTime = alignTime(seconds);
		if (isSeekingFlag) {
			pendingSeekTime = alignedTime;
			return;
		}
		if (lastSeekTime === alignedTime) return;

		// 检查缓存
		const cachedFrame = assetHandle?.asset.getCachedFrame(alignedTime);
		if (cachedFrame) {
			store.setState((state) => ({
				...state,
				internal: {
					...state.internal,
					currentFrame: cachedFrame,
					isReady: true,
				},
			}));
			lastSeekTime = alignedTime;
			return;
		}

		isSeekingFlag = true;
		asyncId++;
		const currentAsyncId = asyncId;

		let iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
		try {
			// 创建临时迭代器获取帧
			iterator = videoSink.canvases(alignedTime);
			const firstFrame = (await iterator.next()).value ?? null;

			if (currentAsyncId !== asyncId) return;

			if (firstFrame) {
				const canvas = firstFrame.canvas;
				if (
					canvas instanceof HTMLCanvasElement ||
					canvas instanceof OffscreenCanvas
				) {
					const skiaImage = await canvasToSkImage(canvas);
					if (skiaImage && currentAsyncId === asyncId) {
						updateCurrentFrame(skiaImage, alignedTime);
						lastSeekTime = alignedTime;
					}
				}
			}
			if (firstFrame && SEEK_PREFETCH_FRAMES > 0) {
				// 预取少量连续帧，减少拖动预览时的离散命中
				for (let i = 0; i < SEEK_PREFETCH_FRAMES; i += 1) {
					const result = await iterator.next();
					if (currentAsyncId !== asyncId) return;
					const nextFrame = result.value ?? null;
					if (!nextFrame) break;
					const canvas = nextFrame.canvas;
					if (
						canvas instanceof HTMLCanvasElement ||
						canvas instanceof OffscreenCanvas
					) {
						const skiaImage = await canvasToSkImage(canvas);
						if (skiaImage && currentAsyncId === asyncId) {
							const alignedTime = alignTime(nextFrame.timestamp);
							assetHandle?.asset.storeFrame(alignedTime, skiaImage);
						}
					}
				}
			}
		} catch (err) {
			console.warn("Seek failed:", err);
		} finally {
			await iterator?.return?.();
			isSeekingFlag = false;
			if (pendingSeekTime !== null && pendingSeekTime !== lastSeekTime) {
				const nextTime = pendingSeekTime;
				pendingSeekTime = null;
				await seekToTime(nextTime);
			} else {
				pendingSeekTime = null;
			}
		}
	};

	const prepareFrame = async (context: PrepareFrameContext): Promise<void> => {
		const { element, displayTime, fps } = context;
		if (context.phase === "afterRender") return;
		const { internal, constraints, props } = store.getState();
		if (constraints.isLoading || constraints.hasError) return;
		if (!props.uri || internal.videoDuration <= 0) return;

		const startSeconds = framesToSeconds(element.timeline.start ?? 0, fps);
		const currentSeconds = framesToSeconds(displayTime, fps);
		const clipDurationSeconds = framesToSeconds(
			element.timeline.end - element.timeline.start,
			fps,
		);
		const offsetSeconds = framesToSeconds(element.timeline.offset ?? 0, fps);

		const videoTime = calculateVideoTime({
			start: startSeconds,
			timelineTime: currentSeconds,
			videoDuration: internal.videoDuration,
			reversed: props.reversed,
			offset: offsetSeconds,
			clipDuration: clipDurationSeconds,
		});

		const targetFrameIndex = secondsToFrames(videoTime, fps);
		const durationFrames = secondsToFrames(internal.videoDuration, fps);
		const alignedFrameIndex = Math.min(
			Math.max(0, targetFrameIndex),
			durationFrames,
		);
		const alignedVideoTime = framesToSeconds(alignedFrameIndex, fps);
		// 导出时按帧顺序流式解码，只有回退或首次才重建迭代器
		if (
			props.reversed ||
			lastPreparedFrameIndex === null ||
			alignedFrameIndex < lastPreparedFrameIndex
		) {
			await startPlayback(alignedVideoTime);
			lastPreparedFrameIndex = alignedFrameIndex;
		} else {
			if (!isPlaybackActive) {
				await startPlayback(framesToSeconds(lastPreparedFrameIndex, fps));
			}
			if (alignedFrameIndex > lastPreparedFrameIndex) {
				await getNextFrame(alignedVideoTime);
				lastPreparedFrameIndex = alignedFrameIndex;
			}
		}
	};

	const store = createStore<
		ComponentModel<VideoClipProps, VideoClipInternal>
	>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: "VideoClip",
			props: initialProps,
			constraints: {
				isLoading: true,
				canTrimStart: true,
				canTrimEnd: true,
			},
			internal: {
				videoSink: null,
				input: null,
				currentFrame: null,
				videoDuration: 0,
				isReady: false,
				playbackEpoch: 0,
				thumbnailCanvas: null,
				frameCache: fallbackFrameCache,
				seekToTime,
				startPlayback,
				getNextFrame,
				stepPlayback,
				stopPlayback,
			} satisfies VideoClipInternal,

			setProps: (partial) => {
				const result = get().validate(partial);
				const nextPatch = result.corrected ?? (result.valid ? partial : null);
				if (nextPatch) {
					set((state) => {
						const nextProps = { ...state.props, ...nextPatch };
						const offsetFrames = getTimelineOffsetFrames();
						const fps = getTimelineFps();
						const totalFrames =
							Number.isFinite(state.internal.videoDuration) &&
							state.internal.videoDuration > 0
								? secondsToFrames(state.internal.videoDuration, fps)
								: null;
						const availableDuration = computeAvailableDurationFrames(
							totalFrames,
							offsetFrames,
						);
						const nextConstraints =
							availableDuration === undefined ||
							availableDuration === state.constraints.maxDuration
								? state.constraints
								: { ...state.constraints, maxDuration: availableDuration };
						return {
							props: nextProps,
							constraints: nextConstraints,
						};
					});
				}
				return result;
			},

			setConstraints: (partial) => {
				set((state) => ({
					constraints: { ...state.constraints, ...partial },
				}));
			},

			setInternal: (partial) => {
				set((state) => ({
					internal: { ...state.internal, ...partial },
				}));
			},

			validate: (newProps) => {
				const { constraints, props } = get();
				const errors: string[] = [];
				let corrected: Record<string, unknown> | undefined;

				const start = newProps.start ?? props.start;
				const end = newProps.end ?? props.end;

				// 验证 start < end
				if (start >= end) {
					errors.push("Start must be less than end");
				}

				// 验证时长不超过视频原始时长
				if (constraints.maxDuration !== undefined) {
					const duration = end - start;

					if (duration > constraints.maxDuration) {
						const fps = getTimelineFps();
						const maxDurationLabel = framesToTimecode(
							constraints.maxDuration,
							fps,
						);
						errors.push(`Duration cannot exceed ${maxDurationLabel}`);
						// 提供修正值
						corrected = {
							...newProps,
							end: start + constraints.maxDuration,
						};
					}
				}

				return {
					valid: errors.length === 0,
					errors,
					corrected,
				};
			},

			init: async () => {
				const { props } = get();
				const { uri } = props;

				if (!uri) {
					set((state) => ({
						constraints: {
							...state.constraints,
							isLoading: false,
							hasError: true,
							errorMessage: "No URI provided",
						},
					}));
					return;
				}

				initEpoch += 1;
				const currentInitEpoch = initEpoch;
				asyncId++;
				let localHandle: AssetHandle<VideoAsset> | null = null;

				try {
					localHandle = await acquireVideoAsset(uri);

					// 检查是否被取消
					if (currentInitEpoch !== initEpoch) {
						localHandle.release();
						return;
					}

					assetHandle?.release();
					assetHandle = localHandle;

					const { asset } = localHandle;
					const elements = useTimelineStore.getState().elements;
					const currentTime = useTimelineStore.getState().getDisplayTime();
					const fps = getTimelineFps();
					const durationFrames = secondsToFrames(asset.duration, fps);
					const offsetFrames = getTimelineOffsetFrames();
					const availableDuration = computeAvailableDurationFrames(
						durationFrames,
						offsetFrames,
					);
					const shouldDedicated = shouldUseDedicatedSink(
						elements,
						id,
						uri,
						currentTime,
					);
					activeDedicatedSink = shouldDedicated;
					const clipSink = resolveVideoSink(asset, shouldDedicated);

					// 更新状态
					set((state) => ({
						constraints: {
							...state.constraints,
							isLoading: false,
							maxDuration: availableDuration ?? durationFrames,
						},
						internal: {
							...state.internal,
							videoSink: clipSink,
							input: asset.input,
							videoDuration: asset.duration,
							frameCache: asset.frameCache,
						},
					}));

					// 初始化完成后，seek 到初始位置
					const { reversed } = get().props;
					const offsetSeconds = framesToSeconds(getTimelineOffsetFrames(), fps);
					const clipDurationSeconds = getTimelineClipDurationSeconds();
					const videoTime = calculateVideoTime({
						start: 0,
						timelineTime: 0,
						offset: offsetSeconds,
						clipDuration: clipDurationSeconds,
						videoDuration: asset.duration,
						reversed,
					});

					await seekToTime(videoTime);

					if (currentInitEpoch !== initEpoch) return;

					if (!unsubscribeTimelineOffset) {
						unsubscribeTimelineOffset = useTimelineStore.subscribe(
							(state) => state.getElementById(id)?.timeline?.offset ?? 0,
							() => {
								updateMaxDurationByOffset();
							},
						);
					}

					if (!unsubscribeElements) {
						unsubscribeElements = useTimelineStore.subscribe(
							(state) => state.elements,
							() => {
								updateVideoSink();
							},
						);
					}
					if (!unsubscribeTime) {
						const onTimeChange = () => {
							updateVideoSink();
						};
						const unsub1 = useTimelineStore.subscribe(
							(state) => state.currentTime,
							onTimeChange,
						);
						const unsub2 = useTimelineStore.subscribe(
							(state) => state.previewTime,
							onTimeChange,
						);
						unsubscribeTime = () => {
							unsub1();
							unsub2();
						};
					}
				} catch (error) {
					localHandle?.release();
					if (assetHandle === localHandle) {
						assetHandle = null;
					}

					if (currentInitEpoch !== initEpoch) return;

					set((state) => ({
						constraints: {
							...state.constraints,
							isLoading: false,
							hasError: true,
							errorMessage:
								error instanceof Error ? error.message : "Unknown error",
						},
					}));
				}
			},

			dispose: () => {
				initEpoch += 1; // 终止进行中的 init，避免继续写入
				asyncId++; // 取消所有进行中的异步操作
				const internal = get().internal as VideoClipInternal;

				stopPlayback();

				// 清理迭代器
				videoFrameIterator?.return?.();
				videoFrameIterator = null;
				unsubscribeTimelineOffset?.();
				unsubscribeTimelineOffset = null;
				unsubscribeElements?.();
				unsubscribeElements = null;
				unsubscribeTime?.();
				unsubscribeTime = null;

				assetHandle?.release();
				assetHandle = null;

				// 清理资源
				internal.videoSink = null;
				internal.input = null;
			},

			waitForReady: () => {
				return new Promise<void>((resolve) => {
					const { internal } = get();
					if (internal.isReady) {
						resolve();
						return;
					}
					// 订阅状态变化
					const unsubscribe = store.subscribe(
						(state) => state.internal.isReady,
						(isReady) => {
							if (isReady) {
								unsubscribe();
								resolve();
							}
						},
					);
				});
			},
			prepareFrame,
		})),
	);

	return store;
}
