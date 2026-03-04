import type { TimelineMeta } from "../../element/types";
import { framesToSeconds } from "../../utils/timecode";
import type { ActiveTransitionFrameState } from "../preview/transitionFrameState";

export type TransitionAudioCurve = "equal-power" | "linear";

export type AudioMixInstruction = {
	timelineTimeSeconds: number;
	gain: number;
	activeWindow?: { start: number; end: number };
	sourceTime?: number;
	sourceRange?: { start: number; end: number };
	reversed?: boolean;
};

export type AudioMixClip = {
	id: string;
	timeline: TimelineMeta;
	audioDuration: number;
	enabled: boolean;
	reversed?: boolean;
};

export type TransitionAudioMixPlanInput = {
	displayTimeFrames: number;
	fps: number;
	clips: AudioMixClip[];
	activeTransitions: ActiveTransitionFrameState[];
	transitionCurves?: Record<string, TransitionAudioCurve | undefined>;
};

export type TransitionAudioMixPlan = {
	instructions: Record<string, AudioMixInstruction>;
	activeTransitionIds: string[];
};

type ClipRuntime = {
	id: string;
	start: number;
	end: number;
	offset: number;
	clipDuration: number;
	trimmedStart: number;
	trimmedEnd: number;
	headHandle: number;
	tailHandle: number;
	audioDuration: number;
	reversed: boolean;
};

type TransitionSideMix = {
	gain: number;
	activeWindow: { start: number; end: number };
};

type ClipAccumulator = {
	gain: number;
	activeWindowStart: number;
	activeWindowEnd: number;
	sourceRangeStart: number;
	sourceRangeEnd: number;
};

const EPSILON = 1e-6;
const DEFAULT_CURVE: TransitionAudioCurve = "equal-power";

const clamp = (value: number, minValue: number, maxValue: number) =>
	Math.min(maxValue, Math.max(minValue, value));

const isInRange = (value: number, start: number, end: number): boolean => {
	return value >= start && value < end;
};

const normalizeRange = (start: number, end: number) => {
	const safeStart = Number.isFinite(start) ? start : 0;
	const safeEnd = Number.isFinite(end) ? end : safeStart;
	return {
		start: safeStart,
		end: Math.max(safeStart, safeEnd),
	};
};

const resolveCurveGains = (
	progress: number,
	curve: TransitionAudioCurve,
): { fromGain: number; toGain: number } => {
	const p = clamp(progress, 0, 1);
	if (curve === "linear") {
		return {
			fromGain: 1 - p,
			toGain: p,
		};
	}
	const phase = p * Math.PI * 0.5;
	return {
		fromGain: Math.cos(phase),
		toGain: Math.sin(phase),
	};
};

const buildClipRuntime = (clip: AudioMixClip, fps: number): ClipRuntime => {
	const start = framesToSeconds(clip.timeline.start ?? 0, fps);
	const end = framesToSeconds(clip.timeline.end ?? 0, fps);
	const offset = framesToSeconds(clip.timeline.offset ?? 0, fps);
	const clipDuration = Math.max(0, end - start);
	const rawStart = offset;
	const rawEnd = offset + clipDuration;
	const trimmedStart = clamp(Math.min(rawStart, rawEnd), 0, clip.audioDuration);
	const trimmedEnd = clamp(
		Math.max(rawStart, rawEnd),
		trimmedStart,
		clip.audioDuration,
	);
	const headHandle = Math.max(0, trimmedStart);
	const tailHandle = Math.max(0, clip.audioDuration - trimmedEnd);
	return {
		id: clip.id,
		start,
		end,
		offset,
		clipDuration,
		trimmedStart,
		trimmedEnd,
		headHandle,
		tailHandle,
		audioDuration: clip.audioDuration,
		reversed: Boolean(clip.reversed),
	};
};

const resolveSourceTimeAtTimeline = (
	clip: ClipRuntime,
	timelineTime: number,
): number => {
	const relativeTime = timelineTime - clip.start;
	const sourceTime = clip.reversed
		? clip.offset + clip.clipDuration - relativeTime
		: clip.offset + relativeTime;
	return clamp(sourceTime, 0, clip.audioDuration);
};

