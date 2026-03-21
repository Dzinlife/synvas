import type {
	PrepareFrameContext,
	RenderFrameChannel,
} from "core/element/model/types";
import type { TimelineElement } from "core/element/types";
import type {
	AudioBufferSink,
	Input,
	VideoSample,
	VideoSampleSink,
} from "mediabunny";
import { type SkImage } from "react-skia-lite";
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
} from "@/audio/playback";
import {
	closeVideoSample,
	videoSampleToSkImage,
} from "@/lib/videoFrameUtils";
import {
	getAudioPlaybackSessionKey,
	getVideoPlaybackSessionKey,
} from "@/scene-editor/playback/clipContinuityIndex";
import type { EditorRuntime } from "@/scene-editor/runtime/types";
import { isTimelineTrackAudible } from "@/scene-editor/utils/trackAudibility";
import {
	framesToSeconds,
	framesToTimecode,
	secondsToFrames,
} from "@/utils/timecode";
import type { ComponentModel, ComponentModelStore } from "../model/types";
import { resolveVideoKeyframeTime } from "./keyframeTimeCache";
import { shouldSeekAfterStepPlayback } from "./playbackDriftPolicy";
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
	frameChannel?: RenderFrameChannel;
}

interface PendingSeekRequest {
	time: number;
	options: VideoSeekOptions;
	wait: Promise<void>;
	resolve: () => void;
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
	videoSampleSink: VideoSampleSink | null;
	input: Input | null;
	currentFrame: SkImage | null;
	offscreenFrame: SkImage | null;
	videoDuration: number; // 秒
	videoRotation: 0 | 90 | 180 | 270;
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
	startPlayback: (
		startTime: number,
		frameChannel?: RenderFrameChannel,
	) => Promise<void>;
	// 获取下一帧（流式播放时调用）
	getNextFrame: (
		targetTime: number,
		frameChannel?: RenderFrameChannel,
	) => Promise<void>;
	// 播放步进（自动处理启动/回退）
	stepPlayback: (
		targetTime: number,
		frameChannel?: RenderFrameChannel,
	) => Promise<void>;
	// 停止流式播放
	stopPlayback: (frameChannel?: RenderFrameChannel) => void;
	// 释放播放会话（组件卸载时调用）
	releasePlaybackSession: (frameChannel?: RenderFrameChannel) => void;
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
const PLAYBACK_DRIFT_FLOOR_SECONDS = 1.0;
const PLAYBACK_DRIFT_ADAPTIVE_MULTIPLIER = 2;
const DEFAULT_FRAME_CHANNEL: RenderFrameChannel = "current";
const getNowMs = () =>
	typeof performance !== "undefined" ? performance.now() : Date.now();
const resolveFrameChannel = (
	value: RenderFrameChannel | undefined,
): RenderFrameChannel => {
	return value === "offscreen" ? "offscreen" : DEFAULT_FRAME_CHANNEL;
};
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
	const FRAME_CHANNELS: RenderFrameChannel[] = ["current", "offscreen"];
	// 用于取消异步操作
	let asyncId = 0;
	// init 的取消标记，避免被播放/seek 的 asyncId 误伤
	let initEpoch = 0;
	let isSeekingFlag = false;
	let activeSeekChannel: RenderFrameChannel | null = null;
	let activeSeekTime: number | null = null;
	let lastSeekTimeByChannel: Record<RenderFrameChannel, number | null> = {
		current: null,
		offscreen: null,
	};
	let pendingSeekRequestByChannel: Record<
		RenderFrameChannel,
		PendingSeekRequest | null
	> = {
		current: null,
		offscreen: null,
	};
	let lastPreparedFrameIndexByChannel: Record<
		RenderFrameChannel,
		number | null
	> = {
		current: null,
		offscreen: null,
	};
	let lastRenderedTimeByChannel: Record<RenderFrameChannel, number | null> = {
		current: null,
		offscreen: null,
	};
	let lastPlaybackProgressAtMsByChannel: Record<string, number | null> = {
		current: null,
		offscreen: null,
	};
	let observedPlaybackFrameIntervalByChannel: Record<string, number | null> = {
		current: null,
		offscreen: null,
	};
	let audioInitEpoch = 0;
	let audioPlayback: AudioPlaybackController | null = null;
	let retainedPlaybackSessionKeyByChannel: Record<
		RenderFrameChannel,
		string | null
	> = {
		current: null,
		offscreen: null,
	};

