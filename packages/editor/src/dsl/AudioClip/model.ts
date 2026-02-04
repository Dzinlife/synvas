import type { AudioBufferSink, Input, WrappedAudioBuffer } from "mediabunny";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { AssetHandle } from "@/dsl/assets/AssetStore";
import { type AudioAsset, acquireAudioAsset } from "@/dsl/assets/audioAsset";
import {
	createClipGain,
	ensureAudioContext,
	getAudioContext,
} from "@/editor/audio/audioEngine";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import { framesToSeconds, secondsToFrames } from "@/utils/timecode";
import type {
	ComponentModel,
	ComponentModelStore,
	ValidationResult,
} from "../model/types";

export interface AudioClipProps {
	uri?: string;
}

export interface AudioClipInternal {
	audioSink: AudioBufferSink | null;
	input: Input | null;
	audioDuration: number;
	isReady: boolean;
	playbackEpoch: number;
	stepPlayback: (seconds: number) => Promise<void>;
	stopPlayback: () => void;
}

const DEFAULT_FPS = 30;
const PLAYBACK_BACK_JUMP_FRAMES = 3;
const PLAYBACK_LOOKAHEAD_SECONDS = 2;
const PLAYBACK_LOOKAHEAD_POLL_MS = 120;
const normalizeOffsetFrames = (offset?: number): number => {
	if (!Number.isFinite(offset ?? NaN)) return 0;
	return Math.max(0, Math.round(offset as number));
};

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

