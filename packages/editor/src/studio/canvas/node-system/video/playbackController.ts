import { createFramePrecompileController } from "core/editor/preview/framePrecompileController";
import { schedulePrecompileTask } from "core/editor/preview/framePrecompileScheduler";
import type { AudioBufferSink, VideoSample, VideoSampleSink } from "mediabunny";
import type { SkImage } from "react-skia-lite";
import type { AssetHandle } from "@/assets/AssetStore";
import { type AudioAsset, acquireAudioAsset } from "@/assets/audioAsset";
import { acquireVideoAsset, type VideoAsset } from "@/assets/videoAsset";
import { getAudioContext } from "@/audio/engine";
import {
	getOwner,
	releaseOwner,
	requestOwner,
	subscribeOwnerChange,
} from "@/audio/owner";
import { closeVideoSample, videoSampleToSkImage } from "@/lib/videoFrameUtils";
import {
	type AudioPlaybackController,
	createAudioPlaybackController,
} from "@/audio/playback";
import {
	releaseVideoPlaybackSession,
	retainVideoPlaybackSession,
	stepVideoPlaybackSession,
	stopVideoPlaybackSession,
} from "@/element/VideoClip/videoPlaybackSessionPool";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";

const DEFAULT_FPS = 30;
const LOOKAHEAD_FRAMES = 2;
const PLAYBACK_BACK_JUMP_FRAMES = 3;
const VIDEO_OWNER_PREFIX = "canvas-node:video:";
const SCENE_OWNER_PREFIX = "scene:";

type ClockMode = "audio" | "perf" | null;

const getNowMs = (): number => {
	if (
		typeof performance !== "undefined" &&
		Number.isFinite(performance.now())
	) {
		return performance.now();
	}
	return Date.now();
};

const normalizeFps = (fps: number): number => {
	if (!Number.isFinite(fps) || fps <= 0) return DEFAULT_FPS;
	return Math.round(fps);
};

const clampTime = (value: number, duration: number): number => {
	if (!Number.isFinite(value)) return 0;
	const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
	return Math.min(safeDuration, Math.max(0, value));
};

const alignTime = (time: number, fps: number): number => {
	const safeFps = normalizeFps(fps);
	if (!Number.isFinite(time) || time <= 0) return 0;
	return Math.round(time * safeFps) / safeFps;
};

const toFrameIndex = (time: number, fps: number): number => {
	return Math.round(alignTime(time, fps) * normalizeFps(fps));
};

const toTimeFromFrameIndex = (frameIndex: number, fps: number): number => {
	if (!Number.isFinite(frameIndex)) return 0;
	return Math.max(0, frameIndex / normalizeFps(fps));
};

const toSceneIdFromOwner = (ownerId: string): string | null => {
	if (!ownerId.startsWith(SCENE_OWNER_PREFIX)) return null;
	const sceneId = ownerId.slice(SCENE_OWNER_PREFIX.length).trim();
	return sceneId.length > 0 ? sceneId : null;
};

export interface VideoNodePlaybackSnapshot {
	isLoading: boolean;
	isReady: boolean;
	isPlaying: boolean;
	currentFrame: SkImage | null;
	currentTime: number;
	duration: number;
	errorMessage: string | null;
}

export interface VideoNodePlaybackBinding {
	assetUri: string | null;
	fps: number;
	runtimeManager: StudioRuntimeManager | null;
}

interface SeekOptions {
	fromPlayback?: boolean;
}

interface ResolveFrameOptions {
	allowSingleFrameFallback: boolean;
}

interface QueuedSeekRequest {
	time: number;
	fromPlayback: boolean;
}

interface ControllerFrameState {
	frame: SkImage | null;
	dispose?: () => void;
}

export interface VideoNodePlaybackController {
	readonly nodeId: string;
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => VideoNodePlaybackSnapshot;
	bind: (binding: VideoNodePlaybackBinding) => void;
	play: () => Promise<void>;
	pause: () => void;
	togglePlayback: () => Promise<void>;
	seekToTime: (seconds: number, options?: SeekOptions) => Promise<void>;
}

