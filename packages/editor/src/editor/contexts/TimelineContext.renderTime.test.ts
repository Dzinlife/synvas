import type { TimelineElement } from "core/dsl/types";
import { afterEach, describe, expect, it } from "vitest";
import { useTimelineStore } from "./TimelineContext";

const initialState = useTimelineStore.getState();

const createElement = (
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
	props: {
		uri: `${id}.mp4`,
	},
});

afterEach(() => {
	useTimelineStore.setState(initialState, true);
});

describe("TimelineContext render time", () => {
	it("非导出时 currentTime 等于末尾会回退一帧", () => {
		useTimelineStore.setState({
			elements: [createElement("clip-1", 0, 120)],
			currentTime: 120,
			previewTime: null,
			isPlaying: false,
			isExporting: false,
			exportTime: null,
		});

		expect(useTimelineStore.getState().getRenderTime()).toBe(119);
	});

	it("非导出时 currentTime 超过末尾不回退", () => {
		useTimelineStore.setState({
			elements: [createElement("clip-1", 0, 120)],
			currentTime: 121,
			previewTime: null,
			isPlaying: false,
			isExporting: false,
			exportTime: null,
		});

		expect(useTimelineStore.getState().getRenderTime()).toBe(121);
	});

	it("非导出暂停态 previewTime 等于末尾会回退一帧", () => {
		useTimelineStore.setState({
			elements: [createElement("clip-1", 0, 120)],
			currentTime: 0,
			previewTime: 120,
			isPlaying: false,
			isExporting: false,
			exportTime: null,
		});

		expect(useTimelineStore.getState().getRenderTime()).toBe(119);
	});

	it("空时间线不会回退到负数", () => {
		useTimelineStore.setState({
			elements: [],
			currentTime: 0,
			previewTime: null,
			isPlaying: false,
			isExporting: false,
			exportTime: null,
		});

		expect(useTimelineStore.getState().getRenderTime()).toBe(0);
	});

	it("导出态不做末尾回退", () => {
		useTimelineStore.setState({
			elements: [createElement("clip-1", 0, 120)],
			currentTime: 120,
			previewTime: null,
			isPlaying: false,
			isExporting: true,
			exportTime: 120,
		});

		expect(useTimelineStore.getState().getRenderTime()).toBe(120);
	});
});
