// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import type { TimelineElement } from "core/timeline-system/types";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTimelineElementDnd } from "./useTimelineElementDnd";

vi.mock("@use-gesture/react", () => ({
	useDrag: (
		handler: (state: {
			movement: [number, number];
			first: boolean;
			last: boolean;
			event?: MouseEvent;
			tap: boolean;
			xy: [number, number];
		}) => void,
	) => handler,
}));

vi.mock("../contexts/TimelineContext", () => {
	const storeState = {
		tracks: [{ id: "track-main", locked: false }],
		audioTrackStates: {},
	};
	return {
		useTimelineStore: (
			selector: (state: typeof storeState) => unknown,
		) => selector(storeState),
	};
});

vi.mock("../runtime/EditorRuntimeProvider", () => ({
	useTimelineStoreApi: () => ({
		getState: () => ({
			scrollLeft: 0,
		}),
	}),
}));

interface HarnessProps {
	options: Parameters<typeof useTimelineElementDnd>[0];
	onReady: (bindBodyDrag: ReturnType<typeof useTimelineElementDnd>["bindBodyDrag"]) => void;
}

const Harness: React.FC<HarnessProps> = ({ options, onReady }) => {
	const { bindBodyDrag } = useTimelineElementDnd(options);
	React.useEffect(() => {
		onReady(bindBodyDrag);
	}, [bindBodyDrag, onReady]);
	return null;
};

const createElement = (): TimelineElement => ({
	id: "element-1",
	type: "VideoClip",
	component: "video-clip",
	name: "Clip 1",
	assetId: "asset-1",
	props: {},
	timeline: {
		start: 10,
		end: 40,
		startTimecode: "",
		endTimecode: "",
		trackIndex: 0,
	},
	transform: {},
	render: {
		zIndex: 0,
		visible: true,
		opacity: 1,
	},
});

