// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { TimelineElement } from "core/dsl/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createEditorRuntimeWrapper,
	createTestEditorRuntime,
} from "./runtime/testUtils";
import TimelineEditor from "./TimelineEditor";

vi.mock("@use-gesture/react", () => ({
	useDrag: () => () => ({}),
}));

vi.mock("@/components/ui/progressive-blur", () => ({
	ProgressiveBlur: () => null,
}));

vi.mock("@/editor/components/TimeIndicatorCanvas", () => ({
	default: () => null,
}));

vi.mock("./components/TimelineContextMenu", () => ({
	default: () => null,
}));

vi.mock("./components/TimelineDragOverlay", () => ({
	default: () => null,
}));

vi.mock("./components/TimelineElement", () => ({
	default: () => null,
}));

vi.mock("./components/TimelineRuler", () => ({
	default: () => <div data-testid="timeline-ruler" />,
}));

vi.mock("./components/TimelineToolbar", () => ({
	default: () => <div data-testid="timeline-toolbar" />,
}));

vi.mock("./components/TimelineTrackSidebarItem", () => ({
	default: () => <div data-testid="timeline-track-sidebar-item" />,
}));

vi.mock("./drag", () => {
	const dragStoreState = {
		setTimelineScrollLeft: vi.fn(),
		isDragging: false,
		dragSource: null,
		autoScrollSpeedX: 0,
		autoScrollSpeedY: 0,
	};
	return {
		MaterialDragOverlay: () => null,
		useDragStore: (selector: (state: typeof dragStoreState) => unknown) =>
			selector(dragStoreState),
	};
});

vi.mock("./hooks/useExternalMaterialDnd", () => ({
	useExternalMaterialDnd: () => ({
		handleExternalDragEnter: vi.fn(),
		handleExternalDragOver: vi.fn(),
		handleExternalDragLeave: vi.fn(),
		handleExternalDrop: vi.fn(),
	}),
}));

const runtime = createTestEditorRuntime("timeline-editor-minimap-test");
const timelineStore = runtime.timelineStore;
const wrapper = createEditorRuntimeWrapper(runtime);
const initialState = timelineStore.getState();
let resizeObserverCallback: ResizeObserverCallback | null = null;

class ResizeObserverMock {
	constructor(callback: ResizeObserverCallback) {
		resizeObserverCallback = callback;
	}

	observe() {}

	unobserve() {}

	disconnect() {}
}

const createElement = ({
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

describe("TimelineEditor minimap sync", () => {
	beforeEach(() => {
		vi.stubGlobal("ResizeObserver", ResizeObserverMock);
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
		timelineStore.setState(
			{
				...initialState,
				elements: [],
				scrollLeft: 0,
				timelineScale: 1,
				timelineMaxScrollLeft: 0,
				timelineViewportWidth: 0,
			},
			true,
		);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		resizeObserverCallback = null;
		timelineStore.setState(initialState, true);
	});

	it("rulerWidth 变化会同步到 timelineViewportWidth", async () => {
		render(<TimelineEditor />, { wrapper });

		await waitFor(() => {
			expect(timelineStore.getState().timelineViewportWidth).toBe(800);
		});

		act(() => {
			resizeObserverCallback?.(
				[
					{
						contentRect: {
							width: 640,
							height: 24,
						},
					} as ResizeObserverEntry,
				],
				{} as ResizeObserver,
			);
		});

		await waitFor(() => {
			expect(timelineStore.getState().timelineViewportWidth).toBe(640);
		});
	});

	it("根据时间线内容计算并限制最大滚动", async () => {
		timelineStore.setState({
			elements: [
				createElement({
					id: "clip-1",
					start: 0,
					end: 3000,
					trackIndex: 0,
				}),
			],
			scrollLeft: 9999,
			timelineScale: 1,
			fps: 30,
			timelineMaxScrollLeft: 0,
		});
		render(<TimelineEditor />, { wrapper });

		await waitFor(() => {
			expect(timelineStore.getState().timelineMaxScrollLeft).toBeCloseTo(
				4448,
			);
		});
		expect(timelineStore.getState().scrollLeft).toBeCloseTo(4448);
	});

	it("scrollLeft 为 0 且锚点在内容内时，缩放会按锚点产生滚动", async () => {
		timelineStore.setState({
			elements: [
				createElement({
					id: "clip-zoom-inner",
					start: 0,
					end: 3000,
					trackIndex: 0,
				}),
			],
			scrollLeft: 0,
			timelineScale: 1,
			fps: 30,
		});
		render(<TimelineEditor />, { wrapper });

		const scrollArea = document.querySelector("[data-timeline-scroll-area]");
		expect(scrollArea).not.toBeNull();
		act(() => {
			scrollArea?.dispatchEvent(
				new WheelEvent("wheel", {
					ctrlKey: true,
					deltaY: -100,
					clientX: 600,
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		await waitFor(() => {
			expect(timelineStore.getState().scrollLeft).toBeGreaterThan(0);
		});
	});

	it("scrollLeft 为 0 且锚点在最后元素之后时，缩放保持 0 点", async () => {
		timelineStore.setState({
			elements: [
				createElement({
					id: "clip-zoom-tail",
					start: 0,
					end: 340,
					trackIndex: 0,
				}),
			],
			scrollLeft: 0,
			timelineScale: 1,
			fps: 30,
		});
		render(<TimelineEditor />, { wrapper });

		const scrollArea = document.querySelector("[data-timeline-scroll-area]");
		expect(scrollArea).not.toBeNull();
		act(() => {
			scrollArea?.dispatchEvent(
				new WheelEvent("wheel", {
					ctrlKey: true,
					deltaY: -100,
					clientX: 800,
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		await waitFor(() => {
			expect(timelineStore.getState().timelineScale).toBeGreaterThan(1);
		});
		expect(timelineStore.getState().scrollLeft).toBe(0);
	});
});
