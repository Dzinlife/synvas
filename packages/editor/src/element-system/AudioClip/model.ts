import type { AudioBufferSink, Input } from "mediabunny";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { AssetHandle } from "@/assets/AssetStore";
import { type AudioAsset, acquireAudioAsset } from "@/assets/audioAsset";
import {
	type AudioPlaybackController,
	type AudioPlaybackMixInstruction,
	type AudioPlaybackStepInput,
	createAudioPlaybackController,
} from "@/audio/playback";
import { getAudioPlaybackSessionKey } from "@/scene-editor/playback/clipContinuityIndex";
import type { EditorRuntime } from "@/scene-editor/runtime/types";
import { isTimelineTrackAudible } from "@/scene-editor/utils/trackAudibility";
import { secondsToFrames } from "@/utils/timecode";
import type {
	ComponentModel,
	ComponentModelStore,
	ValidationResult,
} from "../model/types";

export interface AudioClipProps {
	uri?: string;
	reversed?: boolean;
}

export interface AudioClipInternal {
	audioSink: AudioBufferSink | null;
	input: Input | null;
	audioDuration: number;
	isReady: boolean;
	playbackEpoch: number;
	stepPlayback: (input: AudioPlaybackStepInput) => Promise<void>;
	setPlaybackGain: (gain: number) => void;
	applyAudioMix: (
		instruction: AudioPlaybackMixInstruction | null,
	) => Promise<void>;
	stopPlayback: () => void;
}

const DEFAULT_FPS = 30;
const normalizeOffsetFrames = (offset?: number): number => {
	if (!Number.isFinite(offset ?? NaN)) return 0;
	return Math.max(0, Math.round(offset as number));
};

export function createAudioClipModel(
	id: string,
	initialProps: AudioClipProps,
	runtime: EditorRuntime,
): ComponentModelStore<AudioClipProps, AudioClipInternal> {
	const timelineStore = runtime.timelineStore;
	let initEpoch = 0;

	let assetHandle: AssetHandle<AudioAsset> | null = null;
	let unsubscribeTimelineOffset: (() => void) | null = null;
	let audioPlayback: AudioPlaybackController | null = null;

	const getTimelineFps = () => {
		const fps = timelineStore.getState().fps;
		if (!Number.isFinite(fps) || fps <= 0) return DEFAULT_FPS;
		return Math.round(fps);
	};

	const getTimeline = () => {
		return timelineStore.getState().getElementById(id)?.timeline;
	};

	const getTimelineOffsetFrames = (): number => {
		const timeline = getTimeline();
		return normalizeOffsetFrames(timeline?.offset);
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

	const stepPlayback = async (input: AudioPlaybackStepInput): Promise<void> => {
		if (!audioPlayback) return;
		await audioPlayback.stepPlayback(input);
	};

	const setPlaybackGain = (gain: number) => {
		audioPlayback?.setGain(gain);
	};

	const stopPlayback = () => {
		audioPlayback?.stopPlayback();
	};

	const applyAudioMix = async (
		instruction: AudioPlaybackMixInstruction | null,
	): Promise<void> => {
		if (!instruction) {
			stopPlayback();
			return;
		}
		await stepPlayback(instruction);
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
				setPlaybackGain,
				applyAudioMix,
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
						unsubscribeTimelineOffset = timelineStore.subscribe(
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

				stopPlayback();
				audioPlayback?.dispose();

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