describe("useTimelineElementDnd", () => {
	afterEach(() => {
		cleanup();
	});

	it("拖拽经过 canvas surface 时会保留 ghost 并清空轨道指示", () => {
		const element = createElement();
		const requestDropToCanvas = vi.fn(() => false);
		const setActiveSnapPoint = vi.fn();
		const setActiveDropTarget = vi.fn();
		const setDragGhosts = vi.fn();
		const stopAutoScroll = vi.fn();
		const elementRef = { current: null } as React.RefObject<HTMLDivElement | null>;
		const timelineElementHost = document.createElement("div");
		timelineElementHost.setAttribute("data-timeline-element", "true");
		Object.defineProperty(timelineElementHost, "getBoundingClientRect", {
			value: () => ({
				left: 100,
				top: 100,
				right: 220,
				bottom: 128,
				width: 120,
				height: 28,
				x: 100,
				y: 100,
				toJSON: () => ({}),
			}),
		});
		const dragTarget = document.createElement("div");
		timelineElementHost.appendChild(dragTarget);
		document.body.appendChild(timelineElementHost);

		const canvasSurface = document.createElement("div");
		canvasSurface.setAttribute("data-canvas-surface", "true");
		document.body.appendChild(canvasSurface);
		const originalElementFromPoint = (
			document as Document & {
				elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
			}
		).elementFromPoint;
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: () => canvasSurface,
		});

		const options: Parameters<typeof useTimelineElementDnd>[0] = {
			element,
			trackIndex: 0,
			trackY: 0,
			ratio: 1,
			fps: 30,
			trackHeight: 100,
			trackCount: 1,
			trackAssignments: new Map([["element-1", 0]]),
			maxDuration: undefined,
			elements: [element],
			getCurrentTime: () => 0,
			snapEnabled: false,
			autoAttach: false,
			rippleEditingEnabled: false,
			attachments: new Map(),
			selectedIds: ["element-1"],
			select: vi.fn(),
			setSelection: vi.fn(),
			updateTimeRange: vi.fn(),
			moveWithAttachments: vi.fn(),
			setElements: vi.fn(),
			setIsDragging: vi.fn(),
			setActiveSnapPoint,
			setActiveDropTarget,
			setDragGhosts,
			setLocalStartTime: vi.fn(),
			setLocalEndTime: vi.fn(),
			setLocalTrackY: vi.fn(),
			setLocalOffsetFrames: vi.fn(),
			setLocalTransitionDuration: vi.fn(),
			requestDropToCanvas,
			stopAutoScroll,
			updateAutoScrollFromPosition: vi.fn(),
			updateAutoScrollYFromPosition: vi.fn(),
			elementRef,
			transitionDuration: 0,
		};

		let bindBodyDrag: ReturnType<typeof useTimelineElementDnd>["bindBodyDrag"] | null =
			null;
		render(
			<Harness
				options={options}
				onReady={(handler) => {
					bindBodyDrag = handler;
				}}
			/>,
		);
		expect(bindBodyDrag).toBeTypeOf("function");

		act(() => {
			const startEvent = {
				target: dragTarget,
				stopPropagation: vi.fn(),
				altKey: false,
			} as unknown as MouseEvent;
			bindBodyDrag?.({
				movement: [0, 0],
				first: true,
				last: false,
				event: startEvent,
				tap: false,
				xy: [100, 110],
			});
			const moveEvent = {
				target: dragTarget,
				altKey: false,
			} as unknown as MouseEvent;
			bindBodyDrag?.({
				movement: [24, 8],
				first: false,
				last: false,
				event: moveEvent,
				tap: false,
				xy: [124, 118],
			});
		});

		expect(setDragGhosts).toHaveBeenCalled();
		expect(setActiveSnapPoint).toHaveBeenCalledWith(null);
		expect(setActiveDropTarget).toHaveBeenLastCalledWith(null);
		expect(stopAutoScroll).toHaveBeenCalled();
		expect(requestDropToCanvas).not.toHaveBeenCalled();

		timelineElementHost.remove();
		canvasSurface.remove();
		if (typeof originalElementFromPoint === "function") {
			Object.defineProperty(document, "elementFromPoint", {
				configurable: true,
				value: originalElementFromPoint,
			});
		} else {
			delete (
				document as Document & {
					elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
				}
			).elementFromPoint;
		}
	});

	it("点位仍在 timeline-editor 范围内时不应切换到 canvas 预览", () => {
		const element = createElement();
		const requestDropToCanvas = vi.fn(() => false);
		const setActiveDropTarget = vi.fn();
		const stopAutoScroll = vi.fn();
		const elementRef = { current: null } as React.RefObject<HTMLDivElement | null>;
		const timelineElementHost = document.createElement("div");
		timelineElementHost.setAttribute("data-timeline-element", "true");
		Object.defineProperty(timelineElementHost, "getBoundingClientRect", {
			value: () => ({
				left: 100,
				top: 100,
				right: 220,
				bottom: 128,
				width: 120,
				height: 28,
				x: 100,
				y: 100,
				toJSON: () => ({}),
			}),
		});
		const dragTarget = document.createElement("div");
		timelineElementHost.appendChild(dragTarget);
		document.body.appendChild(timelineElementHost);

		const timelineEditor = document.createElement("div");
		timelineEditor.setAttribute("data-testid", "timeline-editor");
		Object.defineProperty(timelineEditor, "getBoundingClientRect", {
			value: () => ({
				left: 0,
				top: 0,
				right: 600,
				bottom: 400,
				width: 600,
				height: 400,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			}),
		});
		document.body.appendChild(timelineEditor);

		const canvasSurface = document.createElement("div");
		canvasSurface.setAttribute("data-canvas-surface", "true");
		document.body.appendChild(canvasSurface);
		const originalElementFromPoint = (
			document as Document & {
				elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
			}
		).elementFromPoint;
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: () => canvasSurface,
		});

		const options: Parameters<typeof useTimelineElementDnd>[0] = {
			element,
			trackIndex: 0,
			trackY: 0,
			ratio: 1,
			fps: 30,
			trackHeight: 100,
			trackCount: 1,
			trackAssignments: new Map([["element-1", 0]]),
			maxDuration: undefined,
			elements: [element],
			getCurrentTime: () => 0,
			snapEnabled: false,
			autoAttach: false,
			rippleEditingEnabled: false,
			attachments: new Map(),
			selectedIds: ["element-1"],
			select: vi.fn(),
			setSelection: vi.fn(),
			updateTimeRange: vi.fn(),
			moveWithAttachments: vi.fn(),
			setElements: vi.fn(),
			setIsDragging: vi.fn(),
			setActiveSnapPoint: vi.fn(),
			setActiveDropTarget,
			setDragGhosts: vi.fn(),
			setLocalStartTime: vi.fn(),
			setLocalEndTime: vi.fn(),
			setLocalTrackY: vi.fn(),
			setLocalOffsetFrames: vi.fn(),
			setLocalTransitionDuration: vi.fn(),
			requestDropToCanvas,
			stopAutoScroll,
			updateAutoScrollFromPosition: vi.fn(),
			updateAutoScrollYFromPosition: vi.fn(),
			elementRef,
			transitionDuration: 0,
		};

		let bindBodyDrag: ReturnType<typeof useTimelineElementDnd>["bindBodyDrag"] | null =
			null;
		render(
			<Harness
				options={options}
				onReady={(handler) => {
					bindBodyDrag = handler;
				}}
			/>,
		);
		expect(bindBodyDrag).toBeTypeOf("function");

		act(() => {
			const startEvent = {
				target: dragTarget,
				stopPropagation: vi.fn(),
				altKey: false,
			} as unknown as MouseEvent;
			bindBodyDrag?.({
				movement: [0, 0],
				first: true,
				last: false,
				event: startEvent,
				tap: false,
				xy: [100, 110],
			});
			const moveEvent = {
				target: dragTarget,
				altKey: false,
			} as unknown as MouseEvent;
			bindBodyDrag?.({
				movement: [24, 8],
				first: false,
				last: false,
				event: moveEvent,
				tap: false,
				xy: [124, 118],
			});
		});

		expect(setActiveDropTarget).toHaveBeenCalled();
		const lastDropTarget = setActiveDropTarget.mock.calls.at(-1)?.[0] as
			| { type: string }
			| null
			| undefined;
		expect(lastDropTarget).toBeTruthy();
		expect(stopAutoScroll).not.toHaveBeenCalled();

		timelineElementHost.remove();
		timelineEditor.remove();
		canvasSurface.remove();
		if (typeof originalElementFromPoint === "function") {
			Object.defineProperty(document, "elementFromPoint", {
				configurable: true,
				value: originalElementFromPoint,
			});
		} else {
			delete (
				document as Document & {
					elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
				}
			).elementFromPoint;
		}
	});

	it("body drag 在 canvas surface 松手时会请求 dropToCanvas 并跳过 timeline 提交", () => {
		const element = createElement();
		const setElements = vi.fn();
		const moveWithAttachments = vi.fn();
		const requestDropToCanvas = vi.fn(() => true);
		const setIsDragging = vi.fn();
		const setActiveSnapPoint = vi.fn();
		const setActiveDropTarget = vi.fn();
		const setDragGhosts = vi.fn();
		const setLocalStartTime = vi.fn();
		const setLocalEndTime = vi.fn();
		const setLocalTrackY = vi.fn();
		const setLocalOffsetFrames = vi.fn();
		const setLocalTransitionDuration = vi.fn();
		const stopAutoScroll = vi.fn();
		const elementRef = { current: null } as React.RefObject<HTMLDivElement | null>;
		const timelineElementHost = document.createElement("div");
		timelineElementHost.setAttribute("data-timeline-element", "true");
		Object.defineProperty(timelineElementHost, "getBoundingClientRect", {
			value: () => ({
				left: 100,
				top: 100,
				right: 220,
				bottom: 128,
				width: 120,
				height: 28,
				x: 100,
				y: 100,
				toJSON: () => ({}),
			}),
		});
		const dragTarget = document.createElement("div");
		timelineElementHost.appendChild(dragTarget);
		document.body.appendChild(timelineElementHost);

		const canvasSurface = document.createElement("div");
		canvasSurface.setAttribute("data-canvas-surface", "true");
		document.body.appendChild(canvasSurface);
		const originalElementFromPoint = (
			document as Document & {
				elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
			}
		).elementFromPoint;
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: () => canvasSurface,
		});

		const options: Parameters<typeof useTimelineElementDnd>[0] = {
			element,
			trackIndex: 0,
			trackY: 0,
			ratio: 1,
			fps: 30,
			trackHeight: 100,
			trackCount: 1,
			trackAssignments: new Map([["element-1", 0]]),
			maxDuration: undefined,
			elements: [element],
			getCurrentTime: () => 0,
			snapEnabled: false,
			autoAttach: false,
			rippleEditingEnabled: false,
			attachments: new Map(),
			selectedIds: ["element-1"],
			select: vi.fn(),
			setSelection: vi.fn(),
			updateTimeRange: vi.fn(),
			moveWithAttachments,
			setElements,
			setIsDragging,
			setActiveSnapPoint,
			setActiveDropTarget,
			setDragGhosts,
			setLocalStartTime,
			setLocalEndTime,
			setLocalTrackY,
			setLocalOffsetFrames,
			setLocalTransitionDuration,
			requestDropToCanvas,
			stopAutoScroll,
			updateAutoScrollFromPosition: vi.fn(),
			updateAutoScrollYFromPosition: vi.fn(),
			elementRef,
			transitionDuration: 0,
		};

		let bindBodyDrag: ReturnType<typeof useTimelineElementDnd>["bindBodyDrag"] | null =
			null;
		render(
			<Harness
				options={options}
				onReady={(handler) => {
					bindBodyDrag = handler;
				}}
			/>,
		);
		expect(bindBodyDrag).toBeTypeOf("function");

		act(() => {
			const startEvent = {
				target: dragTarget,
				stopPropagation: vi.fn(),
				altKey: false,
			} as unknown as MouseEvent;
			bindBodyDrag?.({
				movement: [0, 0],
				first: true,
				last: false,
				event: startEvent,
				tap: false,
				xy: [100, 110],
			});
			const moveEvent = {
				target: dragTarget,
				altKey: false,
			} as unknown as MouseEvent;
			bindBodyDrag?.({
				movement: [24, 8],
				first: false,
				last: false,
				event: moveEvent,
				tap: false,
				xy: [124, 118],
			});
			const endEvent = {
				target: dragTarget,
				altKey: false,
			} as unknown as MouseEvent;
			bindBodyDrag?.({
				movement: [24, 8],
				first: false,
				last: true,
				event: endEvent,
				tap: false,
				xy: [124, 118],
			});
		});

		expect(requestDropToCanvas).toHaveBeenCalledWith({
			targetIds: ["element-1"],
			primaryId: "element-1",
			clientX: 124,
			clientY: 118,
		});
		expect(setElements).not.toHaveBeenCalled();
		expect(moveWithAttachments).not.toHaveBeenCalled();
		expect(stopAutoScroll).toHaveBeenCalled();

		timelineElementHost.remove();
		canvasSurface.remove();
		if (typeof originalElementFromPoint === "function") {
			Object.defineProperty(document, "elementFromPoint", {
				configurable: true,
				value: originalElementFromPoint,
			});
		} else {
			delete (
				document as Document & {
					elementFromPoint?: ((x: number, y: number) => Element | null) | undefined;
				}
			).elementFromPoint;
		}
	});
});
