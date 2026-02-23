import type { PrepareFrameContext } from "core/dsl/model/types";
import type { TimelineElement } from "core/dsl/types";
import type {
	AudioBufferSink,
	CanvasSink,
	Input,
	WrappedCanvas,
} from "mediabunny";
import { type SkImage, Skia } from "react-skia-lite";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { AssetHandle } from "@/assets/AssetStore";
import { type AudioAsset, acquireAudioAsset } from "@/assets/audioAsset";
import { acquireVideoAsset, type VideoAsset } from "@/assets/videoAsset";
import {
	type AudioPlaybackController,
	type AudioPlaybackMixInstruction,
	type AudioPlaybackStepInput,
	createAudioPlaybackController,
} from "@/editor/audio/audioPlayback";
import type { EditorRuntime } from "@/editor/runtime/types";
import {
	getAudioPlaybackSessionKey,
	getVideoPlaybackSessionKey,
} from "@/editor/playback/clipContinuityIndex";
import { isTimelineTrackAudible } from "@/editor/utils/trackAudibility";
import {
	framesToSeconds,
	framesToTimecode,
	secondsToFrames,
} from "@/utils/timecode";
import type { ComponentModel, ComponentModelStore } from "../model/types";
import { resolveVideoKeyframeTime } from "./keyframeTimeCache";
import { warmFramesFromKeyframeToTarget } from "./reverseSeekWarmup";
import {
	releaseVideoPlaybackSession,
	retainVideoPlaybackSession,
	stepVideoPlaybackSession,
	stopVideoPlaybackSession,
} from "./videoPlaybackSessionPool";

// VideoClip Props 类型
export interface VideoClipProps {
	uri?: string;
	reversed?: boolean;
	start: number; // 帧
	end: number; // 帧
}

export type VideoSeekReason = "default" | "reverse-playback";

export interface VideoSeekOptions {
	reason?: VideoSeekReason;
}

const resolveSeekReason = (
	reason: VideoSeekReason | undefined,
	reversed: boolean,
): VideoSeekReason => {
	if (reason) return reason;
	return reversed ? "reverse-playback" : "default";
};

