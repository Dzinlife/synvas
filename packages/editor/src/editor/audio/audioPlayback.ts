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

type ResolvedPlaybackInput = {
	timelineTimeSeconds: number;
	gain: number;
	activeWindow: AudioPlaybackRange;
	sourceTime: number;
	sourceRange: AudioPlaybackRange;
};

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

export const createAudioPlaybackController = (
	deps: AudioPlaybackDeps,
): AudioPlaybackController => {
	let asyncId = 0;
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
	const isPlaybackEnabled = () => deps.isPlaybackEnabled?.() ?? true;

	const ensureClipGainNode = (): GainNode | null => {
		if (clipGain) return clipGain;
		clipGain = createClipGain();
		return clipGain;
	};

	const setGainInternal = (
		gainValue: number,
		contextOverride?: AudioContext | null,
	) => {
		const gainNode = ensureClipGainNode();
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
				: clampRange(
						input.sourceRange ?? fallbackSourceRange,
						0,
						audioDuration,
					);
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
			gain:
				typeof input === "number" ? DEFAULT_GAIN : normalizeGain(input.gain),
			activeWindow,
			sourceTime,
			sourceRange,
		};
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

	const startPlayback = async (
		playbackInput: ResolvedPlaybackInput,
	): Promise<void> => {
		if (!isPlaybackEnabled()) {
			stopPlayback();
			return;
		}
		const { isLoading, hasError, uri, audioSink, audioDuration } =
			deps.getState();
		if (isLoading || hasError) return;
		if (!uri || !audioSink || audioDuration <= 0) return;

		const context = await ensureAudioContext();
		if (!context) return;

		const gainNode = ensureClipGainNode();
		if (!gainNode) return;
		setGainInternal(playbackInput.gain, context);

		const timeline = deps.getTimeline();
		if (!timeline) return;

		if (playbackInput.sourceRange.start >= playbackInput.sourceRange.end)
			return;

		const audioStart = clampValue(
			playbackInput.sourceTime,
			playbackInput.sourceRange.start,
			playbackInput.sourceRange.end,
		);
		const audioEnd = clampValue(
			playbackInput.sourceRange.end,
			playbackInput.sourceRange.start,
			audioDuration,
		);

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
		playbackIterator = audioSink.buffers(audioStart, audioEnd);

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

	const stepPlayback = async (input: AudioPlaybackStepInput): Promise<void> => {
		if (!isPlaybackEnabled()) {
			stopPlayback();
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
			stopPlayback();
			return;
		}
		if (
			playbackInput.timelineTimeSeconds < playbackInput.activeWindow.start ||
			playbackInput.timelineTimeSeconds >= playbackInput.activeWindow.end
		) {
			stopPlayback();
			return;
		}

		setGainInternal(playbackInput.gain);

		const backJumpSeconds = PLAYBACK_BACK_JUMP_FRAMES / fps;
		if (!isPlaybackActive) {
			await startPlayback(playbackInput);
			lastPlaybackTargetTime = playbackInput.timelineTimeSeconds;
			return;
		}

		const context = getAudioContext();
		if (
			!context ||
			playbackStartAudioTime === null ||
			playbackStartContextTime === null
		) {
			stopPlayback();
			await startPlayback(playbackInput);
			lastPlaybackTargetTime = playbackInput.timelineTimeSeconds;
			return;
		}

		if (
			lastPlaybackTargetTime !== null &&
			playbackInput.timelineTimeSeconds <
				lastPlaybackTargetTime - backJumpSeconds
		) {
			stopPlayback();
			await startPlayback(playbackInput);
			lastPlaybackTargetTime = playbackInput.timelineTimeSeconds;
			return;
		}

		const audioTargetTime = clampValue(
			playbackInput.sourceTime,
			playbackInput.sourceRange.start,
			playbackInput.sourceRange.end,
		);
		const audioNow =
			playbackStartAudioTime + (context.currentTime - playbackStartContextTime);
		if (Math.abs(audioNow - audioTargetTime) > 0.2) {
			stopPlayback();
			await startPlayback(playbackInput);
			lastPlaybackTargetTime = playbackInput.timelineTimeSeconds;
			return;
		}

		lastPlaybackTargetTime = playbackInput.timelineTimeSeconds;
	};

	const setGain = (gain: number) => {
		setGainInternal(gain);
	};

	const dispose = () => {
		stopPlayback();
		if (clipGain) {
			try {
				clipGain.disconnect();
			} catch {}
			clipGain = null;
		}
	};

	return {
		stepPlayback,
		setGain,
		stopPlayback,
		dispose,
	};
};
