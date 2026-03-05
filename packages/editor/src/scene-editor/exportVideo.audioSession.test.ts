import type {
	ExportElementAudioSource,
	ExportTimelineAsVideoOptions,
} from "core/editor/exportVideo";
import {
	__applyAudioMixPlanAtFrameForTests,
	__chooseSessionInstructionForTests,
	__collectExportAudioTargetsForTests,
	__resolveExportAudioTransitionFrameStateForTests,
} from "core/editor/exportVideo";
import type { TransitionFrameState } from "core/editor/preview/transitionFrameState";
import type { TimelineTrack } from "core/editor/timeline/types";
import type { TimelineElement, TimelineMeta } from "core/element/types";
import type { AudioBufferSink } from "mediabunny";
import { describe, expect, it, vi } from "vitest";
import { getAudioPlaybackSessionKey } from "./playback/clipContinuityIndex";

vi.mock("react-skia-lite", () => ({
	JsiSkSurface: class {},
	Skia: {},
	SkiaSGRoot: class {},
}));

const createTrack = (overrides?: Partial<TimelineTrack>): TimelineTrack => ({
	id: "main",
	role: "clip",
	hidden: false,
	locked: false,
	muted: false,
	solo: false,
	...overrides,
});

const createTimeline = (
	start: number,
	end: number,
	offset = 0,
	trackIndex = 0,
): TimelineMeta => ({
	start,
	end,
	startTimecode: "",
	endTimecode: "",
	offset,
	trackIndex,
});

const createAudioClip = ({
	id,
	start,
	end,
	offset = 0,
	assetId = "shared-source-audio",
	reversed = false,
	trackIndex = -1,
}: {
	id: string;
	start: number;
	end: number;
	offset?: number;
	assetId?: string;
	reversed?: boolean;
	trackIndex?: number;
}): TimelineElement => ({
	id,
	type: "AudioClip",
	component: "audio-clip",
	name: id,
	assetId,
	timeline: createTimeline(start, end, offset, trackIndex),
	props: { reversed },
});

const createVideoClip = ({
	id,
	start,
	end,
	offset = 0,
	assetId = "shared-source-video",
	reversed = false,
	trackIndex = 0,
}: {
	id: string;
	start: number;
	end: number;
	offset?: number;
	assetId?: string;
	reversed?: boolean;
	trackIndex?: number;
}): TimelineElement => ({
	id,
	type: "VideoClip",
	component: "video-clip",
	name: id,
	assetId,
	timeline: createTimeline(start, end, offset, trackIndex),
	props: { reversed },
});

const createTransition = ({
	id,
	start,
	end,
	boundary,
	fromId,
	toId,
}: {
	id: string;
	start: number;
	end: number;
	boundary: number;
	fromId: string;
	toId: string;
}): TimelineElement => ({
	id,
	type: "Transition",
	component: "transition/crossfade",
	name: id,
	timeline: createTimeline(start, end, 0, 0),
	props: {},
	transition: {
		duration: end - start,
		boundry: boundary,
		fromId,
		toId,
	},
});

const createOptions = ({
	elements,
	tracks,
	audioSources,
	audioTrackStates,
	getAudioSessionKeyByElementId,
	isElementAudioEnabled,
}: {
	elements: TimelineElement[];
	tracks: TimelineTrack[];
	audioSources: Record<string, ExportElementAudioSource>;
	audioTrackStates?: NonNullable<
		ExportTimelineAsVideoOptions["audio"]
	>["audioTrackStates"];
	getAudioSessionKeyByElementId?: NonNullable<
		ExportTimelineAsVideoOptions["audio"]
	>["getAudioSessionKeyByElementId"];
	isElementAudioEnabled?: NonNullable<
		ExportTimelineAsVideoOptions["audio"]
	>["isElementAudioEnabled"];
}): ExportTimelineAsVideoOptions => ({
	elements,
	tracks,
	fps: 30,
	canvasSize: { width: 1920, height: 1080 },
	buildSkiaFrameSnapshot: (() => {
		throw new Error("not used in this test");
	}) as ExportTimelineAsVideoOptions["buildSkiaFrameSnapshot"],
	audio: {
		audioTrackStates,
		getAudioSourceByElementId: (elementId) => audioSources[elementId] ?? null,
		getAudioSessionKeyByElementId,
		isElementAudioEnabled,
	},
});

const EMPTY_TRANSITION_STATE: TransitionFrameState = {
	activeTransitions: [],
	hiddenElementIds: [],
};