const resolveTransitionMix = ({
	currentTime,
	transition,
	from,
	to,
	curve,
	fps,
}: {
	currentTime: number;
	transition: ActiveTransitionFrameState;
	from: ClipRuntime;
	to: ClipRuntime;
	curve: TransitionAudioCurve;
	fps: number;
}): {
	fromMix: TransitionSideMix;
	toMix: TransitionSideMix;
} => {
	const desiredStart = framesToSeconds(transition.start, fps);
	const desiredEnd = framesToSeconds(transition.end, fps);
	const boundary = framesToSeconds(transition.boundary, fps);

	const fromPlayable = normalizeRange(from.start, from.end + from.tailHandle);
	const toPlayable = normalizeRange(to.start - to.headHandle, to.end);

	let overlapStart = Math.max(
		desiredStart,
		fromPlayable.start,
		toPlayable.start,
	);
	let overlapEnd = Math.min(desiredEnd, fromPlayable.end, toPlayable.end);
	if (overlapEnd < overlapStart) {
		overlapEnd = overlapStart;
	}

	let fromGain = 0;
	let toGain = 0;

	if (overlapEnd - overlapStart > EPSILON) {
		if (currentTime < overlapStart) {
			fromGain = 1;
			toGain = 0;
		} else if (currentTime >= overlapEnd) {
			fromGain = 0;
			toGain = 1;
		} else {
			const progress =
				(currentTime - overlapStart) / (overlapEnd - overlapStart);
			const gains = resolveCurveGains(progress, curve);
			fromGain = gains.fromGain;
			toGain = gains.toGain;
		}
	} else {
		const cutTime = clamp(boundary, desiredStart, desiredEnd);
		fromGain = currentTime < cutTime ? 1 : 0;
		toGain = currentTime >= cutTime ? 1 : 0;
		overlapStart = cutTime;
		overlapEnd = cutTime;
	}

	const fromWindow = normalizeRange(
		Math.max(desiredStart, fromPlayable.start),
		Math.min(
			overlapEnd - overlapStart > EPSILON ? overlapEnd : overlapStart,
			fromPlayable.end,
		),
	);
	const toWindow = normalizeRange(
		Math.max(
			overlapEnd - overlapStart > EPSILON ? overlapStart : overlapEnd,
			toPlayable.start,
		),
		Math.min(desiredEnd, toPlayable.end),
	);

	if (!isInRange(currentTime, fromWindow.start, fromWindow.end)) {
		fromGain = 0;
	}
	if (!isInRange(currentTime, toWindow.start, toWindow.end)) {
		toGain = 0;
	}

	return {
		fromMix: {
			gain: clamp(fromGain, 0, 1),
			activeWindow: fromWindow,
		},
		toMix: {
			gain: clamp(toGain, 0, 1),
			activeWindow: toWindow,
		},
	};
};

const resolveSingleSidedTransitionMix = ({
	currentTime,
	transition,
	clip,
	curve,
	fps,
	side,
}: {
	currentTime: number;
	transition: ActiveTransitionFrameState;
	clip: ClipRuntime;
	curve: TransitionAudioCurve;
	fps: number;
	side: "from" | "to";
}): TransitionSideMix => {
	const desiredStart = framesToSeconds(transition.start, fps);
	const desiredEnd = framesToSeconds(transition.end, fps);
	const boundary = framesToSeconds(transition.boundary, fps);

	const playable =
		side === "from"
			? normalizeRange(clip.start, clip.end + clip.tailHandle)
			: normalizeRange(clip.start - clip.headHandle, clip.end);

	let activeStart = Math.max(desiredStart, playable.start);
	let activeEnd = Math.min(desiredEnd, playable.end);
	if (activeEnd < activeStart) {
		activeEnd = activeStart;
	}

	let gain = 0;
	if (activeEnd - activeStart > EPSILON) {
		if (currentTime < activeStart) {
			gain = side === "from" ? 1 : 0;
		} else if (currentTime >= activeEnd) {
			gain = side === "from" ? 0 : 1;
		} else {
			const progress = (currentTime - activeStart) / (activeEnd - activeStart);
			const curveGains = resolveCurveGains(progress, curve);
			gain = side === "from" ? curveGains.fromGain : curveGains.toGain;
		}
	} else {
		const cutTime = clamp(boundary, desiredStart, desiredEnd);
		gain =
			side === "from"
				? currentTime < cutTime
					? 1
					: 0
				: currentTime >= cutTime
					? 1
					: 0;
		activeStart = cutTime;
		activeEnd = cutTime;
	}

	const activeWindow = normalizeRange(activeStart, activeEnd);
	if (!isInRange(currentTime, activeWindow.start, activeWindow.end)) {
		gain = 0;
	}

	return {
		gain: clamp(gain, 0, 1),
		activeWindow,
	};
};

