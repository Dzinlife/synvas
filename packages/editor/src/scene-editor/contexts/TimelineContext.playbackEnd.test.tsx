// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { TimelineElement } from "core/timeline-system/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as audioEngine from "@/audio/engine";
import {
	createRuntimeProviderWrapper,
	createTestEditorRuntime,
} from "../runtime/testUtils";
import { TimelineProvider } from "./TimelineContext";

const runtime = createTestEditorRuntime("timeline-playback-end-test");
const timelineStore = runtime.timelineStore;
const wrapper = createRuntimeProviderWrapper(runtime);
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

let rafQueue: Array<{ id: number; callback: FrameRequestCallback }> = [];
let rafNow = 0;
let rafIdSeed = 0;

const flushNextAnimationFrame = (deltaMs = 16): boolean => {
	const frame = rafQueue.shift();
	if (!frame) return false;
	rafNow += deltaMs;
	frame.callback(rafNow);
	return true;
};

describe("TimelineContext playback end guard", () => {
	beforeEach(() => {
		rafQueue = [];
		rafNow = 0;
		rafIdSeed = 0;
		vi.spyOn(audioEngine, "getAudioContext").mockReturnValue(null);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			rafIdSeed += 1;
			const id = rafIdSeed;
			rafQueue.push({ id, callback });
			return id;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number) => {
			rafQueue = rafQueue.filter((entry) => entry.id !== id);
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		rafQueue = [];
		rafNow = 0;
		rafIdSeed = 0;
		timelineStore.setState(initialState, true);
	});

	it("play 越界起播会立即停止并 seek 到末尾", () => {
		timelineStore.setState({
			elements: [createElement("clip-1", 0, 120)],
			currentTime: 140,
			previewTime: 12,
			isPlaying: false,
		});

		act(() => {
			timelineStore.getState().play();
		});

		const state = timelineStore.getState();
		expect(state.isPlaying).toBe(false);
		expect(state.currentTime).toBe(120);
		expect(state.previewTime).toBeNull();
	});

	it("togglePlay 越界起播会立即停止并 seek 到末尾", () => {
		timelineStore.setState({
			elements: [createElement("clip-1", 0, 90)],
			currentTime: 110,
			previewTime: 20,
			isPlaying: false,
		});

		act(() => {
			timelineStore.getState().togglePlay();
		});

		const state = timelineStore.getState();
		expect(state.isPlaying).toBe(false);
		expect(state.currentTime).toBe(90);
		expect(state.previewTime).toBeNull();
	});

	it("播放推进到末尾时会自动停止并钳制到末尾", async () => {
		render(
			<TimelineProvider elements={[createElement("clip-1", 0, 10)]} fps={30}>
				<div />
			</TimelineProvider>,
			{ wrapper },
		);

		await waitFor(() => {
			expect(timelineStore.getState().elements).toHaveLength(1);
		});

		act(() => {
			timelineStore.setState({
				currentTime: 8,
				previewTime: null,
				isPlaying: false,
			});
		});

		act(() => {
			timelineStore.getState().play();
		});

		expect(timelineStore.getState().isPlaying).toBe(true);
		expect(rafQueue.length).toBeGreaterThan(0);

		act(() => {
			flushNextAnimationFrame(16);
		});
		expect(timelineStore.getState().isPlaying).toBe(true);

		act(() => {
			flushNextAnimationFrame(100);
		});

		const stopped = timelineStore.getState();
		expect(stopped.isPlaying).toBe(false);
		expect(stopped.currentTime).toBe(10);
		expect(stopped.getRenderTime()).toBe(9);
		expect(rafQueue.length).toBe(0);

		const didRun = flushNextAnimationFrame(100);
		expect(didRun).toBe(false);
		expect(timelineStore.getState().currentTime).toBe(10);
	});

	it("播放中末尾缩短后下一帧会停在新末尾", async () => {
		render(
			<TimelineProvider elements={[createElement("clip-1", 0, 20)]} fps={30}>
				<div />
			</TimelineProvider>,
			{ wrapper },
		);

		await waitFor(() => {
			expect(timelineStore.getState().elements).toHaveLength(1);
		});

		act(() => {
			timelineStore.setState({
				currentTime: 15,
				previewTime: null,
				isPlaying: false,
			});
		});

		act(() => {
			timelineStore.getState().play();
			flushNextAnimationFrame(16);
		});
		expect(timelineStore.getState().isPlaying).toBe(true);

		act(() => {
			timelineStore
				.getState()
				.setElements([createElement("clip-1", 0, 14)], { history: false });
		});

		act(() => {
			flushNextAnimationFrame(16);
		});

		const stopped = timelineStore.getState();
		expect(stopped.isPlaying).toBe(false);
		expect(stopped.currentTime).toBe(14);
		expect(rafQueue.length).toBe(0);
	});

	it("播放中卸载 TimelineProvider 会停止 RAF 循环", async () => {
		const view = render(
			<TimelineProvider elements={[createElement("clip-1", 0, 200)]} fps={30}>
				<div />
			</TimelineProvider>,
			{ wrapper },
		);

		await waitFor(() => {
			expect(timelineStore.getState().elements).toHaveLength(1);
		});

		act(() => {
			timelineStore.setState({
				currentTime: 10,
				previewTime: null,
				isPlaying: false,
			});
			timelineStore.getState().play();
		});
		expect(timelineStore.getState().isPlaying).toBe(true);
		expect(rafQueue.length).toBeGreaterThan(0);

		act(() => {
			view.unmount();
		});
		expect(rafQueue.length).toBe(0);

		const didRun = flushNextAnimationFrame(16);
		expect(didRun).toBe(false);
	});

	it("Filter 不影响播放停止边界", () => {
		timelineStore.setState({
			elements: [
				createElement("clip-1", 0, 120, "VideoClip"),
				createElement("filter-1", 0, 300, "Filter"),
			],
			currentTime: 140,
			previewTime: null,
			isPlaying: false,
		});

		act(() => {
			timelineStore.getState().play();
		});

		const state = timelineStore.getState();
		expect(state.isPlaying).toBe(false);
		expect(state.currentTime).toBe(120);
	});
});
