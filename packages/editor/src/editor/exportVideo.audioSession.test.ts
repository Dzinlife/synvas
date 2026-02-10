import type { TimelineElement, TimelineMeta } from "core/dsl/types";
import type {
	ExportElementAudioSource,
	ExportTimelineAsVideoOptions,
} from "core/editor/exportVideo";
import {
	__applyAudioMixPlanAtFrameForTests,
	__chooseSessionInstructionForTests,
	__collectExportAudioTargetsForTests,
} from "core/editor/exportVideo";
import type { TransitionFrameState } from "core/editor/preview/transitionFrameState";
import type { TimelineTrack } from "core/editor/timeline/types";
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
	uri = "shared.mp3",
	trackIndex = -1,
}: {
	id: string;
	start: number;
	end: number;
	offset?: number;
	uri?: string;
	trackIndex?: number;
}): TimelineElement => ({
	id,
	type: "AudioClip",
	component: "audio-clip",
	name: id,
	timeline: createTimeline(start, end, offset, trackIndex),
	props: { uri },
});

const createVideoClip = ({
	id,
	start,
	end,
	offset = 0,
	uri = "shared.mp4",
	trackIndex = 0,
}: {
	id: string;
	start: number;
	end: number;
	offset?: number;
	uri?: string;
	trackIndex?: number;
}): TimelineElement => ({
	id,
	type: "VideoClip",
	component: "video-clip",
	name: id,
	timeline: createTimeline(start, end, offset, trackIndex),
	props: { uri },
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
}: {
	elements: TimelineElement[];
	tracks: TimelineTrack[];
	audioSources: Record<string, ExportElementAudioSource>;
	audioTrackStates?: NonNullable<ExportTimelineAsVideoOptions["audio"]>["audioTrackStates"];
	getAudioSessionKeyByElementId?: NonNullable<
		ExportTimelineAsVideoOptions["audio"]
	>["getAudioSessionKeyByElementId"];
}): ExportTimelineAsVideoOptions => ({
	elements,
	tracks,
	fps: 30,
	canvasSize: { width: 1920, height: 1080 },
	buildSkiaRenderState: (() => {
		throw new Error("not used in this test");
	}) as ExportTimelineAsVideoOptions["buildSkiaRenderState"],
	audio: {
		audioTrackStates,
		getAudioSourceByElementId: (elementId) => audioSources[elementId] ?? null,
		getAudioSessionKeyByElementId,
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
				},
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
				},
				instruction: {
					timelineTimeSeconds: 1,
					gain: 0.8,
				},
			},
		);

		expect(chosen.clip.id).toBe("b");
	});
});
