// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type { TimelineElement } from "core/element/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createEditorRuntimeWrapper,
	createTestEditorRuntime,
} from "../runtime/testUtils";
import { getPixelsPerFrame } from "../utils/timelineScale";
import {
	MAX_TIMELINE_SCALE,
	MIN_TIMELINE_SCALE,
} from "../utils/timelineZoom";
import TimelineMinimap from "./TimelineMinimap";

const createElement = ({
	id,
	type,
	start,
	end,
	trackIndex,
}: {
	id: string;
	type: TimelineElement["type"];
	start: number;
	end: number;
	trackIndex: number;
}): TimelineElement => ({
	id,
	type,
	component: "mock",
	name: id,
	timeline: {
		start,
		end,
		startTimecode: "",
		endTimecode: "",
		trackIndex,
	},
	props: {},
});

const runtime = createTestEditorRuntime("timeline-minimap-test");
const timelineStore = runtime.timelineStore;
const wrapper = createEditorRuntimeWrapper(runtime);
const initialState = timelineStore.getState();
const FPS = 30;
const TIMELINE_PADDING_LEFT = 48;

const resolveVisibleRange = () => {
	const state = timelineStore.getState();
	const ratio = getPixelsPerFrame(FPS, state.timelineScale);
	const visibleFrameCount =
		ratio > 0 ? state.timelineViewportWidth / ratio : 0;
	const maxStartFrame =
		ratio > 0
			? Math.max(0, (state.timelineMaxScrollLeft - TIMELINE_PADDING_LEFT) / ratio)
			: 0;
	const startFrame =
		ratio > 0
			? Math.min(
					Math.max((state.scrollLeft - TIMELINE_PADDING_LEFT) / ratio, 0),
					maxStartFrame,
				)
			: 0;
	return {
		startFrame,
		endFrame: startFrame + visibleFrameCount,
	};
};

