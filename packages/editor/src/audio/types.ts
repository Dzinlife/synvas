import type { TimelineMeta } from "core/dsl/types";
import type { AudioBufferSink } from "mediabunny";

export type PreviewLoudnessSnapshot = {
	leftRms: number;
	rightRms: number;
	leftPeak: number;
	rightPeak: number;
	updatedAtMs: number;
};

export type AudioPlaybackState = {
	isLoading?: boolean;
	hasError?: boolean;
	uri?: string;
	audioSink: AudioBufferSink | null;
	audioDuration: number;
};

export type AudioPlaybackDeps = {
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