const mergeWindowAndSourceRange = (
	acc: ClipAccumulator,
	clip: ClipRuntime,
	window: { start: number; end: number },
) => {
	const normalizedWindow = normalizeRange(window.start, window.end);
	acc.activeWindowStart = Math.min(
		acc.activeWindowStart,
		normalizedWindow.start,
	);
	acc.activeWindowEnd = Math.max(acc.activeWindowEnd, normalizedWindow.end);

	const sourceStart = resolveSourceTimeAtTimeline(clip, normalizedWindow.start);
	const sourceEnd = resolveSourceTimeAtTimeline(clip, normalizedWindow.end);
	acc.sourceRangeStart = Math.min(acc.sourceRangeStart, sourceStart, sourceEnd);
	acc.sourceRangeEnd = Math.max(acc.sourceRangeEnd, sourceStart, sourceEnd);
};

export const buildTransitionAudioMixPlan = (
	input: TransitionAudioMixPlanInput,
): TransitionAudioMixPlan => {
	const fps = Number.isFinite(input.fps) && input.fps > 0 ? input.fps : 30;
	const currentTime = framesToSeconds(input.displayTimeFrames, fps);
	const clipRuntimeById = new Map<string, ClipRuntime>();
	const accById = new Map<string, ClipAccumulator>();
	const declaredClipIds = new Set<string>();
	const instructions: Record<string, AudioMixInstruction> = {};

	for (const clip of input.clips) {
		declaredClipIds.add(clip.id);
		if (!clip.enabled) continue;
		if (!Number.isFinite(clip.audioDuration) || clip.audioDuration <= 0)
			continue;
		const runtime = buildClipRuntime(clip, fps);
		clipRuntimeById.set(runtime.id, runtime);
		accById.set(runtime.id, {
			gain: 1,
			activeWindowStart: runtime.start,
			activeWindowEnd: runtime.end,
			sourceRangeStart: runtime.trimmedStart,
			sourceRangeEnd: runtime.trimmedEnd,
		});
	}

	for (const transition of input.activeTransitions) {
		const from = clipRuntimeById.get(transition.fromId);
		const to = clipRuntimeById.get(transition.toId);
		const fromDeclared = declaredClipIds.has(transition.fromId);
		const toDeclared = declaredClipIds.has(transition.toId);
		if (!from && !to) continue;

		const curve = input.transitionCurves?.[transition.id] ?? DEFAULT_CURVE;
		if (from && to) {
			const fromAcc = accById.get(from.id);
			const toAcc = accById.get(to.id);
			if (!fromAcc || !toAcc) continue;
			const mix = resolveTransitionMix({
				currentTime,
				transition,
				from,
				to,
				curve,
				fps,
			});
			fromAcc.gain *= mix.fromMix.gain;
			toAcc.gain *= mix.toMix.gain;
			mergeWindowAndSourceRange(fromAcc, from, mix.fromMix.activeWindow);
			mergeWindowAndSourceRange(toAcc, to, mix.toMix.activeWindow);
			continue;
		}

		if (from && !toDeclared) {
			const fromAcc = accById.get(from.id);
			if (!fromAcc) continue;
			const mix = resolveSingleSidedTransitionMix({
				currentTime,
				transition,
				clip: from,
				curve,
				fps,
				side: "from",
			});
			fromAcc.gain *= mix.gain;
			mergeWindowAndSourceRange(fromAcc, from, mix.activeWindow);
			continue;
		}

		if (to && !fromDeclared) {
			const toAcc = accById.get(to.id);
			if (!toAcc) continue;
			const mix = resolveSingleSidedTransitionMix({
				currentTime,
				transition,
				clip: to,
				curve,
				fps,
				side: "to",
			});
			toAcc.gain *= mix.gain;
			mergeWindowAndSourceRange(toAcc, to, mix.activeWindow);
		}
	}

	for (const [id, runtime] of clipRuntimeById.entries()) {
		const acc = accById.get(id);
		if (!acc) continue;
		const window = normalizeRange(acc.activeWindowStart, acc.activeWindowEnd);
		const sourceRange = normalizeRange(
			acc.sourceRangeStart,
			acc.sourceRangeEnd,
		);
		if (!isInRange(currentTime, window.start, window.end)) continue;
		if (sourceRange.end - sourceRange.start <= EPSILON) continue;
		const gain = clamp(acc.gain, 0, 1);
		if (gain <= 0) continue;

		const sourceTime = clamp(
			resolveSourceTimeAtTimeline(runtime, currentTime),
			sourceRange.start,
			sourceRange.end,
		);
		instructions[id] = {
			timelineTimeSeconds: currentTime,
			gain,
			activeWindow: window,
			sourceRange,
			sourceTime,
			reversed: runtime.reversed,
		};
	}

	return {
		instructions,
		activeTransitionIds: input.activeTransitions.map((item) => item.id),
	};
};
