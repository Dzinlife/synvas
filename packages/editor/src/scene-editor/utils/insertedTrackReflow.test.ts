import type { TimelineElement } from "core/timeline-system/types";
import { describe, expect, it } from "vitest";
import { reflowInsertedElementsOnTracks } from "./insertedTrackReflow";

const createClip = ({
	id,
	start,
	end,
	trackIndex,
}: {
	id: string;
	start: number;
	end: number;
	trackIndex: number;
}): TimelineElement => ({
	id,
	type: "VideoClip",
	component: "video-clip",
	name: id,
	timeline: {
		start,
		end,
		startTimecode: "",
		endTimecode: "",
		trackIndex,
	},
	props: {
		uri: `${id}.mp4`,
	},
});

describe("reflowInsertedElementsOnTracks", () => {
	it("无冲突时保持插入轨道不变", () => {
		const base = [createClip({ id: "base", start: 0, end: 30, trackIndex: 0 })];
		const inserted = [
			createClip({ id: "inserted", start: 30, end: 60, trackIndex: 0 }),
		];

		const reflowed = reflowInsertedElementsOnTracks(base, inserted);
		expect(reflowed).toHaveLength(1);
		expect(reflowed[0].timeline.trackIndex).toBe(0);
	});

	it("与已有轨道重叠时会向上寻找可用轨道", () => {
		const base = [createClip({ id: "base", start: 0, end: 100, trackIndex: 0 })];
		const inserted = [
			createClip({ id: "inserted", start: 20, end: 60, trackIndex: 0 }),
		];

		const reflowed = reflowInsertedElementsOnTracks(base, inserted);
		expect(reflowed).toHaveLength(1);
		expect(reflowed[0].timeline.trackIndex).toBe(1);
	});

	it("保持与粘贴逻辑一致：多元素重叠按顺序继续上推轨道", () => {
		const base = [
			createClip({ id: "base-0", start: 0, end: 100, trackIndex: 0 }),
			createClip({ id: "base-1", start: 0, end: 100, trackIndex: 1 }),
		];
		const inserted = [
			createClip({ id: "inserted-a", start: 10, end: 20, trackIndex: 0 }),
			createClip({ id: "inserted-b", start: 10, end: 20, trackIndex: 0 }),
		];

		const reflowed = reflowInsertedElementsOnTracks(base, inserted);
		expect(reflowed).toHaveLength(2);
		expect(reflowed[0].timeline.trackIndex).toBe(2);
		expect(reflowed[1].timeline.trackIndex).toBe(3);
	});
});
