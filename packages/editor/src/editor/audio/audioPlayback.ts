import type { TimelineMeta } from "core/dsl/types";
import type { AudioBufferSink, WrappedAudioBuffer } from "mediabunny";
import {
	createClipGain,
	ensureAudioContext,
	getAudioContext,
} from "@/editor/audio/audioEngine";
import { framesToSeconds } from "@/utils/timecode";

type AudioPlaybackState = {
	isLoading?: boolean;
	hasError?: boolean;
	uri?: string;
	audioSink: AudioBufferSink | null;
	audioDuration: number;
};

type AudioPlaybackDeps = {
	getTimeline: () => TimelineMeta | undefined;
	getFps: () => number;
	getState: () => AudioPlaybackState;
	isPlaybackEnabled?: () => boolean;
	getRuntimeKey?: () => string;
	getSeekEpoch?: () => number;
};

export type AudioPlaybackRange = {
	start: number;
	end: number;
};

export type AudioPlaybackMixInstruction = {
	timelineTimeSeconds: number;
	gain?: number;
	activeWindow?: AudioPlaybackRange;
	sourceTime?: number;
	sourceRange?: AudioPlaybackRange;
	reversed?: boolean;
};

export type AudioPlaybackStepInput = number | AudioPlaybackMixInstruction;

export type AudioPlaybackController = {
	stepPlayback: (input: AudioPlaybackStepInput) => Promise<void>;
	setGain: (gain: number) => void;
	stopPlayback: () => void;
	dispose: () => void;
};

const DEFAULT_FPS = 30;
const PLAYBACK_BACK_JUMP_FRAMES = 3;
const PLAYBACK_LOOKAHEAD_SECONDS = 2;
const PLAYBACK_LOOKAHEAD_POLL_MS = 120;
const DEFAULT_GAIN = 1;
const GAIN_RAMP_SECONDS = 0.02;
const SOURCE_STOP_FADE_OUT_SECONDS = 0.008;
const SOURCE_SEEK_FADE_OUT_SECONDS = 0.001;
const RUNTIME_IDLE_TTL_MS = 500;
const AUDIO_PLAYBACK_DEBUG_LOCAL_STORAGE_KEY = "ai-nle:audio-playback-debug";
const SAMPLE_RATE_MISMATCH_EPSILON = 1;

