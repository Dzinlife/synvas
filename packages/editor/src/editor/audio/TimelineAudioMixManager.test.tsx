import { describe, expect, it, vi } from "vitest";
import type { TimelineElement, TimelineMeta } from "../../dsl/types";
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
	transform: {
		centerX: 0,
		centerY: 0,
		width: 1920,
		height: 1080,
		rotation: 0,
	},
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
	transform: {
		centerX: 0,
		centerY: 0,
		width: 1920,
		height: 1080,
		rotation: 0,
	},
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

describe("TimelineAudioMixManager.runTimelineAudioMixFrame", () => {
	it("暂停时会停止所有目标", () => {
		const apply = vi.fn();
		const timeline = createTimeline(0, 60);
		const targets = new Map([
			[
				"clip-a",
				{
					id: "clip-a",
					timeline,
					audioDuration: 2,
					enabled: true,
					applyAudioMix: apply,
				},
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
				{
					id: "from",
					timeline: from.timeline,
					audioDuration: 2,
					enabled: true,
					applyAudioMix: applyFrom,
				},
			],
			[
				"to",
				{
					id: "to",
					timeline: to.timeline,
					audioDuration: 2,
					enabled: true,
					applyAudioMix: applyTo,
				},
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
				{
					id: "clip-a",
					timeline: createTimeline(0, 60),
					audioDuration: 2,
					enabled: true,
					applyAudioMix: apply,
				},
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
				{
					id: "clip-a",
					timeline: createTimeline(0, 60),
					audioDuration: 2,
					enabled: false,
					applyAudioMix: apply,
				},
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
});
