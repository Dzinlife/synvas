import type { AudioBufferSink, WrappedAudioBuffer } from "mediabunny";
import type { TimelineMeta } from "@/dsl/types";
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

export type AudioPlaybackController = {
	stepPlayback: (timelineTimeSeconds: number) => Promise<void>;
	stopPlayback: () => void;
	dispose: () => void;
};

const DEFAULT_FPS = 30;
const PLAYBACK_BACK_JUMP_FRAMES = 3;
const PLAYBACK_LOOKAHEAD_SECONDS = 2;
const PLAYBACK_LOOKAHEAD_POLL_MS = 120;

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

		if (!clipGain) {
			clipGain = createClipGain();
		}
		if (!clipGain) return;

		const timeline = deps.getTimeline();
		if (!timeline) return;

		const fps = resolveFps(deps.getFps);
		const clipStartSeconds = framesToSeconds(timeline.start ?? 0, fps);
		const clipDurationSeconds = framesToSeconds(
			timeline.end - timeline.start,
			fps,
		);
		const offsetSeconds = framesToSeconds(
			normalizeOffsetFrames(timeline.offset),
			fps,
		);
		const safeDurationSeconds = Math.max(
			0,
			Math.min(audioDuration - offsetSeconds, clipDurationSeconds),
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

	const stepPlayback = async (timelineTimeSeconds: number): Promise<void> => {
		if (!isPlaybackEnabled()) {
			stopPlayback();
			return;
		}
		if (!Number.isFinite(timelineTimeSeconds)) return;
		const { isLoading, hasError, uri, audioSink } = deps.getState();
		if (isLoading || hasError) return;
		if (!uri || !audioSink) return;

		const timeline = deps.getTimeline();
		if (!timeline) return;

		const fps = resolveFps(deps.getFps);
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

		const offsetSeconds = framesToSeconds(
			normalizeOffsetFrames(timeline.offset),
			fps,
		);
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
		stopPlayback,
		dispose,
	};
};