const isAudioPlaybackDebugEnabled = (): boolean => {
	if (typeof window === "undefined") return false;
	const globalFlag = (
		window as Window & {
			__AI_NLE_AUDIO_PLAYBACK_DEBUG__?: boolean;
		}
	).__AI_NLE_AUDIO_PLAYBACK_DEBUG__;
	if (globalFlag === true) return true;
	try {
		return window.localStorage.getItem(AUDIO_PLAYBACK_DEBUG_LOCAL_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
};

const logAudioPlaybackDebug = (
	event: string,
	payload: Record<string, unknown>,
) => {
	if (!isAudioPlaybackDebugEnabled()) return;
	console.info("[AudioPlaybackDebug]", event, payload);
};

type ResolvedPlaybackInput = {
	timelineTimeSeconds: number;
	gain: number;
	activeWindow: AudioPlaybackRange;
	sourceTime: number;
	sourceRange: AudioPlaybackRange;
	reversed: boolean;
};

type ScheduledAudioSource = {
	source: AudioBufferSourceNode;
	gainNode: GainNode | null;
};

type AudioPlaybackRuntime = {
	key: string;
	refCount: number;
	idleDisposalTimer: ReturnType<typeof setTimeout> | null;
	asyncId: number;
	playbackIterator: AsyncGenerator<
		WrappedAudioBuffer | null,
		void,
		unknown
	> | null;
	isPlaybackActive: boolean;
	playbackStartContextTime: number | null;
	playbackStartAudioTime: number | null;
	scheduledSources: ScheduledAudioSource[];
	clipGain: GainNode | null;
	playbackDirection: 1 | -1;
	lastPlaybackTargetTime: number | null;
	lastPlaybackSourceTime: number | null;
	lastHandledSeekEpoch: number | null;
	forwardBuffer: AudioBuffer | null;
	forwardBufferSignature: string | null;
	forwardBufferPromise: Promise<AudioBuffer | null> | null;
	reverseBuffer: AudioBuffer | null;
	reverseBufferSignature: string | null;
	reverseBufferPromise: Promise<AudioBuffer | null> | null;
};

const runtimeByKey = new Map<string, AudioPlaybackRuntime>();
let runtimeControllerIdSeed = 0;

const normalizeOffsetFrames = (offset?: number): number => {
	if (!Number.isFinite(offset ?? NaN)) return 0;
	return Math.max(0, Math.round(offset as number));
};

const resolveFps = (getFps: () => number): number => {
	const fps = getFps();
	if (!Number.isFinite(fps) || fps <= 0) return DEFAULT_FPS;
	return Math.round(fps);
};

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

const clampRange = (
	range: AudioPlaybackRange,
	minValue: number,
	maxValue: number,
): AudioPlaybackRange => {
	const start = Math.min(
		maxValue,
		Math.max(minValue, Number.isFinite(range.start) ? range.start : minValue),
	);
	const end = Math.min(
		maxValue,
		Math.max(start, Number.isFinite(range.end) ? range.end : maxValue),
	);
	return { start, end };
};

const clampValue = (value: number, start: number, end: number): number => {
	if (!Number.isFinite(value)) return start;
	return Math.min(end, Math.max(start, value));
};

const normalizeGain = (value: number | undefined): number => {
	if (!Number.isFinite(value)) return DEFAULT_GAIN;
	return Math.max(0, value ?? DEFAULT_GAIN);
};

const normalizeSeekEpoch = (value: number | undefined): number | null => {
	if (!Number.isFinite(value)) return null;
	return Math.round(value as number);
};

const createRuntime = (key: string): AudioPlaybackRuntime => ({
	key,
	refCount: 0,
	idleDisposalTimer: null,
	asyncId: 0,
	playbackIterator: null,
	isPlaybackActive: false,
	playbackStartContextTime: null,
	playbackStartAudioTime: null,
	scheduledSources: [],
	clipGain: null,
	playbackDirection: 1,
	lastPlaybackTargetTime: null,
	lastPlaybackSourceTime: null,
	lastHandledSeekEpoch: null,
	forwardBuffer: null,
	forwardBufferSignature: null,
	forwardBufferPromise: null,
	reverseBuffer: null,
	reverseBufferSignature: null,
	reverseBufferPromise: null,
});

const disconnectScheduledSource = (scheduled: ScheduledAudioSource) => {
	try {
		scheduled.source.disconnect();
	} catch {}
	if (!scheduled.gainNode) return;
	try {
		scheduled.gainNode.disconnect();
	} catch {}
};

const stopRuntimeScheduledSources = (
	runtime: AudioPlaybackRuntime,
	options?: {
		fadeOutSeconds?: number;
	},
) => {
	if (runtime.scheduledSources.length === 0) return;
	const context = getAudioContext();
	const fadeOutSeconds = Math.max(0, options?.fadeOutSeconds ?? 0);
	const now = context?.currentTime ?? 0;
	const scheduledSources = runtime.scheduledSources;
	runtime.scheduledSources = [];

	for (const scheduled of scheduledSources) {
		scheduled.source.onended = () => {
			disconnectScheduledSource(scheduled);
		};
		try {
			if (context && fadeOutSeconds > 0 && scheduled.gainNode) {
				scheduled.gainNode.gain.cancelScheduledValues(now);
				scheduled.gainNode.gain.setValueAtTime(
					scheduled.gainNode.gain.value,
					now,
				);
				scheduled.gainNode.gain.linearRampToValueAtTime(
					0,
					now + fadeOutSeconds,
				);
				scheduled.source.stop(now + fadeOutSeconds);
			} else {
				scheduled.source.stop();
			}
		} catch {
			disconnectScheduledSource(scheduled);
		}
		if (!context || fadeOutSeconds <= 0) {
			disconnectScheduledSource(scheduled);
		}
	}
};

const stopRuntimePlayback = (
	runtime: AudioPlaybackRuntime,
	options?: {
		fadeOutSeconds?: number;
	},
) => {
	runtime.asyncId += 1;
	runtime.isPlaybackActive = false;
	runtime.playbackStartContextTime = null;
	runtime.playbackStartAudioTime = null;
	runtime.playbackDirection = 1;
	runtime.lastPlaybackTargetTime = null;
	runtime.lastPlaybackSourceTime = null;
	runtime.playbackIterator?.return?.();
	runtime.playbackIterator = null;
	stopRuntimeScheduledSources(runtime, options);
};

const disposeRuntime = (runtime: AudioPlaybackRuntime) => {
	if (runtime.idleDisposalTimer) {
		clearTimeout(runtime.idleDisposalTimer);
		runtime.idleDisposalTimer = null;
	}
	stopRuntimePlayback(runtime, { fadeOutSeconds: 0 });
	runtime.forwardBuffer = null;
	runtime.forwardBufferSignature = null;
	runtime.forwardBufferPromise = null;
	runtime.reverseBuffer = null;
	runtime.reverseBufferSignature = null;
	runtime.reverseBufferPromise = null;
	if (runtime.clipGain) {
		try {
			runtime.clipGain.disconnect();
		} catch {}
		runtime.clipGain = null;
	}
	runtimeByKey.delete(runtime.key);
};

const getOrCreateRuntime = (key: string): AudioPlaybackRuntime => {
	const existing = runtimeByKey.get(key);
	if (existing) {
		if (existing.idleDisposalTimer) {
			clearTimeout(existing.idleDisposalTimer);
			existing.idleDisposalTimer = null;
		}
		return existing;
	}
	const runtime = createRuntime(key);
	runtimeByKey.set(key, runtime);
	return runtime;
};

const retainRuntime = (key: string): AudioPlaybackRuntime => {
	const runtime = getOrCreateRuntime(key);
	runtime.refCount += 1;
	return runtime;
};

const releaseRuntime = (
	key: string,
	options?: {
		stopWhenOrphaned?: boolean;
	},
) => {
	const runtime = runtimeByKey.get(key);
	if (!runtime) return;
	runtime.refCount = Math.max(0, runtime.refCount - 1);
	if (runtime.refCount > 0) return;
	if (options?.stopWhenOrphaned) {
		stopRuntimePlayback(runtime);
	}
	if (runtime.idleDisposalTimer) {
		clearTimeout(runtime.idleDisposalTimer);
	}
	runtime.idleDisposalTimer = setTimeout(() => {
		const latestRuntime = runtimeByKey.get(key);
		if (!latestRuntime) return;
		if (latestRuntime.refCount > 0) return;
		disposeRuntime(latestRuntime);
	}, RUNTIME_IDLE_TTL_MS);
};

const ensureRuntimeGainNode = (
	runtime: AudioPlaybackRuntime,
): GainNode | null => {
	if (runtime.clipGain) return runtime.clipGain;
	runtime.clipGain = createClipGain();
	return runtime.clipGain;
};

const resolveRuntimeKeyValue = (
	deps: AudioPlaybackDeps,
	fallback: string,
): string => {
	const key = deps.getRuntimeKey?.();
	if (!key || typeof key !== "string") return fallback;
	return key;
};

const resolvePlaybackInput = (
	input: AudioPlaybackStepInput,
	timeline: TimelineMeta,
	fps: number,
	audioDuration: number,
): ResolvedPlaybackInput => {
	const timelineTimeSeconds =
		typeof input === "number" ? input : input.timelineTimeSeconds;
	const clipStartSeconds = framesToSeconds(timeline.start ?? 0, fps);
	const clipEndSeconds = framesToSeconds(timeline.end ?? 0, fps);
	const clipDurationSeconds = Math.max(0, clipEndSeconds - clipStartSeconds);
	const offsetSeconds = framesToSeconds(
		normalizeOffsetFrames(timeline.offset),
		fps,
	);

	const fallbackSourceRange = clampRange(
		{
			start: offsetSeconds,
			end: offsetSeconds + clipDurationSeconds,
		},
		0,
		audioDuration,
	);
	const sourceRange =
		typeof input === "number"
			? fallbackSourceRange
			: clampRange(input.sourceRange ?? fallbackSourceRange, 0, audioDuration);
	const activeWindow =
		typeof input === "number"
			? { start: clipStartSeconds, end: clipEndSeconds }
			: (() => {
					const { activeWindow: inputWindow } = input;
					const startCandidate = inputWindow?.start;
					const start =
						typeof startCandidate === "number" &&
						Number.isFinite(startCandidate)
							? startCandidate
							: clipStartSeconds;
					const endCandidate = inputWindow?.end;
					const end =
						typeof endCandidate === "number" && Number.isFinite(endCandidate)
							? endCandidate
							: clipEndSeconds;
					return { start, end: Math.max(start, end) };
				})();

	const fallbackSourceTime =
		offsetSeconds + Math.max(0, timelineTimeSeconds - clipStartSeconds);
	const sourceTime = clampValue(
		typeof input === "number"
			? fallbackSourceTime
			: (input.sourceTime ?? fallbackSourceTime),
		sourceRange.start,
		sourceRange.end,
	);

	return {
		timelineTimeSeconds,
		gain: typeof input === "number" ? DEFAULT_GAIN : normalizeGain(input.gain),
		activeWindow,
		sourceTime,
		sourceRange,
		reversed: typeof input === "number" ? false : Boolean(input.reversed),
	};
};

export const createAudioPlaybackController = (
	deps: AudioPlaybackDeps,
): AudioPlaybackController => {
	runtimeControllerIdSeed += 1;
	const fallbackRuntimeKey = `controller:${runtimeControllerIdSeed}`;
	let activeRuntimeKey = resolveRuntimeKeyValue(deps, fallbackRuntimeKey);
	retainRuntime(activeRuntimeKey);

	const isPlaybackEnabled = () => deps.isPlaybackEnabled?.() ?? true;
	const stopRuntimeByReason = (
		runtime: AudioPlaybackRuntime,
		reason: "default" | "seek",
	) => {
		stopRuntimePlayback(runtime, {
			fadeOutSeconds:
				reason === "seek"
					? SOURCE_SEEK_FADE_OUT_SECONDS
					: SOURCE_STOP_FADE_OUT_SECONDS,
		});
	};

	const syncRuntime = (): AudioPlaybackRuntime => {
		const resolvedKey = resolveRuntimeKeyValue(deps, fallbackRuntimeKey);
		if (resolvedKey !== activeRuntimeKey) {
			retainRuntime(resolvedKey);
			releaseRuntime(activeRuntimeKey);
			activeRuntimeKey = resolvedKey;
		}
		return getOrCreateRuntime(activeRuntimeKey);
	};

	const setGainInternal = (
		runtime: AudioPlaybackRuntime,
		gainValue: number,
		contextOverride?: AudioContext | null,
	) => {
		const gainNode = ensureRuntimeGainNode(runtime);
		if (!gainNode) return;
		const context = contextOverride ?? getAudioContext();
		if (!context) return;

		const safeGain = normalizeGain(gainValue);
		const now = context.currentTime;
		try {
			gainNode.gain.cancelScheduledValues(now);
			gainNode.gain.setValueAtTime(gainNode.gain.value, now);
			gainNode.gain.linearRampToValueAtTime(safeGain, now + GAIN_RAMP_SECONDS);
			} catch {
				gainNode.gain.value = safeGain;
				}
			};

	const isSampleRateMismatched = (
		sourceSampleRate: number,
		contextSampleRate: number,
	): boolean => {
		if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) return false;
		if (!Number.isFinite(contextSampleRate) || contextSampleRate <= 0) return false;
		return (
			Math.abs(sourceSampleRate - contextSampleRate) >
			SAMPLE_RATE_MISMATCH_EPSILON
		);
	};

	const buildRuntimeForwardBuffer = async ({
		audioSink,
		audioDuration,
		context,
	}: {
		audioSink: AudioBufferSink;
		audioDuration: number;
		context: AudioContext;
	}): Promise<AudioBuffer | null> => {
		const safeDuration = Number.isFinite(audioDuration)
			? Math.max(0, audioDuration)
			: 0;
		if (safeDuration <= 0) return null;

		const chunks: WrappedAudioBuffer[] = [];
		let sampleRate = 0;
		let numberOfChannels = 0;
		for await (const wrapped of audioSink.buffers(0, safeDuration)) {
			const buffer = wrapped?.buffer;
			if (!buffer) continue;
			chunks.push(wrapped);
			if (!sampleRate) {
				sampleRate = buffer.sampleRate;
			}
			numberOfChannels = Math.max(numberOfChannels, buffer.numberOfChannels);
		}
		if (chunks.length === 0 || sampleRate <= 0 || numberOfChannels <= 0) {
			return null;
		}

		const totalFrames = Math.max(1, Math.round(safeDuration * sampleRate));
		const forwardChannels = Array.from(
			{ length: numberOfChannels },
			() => new Float32Array(totalFrames),
		);
		for (const wrapped of chunks) {
			const buffer = wrapped.buffer;
			if (!buffer) continue;
			const chunkSampleRate = buffer.sampleRate;
			const chunkChannels = buffer.numberOfChannels;
			if (chunkChannels <= 0 || chunkSampleRate <= 0) continue;

			const normalizedTimestamp = Number.isFinite(wrapped.timestamp)
				? Math.max(0, wrapped.timestamp)
				: 0;
			if (chunkSampleRate === sampleRate) {
				const startFrame = Math.max(
					0,
					Math.round(normalizedTimestamp * sampleRate),
				);
				const availableFrames = Math.max(0, totalFrames - startFrame);
				if (availableFrames <= 0) continue;
				const copyFrames = Math.min(buffer.length, availableFrames);
				if (copyFrames <= 0) continue;
				for (let channel = 0; channel < numberOfChannels; channel += 1) {
					const sourceChannel = Math.min(channel, chunkChannels - 1);
					if (sourceChannel < 0) continue;
					const sourceData = buffer.getChannelData(sourceChannel);
					forwardChannels[channel]?.set(
						sourceData.subarray(0, copyFrames),
						startFrame,
					);
				}
				continue;
			}

			const chunkDurationSeconds = buffer.length / chunkSampleRate;
			const chunkEndTime = normalizedTimestamp + chunkDurationSeconds;
			if (chunkEndTime <= 0 || normalizedTimestamp >= safeDuration) {
				continue;
			}
			const writeStartTime = Math.max(0, normalizedTimestamp);
			const writeEndTime = Math.min(safeDuration, chunkEndTime);
			const writeStartIndex = Math.max(
				0,
				Math.floor((writeStartTime - normalizedTimestamp) * chunkSampleRate),
			);
			const writeEndIndex = Math.min(
				buffer.length,
				Math.ceil((writeEndTime - normalizedTimestamp) * chunkSampleRate),
			);
			for (let sourceIndex = writeStartIndex; sourceIndex < writeEndIndex; sourceIndex += 1) {
				const time = normalizedTimestamp + sourceIndex / chunkSampleRate;
				const destinationIndex = Math.round(time * sampleRate);
				if (destinationIndex < 0 || destinationIndex >= totalFrames) continue;
				for (let channel = 0; channel < numberOfChannels; channel += 1) {
					const sourceChannel = Math.min(channel, chunkChannels - 1);
					if (sourceChannel < 0) continue;
					forwardChannels[channel][destinationIndex] =
						buffer.getChannelData(sourceChannel)[sourceIndex] ?? 0;
				}
			}
		}

		const forwardBuffer = context.createBuffer(
			numberOfChannels,
			totalFrames,
			sampleRate,
		);
		for (let channel = 0; channel < numberOfChannels; channel += 1) {
			const sourceData = forwardChannels[channel];
			const targetData = forwardBuffer.getChannelData(channel);
			targetData.set(sourceData);
		}
		return forwardBuffer;
	};

	const buildRuntimeReverseBufferFromForward = ({
		forwardBuffer,
		context,
	}: {
		forwardBuffer: AudioBuffer;
		context: AudioContext;
	}): AudioBuffer => {
		const reversedBuffer = context.createBuffer(
			forwardBuffer.numberOfChannels,
			forwardBuffer.length,
			forwardBuffer.sampleRate,
		);
		for (let channel = 0; channel < forwardBuffer.numberOfChannels; channel += 1) {
			const sourceData = forwardBuffer.getChannelData(channel);
			const targetData = reversedBuffer.getChannelData(channel);
			for (let i = 0; i < forwardBuffer.length; i += 1) {
				targetData[i] = sourceData[forwardBuffer.length - 1 - i] ?? 0;
			}
		}
		return reversedBuffer;
	};

	const ensureRuntimeForwardBuffer = async ({
		runtime,
		audioSink,
		audioDuration,
		context,
		uri,
	}: {
		runtime: AudioPlaybackRuntime;
		audioSink: AudioBufferSink;
		audioDuration: number;
		context: AudioContext;
		uri: string;
	}): Promise<AudioBuffer | null> => {
		const signature = `${uri}|${audioDuration}`;
		if (
			runtime.forwardBuffer &&
			runtime.forwardBufferSignature === signature
		) {
			return runtime.forwardBuffer;
		}
		if (
			runtime.forwardBufferPromise &&
			runtime.forwardBufferSignature === signature
		) {
			return runtime.forwardBufferPromise;
		}

		runtime.forwardBuffer = null;
		runtime.forwardBufferSignature = signature;
		if (runtime.reverseBufferSignature !== signature) {
			runtime.reverseBuffer = null;
			runtime.reverseBufferSignature = null;
			runtime.reverseBufferPromise = null;
		}

		const buildingPromise = buildRuntimeForwardBuffer({
			audioSink,
			audioDuration,
			context,
		});
		runtime.forwardBufferPromise = buildingPromise;
		try {
			const forward = await buildingPromise;
			if (runtime.forwardBufferSignature !== signature) return null;
			runtime.forwardBuffer = forward;
			return forward;
		} finally {
			if (runtime.forwardBufferSignature === signature) {
				runtime.forwardBufferPromise = null;
			}
		}
	};

	const ensureRuntimeReverseBuffer = async ({
		runtime,
		audioSink,
		audioDuration,
		context,
		uri,
	}: {
		runtime: AudioPlaybackRuntime;
		audioSink: AudioBufferSink;
		audioDuration: number;
		context: AudioContext;
		uri: string;
	}): Promise<AudioBuffer | null> => {
		const signature = `${uri}|${audioDuration}`;
		if (
			runtime.reverseBuffer &&
			runtime.reverseBufferSignature === signature
		) {
			return runtime.reverseBuffer;
		}
		if (
			runtime.reverseBufferPromise &&
			runtime.reverseBufferSignature === signature
		) {
			return runtime.reverseBufferPromise;
		}

		runtime.reverseBuffer = null;
		runtime.reverseBufferSignature = signature;
		const buildingPromise = (async () => {
			const forwardBuffer = await ensureRuntimeForwardBuffer({
				runtime,
				audioSink,
				audioDuration,
				context,
				uri,
			});
			if (!forwardBuffer) return null;
			return buildRuntimeReverseBufferFromForward({
				forwardBuffer,
				context,
			});
		})();
		runtime.reverseBufferPromise = buildingPromise;
		try {
			const reversed = await buildingPromise;
			if (runtime.reverseBufferSignature !== signature) return null;
			runtime.reverseBuffer = reversed;
			return reversed;
		} finally {
			if (runtime.reverseBufferSignature === signature) {
				runtime.reverseBufferPromise = null;
			}
		}
	};

	const schedulePlayback = async (
		runtime: AudioPlaybackRuntime,
		iterator: AsyncGenerator<WrappedAudioBuffer | null, void, unknown>,
		currentAsyncId: number,
	) => {
		let chunkIndex = 0;
		try {
			for await (const wrapped of iterator) {
				chunkIndex += 1;
				if (currentAsyncId !== runtime.asyncId) return;
				if (!wrapped?.buffer) continue;
				const context = getAudioContext();
				if (!context) return;
				if (!runtime.clipGain) return;
				if (
					runtime.playbackStartContextTime === null ||
					runtime.playbackStartAudioTime === null
				) {
					return;
				}
				const targetStart =
					runtime.playbackStartContextTime +
					(wrapped.timestamp - runtime.playbackStartAudioTime);
				logAudioPlaybackDebug("chunk-received", {
					runtimeKey: runtime.key,
					asyncId: currentAsyncId,
					chunkIndex,
					chunkTimestamp: wrapped.timestamp,
					chunkDuration: wrapped.duration,
					bufferDuration: wrapped.buffer.duration,
					targetStart,
					contextTime: context.currentTime,
				});

				let waitGuard = 20;
				while (
					currentAsyncId === runtime.asyncId &&
					targetStart - context.currentTime > PLAYBACK_LOOKAHEAD_SECONDS &&
					waitGuard > 0
				) {
					waitGuard -= 1;
					await sleep(PLAYBACK_LOOKAHEAD_POLL_MS);
				}
				if (currentAsyncId !== runtime.asyncId) return;
				if (targetStart + 0.02 < context.currentTime) {
					logAudioPlaybackDebug("chunk-dropped-late", {
						runtimeKey: runtime.key,
						asyncId: currentAsyncId,
						chunkIndex,
						targetStart,
						contextTime: context.currentTime,
						lateBySeconds: context.currentTime - targetStart,
					});
					continue;
				}

				const source = context.createBufferSource();
				const sourceGain =
					typeof context.createGain === "function"
						? context.createGain()
						: null;
				source.buffer = wrapped.buffer;
				if (sourceGain) {
					sourceGain.gain.value = 1;
					source.connect(sourceGain);
					sourceGain.connect(runtime.clipGain);
				} else {
					source.connect(runtime.clipGain);
				}
				const scheduledSource: ScheduledAudioSource = {
					source,
					gainNode: sourceGain,
				};
				source.onended = () => {
					runtime.scheduledSources = runtime.scheduledSources.filter(
						(item) => item !== scheduledSource,
					);
					disconnectScheduledSource(scheduledSource);
				};
				runtime.scheduledSources.push(scheduledSource);
				source.start(targetStart);
				logAudioPlaybackDebug("source-start", {
					runtimeKey: runtime.key,
					asyncId: currentAsyncId,
					chunkIndex,
					startAt: targetStart,
					startOffset: 0,
					startDuration: wrapped.buffer.duration,
					contextTime: context.currentTime,
					chunkTimestamp: wrapped.timestamp,
					chunkDuration: wrapped.duration,
					bufferDuration: wrapped.buffer.duration,
				});
			}
		} catch (error) {
			if (currentAsyncId === runtime.asyncId) {
				console.warn("音频播放调度失败:", error);
			}
		}
	};

	const startPlayback = async (
		runtime: AudioPlaybackRuntime,
		playbackInput: ResolvedPlaybackInput,
	): Promise<void> => {
		if (!isPlaybackEnabled()) {
			stopRuntimePlayback(runtime, {
				fadeOutSeconds: SOURCE_STOP_FADE_OUT_SECONDS,
			});
			return;
		}
		const { isLoading, hasError, uri, audioSink, audioDuration } =
			deps.getState();
		if (isLoading || hasError) return;
		if (!uri || !audioSink || audioDuration <= 0) return;

		const context = await ensureAudioContext();
		if (!context) return;

		const gainNode = ensureRuntimeGainNode(runtime);
		if (!gainNode) return;
		setGainInternal(runtime, playbackInput.gain, context);

		const timeline = deps.getTimeline();
		if (!timeline) return;

		if (playbackInput.sourceRange.start >= playbackInput.sourceRange.end)
			return;

			const audioStart = clampValue(
				playbackInput.sourceTime,
				playbackInput.sourceRange.start,
				playbackInput.sourceRange.end,
			);
			if (!Number.isFinite(audioStart)) return;

			stopRuntimeScheduledSources(runtime, {
				fadeOutSeconds: SOURCE_STOP_FADE_OUT_SECONDS,
			});
			runtime.playbackIterator?.return?.();
			runtime.playbackIterator = null;

			if (playbackInput.reversed) {
				const reverseBuffer = await ensureRuntimeReverseBuffer({
					runtime,
					audioSink,
					audioDuration,
					context,
					uri,
				});
				if (!reverseBuffer) {
					console.warn("音频倒放缓存构建失败，已停止当前播放。");
					stopRuntimePlayback(runtime, {
						fadeOutSeconds: SOURCE_STOP_FADE_OUT_SECONDS,
					});
					return;
				}

				const frameDuration = 1 / Math.max(1, reverseBuffer.sampleRate);
				const maxOffset = Math.max(0, reverseBuffer.duration - frameDuration);
				const reverseOffset = clampValue(
					audioDuration - audioStart,
					0,
					maxOffset,
				);

				runtime.isPlaybackActive = true;
				runtime.asyncId += 1;
				runtime.playbackStartAudioTime = audioStart;
				runtime.playbackStartContextTime = context.currentTime + 0.05;
				runtime.playbackDirection = -1;

				const source = context.createBufferSource();
				const sourceGain =
					typeof context.createGain === "function"
						? context.createGain()
						: null;
				source.buffer = reverseBuffer;
				if (sourceGain) {
					sourceGain.gain.value = 1;
					source.connect(sourceGain);
					sourceGain.connect(gainNode);
				} else {
					source.connect(gainNode);
				}
				const scheduledSource: ScheduledAudioSource = {
					source,
					gainNode: sourceGain,
				};
				source.onended = () => {
					runtime.scheduledSources = runtime.scheduledSources.filter(
						(item) => item !== scheduledSource,
					);
					disconnectScheduledSource(scheduledSource);
				};
				runtime.scheduledSources.push(scheduledSource);
				source.start(runtime.playbackStartContextTime, reverseOffset);
				return;
			}

			const audioEnd = clampValue(
				audioDuration,
				playbackInput.sourceRange.start,
				audioDuration,
			);
			if (!Number.isFinite(audioEnd)) return;
			if (audioStart >= audioEnd) return;

			let sourceSampleRate = Number.NaN;
			try {
				const firstBuffer = await audioSink.getBuffer(audioStart);
				sourceSampleRate = firstBuffer?.buffer?.sampleRate ?? Number.NaN;
			} catch {}
			if (isSampleRateMismatched(sourceSampleRate, context.sampleRate)) {
				const forwardBuffer = await ensureRuntimeForwardBuffer({
					runtime,
					audioSink,
					audioDuration,
					context,
					uri,
				});
				if (!forwardBuffer) {
					console.warn("音频正放缓存构建失败，已停止当前播放。");
					stopRuntimePlayback(runtime, {
						fadeOutSeconds: SOURCE_STOP_FADE_OUT_SECONDS,
					});
					return;
				}

				const frameDuration = 1 / Math.max(1, forwardBuffer.sampleRate);
				const maxOffset = Math.max(0, forwardBuffer.duration - frameDuration);
				const forwardOffset = clampValue(
					audioStart,
					0,
					maxOffset,
				);

				runtime.isPlaybackActive = true;
				runtime.asyncId += 1;
				runtime.playbackStartAudioTime = forwardOffset;
				runtime.playbackStartContextTime = context.currentTime + 0.05;
				runtime.playbackDirection = 1;

				const source = context.createBufferSource();
				const sourceGain =
					typeof context.createGain === "function"
						? context.createGain()
						: null;
				source.buffer = forwardBuffer;
				if (sourceGain) {
					sourceGain.gain.value = 1;
					source.connect(sourceGain);
					sourceGain.connect(gainNode);
				} else {
					source.connect(gainNode);
				}
				const scheduledSource: ScheduledAudioSource = {
					source,
					gainNode: sourceGain,
				};
				source.onended = () => {
					runtime.scheduledSources = runtime.scheduledSources.filter(
						(item) => item !== scheduledSource,
					);
					disconnectScheduledSource(scheduledSource);
				};
				runtime.scheduledSources.push(scheduledSource);
				source.start(runtime.playbackStartContextTime, forwardOffset);
				logAudioPlaybackDebug("playback-start-forward-linearized", {
					runtimeKey: runtime.key,
					asyncId: runtime.asyncId,
					audioStart,
					audioEnd,
					sourceSampleRate,
					contextSampleRate: context.sampleRate,
					playbackStartContextTime: runtime.playbackStartContextTime,
					contextTime: context.currentTime,
				});
				return;
			}

			runtime.isPlaybackActive = true;
			runtime.asyncId += 1;
			const currentAsyncId = runtime.asyncId;

			runtime.playbackStartAudioTime = audioStart;
			runtime.playbackStartContextTime = context.currentTime + 0.05;
			runtime.playbackDirection = 1;
			runtime.playbackIterator = audioSink.buffers(audioStart, audioEnd);
			logAudioPlaybackDebug("playback-start-forward", {
				runtimeKey: runtime.key,
				asyncId: runtime.asyncId,
				audioStart,
				audioEnd,
				playbackStartContextTime: runtime.playbackStartContextTime,
				contextTime: context.currentTime,
			});

			schedulePlayback(runtime, runtime.playbackIterator, currentAsyncId);
		};

	const stepPlayback = async (input: AudioPlaybackStepInput): Promise<void> => {
		const runtime = syncRuntime();
		const seekEpoch = normalizeSeekEpoch(deps.getSeekEpoch?.());
			const restartPlayback = async (
				playbackInput: ResolvedPlaybackInput,
				timelineTimeSeconds: number,
				reason: "default" | "seek" = "default",
			) => {
				stopRuntimeByReason(runtime, reason);
				await startPlayback(runtime, playbackInput);
				runtime.lastPlaybackTargetTime = timelineTimeSeconds;
				runtime.lastPlaybackSourceTime = playbackInput.sourceTime;
			};
		if (!isPlaybackEnabled()) {
			stopRuntimeByReason(runtime, "default");
			return;
		}

		const timeline = deps.getTimeline();
		if (!timeline) return;
		const fps = resolveFps(deps.getFps);
		const { isLoading, hasError, uri, audioSink } = deps.getState();
		if (isLoading || hasError) return;
		if (!uri || !audioSink) return;

		const { audioDuration } = deps.getState();
		if (!Number.isFinite(audioDuration) || audioDuration <= 0) return;

		const playbackInput = resolvePlaybackInput(
			input,
			timeline,
			fps,
			audioDuration,
		);
		if (!Number.isFinite(playbackInput.timelineTimeSeconds)) return;

		if (playbackInput.activeWindow.start >= playbackInput.activeWindow.end) {
			stopRuntimeByReason(runtime, "default");
			return;
		}
		if (
			playbackInput.timelineTimeSeconds < playbackInput.activeWindow.start ||
			playbackInput.timelineTimeSeconds >= playbackInput.activeWindow.end
		) {
			stopRuntimeByReason(runtime, "default");
			return;
		}

		setGainInternal(runtime, playbackInput.gain);

			const backJumpSeconds = PLAYBACK_BACK_JUMP_FRAMES / fps;
			const expectedDirection = playbackInput.reversed ? -1 : 1;
			if (!runtime.isPlaybackActive) {
				await startPlayback(runtime, playbackInput);
				if (seekEpoch !== null) runtime.lastHandledSeekEpoch = seekEpoch;
				runtime.lastPlaybackTargetTime = playbackInput.timelineTimeSeconds;
				runtime.lastPlaybackSourceTime = playbackInput.sourceTime;
				runtime.playbackDirection = expectedDirection;
				return;
			}
			if (runtime.playbackDirection !== expectedDirection) {
				await restartPlayback(playbackInput, playbackInput.timelineTimeSeconds);
				return;
			}

		if (seekEpoch !== null) {
			if (runtime.lastHandledSeekEpoch === null) {
				runtime.lastHandledSeekEpoch = seekEpoch;
			} else if (runtime.lastHandledSeekEpoch !== seekEpoch) {
				runtime.lastHandledSeekEpoch = seekEpoch;
				await restartPlayback(
					playbackInput,
					playbackInput.timelineTimeSeconds,
					"seek",
				);
				return;
			}
		}

		const context = getAudioContext();
		if (
			!context ||
			runtime.playbackStartAudioTime === null ||
			runtime.playbackStartContextTime === null
		) {
			await restartPlayback(playbackInput, playbackInput.timelineTimeSeconds);
			return;
		}

			if (runtime.lastPlaybackTargetTime !== null) {
				if (
					expectedDirection === 1 &&
					playbackInput.timelineTimeSeconds <
						runtime.lastPlaybackTargetTime - backJumpSeconds
				) {
					await restartPlayback(playbackInput, playbackInput.timelineTimeSeconds);
					return;
				}
				if (
					expectedDirection === -1 &&
					runtime.lastPlaybackSourceTime !== null &&
					playbackInput.sourceTime >
						runtime.lastPlaybackSourceTime + backJumpSeconds
				) {
					await restartPlayback(playbackInput, playbackInput.timelineTimeSeconds);
					return;
				}
			}

		const audioTargetTime = clampValue(
			playbackInput.sourceTime,
			playbackInput.sourceRange.start,
			playbackInput.sourceRange.end,
		);
			const audioNow =
				runtime.playbackStartAudioTime +
				runtime.playbackDirection *
					(context.currentTime - runtime.playbackStartContextTime);
			if (Math.abs(audioNow - audioTargetTime) > 0.2) {
				await restartPlayback(playbackInput, playbackInput.timelineTimeSeconds);
				return;
			}

			runtime.lastPlaybackTargetTime = playbackInput.timelineTimeSeconds;
			runtime.lastPlaybackSourceTime = playbackInput.sourceTime;
		};

	const setGain = (gain: number) => {
		const runtime = syncRuntime();
		setGainInternal(runtime, gain);
	};

	const stopPlayback = () => {
		const runtime = syncRuntime();
		stopRuntimeByReason(runtime, "default");
	};

	const dispose = () => {
		releaseRuntime(activeRuntimeKey, { stopWhenOrphaned: true });
	};

	return {
		stepPlayback,
		setGain,
		stopPlayback,
		dispose,
	};
};

export const __resetAudioPlaybackRuntimeForTests = () => {
	for (const runtime of runtimeByKey.values()) {
		disposeRuntime(runtime);
	}
	runtimeByKey.clear();
};