// VideoClip 内部状态
export interface VideoClipInternal {
	videoSink: CanvasSink | null;
	input: Input | null;
	currentFrame: SkImage | null;
	videoDuration: number; // 秒
	isReady: boolean;
	playbackEpoch: number;
	audioSink: AudioBufferSink | null;
	audioDuration: number;
	hasSourceAudioTrack: boolean | null;
	// 缩略图（用于时间线预览）
	thumbnailCanvas: HTMLCanvasElement | null;
	// 帧缓存
	frameCache: Map<number, SkImage>;
	// seek 方法（用于拖动/跳转）
	seekToTime: (seconds: number, options?: VideoSeekOptions) => Promise<void>;
	// 开始流式播放
	startPlayback: (startTime: number) => Promise<void>;
	// 获取下一帧（流式播放时调用）
	getNextFrame: (targetTime: number) => Promise<void>;
	// 播放步进（自动处理启动/回退）
	stepPlayback: (targetTime: number) => Promise<void>;
	// 停止流式播放
	stopPlayback: () => void;
	// 释放播放会话（组件卸载时调用）
	releasePlaybackSession: () => void;
	// 音频播放步进
	stepAudioPlayback: (input: AudioPlaybackStepInput) => Promise<void>;
	// 音频播放增益
	setAudioPlaybackGain: (gain: number) => void;
	// 音频混音桥接
	applyAudioMix: (
		instruction: AudioPlaybackMixInstruction | null,
	) => Promise<void>;
	// 停止音频播放
	stopAudioPlayback: () => void;
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
	runtime: EditorRuntime,
): ComponentModelStore<VideoClipProps, VideoClipInternal> {
	const timelineStore = runtime.timelineStore;
	const SEEK_PREFETCH_FRAMES = 24;
	const REVERSE_PREWARM_LOOKAHEAD_KEYFRAMES = 2;
	const REVERSE_PREWARM_COMPLETED_LIMIT = 512;
	// 用于取消异步操作
	let asyncId = 0;
	// init 的取消标记，避免被播放/seek 的 asyncId 误伤
	let initEpoch = 0;
	let isSeekingFlag = false;
	let lastSeekTime: number | null = null;
	let pendingSeekRequest: { time: number; options: VideoSeekOptions } | null =
		null;
	let lastPreparedFrameIndex: number | null = null;
	let audioInitEpoch = 0;
	let audioPlayback: AudioPlaybackController | null = null;
	let retainedPlaybackSessionKey: string | null = null;

	let assetHandle: AssetHandle<VideoAsset> | null = null;
	let audioAssetHandle: AssetHandle<AudioAsset> | null = null;
	let unsubscribeTimelineOffset: (() => void) | null = null;
	let unsubscribeElements: (() => void) | null = null;
	let unsubscribeTime: (() => void) | null = null;
	let activeDedicatedSink = false;
	let dedicatedVideoSink: CanvasSink | null = null;
	let lastSinkSwitchFrame: number | null = null;
	const reversePrewarmInflight = new Set<string>();
	const reversePrewarmCompleted = new Set<string>();
	const reversePrewarmCompletedOrder: string[] = [];

	const getTimelineFps = () => {
		const fps = timelineStore.getState().fps;
		if (!Number.isFinite(fps) || fps <= 0) return DEFAULT_FPS;
		return Math.round(fps);
	};

	const getTimeline = () => {
		return timelineStore.getState().getElementById(id)?.timeline;
	};

	const getTimelineOffsetFrames = (): number => {
		const timelineOffset = getTimeline()?.offset;
		return normalizeOffsetFrames(timelineOffset);
	};

	const getTimelineClipDurationSeconds = (): number | undefined => {
		const timeline = getTimeline();
		if (!timeline) return undefined;
		const durationFrames = timeline.end - timeline.start;
		if (!Number.isFinite(durationFrames)) return undefined;
		return framesToSeconds(durationFrames, getTimelineFps());
	};

	const resolveVideoPlaybackSessionKey = (): string => {
		const timelineState = timelineStore.getState();
		return `${runtime.id}:${getVideoPlaybackSessionKey(timelineState.elements, id)}`;
	};

	const retainPlaybackSession = (): string => {
		const nextKey = resolveVideoPlaybackSessionKey();
		if (retainedPlaybackSessionKey === nextKey) return nextKey;
		retainVideoPlaybackSession(nextKey);
		if (retainedPlaybackSessionKey) {
			releaseVideoPlaybackSession(retainedPlaybackSessionKey);
		}
		retainedPlaybackSessionKey = nextKey;
		return nextKey;
	};

	const releasePlaybackSession = () => {
		if (!retainedPlaybackSessionKey) return;
		releaseVideoPlaybackSession(retainedPlaybackSessionKey);
		retainedPlaybackSessionKey = null;
	};

	// 将时间戳对齐到帧间隔（以时间线 FPS 为准）
	const alignTime = (time: number): number => {
		const frameInterval = 1 / getTimelineFps();
		return Math.round(time / frameInterval) * frameInterval;
	};

	const resetReversePrewarmState = () => {
		reversePrewarmInflight.clear();
		reversePrewarmCompleted.clear();
		reversePrewarmCompletedOrder.length = 0;
	};

	const markReversePrewarmCompleted = (key: string) => {
		if (reversePrewarmCompleted.has(key)) return;
		reversePrewarmCompleted.add(key);
		reversePrewarmCompletedOrder.push(key);
		while (
			reversePrewarmCompletedOrder.length > REVERSE_PREWARM_COMPLETED_LIMIT
		) {
			const oldest = reversePrewarmCompletedOrder.shift();
			if (!oldest) break;
			reversePrewarmCompleted.delete(oldest);
		}
	};

	const buildReversePrewarmRangeKey = (
		uri: string,
		startTime: number,
		endExclusive: number,
	): string => {
		const startKey = Math.max(0, Math.round(startTime * 1000));
		const endKey = Math.max(0, Math.round(endExclusive * 1000));
		return `${uri}|${startKey}-${endKey}`;
	};

	const fallbackFrameCache = new Map<number, SkImage>();
	// 当前显示帧，避免缓存回收时误释放
	let pinnedFrame: SkImage | null = null;
	let pinnedFrameAsset: VideoAsset | null = null;

	const updatePinnedFrame = (
		nextFrame: SkImage | null,
		asset: VideoAsset | null,
	) => {
		if (pinnedFrame === nextFrame && pinnedFrameAsset === asset) return;
		if (pinnedFrame && pinnedFrameAsset) {
			pinnedFrameAsset.unpinFrame(pinnedFrame);
		}
		if (nextFrame && asset) {
			asset.pinFrame(nextFrame);
		}
		pinnedFrame = nextFrame;
		pinnedFrameAsset = nextFrame && asset ? asset : null;
	};

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

	const prewarmReverseRange = async (options: {
		uri: string;
		asset: VideoAsset;
		videoSink: CanvasSink;
		startTime: number;
		endExclusive: number;
	}): Promise<void> => {
		const { uri, asset, videoSink, startTime, endExclusive } = options;
		const rangeKey = buildReversePrewarmRangeKey(uri, startTime, endExclusive);
		if (
			reversePrewarmInflight.has(rangeKey) ||
			reversePrewarmCompleted.has(rangeKey)
		) {
			return;
		}
		reversePrewarmInflight.add(rangeKey);

		let iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
		let hasError = false;
		try {
			iterator = videoSink.canvases(startTime, endExclusive);
			while (true) {
				const result = await iterator.next();
				if (result.done) break;
				// 资源已切换时停止旧任务，避免把旧素材帧写进新状态。
				if (assetHandle?.asset !== asset) return;
				const canvas = result.value.canvas;
				if (
					!(
						canvas instanceof HTMLCanvasElement ||
						canvas instanceof OffscreenCanvas
					)
				) {
					continue;
				}
				const skiaImage = await canvasToSkImage(canvas);
				if (!skiaImage) continue;
				asset.storeFrame(alignTime(result.value.timestamp), skiaImage);
			}
		} catch (err) {
			hasError = true;
			console.warn("Reverse prewarm failed:", err);
		} finally {
			await iterator?.return?.();
			reversePrewarmInflight.delete(rangeKey);
			if (!hasError) {
				markReversePrewarmCompleted(rangeKey);
			}
		}
	};

	const scheduleReverseLookaheadPrewarm = (options: {
		uri: string;
		input: Input;
		videoSink: CanvasSink;
		asset: VideoAsset;
		targetTime: number;
	}) => {
		const { uri, input, videoSink, asset, targetTime } = options;
		void (async () => {
			const frameInterval = 1 / getTimelineFps();
			const currentTimeKey = Math.max(0, Math.round(targetTime * 1000));
			const currentKeyTime = await resolveVideoKeyframeTime({
				uri,
				input,
				time: targetTime,
				timeKey: currentTimeKey,
			});
			if (currentKeyTime === null) return;

			let upperBoundary = Math.max(0, currentKeyTime);
			for (let i = 0; i < REVERSE_PREWARM_LOOKAHEAD_KEYFRAMES; i += 1) {
				const previousQueryTime = Math.max(0, upperBoundary - frameInterval);
				const previousQueryKey = Math.max(
					0,
					Math.round(previousQueryTime * 1000),
				);
				const previousKeyTime = await resolveVideoKeyframeTime({
					uri,
					input,
					time: previousQueryTime,
					timeKey: previousQueryKey,
				});
				if (previousKeyTime === null) break;
				const startTime = Math.max(0, previousKeyTime);
				if (startTime >= upperBoundary) break;
				// 预热到当前关键帧右侧半帧，保证边界处也可直接命中缓存。
				const endExclusive = upperBoundary + frameInterval * 0.5;
				await prewarmReverseRange({
					uri,
					asset,
					videoSink,
					startTime,
					endExclusive,
				});
				upperBoundary = startTime;
			}
		})();
	};

	// 更新当前帧
	const updateCurrentFrame = (skiaImage: SkImage, timestamp?: number) => {
		// 存入缓存
		if (timestamp !== undefined) {
			const alignedTime = alignTime(timestamp);
			assetHandle?.asset.storeFrame(alignedTime, skiaImage);
		}

		updatePinnedFrame(skiaImage, assetHandle?.asset ?? null);
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
		assetId?: string,
		currentTime?: number,
	): boolean => {
		if (!assetId) return false;
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
			if (element.assetId !== assetId) return false;
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
		const timelineState = timelineStore.getState();
		const elements = timelineState.elements;
		const currentTime = timelineState.getDisplayTime();
		const currentElement = elements.find((el) => el.id === id);
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
			currentElement?.assetId,
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
		await stepPlayback(startTime);
	};

	// 获取下一帧（流式播放时调用）
	const getNextFrame = async (targetTime: number): Promise<void> => {
		await stepPlayback(targetTime);
	};

	// 停止流式播放
	const stopPlayback = () => {
		const sessionKey =
			retainedPlaybackSessionKey ?? resolveVideoPlaybackSessionKey();
		stopVideoPlaybackSession(sessionKey);
	};

	// 统一的播放步进方法，避免频繁挂载导致状态丢失
	const stepPlayback = async (targetTime: number): Promise<void> => {
		if (!Number.isFinite(targetTime)) return;
		const { internal, props } = store.getState();
		const videoSink = internal.videoSink;
		if (!videoSink) return;
		// 倒放时 targetTime 会递减，阈值必须为 0 才能每次回退都重建迭代器并推进画面。
		const backJumpThresholdSeconds = props.reversed
			? 0
			: PLAYBACK_BACK_JUMP_FRAMES / getTimelineFps();
		const sessionKey = retainPlaybackSession();
		const frameToShow = await stepVideoPlaybackSession({
			key: sessionKey,
			sink: videoSink,
			targetTime,
			backJumpThresholdSeconds,
			isExporting: () => timelineStore.getState().isExporting,
		});
		if (!frameToShow) {
			return;
		}
		const canvas = frameToShow.canvas;
		if (
			!(
				canvas instanceof HTMLCanvasElement || canvas instanceof OffscreenCanvas
			)
		) {
			return;
		}
		const skiaImage = await canvasToSkImage(canvas);
		if (!skiaImage) return;
		updateCurrentFrame(skiaImage, frameToShow.timestamp);
	};

	const getAudioPlaybackState = () => {
		const { internal, constraints, props } = store.getState();
		return {
			isLoading: constraints.isLoading,
			hasError: constraints.hasError,
			uri: props.uri,
			audioSink: internal.audioSink,
			audioDuration: internal.audioDuration,
		};
	};

	const stepAudioPlayback = async (
		input: AudioPlaybackStepInput,
	): Promise<void> => {
		if (!audioPlayback) return;
		await audioPlayback.stepPlayback(input);
	};

	const setAudioPlaybackGain = (gain: number) => {
		audioPlayback?.setGain(gain);
	};

	const stopAudioPlayback = () => {
		audioPlayback?.stopPlayback();
	};

	const applyAudioMix = async (
		instruction: AudioPlaybackMixInstruction | null,
	): Promise<void> => {
		if (!instruction) {
			stopAudioPlayback();
			return;
		}
		await stepAudioPlayback(instruction);
	};

	// Seek 到指定时间的方法（用于拖动/跳转）
	const seekToTime = async (
		seconds: number,
		options: VideoSeekOptions = {},
	): Promise<void> => {
		const { internal, props } = store.getState();
		const { videoSink, input } = internal;

		if (!videoSink) return;

		// seek 前先停止流式播放，避免迭代器与临时 seek 竞争
		stopPlayback();

		const alignedTime = alignTime(seconds);
		const normalizedOptions: VideoSeekOptions = {
			reason: resolveSeekReason(options.reason, Boolean(props.reversed)),
		};
		const shouldReverseLookahead =
			normalizedOptions.reason === "reverse-playback" &&
			Boolean(props.reversed);
		const reverseLookaheadContext =
			shouldReverseLookahead &&
			typeof props.uri === "string" &&
			props.uri.length > 0 &&
			input &&
			assetHandle?.asset
				? {
						uri: props.uri,
						input,
						asset: assetHandle.asset,
					}
				: null;
		const triggerReverseLookaheadPrewarm = () => {
			if (!reverseLookaheadContext) return;
			scheduleReverseLookaheadPrewarm({
				uri: reverseLookaheadContext.uri,
				input: reverseLookaheadContext.input,
				videoSink,
				asset: reverseLookaheadContext.asset,
				targetTime: alignedTime,
			});
		};
		// 防止并发 seek
		if (isSeekingFlag) {
			pendingSeekRequest = { time: alignedTime, options: normalizedOptions };
			// seek 忙碌时也触发倒放预热，避免预编译阶段丢失 lookahead 机会。
			triggerReverseLookaheadPrewarm();
			return;
		}
		if (lastSeekTime === alignedTime) {
			// 命中同帧时仍允许倒放预热继续推进。
			triggerReverseLookaheadPrewarm();
			return;
		}

		// 检查缓存
		const cachedFrame = assetHandle?.asset.getCachedFrame(alignedTime);
		if (cachedFrame) {
			updatePinnedFrame(cachedFrame, assetHandle?.asset ?? null);
			store.setState((state) => ({
				...state,
				internal: {
					...state.internal,
					currentFrame: cachedFrame,
					isReady: true,
				},
			}));
			lastSeekTime = alignedTime;
			triggerReverseLookaheadPrewarm();
			return;
		}

		isSeekingFlag = true;
		asyncId++;
		const currentAsyncId = asyncId;

		const decodeWrappedFrame = async (
			frame: WrappedCanvas,
		): Promise<SkImage | null> => {
			const canvas = frame.canvas;
			if (
				!(
					canvas instanceof HTMLCanvasElement ||
					canvas instanceof OffscreenCanvas
				)
			) {
				return null;
			}
			return canvasToSkImage(canvas);
		};

		const fallbackSeekBySingleFrame = async (): Promise<void> => {
			const iterator = videoSink.canvases(alignedTime);
			try {
				const firstFrame = (await iterator.next()).value ?? null;
				if (currentAsyncId !== asyncId) return;
				if (!firstFrame) return;
				const firstImage = await decodeWrappedFrame(firstFrame);
				if (firstImage && currentAsyncId === asyncId) {
					updateCurrentFrame(firstImage, alignedTime);
					lastSeekTime = alignedTime;
				}
				if (SEEK_PREFETCH_FRAMES <= 0) return;
				// 预取少量连续帧，减少拖动预览时的离散命中
				for (let i = 0; i < SEEK_PREFETCH_FRAMES; i += 1) {
					const result = await iterator.next();
					if (currentAsyncId !== asyncId) return;
					const nextFrame = result.value ?? null;
					if (!nextFrame) break;
					const nextImage = await decodeWrappedFrame(nextFrame);
					if (nextImage && currentAsyncId === asyncId) {
						const nextAlignedTime = alignTime(nextFrame.timestamp);
						assetHandle?.asset.storeFrame(nextAlignedTime, nextImage);
					}
				}
			} finally {
				await iterator.return?.();
			}
		};

		try {
			let resolvedByWarmup = false;
			if (shouldReverseLookahead && props.uri && input && assetHandle?.asset) {
				const warmupResult = await warmFramesFromKeyframeToTarget<SkImage>({
					videoSink,
					targetTime: alignedTime,
					frameInterval: 1 / getTimelineFps(),
					alignTime,
					resolveKeyframeTime: ({ targetTime, timeKey }) =>
						resolveVideoKeyframeTime({
							uri: props.uri ?? "",
							input,
							time: targetTime,
							timeKey,
						}),
					getCachedFrame: (time) => assetHandle?.asset.getCachedFrame(time),
					decodeWrappedFrame: async (frame) => {
						const decoded = await decodeWrappedFrame(frame);
						if (!decoded || currentAsyncId !== asyncId) return null;
						return decoded;
					},
					storeFrame: (time, frame) => {
						assetHandle?.asset.storeFrame(time, frame);
					},
					shouldAbort: () => currentAsyncId !== asyncId,
				});
				if (currentAsyncId !== asyncId) return;
				if (warmupResult.frame) {
					updateCurrentFrame(warmupResult.frame, alignedTime);
					lastSeekTime = alignedTime;
					resolvedByWarmup = true;
				}
			}
			if (!resolvedByWarmup) {
				await fallbackSeekBySingleFrame();
			}
			triggerReverseLookaheadPrewarm();
		} catch (err) {
			console.warn("Seek failed:", err);
		} finally {
			isSeekingFlag = false;
			if (pendingSeekRequest && pendingSeekRequest.time !== lastSeekTime) {
				const nextRequest = pendingSeekRequest;
				pendingSeekRequest = null;
				await seekToTime(nextRequest.time, nextRequest.options);
			} else {
				pendingSeekRequest = null;
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
		// 倒放预编译必须走 seek 路径，才能正确处理 GOP 回退并稳定产出目标帧。
		if (props.reversed) {
			await seekToTime(alignedVideoTime);
			lastPreparedFrameIndex = alignedFrameIndex;
			return;
		}
		// 正放场景按帧顺序流式解码，只有回退或首次才重建迭代器。
		if (
			lastPreparedFrameIndex === null ||
			alignedFrameIndex < lastPreparedFrameIndex
		) {
			await stepPlayback(alignedVideoTime);
			lastPreparedFrameIndex = alignedFrameIndex;
		} else if (alignedFrameIndex > lastPreparedFrameIndex) {
			await stepPlayback(alignedVideoTime);
			lastPreparedFrameIndex = alignedFrameIndex;
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
				audioSink: null,
				audioDuration: 0,
				hasSourceAudioTrack: null,
				thumbnailCanvas: null,
				frameCache: fallbackFrameCache,
				seekToTime,
				startPlayback,
				getNextFrame,
				stepPlayback,
				stopPlayback,
				releasePlaybackSession,
				stepAudioPlayback,
				setAudioPlaybackGain,
				applyAudioMix,
				stopAudioPlayback,
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
				audioInitEpoch += 1;
				const currentInitEpoch = initEpoch;
				const currentAudioInitEpoch = audioInitEpoch;
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
					resetReversePrewarmState();

					const { asset } = localHandle;
					const elements = timelineStore.getState().elements;
					const currentTime = timelineStore.getState().getDisplayTime();
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
						unsubscribeTimelineOffset = timelineStore.subscribe(
							(state) => state.getElementById(id)?.timeline?.offset ?? 0,
							() => {
								updateMaxDurationByOffset();
							},
						);
					}

					if (!unsubscribeElements) {
						unsubscribeElements = timelineStore.subscribe(
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
						const unsub1 = timelineStore.subscribe(
							(state) => state.currentTime,
							onTimeChange,
						);
						const unsub2 = timelineStore.subscribe(
							(state) => state.previewTime,
							onTimeChange,
						);
						unsubscribeTime = () => {
							unsub1();
							unsub2();
						};
					}

					let localAudioHandle: AssetHandle<AudioAsset> | null = null;
					try {
						localAudioHandle = await acquireAudioAsset(uri);
						if (
							currentInitEpoch !== initEpoch ||
							currentAudioInitEpoch !== audioInitEpoch
						) {
							localAudioHandle.release();
							return;
						}

						audioAssetHandle?.release();
						audioAssetHandle = localAudioHandle;

						const audioSink = localAudioHandle.asset.createAudioSink();
						const audioDuration = localAudioHandle?.asset.duration ?? 0;
						set((state) => ({
							internal: {
								...state.internal,
								audioSink,
								audioDuration,
								hasSourceAudioTrack: audioDuration > 0,
							},
						}));
					} catch (_error) {
						localAudioHandle?.release();
						if (audioAssetHandle === localAudioHandle) {
							audioAssetHandle = null;
						}
						if (
							currentInitEpoch !== initEpoch ||
							currentAudioInitEpoch !== audioInitEpoch
						) {
							return;
						}
						set((state) => ({
							internal: {
								...state.internal,
								audioSink: null,
								audioDuration: 0,
								hasSourceAudioTrack: false,
							},
						}));
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
				audioInitEpoch += 1;
				asyncId++; // 取消所有进行中的异步操作
				const internal = get().internal as VideoClipInternal;

				updatePinnedFrame(null, null);
				stopPlayback();
				releasePlaybackSession();
				stopAudioPlayback();
				audioPlayback?.dispose();

				unsubscribeTimelineOffset?.();
				unsubscribeTimelineOffset = null;
				unsubscribeElements?.();
				unsubscribeElements = null;
				unsubscribeTime?.();
				unsubscribeTime = null;

				assetHandle?.release();
				assetHandle = null;
				audioAssetHandle?.release();
				audioAssetHandle = null;
				resetReversePrewarmState();

				// 清理资源
				internal.videoSink = null;
				internal.input = null;
				internal.audioSink = null;
				internal.audioDuration = 0;
				internal.hasSourceAudioTrack = null;
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

	audioPlayback = createAudioPlaybackController({
		getTimeline,
		getFps: getTimelineFps,
		getState: getAudioPlaybackState,
		getSeekEpoch: () => timelineStore.getState().seekEpoch,
		getRuntimeKey: () => {
			const timelineState = timelineStore.getState();
			return `${runtime.id}:${getAudioPlaybackSessionKey(timelineState.elements, id)}`;
		},
		isPlaybackEnabled: () => {
			const timelineState = timelineStore.getState();
			return isTimelineTrackAudible(
				timelineState.getElementById(id)?.timeline,
				timelineState.tracks,
				timelineState.audioTrackStates,
			);
		},
	});

	return store;
}