	let assetHandle: AssetHandle<VideoAsset> | null = null;
	let audioAssetHandle: AssetHandle<AudioAsset> | null = null;
	let unsubscribeTimelineOffset: (() => void) | null = null;
	let unsubscribeElements: (() => void) | null = null;
	let unsubscribeTime: (() => void) | null = null;
	let activeDedicatedSink = false;
	let dedicatedVideoSampleSink: VideoSampleSink | null = null;
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

	const resolveVideoPlaybackSessionKey = (
		frameChannel: RenderFrameChannel = DEFAULT_FRAME_CHANNEL,
	): string => {
		const timelineState = timelineStore.getState();
		const baseKey = `${runtime.id}:${getVideoPlaybackSessionKey(timelineState.elements, id)}`;
		return frameChannel === "offscreen" ? `${baseKey}:offscreen` : baseKey;
	};

	const retainPlaybackSession = (
		frameChannel: RenderFrameChannel = DEFAULT_FRAME_CHANNEL,
	): string => {
		const nextKey = resolveVideoPlaybackSessionKey(frameChannel);
		const retainedKey = retainedPlaybackSessionKeyByChannel[frameChannel];
		if (retainedKey === nextKey) return nextKey;
		retainVideoPlaybackSession(nextKey);
		if (retainedKey) {
			releaseVideoPlaybackSession(retainedKey);
		}
		retainedPlaybackSessionKeyByChannel[frameChannel] = nextKey;
		return nextKey;
	};

	const releasePlaybackSession = (
		frameChannel: RenderFrameChannel = DEFAULT_FRAME_CHANNEL,
	) => {
		const retainedKey = retainedPlaybackSessionKeyByChannel[frameChannel];
		if (!retainedKey) return;
		releaseVideoPlaybackSession(retainedKey);
		retainedPlaybackSessionKeyByChannel[frameChannel] = null;
	};

	const releaseAllPlaybackSessions = () => {
		for (const frameChannel of FRAME_CHANNELS) {
			releasePlaybackSession(frameChannel);
		}
	};

	// 将时间戳对齐到帧间隔（以时间线 FPS 为准）
	const alignTime = (time: number): number => {
		const frameInterval = 1 / getTimelineFps();
		return Math.round(time / frameInterval) * frameInterval;
	};

	const shouldPreemptActiveSeek = (
		frameChannel: RenderFrameChannel,
		targetTime: number,
	): boolean => {
		if (!isSeekingFlag || activeSeekChannel === null) return false;
		const hasDifferentTarget =
			activeSeekTime === null || Math.abs(activeSeekTime - targetTime) > 1e-9;
		// 主预览通道请求到来时，优先抢占离屏慢请求，避免 scrubbing 不跟手。
		if (frameChannel === "current" && activeSeekChannel !== "current") {
			return true;
		}
		// 同通道新目标到来时也抢占旧 seek，保证总是跟最新帧。
		return activeSeekChannel === frameChannel && hasDifferentTarget;
	};

	const resetReversePrewarmState = () => {
		reversePrewarmInflight.clear();
		reversePrewarmCompleted.clear();
		reversePrewarmCompletedOrder.length = 0;
	};

