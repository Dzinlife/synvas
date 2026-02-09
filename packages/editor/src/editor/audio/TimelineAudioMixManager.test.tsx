import type { TimelineElement, TimelineMeta } from "core/dsl/types";
import { describe, expect, it, vi } from "vitest";
import { createTransformMeta } from "@/dsl/transform";
import type { TimelineTrack } from "../timeline/types";
import { runTimelineAudioMixFrame } from "./TimelineAudioMixRunner";

const createTrack = (): TimelineTrack => ({
	id: "main",
	role: "clip",
	hidden: false,
	locked: false,
	muted: false,
	solo: false,
});

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
	role: "clip",
});

const createVideoElement = (
	id: string,
	start: number,
	end: number,
	offset = 0,
): TimelineElement => ({
	id,
	type: "VideoClip",
	component: "video-clip",
	name: id,
	transform: createTransformMeta({
		width: 1920,
		height: 1080,
		positionX: 960,
		positionY: 540,
	}),
	timeline: createTimeline(start, end, offset),
	render: {
		zIndex: 0,
		visible: true,
		opacity: 1,
	},
	props: {
		uri: `${id}.mp4`,
	},
});

const createTransitionElement = (
	id: string,
	start: number,
	end: number,
	boundary: number,
	fromId: string,
	toId: string,
): TimelineElement => ({
	id,
	type: "Transition",
	component: "transition/crossfade",
	name: id,
	transform: createTransformMeta({
		width: 1920,
		height: 1080,
		positionX: 960,
		positionY: 540,
	}),
	timeline: createTimeline(start, end),
	render: {
		zIndex: 1,
		visible: true,
		opacity: 1,
	},
	props: {},
	transition: {
		duration: end - start,
		boundry: boundary,
		fromId,
		toId,
	},
});

const createTarget = ({
	id,
	timeline,
	applyAudioMix,
	audioDuration = 2,
	enabled = true,
	sessionKey,
}: {
	id: string;
	timeline: TimelineMeta;
	applyAudioMix: ReturnType<typeof vi.fn>;
	audioDuration?: number;
	enabled?: boolean;
	sessionKey?: string;
}) => ({
	id,
	timeline,
	audioDuration,
	enabled,
	sessionKey: sessionKey ?? `session:${id}`,
	applyAudioMix,
});

describe("TimelineAudioMixManager.runTimelineAudioMixFrame", () => {
	it("暂停时会停止所有目标", () => {
		const apply = vi.fn();
		const timeline = createTimeline(0, 60);
		const targets = new Map([
			[
				"clip-a",
				createTarget({
					id: "clip-a",
					timeline,
					applyAudioMix: apply,
				}),
			],
		]);

		runTimelineAudioMixFrame({
			isPlaying: false,
			isExporting: false,
			displayTime: 10,
			fps: 30,
			elements: [createVideoElement("clip-a", 0, 60)],
			tracks: [createTrack()],
			audioTrackStates: {},
			targets,
		});

		expect(apply).toHaveBeenCalledTimes(1);
		expect(apply).toHaveBeenLastCalledWith(null);
	});

	it("播放且转场激活时会下发混音指令", () => {
		const applyFrom = vi.fn();
		const applyTo = vi.fn();
		const from = createVideoElement("from", 0, 30, 0);
		const to = createVideoElement("to", 30, 60, 15);
		const transition = createTransitionElement("t1", 15, 45, 30, "from", "to");
		const targets = new Map([
			[
				"from",
				createTarget({
					id: "from",
					timeline: from.timeline,
					applyAudioMix: applyFrom,
				}),
			],
			[
				"to",
				createTarget({
					id: "to",
					timeline: to.timeline,
					applyAudioMix: applyTo,
				}),
			],
		]);

		runTimelineAudioMixFrame({
			isPlaying: true,
			isExporting: false,
			displayTime: 30,
			fps: 30,
			elements: [from, to, transition],
			tracks: [createTrack()],
			audioTrackStates: {},
			targets,
		});

		const fromInstruction = applyFrom.mock.calls.at(-1)?.[0];
		const toInstruction = applyTo.mock.calls.at(-1)?.[0];
		expect(fromInstruction).toMatchObject({
			timelineTimeSeconds: expect.any(Number),
			gain: expect.any(Number),
		});
		expect(toInstruction).toMatchObject({
			timelineTimeSeconds: expect.any(Number),
			gain: expect.any(Number),
		});
		expect(fromInstruction.gain).toBeGreaterThan(0);
		expect(toInstruction.gain).toBeGreaterThan(0);
	});

	it("导出态会强制停止所有目标", () => {
		const apply = vi.fn();
		const targets = new Map([
			[
				"clip-a",
				createTarget({
					id: "clip-a",
					timeline: createTimeline(0, 60),
					applyAudioMix: apply,
				}),
			],
		]);

		runTimelineAudioMixFrame({
			isPlaying: true,
			isExporting: true,
			displayTime: 20,
			fps: 30,
			elements: [createVideoElement("clip-a", 0, 60)],
			tracks: [createTrack()],
			audioTrackStates: {},
			targets,
		});

		expect(apply).toHaveBeenLastCalledWith(null);
	});

	it("禁用目标（对应静音/solo 过滤后）不会继续播放", () => {
		const apply = vi.fn();
		const targets = new Map([
			[
				"clip-a",
				createTarget({
					id: "clip-a",
					timeline: createTimeline(0, 60),
					enabled: false,
					applyAudioMix: apply,
				}),
			],
		]);

		runTimelineAudioMixFrame({
			isPlaying: true,
			isExporting: false,
			displayTime: 20,
			fps: 30,
			elements: [createVideoElement("clip-a", 0, 60)],
			tracks: [createTrack()],
			audioTrackStates: {},
			targets,
		});

		expect(apply).toHaveBeenLastCalledWith(null);
	});

	it("同一 session 在同一帧只会调用一次混音", () => {
		const applyA = vi.fn();
		const applyB = vi.fn();
		const targets = new Map([
			[
				"clip-a",
				createTarget({
					id: "clip-a",
					timeline: createTimeline(0, 60, 0),
					applyAudioMix: applyA,
					sessionKey: "session:shared",
				}),
			],
			[
				"clip-b",
				createTarget({
					id: "clip-b",
					timeline: createTimeline(60, 120, 60),
					applyAudioMix: applyB,
					sessionKey: "session:shared",
				}),
			],
		]);

		runTimelineAudioMixFrame({
			isPlaying: true,
			isExporting: false,
			displayTime: 75,
			fps: 30,
			elements: [
				createVideoElement("clip-a", 0, 60, 0),
				createVideoElement("clip-b", 60, 120, 60),
			],
			tracks: [createTrack()],
			audioTrackStates: {},
			targets,
		});

		expect(applyA.mock.calls.length + applyB.mock.calls.length).toBe(1);
	});
});