class VideoNodePlaybackControllerImpl implements VideoNodePlaybackController {
	readonly nodeId: string;
	private readonly ownerId: string;
	private readonly videoSessionKey: string;
	private disposed = false;
	private listeners = new Set<() => void>();
	private snapshot: VideoNodePlaybackSnapshot = {
		isLoading: false,
		isReady: false,
		isPlaying: false,
		currentFrame: null,
		currentTime: 0,
		duration: 0,
		errorMessage: null,
	};
	private binding: VideoNodePlaybackBinding = {
		assetUri: null,
		fps: DEFAULT_FPS,
		runtimeManager: null,
	};
	private loadEpoch = 0;
	private videoHandle: AssetHandle<VideoAsset> | null = null;
	private audioHandle: AssetHandle<AudioAsset> | null = null;
	private videoSampleSink: VideoSampleSink | null = null;
	private audioSink: AudioBufferSink | null = null;
	private audioPlayback: AudioPlaybackController | null = null;
	private retainedVideoSession = false;
	private rafId: number | null = null;
	private clockMode: ClockMode = null;
	private clockStartTime = 0;
	private audioClockStart: number | null = null;
	private perfClockStartMs: number | null = null;
	private queuedSeek: QueuedSeekRequest | null = null;
	private seekLoopPromise: Promise<void> | null = null;
	private lastCommittedFrameIndex: number | null = null;
	private pinnedFrame: SkImage | null = null;
	private pinnedFrameAsset: VideoAsset | null = null;
	private readonly frameController =
		createFramePrecompileController<ControllerFrameState>({
			lookaheadFrames: LOOKAHEAD_FRAMES,
			scheduleTask: schedulePrecompileTask,
			onPrefetchError: (error, frameIndex) => {
				console.warn(
					`Video node lookahead prefetch failed (${this.nodeId}, frame ${frameIndex}):`,
					error,
				);
			},
		});
	private readonly unsubscribeOwnerChange: () => void;