describe("export audio session mix", () => {
	it("连续硬切会归并成单一 session，切点前后无 gain dip", () => {
		const elements = [
			createAudioClip({ id: "a1", start: 0, end: 30, offset: 100 }),
			createAudioClip({ id: "a2", start: 30, end: 60, offset: 130 }),
		];
		const sharedSink = {} as AudioBufferSink;
		const options = createOptions({
			elements,
			tracks: [createTrack()],
			audioSources: {
				a1: { audioSink: sharedSink, audioDuration: 10 },
				a2: { audioSink: sharedSink, audioDuration: 10 },
			},
			getAudioSessionKeyByElementId: (elementId) =>
				getAudioPlaybackSessionKey(elements, elementId),
		});

		const collected = __collectExportAudioTargetsForTests(options, 90);
		expect(collected.audioTargets).toHaveLength(1);

		__applyAudioMixPlanAtFrameForTests({
			frame: 29,
			startFrame: 0,
			fps: 30,
			audioClips: collected.audioClips,
			audioClipTargetsById: collected.audioClipTargetsById,
			audioTargetsBySessionKey: collected.audioTargetsBySessionKey,
			transitionFrameState: EMPTY_TRANSITION_STATE,
			transitionCurveById: {},
		});
		__applyAudioMixPlanAtFrameForTests({
			frame: 30,
			startFrame: 0,
			fps: 30,
			audioClips: collected.audioClips,
			audioClipTargetsById: collected.audioClipTargetsById,
			audioTargetsBySessionKey: collected.audioTargetsBySessionKey,
			transitionFrameState: EMPTY_TRANSITION_STATE,
			transitionCurveById: {},
		});

		const target = collected.audioTargets[0];
		if (!target) {
			throw new Error("target should exist");
		}
		const gainBefore = target.gains[29] ?? 0;
		const gainAfter = target.gains[30] ?? 0;
		expect(gainBefore).toBeCloseTo(1, 6);
		expect(gainAfter).toBeCloseTo(1, 6);
		expect(Math.abs(gainAfter - gainBefore)).toBeLessThan(1e-6);
		expect(target.sourceRangeStart).toBeCloseTo(100 / 30, 6);
		expect(target.sourceRangeEnd).toBeCloseTo(160 / 30, 6);
	});

	it("倒放连续硬切会按反向源时间更新 sourceRange", () => {
		const elements = [
			createAudioClip({
				id: "a1",
				start: 0,
				end: 30,
				offset: 30,
				reversed: true,
			}),
			createAudioClip({
				id: "a2",
				start: 30,
				end: 60,
				offset: 0,
				reversed: true,
			}),
		];
		const sharedSink = {} as AudioBufferSink;
		const options = createOptions({
			elements,
			tracks: [createTrack()],
			audioSources: {
				a1: { audioSink: sharedSink, audioDuration: 3 },
				a2: { audioSink: sharedSink, audioDuration: 3 },
			},
			getAudioSessionKeyByElementId: (elementId) =>
				getAudioPlaybackSessionKey(elements, elementId),
		});

		const collected = __collectExportAudioTargetsForTests(options, 90);
		expect(collected.audioTargets).toHaveLength(1);

		__applyAudioMixPlanAtFrameForTests({
			frame: 10,
			startFrame: 0,
			fps: 30,
			audioClips: collected.audioClips,
			audioClipTargetsById: collected.audioClipTargetsById,
			audioTargetsBySessionKey: collected.audioTargetsBySessionKey,
			transitionFrameState: EMPTY_TRANSITION_STATE,
			transitionCurveById: {},
		});
		__applyAudioMixPlanAtFrameForTests({
			frame: 40,
			startFrame: 0,
			fps: 30,
			audioClips: collected.audioClips,
			audioClipTargetsById: collected.audioClipTargetsById,
			audioTargetsBySessionKey: collected.audioTargetsBySessionKey,
			transitionFrameState: EMPTY_TRANSITION_STATE,
			transitionCurveById: {},
		});

		const target = collected.audioTargets[0];
		if (!target) {
			throw new Error("target should exist");
		}
		expect(target.gains[10]).toBeGreaterThan(0.99);
		expect(target.gains[40]).toBeGreaterThan(0.99);
		expect(target.sourceRangeStart).toBeCloseTo(0, 6);
		expect(target.sourceRangeEnd).toBeCloseTo(2, 6);
	});

	it("非连续硬切不会归并到同一 session", () => {
		const elements = [
			createAudioClip({ id: "a1", start: 0, end: 30, offset: 100 }),
			createAudioClip({ id: "a2", start: 31, end: 60, offset: 131 }),
		];
		const sharedSink = {} as AudioBufferSink;
		const options = createOptions({
			elements,
			tracks: [createTrack()],
			audioSources: {
				a1: { audioSink: sharedSink, audioDuration: 10 },
				a2: { audioSink: sharedSink, audioDuration: 10 },
			},
			getAudioSessionKeyByElementId: (elementId) =>
				getAudioPlaybackSessionKey(elements, elementId),
		});

		const collected = __collectExportAudioTargetsForTests(options, 90);
		expect(collected.audioTargets).toHaveLength(2);
	});

	it("转场边界存在时不会归并到同一 session", () => {
		const elements = [
			createVideoClip({ id: "v1", start: 0, end: 30, offset: 0 }),
			createVideoClip({ id: "v2", start: 30, end: 60, offset: 30 }),
			createTransition({
				id: "t1",
				start: 15,
				end: 45,
				boundary: 30,
				fromId: "v1",
				toId: "v2",
			}),
		];
		const sharedSink = {} as AudioBufferSink;
		const options = createOptions({
			elements,
			tracks: [createTrack()],
			audioSources: {
				v1: { audioSink: sharedSink, audioDuration: 10 },
				v2: { audioSink: sharedSink, audioDuration: 10 },
			},
			getAudioSessionKeyByElementId: (elementId) =>
				getAudioPlaybackSessionKey(elements, elementId),
		});

		const collected = __collectExportAudioTargetsForTests(options, 90);
		expect(collected.audioTargets).toHaveLength(2);
	});

	it("未提供 session 回调时回退到 clip 级目标", () => {
		const elements = [
			createAudioClip({ id: "a1", start: 0, end: 30, offset: 100 }),
			createAudioClip({ id: "a2", start: 30, end: 60, offset: 130 }),
		];
		const sharedSink = {} as AudioBufferSink;
		const options = createOptions({
			elements,
			tracks: [createTrack()],
			audioSources: {
				a1: { audioSink: sharedSink, audioDuration: 10 },
				a2: { audioSink: sharedSink, audioDuration: 10 },
			},
		});

		const collected = __collectExportAudioTargetsForTests(options, 90);
		expect(collected.audioTargets).toHaveLength(2);
	});

	it("轨道静音时不会因为 session 归并错误地产生可听结果", () => {
		const elements = [
			createAudioClip({
				id: "a1",
				start: 0,
				end: 30,
				offset: 100,
				trackIndex: -1,
			}),
			createAudioClip({
				id: "a2",
				start: 30,
				end: 60,
				offset: 130,
				trackIndex: -2,
			}),
		];
		const sharedSink = {} as AudioBufferSink;
		const options = createOptions({
			elements,
			tracks: [createTrack()],
			audioTrackStates: {
				[-1]: { locked: false, muted: true, solo: false },
			},
			audioSources: {
				a1: { audioSink: sharedSink, audioDuration: 10 },
				a2: { audioSink: sharedSink, audioDuration: 10 },
			},
			getAudioSessionKeyByElementId: (elementId) =>
				getAudioPlaybackSessionKey(elements, elementId),
		});

		const collected = __collectExportAudioTargetsForTests(options, 90);
		expect(collected.audioTargets).toHaveLength(1);

		__applyAudioMixPlanAtFrameForTests({
			frame: 10,
			startFrame: 0,
			fps: 30,
			audioClips: collected.audioClips,
			audioClipTargetsById: collected.audioClipTargetsById,
			audioTargetsBySessionKey: collected.audioTargetsBySessionKey,
			transitionFrameState: EMPTY_TRANSITION_STATE,
			transitionCurveById: {},
		});
		__applyAudioMixPlanAtFrameForTests({
			frame: 40,
			startFrame: 0,
			fps: 30,
			audioClips: collected.audioClips,
			audioClipTargetsById: collected.audioClipTargetsById,
			audioTargetsBySessionKey: collected.audioTargetsBySessionKey,
			transitionFrameState: EMPTY_TRANSITION_STATE,
			transitionCurveById: {},
		});

		const target = collected.audioTargets[0];
		if (!target) {
			throw new Error("target should exist");
		}
		expect(target.gains[10]).toBeCloseTo(0, 6);
		expect(target.gains[40]).toBeGreaterThan(0.99);
	});

	it("无有效 source 的 clip 也会进入 audioClips 声明集合", () => {
		const elements = [
			createAudioClip({ id: "a1", start: 0, end: 30, offset: 0 }),
			createAudioClip({ id: "a2", start: 30, end: 60, offset: 30 }),
			createTransition({
				id: "t1",
				start: 15,
				end: 45,
				boundary: 30,
				fromId: "a1",
				toId: "a2",
			}),
		];
		const options = createOptions({
			elements,
			tracks: [createTrack()],
			audioSources: {
				a1: { audioSink: {} as AudioBufferSink, audioDuration: 3 },
			},
		});

		const collected = __collectExportAudioTargetsForTests(options, 90);
		expect(collected.audioClipTargetsById.has("a1")).toBe(true);
		expect(collected.audioClipTargetsById.has("a2")).toBe(false);
		expect(collected.audioClips.map((clip) => clip.id)).toEqual(["a1", "a2"]);
	});

	it("isElementAudioEnabled 会覆盖 clip 的启用状态", () => {
		const elements = [
			createAudioClip({ id: "a1", start: 0, end: 60, offset: 0 }),
		];
		const options = createOptions({
			elements,
			tracks: [createTrack()],
			audioSources: {
				a1: { audioSink: {} as AudioBufferSink, audioDuration: 10 },
			},
			isElementAudioEnabled: () => false,
		});

		const collected = __collectExportAudioTargetsForTests(options, 90);
		const clip = collected.audioClips[0];
		expect(clip?.enabled).toBe(false);

		__applyAudioMixPlanAtFrameForTests({
			frame: 10,
			startFrame: 0,
			fps: 30,
			audioClips: collected.audioClips,
			audioClipTargetsById: collected.audioClipTargetsById,
			audioTargetsBySessionKey: collected.audioTargetsBySessionKey,
			transitionFrameState: EMPTY_TRANSITION_STATE,
			transitionCurveById: {},
		});

		const target = collected.audioTargets[0];
		if (!target) {
			throw new Error("target should exist");
		}
		expect(target.gains[10]).toBeCloseTo(0, 6);
	});

	it("导出音频转场状态会基于导出音频 elements 计算", () => {
		const elements = [
			createAudioClip({ id: "a1", start: 0, end: 60, offset: 0 }),
			createAudioClip({ id: "a2", start: 60, end: 120, offset: 60 }),
			createTransition({
				id: "t1",
				start: 45,
				end: 75,
				boundary: 60,
				fromId: "a1",
				toId: "a2",
			}),
		];

		const transitionState = __resolveExportAudioTransitionFrameStateForTests({
			elements,
			tracks: [createTrack()],
			frame: 60,
		});

		expect(transitionState.activeTransitions).toHaveLength(1);
		expect(transitionState.activeTransitions[0]).toMatchObject({
			id: "t1",
			fromId: "a1",
			toId: "a2",
		});
	});

	it("会叠加 clip.gainDb 到导出混音增益", () => {
		const boosted = {
			...createAudioClip({
				id: "a1",
				start: 0,
				end: 60,
				offset: 0,
			}),
			clip: {
				gainDb: 6,
			},
		} satisfies TimelineElement;
		const sharedSink = {} as AudioBufferSink;
		const options = createOptions({
			elements: [boosted],
			tracks: [createTrack()],
			audioSources: {
				a1: { audioSink: sharedSink, audioDuration: 10 },
			},
		});

		const collected = __collectExportAudioTargetsForTests(options, 90);
		__applyAudioMixPlanAtFrameForTests({
			frame: 10,
			startFrame: 0,
			fps: 30,
			audioClips: collected.audioClips,
			audioClipTargetsById: collected.audioClipTargetsById,
			audioTargetsBySessionKey: collected.audioTargetsBySessionKey,
			transitionFrameState: EMPTY_TRANSITION_STATE,
			transitionCurveById: {},
		});

		const target = collected.audioTargets[0];
		if (!target) {
			throw new Error("target should exist");
		}
		expect(target.gains[10]).toBeCloseTo(10 ** (6 / 20), 4);
	});

	it("同 session 冲突时按回放端规则优先选择候选", () => {
		const chosen = __chooseSessionInstructionForTests(
			{
				clip: {
					id: "a",
					sessionKey: "session:1",
					timeline: createTimeline(0, 60),
					audioSink: {} as AudioBufferSink,
					audioDuration: 10,
					enabled: true,
					clipGain: 1,
				},
				id: "a",
				timelineStart: 0,
				instruction: {
					timelineTimeSeconds: 1,
					gain: 0.8,
				},
			},
			{
				clip: {
					id: "b",
					sessionKey: "session:1",
					timeline: createTimeline(20, 80),
					audioSink: {} as AudioBufferSink,
					audioDuration: 10,
					enabled: true,
					clipGain: 1,
				},
				id: "b",
				timelineStart: 20,
				instruction: {
					timelineTimeSeconds: 1,
					gain: 0.8,
				},
			},
		);

		expect(chosen.clip.id).toBe("b");
	});
});
