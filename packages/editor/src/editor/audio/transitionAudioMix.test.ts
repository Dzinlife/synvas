import type { TimelineMeta } from "core/dsl/types";
import {
	type AudioMixClip,
	buildTransitionAudioMixPlan,
} from "core/editor/audio/transitionAudioMix";
import type { ActiveTransitionFrameState } from "core/editor/preview/buildSkiaTree";
import { describe, expect, it } from "vitest";
import type { TransitionAudioCurve } from "../../dsl/Transition/model";

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
	reversed = false,
): AudioMixClip => ({
	id,
	timeline,
	audioDuration,
	enabled: true,
	reversed,
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

	it("倒放 clip 的 sourceTime 会随时间递减", () => {
		const clips = [createClip("rev", createTimeline(0, 60, 6), 4, true)];

		const early = buildPlan({
			displayTimeFrames: 10,
			clips,
			activeTransitions: [],
		});
		const late = buildPlan({
			displayTimeFrames: 20,
			clips,
			activeTransitions: [],
		});

		const earlyInstruction = early.instructions.rev;
		const lateInstruction = late.instructions.rev;
		expect(earlyInstruction).toBeTruthy();
		expect(lateInstruction).toBeTruthy();
		if (
			!earlyInstruction ||
			!lateInstruction ||
			!earlyInstruction.sourceRange ||
			!lateInstruction.sourceRange
		) {
			throw new Error("reverse instruction should include source range");
		}
			expect(earlyInstruction.reversed).toBe(true);
			expect(lateInstruction.reversed).toBe(true);
			const earlySourceTime = earlyInstruction.sourceTime ?? 0;
			const lateSourceTime = lateInstruction.sourceTime ?? 0;
			expect(earlySourceTime).toBeGreaterThan(lateSourceTime);
			expect(earlyInstruction.sourceRange.start).toBeLessThanOrEqual(
				earlyInstruction.sourceRange.end,
			);
		expect(lateInstruction.sourceRange.start).toBeLessThanOrEqual(
			lateInstruction.sourceRange.end,
		);
			expect(earlySourceTime).toBeGreaterThanOrEqual(
				earlyInstruction.sourceRange.start,
			);
			expect(earlySourceTime).toBeLessThanOrEqual(
				earlyInstruction.sourceRange.end,
			);
			expect(lateSourceTime).toBeGreaterThanOrEqual(
				lateInstruction.sourceRange.start,
			);
			expect(lateSourceTime).toBeLessThanOrEqual(
				lateInstruction.sourceRange.end,
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