	const resetPlaybackDriftTrackingState = () => {
		lastPlaybackProgressAtMsByChannel = { current: null, offscreen: null };
		observedPlaybackFrameIntervalByChannel = {
			current: null,
			offscreen: null,
		};
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
	// 按渲染通道分别 pin，避免离屏帧覆盖主预览 pin 状态
	const pinnedFrameByChannel: Record<
		RenderFrameChannel,
		{ frame: SkImage | null; asset: VideoAsset | null }
	> = {
		current: { frame: null, asset: null },
		offscreen: { frame: null, asset: null },
	};

	const updatePinnedFrame = (
		frameChannel: RenderFrameChannel,
		nextFrame: SkImage | null,
		asset: VideoAsset | null,
	) => {
		const currentPinned = pinnedFrameByChannel[frameChannel];
		if (currentPinned.frame === nextFrame && currentPinned.asset === asset) {
			return;
		}
		if (currentPinned.frame && currentPinned.asset) {
			currentPinned.asset.unpinFrame(currentPinned.frame);
		}
		if (nextFrame && asset) {
			asset.pinFrame(nextFrame);
		}
		pinnedFrameByChannel[frameChannel] = {
			frame: nextFrame,
			asset: nextFrame && asset ? asset : null,
		};
	};

	const resetPinnedFrames = () => {
		for (const frameChannel of FRAME_CHANNELS) {
			updatePinnedFrame(frameChannel, null, null);
		}
	};

	const prewarmReverseRange = async (options: {
		uri: string;
		asset: VideoAsset;
		videoSampleSink: VideoSampleSink;
		startTime: number;
		endExclusive: number;
	}): Promise<void> => {
		const { uri, asset, videoSampleSink, startTime, endExclusive } = options;
		const rangeKey = buildReversePrewarmRangeKey(uri, startTime, endExclusive);
		if (
			reversePrewarmInflight.has(rangeKey) ||
			reversePrewarmCompleted.has(rangeKey)
		) {
			return;
		}
		reversePrewarmInflight.add(rangeKey);

		let iterator: AsyncGenerator<VideoSample, void, unknown> | null = null;
		let hasError = false;
		try {
			iterator = videoSampleSink.samples(startTime, endExclusive);
			while (true) {
				const result = await iterator.next();
				if (result.done) break;
				// 资源已切换时停止旧任务，避免把旧素材帧写进新状态。
				if (assetHandle?.asset !== asset) {
					closeVideoSample(result.value);
					return;
				}
				const sampleTimestamp = result.value.timestamp;
				const skiaImage = videoSampleToSkImage(result.value);
				if (!skiaImage) continue;
				asset.storeFrame(alignTime(sampleTimestamp), skiaImage);
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
		videoSampleSink: VideoSampleSink;
		asset: VideoAsset;
		targetTime: number;
	}) => {
		const { uri, input, videoSampleSink, asset, targetTime } = options;
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
					videoSampleSink,
					startTime,
					endExclusive,
				});
				upperBoundary = startTime;
			}
		})();
	};

	// 按渲染通道更新帧，避免离屏渲染覆盖主预览帧
	const updateCurrentFrame = (
		skiaImage: SkImage,
		timestamp: number | undefined,
		frameChannel: RenderFrameChannel = DEFAULT_FRAME_CHANNEL,
	) => {
		// 存入缓存
		const isTimestampFinite = Number.isFinite(timestamp ?? NaN);
		if (isTimestampFinite) {
			const alignedTime = alignTime(timestamp as number);
			assetHandle?.asset.storeFrame(alignedTime, skiaImage);
			lastRenderedTimeByChannel[frameChannel] = alignedTime;
		}

		updatePinnedFrame(frameChannel, skiaImage, assetHandle?.asset ?? null);
		store.setState((state) => ({
			...state,
			internal: {
				...state.internal,
				currentFrame:
					frameChannel === "current" ? skiaImage : state.internal.currentFrame,
				offscreenFrame:
					frameChannel === "offscreen"
						? skiaImage
						: state.internal.offscreenFrame,
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

	const resolveVideoSampleSink = (
		asset: VideoAsset,
		shouldDedicated: boolean,
	) => {
		if (!shouldDedicated) return asset.videoSampleSink;
		if (!dedicatedVideoSampleSink) {
			try {
				dedicatedVideoSampleSink = asset.createVideoSampleSink();
			} catch (err) {
				// 创建独立 sink 失败时回退到共享 sink
				console.warn("Create video sample sink failed:", err);
				return asset.videoSampleSink;
			}
		}
		return dedicatedVideoSampleSink;
	};

	const updateVideoSampleSink = () => {
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

		const nextSink = resolveVideoSampleSink(handle.asset, shouldDedicated);
		for (const frameChannel of FRAME_CHANNELS) {
			stopPlayback(frameChannel);
		}
		store.setState((state) => ({
			...state,
			internal: {
				...state.internal,
				videoSampleSink: nextSink,
				playbackEpoch: (state.internal.playbackEpoch ?? 0) + 1,
			},
		}));
		if (!shouldDedicated) {
			// 释放独立 sink 引用，减少长期占用
			dedicatedVideoSampleSink = null;
		}
	};

	// 开始流式播放
	const startPlayback = async (
		startTime: number,
		frameChannel: RenderFrameChannel = DEFAULT_FRAME_CHANNEL,
	): Promise<void> => {
		await stepPlayback(startTime, frameChannel);
	};

	// 获取下一帧（流式播放时调用）
	const getNextFrame = async (
		targetTime: number,
		frameChannel: RenderFrameChannel = DEFAULT_FRAME_CHANNEL,
	): Promise<void> => {
		await stepPlayback(targetTime, frameChannel);
	};

	// 停止流式播放
	const stopPlayback = (
		frameChannel: RenderFrameChannel = DEFAULT_FRAME_CHANNEL,
	) => {
		const sessionKey =
			retainedPlaybackSessionKeyByChannel[frameChannel] ??
			resolveVideoPlaybackSessionKey(frameChannel);
		stopVideoPlaybackSession(sessionKey);
	};

	// 统一的播放步进方法，避免频繁挂载导致状态丢失
	const stepPlayback = async (
		targetTime: number,
		frameChannel: RenderFrameChannel = DEFAULT_FRAME_CHANNEL,
	): Promise<void> => {
		if (!Number.isFinite(targetTime)) return;
		const { internal, props } = store.getState();
		const videoSampleSink = internal.videoSampleSink;
		if (!videoSampleSink) return;
		// 倒放时 targetTime 会递减，阈值必须为 0 才能每次回退都重建迭代器并推进画面。
		const backJumpThresholdSeconds = props.reversed
			? 0
			: PLAYBACK_BACK_JUMP_FRAMES / getTimelineFps();
		const sessionKey = retainPlaybackSession(frameChannel);
		const sampleToShow = await stepVideoPlaybackSession({
			key: sessionKey,
			sink: videoSampleSink,
			targetTime,
			backJumpThresholdSeconds,
			isExporting: () => timelineStore.getState().isExporting,
		});
		if (!sampleToShow) {
			return;
		}
		const sampleTimestamp = sampleToShow.timestamp;
		const skiaImage = videoSampleToSkImage(sampleToShow);
		if (!skiaImage) return;
		updateCurrentFrame(skiaImage, sampleTimestamp, frameChannel);
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
		const { videoSampleSink, input } = internal;
		const frameChannel = resolveFrameChannel(options.frameChannel);

		if (!videoSampleSink) return;

		// seek 前先停止流式播放，避免迭代器与临时 seek 竞争
		stopPlayback(frameChannel);

		const alignedTime = alignTime(seconds);
		const normalizedOptions: VideoSeekOptions = {
			reason: resolveSeekReason(options.reason, Boolean(props.reversed)),
			frameChannel,
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
				videoSampleSink,
				asset: reverseLookaheadContext.asset,
				targetTime: alignedTime,
			});
		};
		// 防止并发 seek
		if (isSeekingFlag) {
			const pending = pendingSeekRequestByChannel[frameChannel];
			if (pending) {
				pending.time = alignedTime;
				pending.options = normalizedOptions;
				if (shouldPreemptActiveSeek(frameChannel, alignedTime)) {
					asyncId += 1;
				}
				// seek 忙碌时也触发倒放预热，避免预编译阶段丢失 lookahead 机会。
				triggerReverseLookaheadPrewarm();
				await pending.wait;
				return;
			}
			let resolveWait: (() => void) | null = null;
			const wait = new Promise<void>((resolve) => {
				resolveWait = resolve;
			});
			const nextPending: PendingSeekRequest = {
				time: alignedTime,
				options: normalizedOptions,
				wait,
				resolve: () => {
					const resolve = resolveWait;
					resolveWait = null;
					resolve?.();
				},
			};
			pendingSeekRequestByChannel[frameChannel] = nextPending;
			if (shouldPreemptActiveSeek(frameChannel, alignedTime)) {
				asyncId += 1;
			}
			// seek 忙碌时也触发倒放预热，避免预编译阶段丢失 lookahead 机会。
			triggerReverseLookaheadPrewarm();
			await nextPending.wait;
			return;
		}
		if (lastSeekTimeByChannel[frameChannel] === alignedTime) {
			// 命中同帧时仍允许倒放预热继续推进。
			triggerReverseLookaheadPrewarm();
			return;
		}

		// 检查缓存
		const cachedFrame = assetHandle?.asset.getCachedFrame(alignedTime);
		if (cachedFrame) {
			updatePinnedFrame(frameChannel, cachedFrame, assetHandle?.asset ?? null);
			store.setState((state) => ({
				...state,
				internal: {
					...state.internal,
					currentFrame:
						frameChannel === "current"
							? cachedFrame
							: state.internal.currentFrame,
					offscreenFrame:
						frameChannel === "offscreen"
							? cachedFrame
							: state.internal.offscreenFrame,
					isReady: true,
				},
			}));
			lastSeekTimeByChannel[frameChannel] = alignedTime;
			lastRenderedTimeByChannel[frameChannel] = alignedTime;
			triggerReverseLookaheadPrewarm();
			return;
		}

		isSeekingFlag = true;
		activeSeekChannel = frameChannel;
		activeSeekTime = alignedTime;
		asyncId++;
		const currentAsyncId = asyncId;

		const decodeVideoSample = async (sample: VideoSample) => {
			return videoSampleToSkImage(sample);
		};

		const fallbackSeekBySingleFrame = async (): Promise<void> => {
			const iterator = videoSampleSink.samples(alignedTime);
			try {
				const firstFrame = (await iterator.next()).value ?? null;
				if (currentAsyncId !== asyncId) {
					closeVideoSample(firstFrame);
					return;
				}
				if (!firstFrame) return;
				const firstImage = await decodeVideoSample(firstFrame);
				if (firstImage && currentAsyncId === asyncId) {
					updateCurrentFrame(firstImage, alignedTime, frameChannel);
					lastSeekTimeByChannel[frameChannel] = alignedTime;
				}
				if (SEEK_PREFETCH_FRAMES <= 0) return;
				// 预取少量连续帧，减少拖动预览时的离散命中
				for (let i = 0; i < SEEK_PREFETCH_FRAMES; i += 1) {
					const result = await iterator.next();
					const nextFrame = result.value ?? null;
					if (currentAsyncId !== asyncId) {
						closeVideoSample(nextFrame);
						return;
					}
					if (!nextFrame) break;
					const nextFrameTimestamp = nextFrame.timestamp;
					const nextImage = await decodeVideoSample(nextFrame);
					if (nextImage && currentAsyncId === asyncId) {
						const nextAlignedTime = alignTime(nextFrameTimestamp);
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
					videoSampleSink,
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
					decodeVideoSample: async (sample) => {
						const decoded = await decodeVideoSample(sample);
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
					updateCurrentFrame(warmupResult.frame, alignedTime, frameChannel);
					lastSeekTimeByChannel[frameChannel] = alignedTime;
					resolvedByWarmup = true;
				}
			}
			if (!resolvedByWarmup) {
				await fallbackSeekBySingleFrame();
			}
			if (currentAsyncId !== asyncId) return;
			triggerReverseLookaheadPrewarm();
		} catch (err) {
			console.warn("Seek failed:", err);
		} finally {
			isSeekingFlag = false;
			activeSeekChannel = null;
			activeSeekTime = null;
			let nextChannel: RenderFrameChannel | null = null;
			for (const candidate of FRAME_CHANNELS) {
				const request = pendingSeekRequestByChannel[candidate];
				if (!request) continue;
				if (request.time === lastSeekTimeByChannel[candidate]) {
					pendingSeekRequestByChannel[candidate] = null;
					// 去重丢弃也要唤醒等待方，避免离屏通道卡死在 await pending.wait。
					request.resolve();
					continue;
				}
				nextChannel = candidate;
				break;
			}
			if (nextChannel) {
				const nextRequest = pendingSeekRequestByChannel[nextChannel];
				pendingSeekRequestByChannel[nextChannel] = null;
				if (nextRequest) {
					try {
						await seekToTime(nextRequest.time, nextRequest.options);
					} finally {
						nextRequest.resolve();
					}
				}
			}
		}
	};

	const prepareFrame = async (context: PrepareFrameContext): Promise<void> => {
		const { element, displayTime, fps } = context;
		if (context.phase === "afterRender") return;
		const frameChannel = resolveFrameChannel(context.frameChannel);
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
		const lastPreparedFrameIndex =
			lastPreparedFrameIndexByChannel[frameChannel];
		// 首帧优先走 seek，避免流式步进在首个可解码帧晚于目标时间时返回空帧。
		if (lastPreparedFrameIndex === null) {
			await seekToTime(alignedVideoTime, { frameChannel });
			lastPreparedFrameIndexByChannel[frameChannel] = alignedFrameIndex;
			return;
		}
		if (alignedFrameIndex === lastPreparedFrameIndex) return;
		// 向后预编译统一走 seek，前向才走 stepPlayback，避免回退卡住。
		if (alignedFrameIndex < lastPreparedFrameIndex) {
			await seekToTime(alignedVideoTime, { frameChannel });
			lastPreparedFrameIndexByChannel[frameChannel] = alignedFrameIndex;
			return;
		}
		const renderedTimeBeforeStep = lastRenderedTimeByChannel[frameChannel];
		await stepPlayback(alignedVideoTime, frameChannel);
		const safeFps = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 30;
		const frameInterval = 1 / safeFps;
		const renderedTime = lastRenderedTimeByChannel[frameChannel];
		const isPlaying = timelineStore.getState().isPlaying;
		const nowMs = getNowMs();
		if (isPlaying) {
			const hasPlaybackProgress =
				Number.isFinite(renderedTime ?? NaN) &&
				(renderedTimeBeforeStep === null ||
					!Number.isFinite(renderedTimeBeforeStep) ||
					(renderedTime as number) > renderedTimeBeforeStep + 1e-9);
			if (hasPlaybackProgress) {
				if (
					renderedTimeBeforeStep !== null &&
					Number.isFinite(renderedTimeBeforeStep)
				) {
					const observedFrameInterval =
						(renderedTime as number) - renderedTimeBeforeStep;
					if (
						Number.isFinite(observedFrameInterval) &&
						observedFrameInterval > 0
					) {
						observedPlaybackFrameIntervalByChannel[frameChannel] =
							observedFrameInterval;
					}
				}
				lastPlaybackProgressAtMsByChannel[frameChannel] = nowMs;
			} else if (lastPlaybackProgressAtMsByChannel[frameChannel] === null) {
				// 播放态首次进入无进展时，以当前时间作为停滞起点，避免历史状态污染。
				lastPlaybackProgressAtMsByChannel[frameChannel] = nowMs;
			}
		} else {
			lastPlaybackProgressAtMsByChannel[frameChannel] = null;
		}
		const lastPlaybackProgressAtMs =
			lastPlaybackProgressAtMsByChannel[frameChannel];
		const stalledDurationSeconds =
			lastPlaybackProgressAtMs === null
				? null
				: Math.max(0, (nowMs - lastPlaybackProgressAtMs) / 1000);
		const shouldSeek = shouldSeekAfterStepPlayback({
			isPlaying,
			targetTime: alignedVideoTime,
			renderedTime,
			timelineFrameInterval: frameInterval,
			observedFrameInterval: observedPlaybackFrameIntervalByChannel[frameChannel],
			stalledDurationSeconds,
			driftFloorSeconds: PLAYBACK_DRIFT_FLOOR_SECONDS,
			adaptiveMultiplier: PLAYBACK_DRIFT_ADAPTIVE_MULTIPLIER,
		});
		if (shouldSeek) {
			await seekToTime(alignedVideoTime, { frameChannel });
		}
		lastPreparedFrameIndexByChannel[frameChannel] = alignedFrameIndex;
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
				videoSampleSink: null,
				input: null,
				currentFrame: null,
				offscreenFrame: null,
				videoDuration: 0,
				videoRotation: 0,
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
					resetPlaybackDriftTrackingState();
					dedicatedVideoSampleSink = null;

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
					const clipSink = resolveVideoSampleSink(asset, shouldDedicated);

					// 更新状态
					set((state) => ({
						constraints: {
							...state.constraints,
							isLoading: false,
							maxDuration: availableDuration ?? durationFrames,
						},
						internal: {
							...state.internal,
							videoSampleSink: clipSink,
							input: asset.input,
							videoDuration: asset.duration,
							videoRotation: asset.videoRotation,
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
								updateVideoSampleSink();
							},
						);
					}
					if (!unsubscribeTime) {
						const onTimeChange = () => {
							updateVideoSampleSink();
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

				resetPinnedFrames();
				for (const frameChannel of FRAME_CHANNELS) {
					stopPlayback(frameChannel);
				}
				releaseAllPlaybackSessions();
				lastSeekTimeByChannel = { current: null, offscreen: null };
				pendingSeekRequestByChannel = { current: null, offscreen: null };
				lastPreparedFrameIndexByChannel = { current: null, offscreen: null };
				lastRenderedTimeByChannel = { current: null, offscreen: null };
				resetPlaybackDriftTrackingState();
				dedicatedVideoSampleSink = null;
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
				internal.videoSampleSink = null;
				internal.input = null;
				internal.videoRotation = 0;
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
