import type { ActiveTransitionFrameState } from "core/editor/preview/buildSkiaTree";
import { describe, expect, it } from "vitest";
import type { TransitionAudioCurve } from "../../dsl/Transition/model";
import type { TimelineMeta } from "../../dsl/types";
import {
	type AudioMixClip,
	buildTransitionAudioMixPlan,
} from "./transitionAudioMix";

const FPS = 30;

const createTimeline = (
	start: number,
	end: number,
	offset = 0,
): TimelineMeta => ({
	start,
	end,
	startTimecode: "",
	endTimecode: "",
	offset,
	trackIndex: 0,
});

const createClip = (
	id: string,
	timeline: TimelineMeta,
	audioDuration: number,
): AudioMixClip => ({
	id,
	timeline,
	audioDuration,
	enabled: true,
});

const createTransition = (
	id: string,
	start: number,
	end: number,
	boundary: number,
	fromId: string,
	toId: string,
): ActiveTransitionFrameState => ({
	id,
	component: "transition/crossfade",
	fromId,
	toId,
	start,
	end,
	boundary,
	duration: end - start,
	head: Math.floor((end - start) / 2),
	tail: end - start - Math.floor((end - start) / 2),
	progress: 0.5,
});

const buildPlan = ({
	displayTimeFrames,
	clips,
	activeTransitions,
	curves,
}: {
	displayTimeFrames: number;
	clips: AudioMixClip[];
	activeTransitions: ActiveTransitionFrameState[];
	curves?: Record<string, TransitionAudioCurve | undefined>;
}) =>
	buildTransitionAudioMixPlan({
		displayTimeFrames,
		fps: FPS,
		clips,
		activeTransitions,
		transitionCurves: curves,
	});

describe("transitionAudioMix", () => {
	it("equal-power 与 linear 在中点具有不同听感增益", () => {
		const clips = [
			createClip("from", createTimeline(0, 30, 0), 2),
			createClip("to", createTimeline(30, 60, 15), 2),
		];
		const transition = createTransition("t1", 15, 45, 30, "from", "to");

		const linear = buildPlan({
			displayTimeFrames: 30,
			clips,
			activeTransitions: [transition],
			curves: { t1: "linear" },
		});
		const power = buildPlan({
			displayTimeFrames: 30,
			clips,
			activeTransitions: [transition],
			curves: { t1: "equal-power" },
		});

		expect(linear.instructions.from?.gain).toBeCloseTo(0.5, 4);
		expect(linear.instructions.to?.gain).toBeCloseTo(0.5, 4);
		expect(power.instructions.from?.gain ?? 0).toBeGreaterThan(
			linear.instructions.from?.gain ?? 0,
		);
		expect(power.instructions.to?.gain ?? 0).toBeGreaterThan(
			linear.instructions.to?.gain ?? 0,
		);
	});

	it("句柄不足时按分段策略智能降级", () => {
		const clips = [
			createClip("from", createTimeline(0, 30, 0), 1.2),
			createClip("to", createTimeline(30, 60, 0), 2),
		];
		const transition = createTransition("t1", 15, 45, 30, "from", "to");

		const earlyPlan = buildPlan({
			displayTimeFrames: 18,
			clips,
			activeTransitions: [transition],
		});
		expect(earlyPlan.instructions.from?.gain).toBeCloseTo(1, 4);
		expect(earlyPlan.instructions.to).toBeUndefined();

		const latePlan = buildPlan({
			displayTimeFrames: 42,
			clips,
			activeTransitions: [transition],
		});
		expect(latePlan.instructions.to?.gain).toBeCloseTo(1, 4);
		expect(latePlan.instructions.from).toBeUndefined();
	});

	it("sourceTime 会被限制在有效 sourceRange 内", () => {
		const clips = [
			createClip("from", createTimeline(0, 30, 0), 2),
			createClip("to", createTimeline(30, 60, 6), 2),
		];
		const transition = createTransition("t1", 20, 50, 30, "from", "to");

		const plan = buildPlan({
			displayTimeFrames: 27,
			clips,
			activeTransitions: [transition],
		});
		const toInstruction = plan.instructions.to;
		expect(toInstruction).toBeTruthy();
		if (!toInstruction?.sourceRange) {
			throw new Error("to instruction should include sourceRange");
		}
		expect(toInstruction.sourceTime).toBeGreaterThanOrEqual(
			toInstruction.sourceRange.start,
		);
		expect(toInstruction.sourceTime).toBeLessThanOrEqual(
			toInstruction.sourceRange.end,
		);
	});

	it("多转场叠加时增益合成保持稳定", () => {
		const clips = [
			createClip("a", createTimeline(0, 30, 0), 3),
			createClip("b", createTimeline(30, 60, 15), 3),
			createClip("c", createTimeline(60, 90, 15), 3),
		];
		const transitions = [
			createTransition("t1", 10, 50, 30, "a", "b"),
			createTransition("t2", 40, 80, 60, "b", "c"),
		];

		const plan = buildPlan({
			displayTimeFrames: 45,
			clips,
			activeTransitions: transitions,
		});
		const middleGain = plan.instructions.b?.gain;
		expect(middleGain).toBeTruthy();
		if (!middleGain) {
			throw new Error("middle gain should be generated");
		}
		expect(middleGain).toBeGreaterThanOrEqual(0);
		expect(middleGain).toBeLessThanOrEqual(1);
	});
});
