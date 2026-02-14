// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type { TimelineElement } from "core/dsl/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineStore } from "../contexts/TimelineContext";
import { getPixelsPerFrame } from "../utils/timelineScale";
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

const initialState = useTimelineStore.getState();

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
		useTimelineStore.setState({
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
		useTimelineStore.setState(initialState, true);
	});

	it("点击 minimap 空白区域会跳转 viewport 且不影响 currentTime", () => {
		render(<TimelineMinimap fps={30} timelinePaddingLeft={48} />);

		const minimap = screen.getByLabelText("timeline minimap");
		fireEvent.pointerDown(minimap, { button: 0, clientX: 100, pointerId: 1 });

		const ratio = getPixelsPerFrame(30, 1);
		const visibleFrameCount = 120 / ratio;
		const expectedStartFrame = 180 - visibleFrameCount / 2;
		const expectedScrollLeft = expectedStartFrame * ratio + 48;

		expect(useTimelineStore.getState().scrollLeft).toBeCloseTo(
			expectedScrollLeft,
		);
		expect(useTimelineStore.getState().currentTime).toBe(88);
	});

	it("拖动 viewport 会连续更新 scrollLeft", () => {
		useTimelineStore.setState({ scrollLeft: 100 });
		render(<TimelineMinimap fps={30} timelinePaddingLeft={48} />);

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

		expect(useTimelineStore.getState().scrollLeft).toBeGreaterThan(100);
	});

	it("拖拽/点击时会正确 clamp 到边界", () => {
		render(<TimelineMinimap fps={30} timelinePaddingLeft={48} />);
		const minimap = screen.getByLabelText("timeline minimap");
		fireEvent.pointerDown(minimap, { button: 0, clientX: 500, pointerId: 3 });

		const maxScrollLeft = 528;
		expect(useTimelineStore.getState().scrollLeft).toBeCloseTo(maxScrollLeft);
	});

	it("无元素时仍可渲染且不会抛错", () => {
		useTimelineStore.setState({
			elements: [],
			scrollLeft: 0,
		});
		render(<TimelineMinimap fps={30} timelinePaddingLeft={48} />);
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
		render(<TimelineMinimap fps={30} timelinePaddingLeft={48} />);
		const minimap = screen.getByLabelText("timeline minimap");
		const viewport = minimap.querySelector('[data-minimap-viewport="true"]');
		expect(viewport).not.toBeNull();

		const beforeWidth = Number.parseFloat(
			(viewport as HTMLElement).style.width,
		);
		act(() => {
			useTimelineStore.setState({ timelineScale: 2 });
		});
		const afterWidth = Number.parseFloat((viewport as HTMLElement).style.width);
		expect(afterWidth).toBeLessThan(beforeWidth);
	});
});