	constructor(nodeId: string) {
		this.nodeId = nodeId;
		this.ownerId = `${VIDEO_OWNER_PREFIX}${nodeId}`;
		this.videoSessionKey = `${this.ownerId}:video`;
		this.unsubscribeOwnerChange = subscribeOwnerChange((change) => {
			if (change.previousOwner !== this.ownerId) return;
			if (change.nextOwner === this.ownerId) return;
			this.pauseInternal({
				releaseOwnerFlag: false,
				invalidateLookahead: true,
			});
		});
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	getSnapshot(): VideoNodePlaybackSnapshot {
		return this.snapshot;
	}

	bind(binding: VideoNodePlaybackBinding): void {
		if (this.disposed) return;
		const nextAssetUri =
			typeof binding.assetUri === "string" && binding.assetUri.trim().length > 0
				? binding.assetUri
				: null;
		const nextFps = normalizeFps(binding.fps);
		const nextRuntimeManager = binding.runtimeManager ?? null;
		const previousAssetUri = this.binding.assetUri;

		this.binding = {
			assetUri: nextAssetUri,
			fps: nextFps,
			runtimeManager: nextRuntimeManager,
		};

		if (previousAssetUri !== nextAssetUri) {
			void this.loadAsset(nextAssetUri);
		}
	}

	async play(): Promise<void> {
		if (this.disposed) return;
		if (this.snapshot.isLoading) return;
		if (!this.videoSampleSink) return;

		const previousOwner = requestOwner(this.ownerId);
		this.pausePreviousSceneOwner(previousOwner);

		if (!this.snapshot.isPlaying) {
			this.patchSnapshot({ isPlaying: true });
		}
		this.resetClock(this.snapshot.currentTime);
		await this.seekToTime(this.snapshot.currentTime, { fromPlayback: true });
		this.startPlaybackLoop();
	}

	pause(): void {
		this.pauseInternal({
			releaseOwnerFlag: true,
			invalidateLookahead: true,
		});
	}

	async togglePlayback(): Promise<void> {
		if (this.snapshot.isPlaying) {
			this.pause();
			return;
		}
		await this.play();
	}

	async seekToTime(seconds: number, options: SeekOptions = {}): Promise<void> {
		if (this.disposed) return;
		const clampedTime = clampTime(seconds, this.snapshot.duration);
		this.queuedSeek = {
			time: clampedTime,
			fromPlayback: options.fromPlayback === true,
		};
		if (this.seekLoopPromise) {
			await this.seekLoopPromise;
			return;
		}
		this.seekLoopPromise = this.runSeekLoop().finally(() => {
			this.seekLoopPromise = null;
		});
		await this.seekLoopPromise;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.pauseInternal({
			releaseOwnerFlag: true,
			invalidateLookahead: true,
		});
		this.queuedSeek = null;
		if (this.retainedVideoSession) {
			releaseVideoPlaybackSession(this.videoSessionKey);
			this.retainedVideoSession = false;
		}
		this.frameController.disposeAll();
		this.lastCommittedFrameIndex = null;
		this.resetPinnedFrame();
		this.disposeAssetHandles();
		this.unsubscribeOwnerChange();
		this.listeners.clear();
	}

	private async runSeekLoop(): Promise<void> {
		while (this.queuedSeek) {
			const request = this.queuedSeek;
			this.queuedSeek = null;
			await this.seekOnce(request.time, {
				fromPlayback: request.fromPlayback,
			});
		}
	}

	private patchSnapshot(next: Partial<VideoNodePlaybackSnapshot>) {
		const previousFrame = this.snapshot.currentFrame;
		this.snapshot = {
			...this.snapshot,
			...next,
		};
		if (previousFrame !== this.snapshot.currentFrame) {
			this.updatePinnedFrame(this.snapshot.currentFrame);
		}
		for (const listener of this.listeners) {
			listener();
		}
	}

	private updatePinnedFrame(nextFrame: SkImage | null) {
		const nextAsset = nextFrame ? (this.videoHandle?.asset ?? null) : null;
		if (this.pinnedFrame === nextFrame && this.pinnedFrameAsset === nextAsset) {
			return;
		}
		if (this.pinnedFrame && this.pinnedFrameAsset) {
			this.pinnedFrameAsset.unpinFrame(this.pinnedFrame);
		}
		if (nextFrame && nextAsset) {
			nextAsset.pinFrame(nextFrame);
		}
		this.pinnedFrame = nextFrame;
		this.pinnedFrameAsset = nextAsset;
	}

	private resetPinnedFrame() {
		this.updatePinnedFrame(null);
	}

	private async loadAsset(uri: string | null): Promise<void> {
		this.loadEpoch += 1;
		const loadEpoch = this.loadEpoch;
		this.pauseInternal({
			releaseOwnerFlag: true,
			invalidateLookahead: true,
		});
		this.resetPinnedFrame();
		this.disposeAssetHandles();
		this.lastCommittedFrameIndex = null;

		if (!uri) {
			this.patchSnapshot({
				isLoading: false,
				isReady: false,
				isPlaying: false,
				currentFrame: null,
				currentTime: 0,
				duration: 0,
				errorMessage: "未绑定视频素材",
			});
			return;
		}

		this.patchSnapshot({
			isLoading: true,
			isReady: false,
			isPlaying: false,
			currentFrame: null,
			currentTime: 0,
			duration: 0,
			errorMessage: null,
		});

		let nextVideoHandle: AssetHandle<VideoAsset> | null = null;
		let nextAudioHandle: AssetHandle<AudioAsset> | null = null;

		try {
			nextVideoHandle = await acquireVideoAsset(uri);
			if (this.disposed || loadEpoch !== this.loadEpoch) {
				nextVideoHandle.release();
				return;
			}

			nextAudioHandle = await acquireAudioAsset(uri).catch(() => null);
			if (this.disposed || loadEpoch !== this.loadEpoch) {
				nextVideoHandle.release();
				nextAudioHandle?.release();
				return;
			}

			this.videoHandle = nextVideoHandle;
			this.videoSampleSink = nextVideoHandle.asset.videoSampleSink;
			this.audioHandle = nextAudioHandle;
			this.audioSink = nextAudioHandle?.asset.createAudioSink() ?? null;
			this.recreateAudioPlayback(uri);

			const duration = Math.max(0, nextVideoHandle.asset.duration);
			this.patchSnapshot({
				isLoading: false,
				isReady: true,
				isPlaying: false,
				currentFrame: null,
				currentTime: 0,
				duration,
				errorMessage: null,
			});

			await this.seekToTime(0);
		} catch (error) {
			nextVideoHandle?.release();
			nextAudioHandle?.release();
			if (this.disposed || loadEpoch !== this.loadEpoch) return;
			this.patchSnapshot({
				isLoading: false,
				isReady: false,
				isPlaying: false,
				currentFrame: null,
				currentTime: 0,
				duration: 0,
				errorMessage:
					error instanceof Error ? error.message : "加载视频素材失败",
			});
		}
	}

	private recreateAudioPlayback(uri: string) {
		this.audioPlayback?.dispose();
		this.audioPlayback = createAudioPlaybackController({
			getTimeline: () => {
				const safeFps = normalizeFps(this.binding.fps);
				const durationFrames = Math.max(
					1,
					Math.round(this.snapshot.duration * safeFps),
				);
				return {
					start: 0,
					end: durationFrames,
					startTimecode: "00:00:00:00",
					endTimecode: "00:00:00:00",
				};
			},
			getFps: () => this.binding.fps,
			getState: () => ({
				isLoading: this.snapshot.isLoading,
				hasError: Boolean(this.snapshot.errorMessage),
				uri,
				audioSink: this.audioSink,
				audioDuration: this.snapshot.duration,
			}),
			isPlaybackEnabled: () => getOwner() === this.ownerId,
			getRuntimeKey: () => this.ownerId,
		});
	}

	private pausePreviousSceneOwner(previousOwner: string | null) {
		if (!previousOwner || previousOwner === this.ownerId) return;
		const sceneId = toSceneIdFromOwner(previousOwner);
		if (!sceneId) return;
		const runtime = this.binding.runtimeManager?.getTimelineRuntime(
			toSceneTimelineRef(sceneId),
		);
		if (!runtime) return;
		runtime.timelineStore.getState().pause();
	}

	private pauseInternal(options: {
		releaseOwnerFlag: boolean;
		invalidateLookahead: boolean;
	}) {
		if (this.snapshot.isPlaying) {
			this.patchSnapshot({ isPlaying: false });
		}
		this.stopPlaybackLoop();
		this.clockMode = null;
		this.audioClockStart = null;
		this.perfClockStartMs = null;
		this.audioPlayback?.stopPlayback();
		stopVideoPlaybackSession(this.videoSessionKey);
		if (options.invalidateLookahead) {
			this.frameController.invalidateAll();
			this.lastCommittedFrameIndex = null;
		}
		if (options.releaseOwnerFlag) {
			releaseOwner(this.ownerId);
		}
	}

	private resetClock(currentTime: number) {
		const context = getAudioContext();
		if (context && context.state === "running") {
			this.clockMode = "audio";
			this.clockStartTime = currentTime;
			this.audioClockStart = context.currentTime;
			this.perfClockStartMs = null;
			return;
		}
		this.clockMode = "perf";
		this.clockStartTime = currentTime;
		this.perfClockStartMs = getNowMs();
		this.audioClockStart = null;
	}

	private getClockTime(nowMs: number): number {
		if (this.clockMode === "audio") {
			const context = getAudioContext();
			if (
				context &&
				context.state === "running" &&
				this.audioClockStart !== null
			) {
				const elapsed = context.currentTime - this.audioClockStart;
				return this.clockStartTime + Math.max(0, elapsed);
			}
			this.clockMode = "perf";
			this.perfClockStartMs = nowMs;
		}
		if (this.perfClockStartMs === null) {
			this.perfClockStartMs = nowMs;
		}
		const elapsed = Math.max(0, (nowMs - this.perfClockStartMs) / 1000);
		return this.clockStartTime + elapsed;
	}

	private startPlaybackLoop() {
		if (this.rafId !== null) return;
		const animate = () => {
			this.rafId = null;
			if (!this.snapshot.isPlaying || this.disposed) return;
			if (getOwner() !== this.ownerId) {
				this.pauseInternal({
					releaseOwnerFlag: false,
					invalidateLookahead: true,
				});
				return;
			}
			const duration = this.snapshot.duration;
			const targetTime = clampTime(this.getClockTime(getNowMs()), duration);
			if (targetTime >= duration) {
				void this.seekToTime(duration, { fromPlayback: true }).finally(() => {
					this.pauseInternal({
						releaseOwnerFlag: true,
						invalidateLookahead: true,
					});
				});
				return;
			}
			void this.seekToTime(targetTime, { fromPlayback: true });
			this.rafId = requestAnimationFrame(animate);
		};
		this.rafId = requestAnimationFrame(animate);
	}

	private stopPlaybackLoop() {
		if (this.rafId === null) return;
		cancelAnimationFrame(this.rafId);
		this.rafId = null;
	}

	private async seekOnce(seconds: number, options: SeekOptions): Promise<void> {
		if (!this.videoSampleSink || !this.videoHandle) {
			this.patchSnapshot({ currentFrame: null, currentTime: 0 });
			return;
		}

		const safeFps = normalizeFps(this.binding.fps);
		const alignedTarget = alignTime(seconds, safeFps);
		const frameIndex = toFrameIndex(alignedTarget, safeFps);
		const previousFrameIndex = this.lastCommittedFrameIndex;
		const isDiscontinuous =
			previousFrameIndex !== null &&
			(frameIndex < previousFrameIndex || frameIndex > previousFrameIndex + 1);

		const buildFrame = async (
			targetFrameIndex: number,
		): Promise<ControllerFrameState> => {
			const targetSeconds = toTimeFromFrameIndex(targetFrameIndex, safeFps);
			const frame = await this.resolveFrameAtTime(targetSeconds, {
				allowSingleFrameFallback: !options.fromPlayback,
			});
			return { frame };
		};

		let currentFrame: SkImage | null = null;
		if (!this.snapshot.isPlaying || isDiscontinuous) {
			this.frameController.invalidateAll();
			if (isDiscontinuous) {
				// 跳跃 seek 时重置流式会话，避免解码器状态影响下一段。
				stopVideoPlaybackSession(this.videoSessionKey);
			}
			const state = await buildFrame(frameIndex);
			currentFrame = state.frame;
			this.frameController.commitFrame(frameIndex, buildFrame);
		} else {
			const entry = await this.frameController.getOrBuildCurrent(
				frameIndex,
				buildFrame,
			);
			currentFrame = entry.state?.frame ?? null;
			this.frameController.commitFrame(frameIndex, buildFrame);
		}
		if (!currentFrame && this.snapshot.currentFrame) {
			// 解码偶发空帧时沿用上一帧，避免拖动与播放过程中闪烁/清屏。
			currentFrame = this.snapshot.currentFrame;
		}

		this.lastCommittedFrameIndex = frameIndex;
		this.patchSnapshot({
			currentTime: alignedTarget,
			currentFrame,
			errorMessage: null,
		});

		if (this.snapshot.isPlaying && getOwner() === this.ownerId) {
			await this.audioPlayback?.stepPlayback({
				timelineTimeSeconds: alignedTarget,
				sourceTime: alignedTarget,
				sourceRange: {
					start: 0,
					end: this.snapshot.duration,
				},
				activeWindow: {
					start: 0,
					end: this.snapshot.duration,
				},
				runtimeKey: this.ownerId,
			});
		}

		if (!options.fromPlayback && this.snapshot.isPlaying) {
			this.resetClock(alignedTarget);
		}
	}

	private ensureRetainedVideoSession() {
		if (this.retainedVideoSession) return;
		retainVideoPlaybackSession(this.videoSessionKey);
		this.retainedVideoSession = true;
	}

	private async resolveFrameAtTime(
		seconds: number,
		options: ResolveFrameOptions,
	): Promise<SkImage | null> {
		const handle = this.videoHandle;
		const sink = this.videoSampleSink;
		if (!handle || !sink) return null;

		const safeFps = normalizeFps(this.binding.fps);
		const alignedTarget = alignTime(seconds, safeFps);
		const cached = handle.asset.getCachedFrame(alignedTarget);
		if (cached) return cached;

		this.ensureRetainedVideoSession();
		const frame = await stepVideoPlaybackSession({
			key: this.videoSessionKey,
			sink,
			targetTime: alignedTarget,
			backJumpThresholdSeconds: PLAYBACK_BACK_JUMP_FRAMES / safeFps,
		});
		if (!frame) {
			if (!options.allowSingleFrameFallback) {
				return null;
			}
			return this.decodeFrameFromDirectSeek(alignedTarget, safeFps);
		}

		return this.decodeAndStoreFrame(handle, frame, safeFps);
	}

	private async decodeFrameFromDirectSeek(
		targetTime: number,
		safeFps: number,
	): Promise<SkImage | null> {
		const sink = this.videoSampleSink;
		const handle = this.videoHandle;
		if (!sink || !handle) return null;
		let iterator: AsyncGenerator<VideoSample, void, unknown> | null = null;
		try {
			iterator = sink.samples(targetTime);
			const firstFrame = (await iterator.next()).value ?? null;
			if (!firstFrame) {
				return null;
			}
			return this.decodeAndStoreFrame(handle, firstFrame, safeFps);
		} catch (error) {
			console.warn("Video node seek fallback decode failed:", error);
			return null;
		} finally {
			await iterator?.return?.();
		}
	}

	private async decodeAndStoreFrame(
		handle: AssetHandle<VideoAsset>,
		frame: VideoSample,
		safeFps: number,
	): Promise<SkImage | null> {
		const timestamp = alignTime(frame.timestamp, safeFps);
		const existed = handle.asset.getCachedFrame(timestamp);
		if (existed) {
			closeVideoSample(frame);
			return existed;
		}

		const decoded = videoSampleToSkImage(frame);
		if (!decoded) return null;

		const cachedAfterDecode = handle.asset.getCachedFrame(timestamp);
		if (cachedAfterDecode) {
			decoded.dispose?.();
			return cachedAfterDecode;
		}

		handle.asset.storeFrame(timestamp, decoded);
		return decoded;
	}

	private disposeAssetHandles() {
		this.videoSampleSink = null;
		this.audioSink = null;
		this.videoHandle?.release();
		this.videoHandle = null;
		this.audioHandle?.release();
		this.audioHandle = null;
		this.audioPlayback?.dispose();
		this.audioPlayback = null;
	}
}

interface ControllerEntry {
	controller: VideoNodePlaybackControllerImpl;
	refCount: number;
}

const controllerEntryByNodeId = new Map<string, ControllerEntry>();

const getOrCreateControllerEntry = (nodeId: string): ControllerEntry => {
	const existing = controllerEntryByNodeId.get(nodeId);
	if (existing) return existing;
	const created: ControllerEntry = {
		controller: new VideoNodePlaybackControllerImpl(nodeId),
		refCount: 0,
	};
	controllerEntryByNodeId.set(nodeId, created);
	return created;
};

export const retainVideoNodePlaybackController = (
	nodeId: string,
): VideoNodePlaybackController => {
	const entry = getOrCreateControllerEntry(nodeId);
	entry.refCount += 1;
	return entry.controller;
};

export const getVideoNodePlaybackController = (
	nodeId: string,
): VideoNodePlaybackController | null => {
	const entry = controllerEntryByNodeId.get(nodeId);
	return entry?.controller ?? null;
};

export const releaseVideoNodePlaybackController = (nodeId: string): void => {
	const entry = controllerEntryByNodeId.get(nodeId);
	if (!entry) return;
	entry.refCount = Math.max(0, entry.refCount - 1);
	if (entry.refCount > 0) return;
	entry.controller.dispose();
	controllerEntryByNodeId.delete(nodeId);
};

export const __resetVideoNodePlaybackControllersForTests = () => {
	for (const [nodeId, entry] of controllerEntryByNodeId) {
		entry.controller.dispose();
		controllerEntryByNodeId.delete(nodeId);
	}
	controllerEntryByNodeId.clear();
};