describe("TimelineMinimap", () => {
	beforeEach(() => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			() =>
				({
					x: 0,
					y: 0,
					top: 0,
					left: 0,
					bottom: 20,
					right: 200,
					width: 200,
					height: 20,
					toJSON: () => ({}),
				}) as DOMRect,
		);
		timelineStore.setState({
			elements: [
				createElement({
					id: "video-1",
					type: "VideoClip",
					start: 0,
					end: 300,
					trackIndex: 0,
				}),
				createElement({
					id: "audio-1",
					type: "AudioClip",
					start: 30,
					end: 240,
					trackIndex: -1,
				}),
			],
			timelineScale: 1,
			scrollLeft: 0,
			timelineMaxScrollLeft: 528,
			timelineViewportWidth: 120,
			currentTime: 88,
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		timelineStore.setState(initialState, true);
	});

	it("点击 minimap 空白区域会跳转 viewport 且不影响 currentTime", () => {
		render(<TimelineMinimap fps={FPS} timelinePaddingLeft={TIMELINE_PADDING_LEFT} />, { wrapper });

		const minimap = screen.getByLabelText("timeline minimap");
		fireEvent.pointerDown(minimap, { button: 0, clientX: 100, pointerId: 1 });

		const ratio = getPixelsPerFrame(FPS, 1);
		const visibleFrameCount = 120 / ratio;
		const expectedStartFrame = 180 - visibleFrameCount / 2;
		const expectedScrollLeft = expectedStartFrame * ratio + TIMELINE_PADDING_LEFT;

		expect(timelineStore.getState().scrollLeft).toBeCloseTo(
			expectedScrollLeft,
		);
		expect(timelineStore.getState().currentTime).toBe(88);
	});

	it("拖动 viewport 会连续更新 scrollLeft", () => {
		timelineStore.setState({ scrollLeft: 100 });
		render(<TimelineMinimap fps={FPS} timelinePaddingLeft={TIMELINE_PADDING_LEFT} />, { wrapper });

		const minimap = screen.getByLabelText("timeline minimap");
		const viewport = minimap.querySelector('[data-minimap-viewport="true"]');
		expect(viewport).not.toBeNull();

		fireEvent.pointerDown(viewport as Element, {
			button: 0,
			clientX: 40,
			pointerId: 2,
		});
		fireEvent.pointerMove(minimap, { clientX: 120, pointerId: 2 });
		fireEvent.pointerUp(minimap, { pointerId: 2 });

		expect(timelineStore.getState().scrollLeft).toBeGreaterThan(100);
	});

	it("拖拽/点击时会正确 clamp 到边界", () => {
		render(<TimelineMinimap fps={FPS} timelinePaddingLeft={TIMELINE_PADDING_LEFT} />, { wrapper });
		const minimap = screen.getByLabelText("timeline minimap");
		fireEvent.pointerDown(minimap, { button: 0, clientX: 500, pointerId: 3 });

		const maxScrollLeft = 528;
		expect(timelineStore.getState().scrollLeft).toBeCloseTo(maxScrollLeft);
	});

	it("无元素时仍可渲染且不会抛错", () => {
		timelineStore.setState({
			elements: [],
			scrollLeft: 0,
		});
		render(<TimelineMinimap fps={FPS} timelinePaddingLeft={TIMELINE_PADDING_LEFT} />, { wrapper });
		expect(screen.getByLabelText("timeline minimap")).toBeTruthy();
		expect(
			screen
				.getByLabelText("timeline minimap")
				.querySelector('[data-minimap-viewport="true"]'),
		).not.toBeNull();
		expect(
			screen.getByLabelText("timeline minimap").querySelector("canvas"),
		).not.toBeNull();
	});

	it("缩放变化时 viewport 宽度会按比例变化", () => {
		render(<TimelineMinimap fps={FPS} timelinePaddingLeft={TIMELINE_PADDING_LEFT} />, { wrapper });
		const minimap = screen.getByLabelText("timeline minimap");
		const viewport = minimap.querySelector('[data-minimap-viewport="true"]');
		expect(viewport).not.toBeNull();

		const beforeWidth = Number.parseFloat(
			(viewport as HTMLElement).style.width,
		);
		act(() => {
			timelineStore.setState({ timelineScale: 2 });
		});
		const afterWidth = Number.parseFloat((viewport as HTMLElement).style.width);
		expect(afterWidth).toBeLessThan(beforeWidth);
	});

	it("左手柄拖拽会改变缩放并保持右边界帧稳定", () => {
		timelineStore.setState({
			scrollLeft: 100,
			timelineScale: 1,
			timelineMaxScrollLeft: 10_000,
		});
		render(<TimelineMinimap fps={FPS} timelinePaddingLeft={TIMELINE_PADDING_LEFT} />, { wrapper });
		const minimap = screen.getByLabelText("timeline minimap");
		const leftHandle = minimap.querySelector(
			'[data-minimap-resize-handle="left"]',
		);
		expect(leftHandle).not.toBeNull();

		const before = resolveVisibleRange();
		fireEvent.pointerDown(leftHandle as Element, {
			button: 0,
			clientX: 40,
			pointerId: 10,
		});
		fireEvent.pointerMove(minimap, { clientX: 80, pointerId: 10 });
		fireEvent.pointerUp(minimap, { pointerId: 10 });

		const after = resolveVisibleRange();
		expect(timelineStore.getState().timelineScale).toBeGreaterThan(1);
		expect(after.endFrame).toBeCloseTo(before.endFrame, 1);
	});

	it("右手柄拖拽会改变缩放并保持左边界帧稳定", () => {
		timelineStore.setState({
			scrollLeft: 100,
			timelineScale: 1,
			timelineMaxScrollLeft: 10_000,
		});
		render(<TimelineMinimap fps={FPS} timelinePaddingLeft={TIMELINE_PADDING_LEFT} />, { wrapper });
		const minimap = screen.getByLabelText("timeline minimap");
		const rightHandle = minimap.querySelector(
			'[data-minimap-resize-handle="right"]',
		);
		expect(rightHandle).not.toBeNull();

		const before = resolveVisibleRange();
		fireEvent.pointerDown(rightHandle as Element, {
			button: 0,
			clientX: 90,
			pointerId: 11,
		});
		fireEvent.pointerMove(minimap, { clientX: 60, pointerId: 11 });
		fireEvent.pointerUp(minimap, { pointerId: 11 });

		const after = resolveVisibleRange();
		expect(timelineStore.getState().timelineScale).toBeGreaterThan(1);
		expect(after.startFrame).toBeCloseTo(before.startFrame, 1);
	});

	it("手柄缩放会被最小/最大缩放范围 clamp", () => {
		timelineStore.setState({
			scrollLeft: 120,
			timelineScale: 1,
		});
		render(<TimelineMinimap fps={FPS} timelinePaddingLeft={TIMELINE_PADDING_LEFT} />, { wrapper });
		const minimap = screen.getByLabelText("timeline minimap");
		const leftHandle = minimap.querySelector(
			'[data-minimap-resize-handle="left"]',
		);
		const rightHandle = minimap.querySelector(
			'[data-minimap-resize-handle="right"]',
		);
		expect(leftHandle).not.toBeNull();
		expect(rightHandle).not.toBeNull();

		fireEvent.pointerDown(leftHandle as Element, {
			button: 0,
			clientX: 40,
			pointerId: 12,
		});
		fireEvent.pointerMove(minimap, { clientX: 500, pointerId: 12 });
		fireEvent.pointerUp(minimap, { pointerId: 12 });
		expect(timelineStore.getState().timelineScale).toBeLessThanOrEqual(
			MAX_TIMELINE_SCALE,
		);

		fireEvent.pointerDown(rightHandle as Element, {
			button: 0,
			clientX: 90,
			pointerId: 13,
		});
		fireEvent.pointerMove(minimap, { clientX: 5000, pointerId: 13 });
		fireEvent.pointerUp(minimap, { pointerId: 13 });
		expect(timelineStore.getState().timelineScale).toBeGreaterThanOrEqual(
			MIN_TIMELINE_SCALE,
		);
		expect(timelineStore.getState().timelineScale).toBeLessThanOrEqual(
			MAX_TIMELINE_SCALE,
		);
	});
});
