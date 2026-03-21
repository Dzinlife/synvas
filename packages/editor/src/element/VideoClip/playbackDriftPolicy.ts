export interface PlaybackDriftPolicyInput {
	isPlaying: boolean;
	targetTime: number;
	renderedTime: number | null;
	timelineFrameInterval: number;
	observedFrameInterval: number | null;
	stalledDurationSeconds: number | null;
	driftFloorSeconds?: number;
	adaptiveMultiplier?: number;
}

const DEFAULT_DRIFT_FLOOR_SECONDS = 1.0;
const DEFAULT_ADAPTIVE_MULTIPLIER = 2;

const isPositiveFinite = (value: number | null | undefined): value is number => {
	return Number.isFinite(value) && (value as number) > 0;
};

const isFiniteNumber = (value: number | null | undefined): value is number => {
	return Number.isFinite(value);
};

const isNonNegativeFinite = (
	value: number | null | undefined,
): value is number => {
	return Number.isFinite(value) && (value as number) >= 0;
};

export const shouldSeekAfterStepPlayback = (
	input: PlaybackDriftPolicyInput,
): boolean => {
	const {
		isPlaying,
		targetTime,
		renderedTime,
		timelineFrameInterval,
		observedFrameInterval,
		stalledDurationSeconds,
		driftFloorSeconds,
		adaptiveMultiplier,
	} = input;
	if (!Number.isFinite(targetTime)) return false;
	const safeTimelineFrameInterval = isPositiveFinite(timelineFrameInterval)
		? timelineFrameInterval
		: 1 / 30;

	if (!isPlaying) {
		if (!isFiniteNumber(renderedTime)) return true;
		const safeRenderedTime = renderedTime;
		return safeRenderedTime < targetTime - safeTimelineFrameInterval * 0.5;
	}

	if (!isFiniteNumber(renderedTime)) return false;
	const safeRenderedTime = renderedTime;
	if (!isPositiveFinite(observedFrameInterval)) return false;
	if (!isNonNegativeFinite(stalledDurationSeconds)) return false;

	const safeDriftFloor = isPositiveFinite(driftFloorSeconds)
		? driftFloorSeconds
		: DEFAULT_DRIFT_FLOOR_SECONDS;
	const safeAdaptiveMultiplier = isPositiveFinite(adaptiveMultiplier)
		? adaptiveMultiplier
		: DEFAULT_ADAPTIVE_MULTIPLIER;
	const adaptiveThresholdSeconds = Math.max(
		safeDriftFloor,
		observedFrameInterval * safeAdaptiveMultiplier,
	);
	const driftSeconds = targetTime - safeRenderedTime;

	return (
		driftSeconds > adaptiveThresholdSeconds &&
		stalledDurationSeconds > adaptiveThresholdSeconds
	);
};
