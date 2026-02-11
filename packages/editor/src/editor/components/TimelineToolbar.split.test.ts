import type { TimelineElement } from "core/dsl/types";
import { describe, expect, it } from "vitest";
import { buildSplitElements } from "./timelineSplit";

const createVideoClip = ({
	id,
	start,
	end,
	offset,
	reversed,
}: {
	id: string;
	start: number;
	end: number;
	offset: number;
	reversed: boolean;
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
		offset,
		trackIndex: 0,
	},
	props: {
		uri: "test.mp4",
		reversed,
	},
});

const createAudioClip = ({
	id,
	start,
	end,
	offset,
	reversed,
}: {
	id: string;
	start: number;
	end: number;
	offset: number;
	reversed: boolean;
}): TimelineElement => ({
	id,
	type: "AudioClip",
	component: "audio-clip",
	name: id,
	timeline: {
		start,
		end,
		startTimecode: "",
		endTimecode: "",
		offset,
		trackIndex: -1,
	},
	props: {
		uri: "test.mp3",
		reversed,
	},
});

describe("TimelineToolbar.buildSplitElements", () => {
	it("前向切割保持右侧 offset 递增", () => {
		const element = createVideoClip({
			id: "clip-1",
			start: 0,
			end: 90,
			offset: 30,
			reversed: false,
		});
		const { left, right } = buildSplitElements(element, 30, 30, "clip-2");
		expect(left.timeline.start).toBe(0);
		expect(left.timeline.end).toBe(30);
		expect(left.timeline.offset).toBe(30);
		expect(right.timeline.start).toBe(30);
		expect(right.timeline.end).toBe(90);
		expect(right.timeline.offset).toBe(60);
	});

	it("反向切割保持切点源时间连续", () => {
		const element = createVideoClip({
			id: "clip-1",
			start: 0,
			end: 90,
			offset: 30,
			reversed: true,
		});
		const { left, right } = buildSplitElements(element, 30, 30, "clip-2");
		expect(left.timeline.start).toBe(0);
		expect(left.timeline.end).toBe(30);
		expect(left.timeline.offset).toBe(90);
		expect(right.timeline.start).toBe(30);
		expect(right.timeline.end).toBe(90);
		expect(right.timeline.offset).toBe(30);
	});

	it("AudioClip 反向切割保持 offset 连续", () => {
		const element = createAudioClip({
			id: "audio-1",
			start: 0,
			end: 90,
			offset: 30,
			reversed: true,
		});
		const { left, right } = buildSplitElements(element, 30, 30, "audio-2");
		expect(left.timeline.start).toBe(0);
		expect(left.timeline.end).toBe(30);
		expect(left.timeline.offset).toBe(90);
		expect(right.timeline.start).toBe(30);
		expect(right.timeline.end).toBe(90);
		expect(right.timeline.offset).toBe(30);
	});
});