export function createAudioClipModel(
	id: string,
	initialProps: AudioClipProps,
): ComponentModelStore<AudioClipProps, AudioClipInternal> {
	let asyncId = 0;
	let initEpoch = 0;

	let assetHandle: AssetHandle<AudioAsset> | null = null;
	let unsubscribeTimelineOffset: (() => void) | null = null;

	let playbackIterator: AsyncGenerator<
		WrappedAudioBuffer | null,
		void,
		unknown
	> | null = null;
	let isPlaybackActive = false;
	let playbackStartContextTime: number | null = null;
	let playbackStartAudioTime: number | null = null;
	let scheduledSources: AudioBufferSourceNode[] = [];
	let clipGain: GainNode | null = null;
	let lastPlaybackTargetTime: number | null = null;


	const getTimelineFps = () => {
		const fps = useTimelineStore.getState().fps;
		if (!Number.isFinite(fps) || fps <= 0) return DEFAULT_FPS;
		return Math.round(fps);
	};

	const getTimeline = () => {
		return useTimelineStore.getState().getElementById(id)?.timeline;
	};

	const getTimelineOffsetFrames = (): number => {
		const timeline = getTimeline();
		return normalizeOffsetFrames(timeline?.offset);
	};

	const getTimelineClipDurationSeconds = (): number | null => {
		const timeline = getTimeline();
		if (!timeline) return null;
		const durationFrames = timeline.end - timeline.start;
		if (!Number.isFinite(durationFrames)) return null;
		return framesToSeconds(durationFrames, getTimelineFps());
	};

	const computeAvailableDurationFrames = (
		durationSeconds: number,
		offsetFrames: number,
	): number | undefined => {
		if (!Number.isFinite(durationSeconds)) return undefined;
		if (durationSeconds <= 0) return 0;
		const fps = getTimelineFps();
		const totalFrames = secondsToFrames(durationSeconds, fps);
		if (!Number.isFinite(totalFrames)) return undefined;
		return Math.max(1, totalFrames - offsetFrames);
	};

	const stopScheduledSources = () => {
		for (const source of scheduledSources) {
			try {
				source.stop();
			} catch {}
		}
		scheduledSources = [];
	};

	const schedulePlayback = async (
		iterator: AsyncGenerator<WrappedAudioBuffer | null, void, unknown>,
		currentAsyncId: number,
	) => {
		try {
			for await (const wrapped of iterator) {
				if (currentAsyncId !== asyncId) return;
				if (!wrapped?.buffer) continue;
				const context = getAudioContext();
				if (!context) return;
				if (!clipGain) return;
				if (
					playbackStartContextTime === null ||
					playbackStartAudioTime === null
				) {
					return;
				}
				const targetStart =
					playbackStartContextTime +
					(wrapped.timestamp - playbackStartAudioTime);

				let waitGuard = 20;
				while (
					currentAsyncId === asyncId &&
					targetStart - context.currentTime > PLAYBACK_LOOKAHEAD_SECONDS &&
					waitGuard > 0
				) {
					waitGuard -= 1;
					await sleep(PLAYBACK_LOOKAHEAD_POLL_MS);
				}
				if (currentAsyncId !== asyncId) return;
				if (targetStart + 0.02 < context.currentTime) continue;

				const source = context.createBufferSource();
				source.buffer = wrapped.buffer;
				source.connect(clipGain);
				source.onended = () => {
					scheduledSources = scheduledSources.filter((item) => item !== source);
				};
				scheduledSources.push(source);
				source.start(targetStart);
			}
		} catch (error) {
			if (currentAsyncId === asyncId) {
				console.warn("音频播放调度失败:", error);
			}
		}
	};

	const startPlayback = async (timelineTimeSeconds: number): Promise<void> => {
		const { internal, constraints, props } = store.getState();
		if (constraints.isLoading || constraints.hasError) return;
		if (!props.uri || !internal.audioSink || !assetHandle) return;

		const context = await ensureAudioContext();
		if (!context) return;

		if (!clipGain) {
			clipGain = createClipGain();
		}
		if (!clipGain) return;

		const timeline = getTimeline();
		if (!timeline) return;

		const fps = getTimelineFps();
		const clipStartSeconds = framesToSeconds(timeline.start ?? 0, fps);
		const clipDurationSeconds = framesToSeconds(
			timeline.end - timeline.start,
			fps,
		);
		const offsetSeconds = framesToSeconds(getTimelineOffsetFrames(), fps);
		const safeDurationSeconds = Math.max(
			0,
			Math.min(assetHandle.asset.duration - offsetSeconds, clipDurationSeconds),
		);
		const audioStart =
			offsetSeconds + Math.max(0, timelineTimeSeconds - clipStartSeconds);
		const audioEnd = offsetSeconds + safeDurationSeconds;

		if (!Number.isFinite(audioStart) || !Number.isFinite(audioEnd)) return;
		if (audioStart >= audioEnd) return;

		stopScheduledSources();
		playbackIterator?.return?.();
		playbackIterator = null;

		isPlaybackActive = true;
		asyncId += 1;
		const currentAsyncId = asyncId;

		playbackStartAudioTime = audioStart;
		playbackStartContextTime = context.currentTime + 0.05;
		playbackIterator = internal.audioSink.buffers(audioStart, audioEnd);

		schedulePlayback(playbackIterator, currentAsyncId);
	};

	const stopPlayback = () => {
		asyncId += 1;
		isPlaybackActive = false;
		playbackStartContextTime = null;
		playbackStartAudioTime = null;
		lastPlaybackTargetTime = null;
		playbackIterator?.return?.();
		playbackIterator = null;
		stopScheduledSources();
	};

	const stepPlayback = async (timelineTimeSeconds: number): Promise<void> => {
		if (!Number.isFinite(timelineTimeSeconds)) return;
		const { internal, constraints, props } = store.getState();
		if (constraints.isLoading || constraints.hasError) return;
		if (!props.uri || !internal.audioSink || !assetHandle) return;

		const timeline = getTimeline();
		if (!timeline) return;

		const fps = getTimelineFps();
		const clipStartSeconds = framesToSeconds(timeline.start ?? 0, fps);
		const clipEndSeconds = framesToSeconds(timeline.end ?? 0, fps);
		if (
			timelineTimeSeconds < clipStartSeconds ||
			timelineTimeSeconds >= clipEndSeconds
		) {
			stopPlayback();
			return;
		}

		const backJumpSeconds = PLAYBACK_BACK_JUMP_FRAMES / fps;
		if (!isPlaybackActive) {
			await startPlayback(timelineTimeSeconds);
			lastPlaybackTargetTime = timelineTimeSeconds;
			return;
		}

		const context = getAudioContext();
		if (
			!context ||
			playbackStartAudioTime === null ||
			playbackStartContextTime === null
		) {
			stopPlayback();
			await startPlayback(timelineTimeSeconds);
			lastPlaybackTargetTime = timelineTimeSeconds;
			return;
		}

		if (
			lastPlaybackTargetTime !== null &&
			timelineTimeSeconds < lastPlaybackTargetTime - backJumpSeconds
		) {
			stopPlayback();
			await startPlayback(timelineTimeSeconds);
			lastPlaybackTargetTime = timelineTimeSeconds;
			return;
		}

		const offsetSeconds = framesToSeconds(getTimelineOffsetFrames(), fps);
		const audioTargetTime =
			offsetSeconds + Math.max(0, timelineTimeSeconds - clipStartSeconds);
		const audioNow =
			playbackStartAudioTime + (context.currentTime - playbackStartContextTime);
		if (Math.abs(audioNow - audioTargetTime) > 0.2) {
			stopPlayback();
			await startPlayback(timelineTimeSeconds);
			lastPlaybackTargetTime = timelineTimeSeconds;
			return;
		}

		lastPlaybackTargetTime = timelineTimeSeconds;
	};

	const store = createStore<
		ComponentModel<AudioClipProps, AudioClipInternal>
	>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: "AudioClip",
			props: initialProps,
			constraints: {
				isLoading: true,
				canTrimStart: true,
				canTrimEnd: true,
			},
			internal: {
				audioSink: null,
				input: null,
				audioDuration: 0,
				isReady: false,
				playbackEpoch: 0,
				stepPlayback,
				stopPlayback,
			} satisfies AudioClipInternal,

			setProps: (partial) => {
				const result = get().validate(partial);
				if (result.valid) {
					set((state) => ({
						...state,
						props: { ...state.props, ...partial },
					}));
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

			validate: (_newProps): ValidationResult => {
				return { valid: true, errors: [] };
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
				asyncId += 1;
				let localHandle: AssetHandle<AudioAsset> | null = null;

				try {
					localHandle = await acquireAudioAsset(uri);
					if (currentInitEpoch !== initEpoch) {
						localHandle.release();
						return;
					}

					assetHandle?.release();
					assetHandle = localHandle;

					const { asset } = localHandle;
					const fps = getTimelineFps();
					const offsetFrames = getTimelineOffsetFrames();
					const availableDuration = computeAvailableDurationFrames(
						asset.duration,
						offsetFrames,
					);

					const audioSink = asset.createAudioSink();

					set((state) => ({
						constraints: {
							...state.constraints,
							isLoading: false,
							maxDuration: availableDuration,
						},
						internal: {
							...state.internal,
							audioSink,
							input: asset.input,
							audioDuration: asset.duration,
							isReady: true,
						},
					}));

					if (!unsubscribeTimelineOffset) {
						unsubscribeTimelineOffset = useTimelineStore.subscribe(
							(state) => state.getElementById(id)?.timeline?.offset ?? 0,
							() => {
								const duration = assetHandle?.asset.duration ?? 0;
								const offset = getTimelineOffsetFrames();
								const maxDuration = computeAvailableDurationFrames(
									duration,
									offset,
								);
								if (maxDuration === undefined) return;
								store.setState((state) => ({
									constraints: {
										...state.constraints,
										maxDuration,
									},
								}));
							},
						);
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
				initEpoch += 1;
				asyncId += 1;

				stopPlayback();
				if (clipGain) {
					try {
						clipGain.disconnect();
					} catch {}
					clipGain = null;
				}

				unsubscribeTimelineOffset?.();
				unsubscribeTimelineOffset = null;

				assetHandle?.release();
				assetHandle = null;

				set((state) => ({
					internal: { ...state.internal, audioSink: null, input: null },
				}));
			},
		})),
	);

	return store;
}
