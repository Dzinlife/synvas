export interface PlaybackDriftPolicyInput {
	isPlaying: boolean;
	targetTime: number;
	renderedTime: number | null;
	timelineFrameInterval: number;
	observedFrameInterval: number | null;
	stalledDurationSeconds: number | null;
	driftFloorSeconds?: number;
	adaptiveMultiplier?: number;
	startupGraceSeconds?: number;
	startupDriftMultiplier?: number;
	stallMultiplier?: number;
	stallMinSeconds?: number;
	stallMaxSeconds?: number;
	hardCatchupMultiplier?: number;
}

const DEFAULT_DRIFT_FLOOR_TIMELINE_FRAMES = 2;
const DEFAULT_ADAPTIVE_MULTIPLIER = 1.5;
const DEFAULT_STARTUP_GRACE_SECONDS = 0.2;
const DEFAULT_STARTUP_DRIFT_MULTIPLIER = 3;
const DEFAULT_STALL_MULTIPLIER = 1.25;
const DEFAULT_STALL_MIN_SECONDS = 0.1;
const DEFAULT_STALL_MAX_SECONDS = 0.6;
const DEFAULT_HARD_CATCHUP_MULTIPLIER = 2.5;

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
		startupGraceSeconds,
		startupDriftMultiplier,
		stallMultiplier,
		stallMinSeconds,
		stallMaxSeconds,
		hardCatchupMultiplier,
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
	if (!isNonNegativeFinite(stalledDurationSeconds)) return false;
	const driftSeconds = targetTime - safeRenderedTime;
	if (!Number.isFinite(driftSeconds) || driftSeconds <= 0) return false;

	const safeDriftFloor = isPositiveFinite(driftFloorSeconds)
		? driftFloorSeconds
		: safeTimelineFrameInterval * DEFAULT_DRIFT_FLOOR_TIMELINE_FRAMES;
	const safeAdaptiveMultiplier = isPositiveFinite(adaptiveMultiplier)
		? adaptiveMultiplier
		: DEFAULT_ADAPTIVE_MULTIPLIER;
	const safeStartupGraceSeconds = isPositiveFinite(startupGraceSeconds)
		? startupGraceSeconds
		: DEFAULT_STARTUP_GRACE_SECONDS;
	const safeStartupDriftMultiplier = isPositiveFinite(startupDriftMultiplier)
		? startupDriftMultiplier
		: DEFAULT_STARTUP_DRIFT_MULTIPLIER;
	const safeStallMultiplier = isPositiveFinite(stallMultiplier)
		? stallMultiplier
		: DEFAULT_STALL_MULTIPLIER;
	const safeStallMinSeconds = isPositiveFinite(stallMinSeconds)
		? stallMinSeconds
		: DEFAULT_STALL_MIN_SECONDS;
	const safeStallMaxSeconds = isPositiveFinite(stallMaxSeconds)
		? stallMaxSeconds
		: DEFAULT_STALL_MAX_SECONDS;
	const safeHardCatchupMultiplier = isPositiveFinite(hardCatchupMultiplier)
		? hardCatchupMultiplier
		: DEFAULT_HARD_CATCHUP_MULTIPLIER;

	if (!isPositiveFinite(observedFrameInterval)) {
		// 启动期兜底：观测帧间隔尚未稳定时，使用时间线帧长估算阈值并叠加宽限时间。
		const startupThresholdSeconds = Math.max(
			safeDriftFloor,
			safeTimelineFrameInterval * safeStartupDriftMultiplier,
		);
		return (
			driftSeconds > startupThresholdSeconds &&
			stalledDurationSeconds > safeStartupGraceSeconds
		);
	}

	const adaptiveThresholdSeconds = Math.max(
		safeDriftFloor,
		observedFrameInterval * safeAdaptiveMultiplier,
	);
	const hardCatchupThresholdSeconds =
		adaptiveThresholdSeconds * safeHardCatchupMultiplier;
	// 漂移过大直接进入硬追赶，优先把渲染时间拉回目标时间附近。
	if (driftSeconds > hardCatchupThresholdSeconds) {
		return true;
	}
	// 常规恢复路径：漂移超自适应阈值且持续停滞达到阈值才 seek，抑制正常帧率差异带来的误触发。
	const stallThresholdSeconds = Math.min(
		safeStallMaxSeconds,
		Math.max(
			safeStallMinSeconds,
			adaptiveThresholdSeconds * safeStallMultiplier,
		),
	);

	return (
		driftSeconds > adaptiveThresholdSeconds &&
		stalledDurationSeconds > stallThresholdSeconds
	);
};
