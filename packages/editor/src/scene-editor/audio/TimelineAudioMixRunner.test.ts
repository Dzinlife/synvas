import type { TimelineTrack } from "core/editor/timeline/types";
import type { TimelineElement, TimelineMeta } from "core/element/types";
import { describe, expect, it, vi } from "vitest";
import { runTimelineAudioMixFrame } from "./TimelineAudioMixRunner";

const createTrack = (): TimelineTrack => ({
	id: "track-main",
	role: "clip",
	hidden: false,
	locked: false,
	muted: false,
	solo: false,
});

const createTimeline = (start: number, end: number): TimelineMeta => ({
	start,
	end,
	startTimecode: "",
	endTimecode: "",
	offset: 0,
	trackIndex: 0,
});

const createAudioClip = (
	id: string,
	start: number,
	end: number,
): TimelineElement => ({
	id,
	type: "AudioClip",
	component: "audio-clip",
	name: id,
	assetId: `${id}-asset`,
	timeline: createTimeline(start, end),
	props: {},
});

describe("runTimelineAudioMixFrame", () => {
	it("同 session 候选切换时会清空未选中的目标", () => {
		const applyA = vi.fn();
		const applyB = vi.fn();
		const elements = [
			createAudioClip("clip-a", 0, 30),
			createAudioClip("clip-b", 60, 90),
		];
		const targets = new Map([
			[
				"clip-a",
				{
					id: "clip-a",
					timeline: createTimeline(0, 30),
					audioDuration: 30,
					enabled: true,
					sessionKey: "session:shared",
					applyAudioMix: applyA,
				},
			],
			[
				"clip-b",
				{
					id: "clip-b",
					timeline: createTimeline(60, 90),
					audioDuration: 30,
					enabled: true,
					sessionKey: "session:shared",
					applyAudioMix: applyB,
				},
			],
		]);

		runTimelineAudioMixFrame({
			isPlaying: true,
			isExporting: false,
			displayTime: 70,
			fps: 30,
			elements,
			tracks: [createTrack()],
			audioTrackStates: {},
			targets,
		});
		runTimelineAudioMixFrame({
			isPlaying: true,
			isExporting: false,
			displayTime: 10,
			fps: 30,
			elements,
			tracks: [createTrack()],
			audioTrackStates: {},
			targets,
		});

		const applyBCalls = applyB.mock.calls;
		const lastApplyBCall = applyBCalls.at(-1);
		expect(lastApplyBCall).toBeDefined();
		expect(lastApplyBCall?.[0]).toBeNull();
	});

	it("停止播放时会对同 session 的所有目标下发停止指令", () => {
		const applyA = vi.fn();
		const applyB = vi.fn();
		const elements = [
			createAudioClip("clip-a", 0, 30),
			createAudioClip("clip-b", 30, 60),
		];
		const targets = new Map([
			[
				"clip-a",
				{
					id: "clip-a",
					timeline: createTimeline(0, 30),
					audioDuration: 30,
					enabled: true,
					sessionKey: "session:shared",
					applyAudioMix: applyA,
				},
			],
			[
				"clip-b",
				{
					id: "clip-b",
					timeline: createTimeline(30, 60),
					audioDuration: 30,
					enabled: true,
					sessionKey: "session:shared",
					applyAudioMix: applyB,
				},
			],
		]);

		runTimelineAudioMixFrame({
			isPlaying: false,
			isExporting: false,
			displayTime: 10,
			fps: 30,
			elements,
			tracks: [createTrack()],
			audioTrackStates: {},
			targets,
		});

		expect(applyA).toHaveBeenCalledWith(null);
		expect(applyB).toHaveBeenCalledWith(null);
	});
});
