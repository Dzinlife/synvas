import type { TimelineMeta } from "core/timeline-system/types";
import type { AudioTrackControlStateMap } from "core/timeline-system/utils/audioTrackState";
import { isTimelineTrackAudible } from "core/timeline-system/utils/trackAudibility";
import { describe, expect, it } from "vitest";
import type { TimelineTrack } from "../timeline/types";

const createTrack = (partial?: Partial<TimelineTrack>): TimelineTrack => ({
	id: "main",
	role: "clip",
	hidden: false,
	locked: false,
	muted: false,
	solo: false,
	...partial,
});

const createTimeline = (partial?: Partial<TimelineMeta>): TimelineMeta => ({
	start: 0,
	end: 30,
	startTimecode: "",
	endTimecode: "",
	trackIndex: 0,
	...partial,
});

describe("core trackAudibility", () => {
	it("普通可见轨道默认可听", () => {
		const audible = isTimelineTrackAudible(
			createTimeline(),
			[createTrack()],
			{},
		);
		expect(audible).toBe(true);
	});

	it("轨道 hidden 或 muted 时不可听", () => {
		const hidden = isTimelineTrackAudible(
			createTimeline(),
			[createTrack({ hidden: true })],
			{},
		);
		const muted = isTimelineTrackAudible(
			createTimeline(),
			[createTrack({ muted: true })],
			{},
		);
		expect(hidden).toBe(false);
		expect(muted).toBe(false);
	});

	it("存在 solo 轨时，仅 solo 轨可听", () => {
		const tracks = [
			createTrack({ solo: true }),
			createTrack({ id: "b", solo: false }),
		];
		const mainAudible = isTimelineTrackAudible(
			createTimeline({ trackIndex: 0 }),
			tracks,
			{},
		);
		const nonSoloAudible = isTimelineTrackAudible(
			createTimeline({ trackIndex: 1 }),
			tracks,
			{},
		);
		expect(mainAudible).toBe(true);
		expect(nonSoloAudible).toBe(false);
	});

	it("负轨索引走 audioTrackStates 判定", () => {
		const audioTrackStates: AudioTrackControlStateMap = {
			"-1": { locked: false, muted: true, solo: false },
		};
		const audible = isTimelineTrackAudible(
			createTimeline({ trackIndex: -1 }),
			[createTrack()],
			audioTrackStates,
		);
		expect(audible).toBe(false);
	});

	it("audioTrackStates 的 solo 会影响默认轨道", () => {
		const audioTrackStates: AudioTrackControlStateMap = {
			"-1": { locked: false, muted: false, solo: true },
		};
		const audible = isTimelineTrackAudible(
			createTimeline({ trackIndex: 0 }),
			[createTrack({ solo: false })],
			audioTrackStates,
		);
		expect(audible).toBe(false);
	});
});
