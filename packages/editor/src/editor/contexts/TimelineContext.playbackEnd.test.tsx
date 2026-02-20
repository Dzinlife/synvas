// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { TimelineElement } from "core/dsl/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as audioEngine from "../audio/audioEngine";
import { TimelineProvider, useTimelineStore } from "./TimelineContext";

const initialState = useTimelineStore.getState();

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

let rafQueue: FrameRequestCallback[] = [];
let rafNow = 0;

const flushNextAnimationFrame = (deltaMs = 16): boolean => {
	const callback = rafQueue.shift();
	if (!callback) return false;
	rafNow += deltaMs;
	callback(rafNow);
	return true;
};

describe("TimelineContext playback end guard", () => {
	beforeEach(() => {
		rafQueue = [];
		rafNow = 0;
		vi.spyOn(audioEngine, "getAudioContext").mockReturnValue(null);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			rafQueue.push(callback);
			return rafQueue.length;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		rafQueue = [];
		rafNow = 0;
		useTimelineStore.setState(initialState, true);
	});

	it("play 越界起播会立即停止并 seek 到末尾", () => {
		useTimelineStore.setState({
			elements: [createElement("clip-1", 0, 120)],
			currentTime: 140,
			previewTime: 12,
			isPlaying: false,
		});

		act(() => {
			useTimelineStore.getState().play();
		});

		const state = useTimelineStore.getState();
		expect(state.isPlaying).toBe(false);
		expect(state.currentTime).toBe(120);
		expect(state.previewTime).toBeNull();
	});

	it("togglePlay 越界起播会立即停止并 seek 到末尾", () => {
		useTimelineStore.setState({
			elements: [createElement("clip-1", 0, 90)],
			currentTime: 110,
			previewTime: 20,
			isPlaying: false,
		});

		act(() => {
			useTimelineStore.getState().togglePlay();
		});

		const state = useTimelineStore.getState();
		expect(state.isPlaying).toBe(false);
		expect(state.currentTime).toBe(90);
		expect(state.previewTime).toBeNull();
	});

	it("播放推进到末尾时会自动停止并钳制到末尾", async () => {
		render(
			<TimelineProvider elements={[createElement("clip-1", 0, 10)]} fps={30}>
				<div />
			</TimelineProvider>,
		);

		await waitFor(() => {
			expect(useTimelineStore.getState().elements).toHaveLength(1);
		});

		act(() => {
			useTimelineStore.setState({
				currentTime: 8,
				previewTime: null,
				isPlaying: false,
			});
		});

		act(() => {
			useTimelineStore.getState().play();
		});

		expect(useTimelineStore.getState().isPlaying).toBe(true);
		expect(rafQueue.length).toBeGreaterThan(0);

		act(() => {
			flushNextAnimationFrame(16);
		});
		expect(useTimelineStore.getState().isPlaying).toBe(true);

		act(() => {
			flushNextAnimationFrame(100);
		});

		const stopped = useTimelineStore.getState();
		expect(stopped.isPlaying).toBe(false);
		expect(stopped.currentTime).toBe(10);
		expect(stopped.getRenderTime()).toBe(9);
		expect(rafQueue.length).toBe(0);

		const didRun = flushNextAnimationFrame(100);
		expect(didRun).toBe(false);
		expect(useTimelineStore.getState().currentTime).toBe(10);
	});

	it("播放中末尾缩短后下一帧会停在新末尾", async () => {
		render(
			<TimelineProvider elements={[createElement("clip-1", 0, 20)]} fps={30}>
				<div />
			</TimelineProvider>,
		);

		await waitFor(() => {
			expect(useTimelineStore.getState().elements).toHaveLength(1);
		});

		act(() => {
			useTimelineStore.setState({
				currentTime: 15,
				previewTime: null,
				isPlaying: false,
			});
		});

		act(() => {
			useTimelineStore.getState().play();
			flushNextAnimationFrame(16);
		});
		expect(useTimelineStore.getState().isPlaying).toBe(true);

		act(() => {
			useTimelineStore
				.getState()
				.setElements([createElement("clip-1", 0, 14)], { history: false });
		});

		act(() => {
			flushNextAnimationFrame(16);
		});

		const stopped = useTimelineStore.getState();
		expect(stopped.isPlaying).toBe(false);
		expect(stopped.currentTime).toBe(14);
		expect(rafQueue.length).toBe(0);
	});

	it("Filter 不影响播放停止边界", () => {
		useTimelineStore.setState({
			elements: [
				createElement("clip-1", 0, 120, "VideoClip"),
				createElement("filter-1", 0, 300, "Filter"),
			],
			currentTime: 140,
			previewTime: null,
			isPlaying: false,
		});

		act(() => {
			useTimelineStore.getState().play();
		});

		const state = useTimelineStore.getState();
		expect(state.isPlaying).toBe(false);
		expect(state.currentTime).toBe(120);
	});
});
