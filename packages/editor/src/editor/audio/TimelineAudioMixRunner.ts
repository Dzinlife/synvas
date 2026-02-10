import type { TimelineElement, TimelineMeta } from "core/dsl/types";
import { chooseSessionInstructionCandidate } from "core/editor/audio/sessionInstructionSelector";
import { resolveTransitionFrameState } from "core/editor/preview/transitionFrameState";
import type { TransitionAudioCurve } from "../../dsl/Transition/model";
import type { TimelineTrack } from "../timeline/types";
import type { AudioTrackControlStateMap } from "../utils/audioTrackState";
import type { AudioMixInstruction } from "./transitionAudioMix";
import { buildTransitionAudioMixPlan } from "./transitionAudioMix";

export type AudioMixTarget = {
	id: string;
	timeline: TimelineMeta;
	audioDuration: number;
	enabled: boolean;
	sessionKey: string;
	applyAudioMix: (
		instruction: AudioMixInstruction | null,
	) => void | Promise<void>;
};

export type RunTimelineAudioMixFrameArgs = {
	isPlaying: boolean;
	isExporting: boolean;
	displayTime: number;
	fps: number;
	elements: TimelineElement[];
	tracks: TimelineTrack[];
	audioTrackStates: AudioTrackControlStateMap;
	targets: Map<string, AudioMixTarget>;
	getTrackIndexForElement?: (element: TimelineElement) => number;
};

const DEFAULT_TRACK_INDEX_RESOLVER = (element: TimelineElement) =>
	element.timeline.trackIndex ?? 0;

const invokeApplyAudioMix = (
	target: AudioMixTarget,
	instruction: AudioMixInstruction | null,
) => {
	const result = target.applyAudioMix(instruction);
	if (result && typeof (result as Promise<void>).then === "function") {
		void result;
	}
};

const resolveTransitionCurve = (
	value: unknown,
): TransitionAudioCurve | undefined => {
	if (value === "equal-power" || value === "linear") {
		return value;
	}
	return undefined;
};

export const runTimelineAudioMixFrame = (
	args: RunTimelineAudioMixFrameArgs,
): Set<string> => {
	const activeIds = new Set<string>();
	const getTrackIndexForElement =
		args.getTrackIndexForElement ?? DEFAULT_TRACK_INDEX_RESOLVER;

	if (!args.isPlaying || args.isExporting) {
		const stoppedSessionKeys = new Set<string>();
		for (const target of args.targets.values()) {
			if (stoppedSessionKeys.has(target.sessionKey)) continue;
			stoppedSessionKeys.add(target.sessionKey);
			invokeApplyAudioMix(target, null);
		}
		return activeIds;
	}

	const transitionFrameState = resolveTransitionFrameState({
		elements: args.elements,
		displayTime: args.displayTime,
		tracks: args.tracks,
		getTrackIndexForElement,
		isTransitionElement: (element) => element.type === "Transition",
	});
	const transitionCurveById: Record<string, TransitionAudioCurve | undefined> =
		{};
	const elementsById = new Map(args.elements.map((el) => [el.id, el] as const));
	for (const transition of transitionFrameState.activeTransitions) {
		const element = elementsById.get(transition.id);
		transitionCurveById[transition.id] = resolveTransitionCurve(
			(element?.props as { audioCurve?: unknown } | undefined)?.audioCurve,
		);
	}

	const clips = Array.from(args.targets.values()).map((target) => ({
		id: target.id,
		timeline: target.timeline,
		audioDuration: target.audioDuration,
		enabled: target.enabled,
	}));
	const plan = buildTransitionAudioMixPlan({
		displayTimeFrames: args.displayTime,
		fps: args.fps,
		clips,
		activeTransitions: transitionFrameState.activeTransitions,
		transitionCurves: transitionCurveById,
	});

	const pickedBySession = new Map<
		string,
		{
			target: AudioMixTarget;
			instruction: AudioMixInstruction | null;
			id: string;
			timelineStart: number;
		}
	>();
	for (const [id, target] of args.targets.entries()) {
		const instruction = plan.instructions[id] ?? null;
		const candidate = {
			target,
			instruction,
			id: target.id,
			timelineStart: target.timeline.start ?? 0,
		};
		const existing = pickedBySession.get(target.sessionKey);
		if (!existing) {
			pickedBySession.set(target.sessionKey, candidate);
			continue;
		}
		if (
			existing.instruction &&
			instruction &&
			existing.target.id !== target.id
		) {
			console.warn(
				`[TimelineAudioMix] session=${target.sessionKey} has multiple active clips, selecting by gain/start`,
			);
		}
		pickedBySession.set(
			target.sessionKey,
			chooseSessionInstructionCandidate(existing, candidate),
		);
	}

	for (const picked of pickedBySession.values()) {
		invokeApplyAudioMix(picked.target, picked.instruction);
		const instruction = picked.instruction;
		if (instruction) {
			activeIds.add(picked.target.id);
		}
	}

	return activeIds;
};
