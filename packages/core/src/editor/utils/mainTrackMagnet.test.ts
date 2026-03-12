import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../../element/types";
import {
	insertElementIntoMainTrack,
	insertElementsIntoMainTrackGroup,
} from "./mainTrackMagnet";

const createMainClip = (
	id: string,
	start: number,
	end: number,
): TimelineElement => ({
	id,
	type: "VideoClip",
	component: "video-clip",
	name: id,
	timeline: {
		start,
		end,
		startTimecode: "",
		endTimecode: "",
		trackIndex: 0,
	},
	props: {},
});

describe("mainTrackMagnet insert pointer time", () => {
	it("主轨插入使用鼠标时间时，宽片段可插到窄片段前", () => {
		const elements = [
			createMainClip("clip-1", 0, 30),
			createMainClip("clip-2", 30, 150),
		];

		const next = insertElementIntoMainTrack(
			elements,
			"clip-2",
			0,
			{ rippleEditingEnabled: true },
			undefined,
			10,
		);

		const clip1 = next.find((element) => element.id === "clip-1");
		const clip2 = next.find((element) => element.id === "clip-2");
		expect(clip2?.timeline.start).toBe(0);
		expect(clip2?.timeline.end).toBe(120);
		expect(clip1?.timeline.start).toBe(120);
		expect(clip1?.timeline.end).toBe(150);
	});

	it("多选组插入优先使用鼠标时间判定插入索引", () => {
		const elements = [
			createMainClip("clip-1", 0, 30),
			createMainClip("clip-2", 30, 60),
			createMainClip("clip-3", 60, 180),
		];

		const next = insertElementsIntoMainTrackGroup(
			elements,
			["clip-2", "clip-3"],
			0,
			{ rippleEditingEnabled: true },
			10,
		);

		const clip1 = next.find((element) => element.id === "clip-1");
		const clip2 = next.find((element) => element.id === "clip-2");
		const clip3 = next.find((element) => element.id === "clip-3");
		expect(clip2?.timeline.start).toBe(0);
		expect(clip3?.timeline.start).toBe(30);
		expect(clip1?.timeline.start).toBe(150);
	});

	it("未传鼠标时间时保持原有中心点兼容行为", () => {
		const elements = [
			createMainClip("clip-1", 0, 30),
			createMainClip("clip-2", 30, 150),
		];

		const next = insertElementIntoMainTrack(elements, "clip-2", 0, {
			rippleEditingEnabled: true,
		});

		const clip1 = next.find((element) => element.id === "clip-1");
		const clip2 = next.find((element) => element.id === "clip-2");
		expect(clip1?.timeline.start).toBe(0);
		expect(clip2?.timeline.start).toBe(30);
	});
});
