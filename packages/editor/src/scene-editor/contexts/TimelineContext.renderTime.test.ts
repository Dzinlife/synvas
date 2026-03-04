import type { TimelineElement } from "core/element/types";
import { afterEach, describe, expect, it } from "vitest";
import { createTestEditorRuntime } from "../runtime/testUtils";

const runtime = createTestEditorRuntime("timeline-render-time-test");
const timelineStore = runtime.timelineStore;
const initialState = timelineStore.getState();

const createElement = (
	id: string,
	start: number,
	end: number,
	type: TimelineElement["type"] = "VideoClip",
): TimelineElement => ({
	id,
	type,
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
	timelineStore.setState(initialState, true);
});

describe("TimelineContext render time", () => {
	it("非导出时 currentTime 等于末尾会回退一帧", () => {
		timelineStore.setState({
			elements: [createElement("clip-1", 0, 120)],
			currentTime: 120,
			previewTime: null,
			isPlaying: false,
			isExporting: false,
			exportTime: null,
		});

		expect(timelineStore.getState().getRenderTime()).toBe(119);
	});

	it("非导出时 currentTime 超过末尾不回退", () => {
		timelineStore.setState({
			elements: [createElement("clip-1", 0, 120)],
			currentTime: 121,
			previewTime: null,
			isPlaying: false,
			isExporting: false,
			exportTime: null,
		});

		expect(timelineStore.getState().getRenderTime()).toBe(121);
	});

	it("非导出暂停态 previewTime 等于末尾会回退一帧", () => {
		timelineStore.setState({
			elements: [createElement("clip-1", 0, 120)],
			currentTime: 0,
			previewTime: 120,
			isPlaying: false,
			isExporting: false,
			exportTime: null,
		});

		expect(timelineStore.getState().getRenderTime()).toBe(119);
	});

	it("空时间线不会回退到负数", () => {
		timelineStore.setState({
			elements: [],
			currentTime: 0,
			previewTime: null,
			isPlaying: false,
			isExporting: false,
			exportTime: null,
		});

		expect(timelineStore.getState().getRenderTime()).toBe(0);
	});

	it("导出态不做末尾回退", () => {
		timelineStore.setState({
			elements: [createElement("clip-1", 0, 120)],
			currentTime: 120,
			previewTime: null,
			isPlaying: false,
			isExporting: true,
			exportTime: 120,
		});

		expect(timelineStore.getState().getRenderTime()).toBe(120);
	});

	it("Filter 不参与末帧回退计算", () => {
		timelineStore.setState({
			elements: [
				createElement("clip-1", 0, 120, "VideoClip"),
				createElement("filter-1", 0, 300, "Filter"),
			],
			currentTime: 120,
			previewTime: null,
			isPlaying: false,
			isExporting: false,
			exportTime: null,
		});

		expect(timelineStore.getState().getRenderTime()).toBe(119);
	});
});
