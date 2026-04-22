// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { TimelineElement } from "core/element/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createEditorRuntimeWrapper,
	createTestEditorRuntime,
} from "./runtime/testUtils";
import { useProjectStore } from "@/projects/projectStore";
import TimelineEditor from "./TimelineEditor";
import { getPixelsPerFrame } from "./utils/timelineScale";

const latestContextMenuActionsRef: {
	current: Array<{ key: string; label: string }> | null;
} = {
	current: null,
};

vi.mock("@use-gesture/react", () => ({
	useDrag: () => () => ({}),
}));

vi.mock("@/components/ui/progressive-blur", () => ({
	ProgressiveBlur: () => null,
}));

vi.mock("@/scene-editor/components/TimeIndicatorCanvas", () => ({
	default: () => null,
}));

vi.mock("./components/TimelineContextMenu", () => ({
	default: ({
		open,
		actions,
	}: {
		open: boolean;
		actions: Array<{ key: string; label: string }>;
	}) => {
		latestContextMenuActionsRef.current = open ? actions : null;
		return open ? (
			<div data-testid="timeline-context-menu">
				{actions.map((action) => (
					<div key={action.key}>{action.label}</div>
				))}
			</div>
		) : null;
	},
}));

vi.mock("./components/TimelineDragOverlay", () => ({
	default: () => null,
}));

vi.mock("./components/TimelineElement", () => ({
	default: ({
		element,
		onRequestContextMenu,
	}: {
		element: TimelineElement;
		onRequestContextMenu?: (
			event: React.MouseEvent<HTMLDivElement>,
			elementId: string,
		) => void;
	}) => (
		<div
			data-testid={`timeline-element-${element.id}`}
			data-timeline-element="true"
			onContextMenu={(event) => onRequestContextMenu?.(event, element.id)}
		>
			{element.name}
		</div>
	),
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
	type = "VideoClip",
	sceneId,
}: {
	id: string;
	start: number;
	end: number;
	trackIndex: number;
	type?: "VideoClip" | "Composition" | "CompositionAudioClip";
	sceneId?: string;
}): TimelineElement => ({
	id,
	type,
	component:
		type === "Composition"
			? "composition"
			: type === "CompositionAudioClip"
				? "composition-audio"
				: "video-clip",
	name: id,
	timeline: {
		start,
		end,
		startTimecode: "",
		endTimecode: "",
		trackIndex,
	},
	props: {
		...(sceneId ? { sceneId } : { uri: `${id}.mp4` }),
	},
});

const createProject = () => ({
	id: "project-1",
	revision: 0,
	assets: [],
	canvas: {
		nodes: [
			{
				id: "node-scene-live",
				type: "scene" as const,
				sceneId: "scene-live",
				name: "Scene Live",
				x: 0,
				y: 0,
				width: 960,
				height: 540,
				siblingOrder: 0,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
		],
	},
	scenes: {
		"scene-live": {
			id: "scene-live",
			name: "Scene Live",
			timeline: {
				fps: 30,
				canvas: { width: 1920, height: 1080 },
				settings: {
					snapEnabled: true,
					autoAttach: true,
					rippleEditingEnabled: false,
					previewAxisEnabled: true,
					audio: {
						exportSampleRate: 48000,
						exportBlockSize: 512,
						masterGainDb: 0,
						compressor: {
							enabled: true,
							thresholdDb: -12,
							ratio: 4,
							kneeDb: 6,
							attackMs: 10,
							releaseMs: 80,
							makeupGainDb: 0,
						},
					},
				},
				tracks: [],
				elements: [],
			},
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
		},
		"scene-deleted": {
			id: "scene-deleted",
			name: "Scene Deleted",
			timeline: {
				fps: 30,
				canvas: { width: 1920, height: 1080 },
				settings: {
					snapEnabled: true,
					autoAttach: true,
					rippleEditingEnabled: false,
					previewAxisEnabled: true,
					audio: {
						exportSampleRate: 48000,
						exportBlockSize: 512,
						masterGainDb: 0,
						compressor: {
							enabled: true,
							thresholdDb: -12,
							ratio: 4,
							kneeDb: 6,
							attackMs: 10,
							releaseMs: 80,
							makeupGainDb: 0,
						},
					},
				},
				tracks: [],
				elements: [],
			},
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
		},
	},
	ui: {
		activeSceneId: "scene-live",
		focusedNodeId: null,
		activeNodeId: "node-scene-live",
		canvasSnapEnabled: true,
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

const TIMELINE_PADDING_LEFT = 48;
const PLAYHEAD_FOLLOW_MANUAL_DEBOUNCE_MS = 300;
const resolveFollowTargetScrollLeft = (time: number, fps = 30) => {
	return time * getPixelsPerFrame(fps, 1) + TIMELINE_PADDING_LEFT;
};

describe("TimelineEditor minimap sync", () => {
	beforeEach(() => {
		vi.stubGlobal("ResizeObserver", ResizeObserverMock);
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn((_callback: FrameRequestCallback) => 1),
		);
		vi.stubGlobal(
			"cancelAnimationFrame",
			vi.fn((_id: number) => {}),
		);
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
		latestContextMenuActionsRef.current = null;
		useProjectStore.setState({
			status: "ready",
			projects: [],
			currentProjectId: "project-1",
			currentProject: createProject(),
			focusedSceneDrafts: {},
			sceneTimelineMutationOpIds: {},
			error: null,
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		resizeObserverCallback = null;
		timelineStore.setState(initialState, true);
	});

	it("主 scene 未删除时菜单显示跳转到主 Scene", async () => {
		timelineStore.setState({
			...initialState,
			elements: [
				createElement({
					id: "composition-live",
					start: 0,
					end: 60,
					trackIndex: 0,
					type: "Composition",
					sceneId: "scene-live",
				}),
			],
			selectedIds: ["composition-live"],
			primarySelectedId: "composition-live",
		});
		render(<TimelineEditor onRestoreSceneReferenceToCanvas={vi.fn()} />, {
			wrapper,
		});

		fireEvent.contextMenu(
			screen.getByTestId("timeline-element-composition-live"),
		);

		await waitFor(() => {
			expect(screen.getByText("跳转到主 Scene")).toBeTruthy();
		});
		expect(screen.queryByText("还原主 Scene")).toBeNull();
	});

	it("主 scene 已删除时菜单显示还原主 Scene", async () => {
		timelineStore.setState({
			...initialState,
			elements: [
				createElement({
					id: "composition-audio-deleted",
					start: 0,
					end: 60,
					trackIndex: -1,
					type: "CompositionAudioClip",
					sceneId: "scene-deleted",
				}),
			],
			selectedIds: ["composition-audio-deleted"],
			primarySelectedId: "composition-audio-deleted",
		});
		render(<TimelineEditor onRestoreSceneReferenceToCanvas={vi.fn()} />, {
			wrapper,
		});

		fireEvent.contextMenu(
			screen.getByTestId("timeline-element-composition-audio-deleted"),
		);

		await waitFor(() => {
			expect(screen.getByText("还原主 Scene")).toBeTruthy();
		});
		expect(screen.queryByText("跳转到主 Scene")).toBeNull();
	});

	it("挂载和卸载时会同步 TimelineEditor mounted 状态", () => {
		const { unmount } = render(<TimelineEditor />, { wrapper });

		expect(timelineStore.getState().isTimelineEditorMounted).toBe(true);

		unmount();

		expect(timelineStore.getState().isTimelineEditorMounted).toBe(false);
		expect(timelineStore.getState().isTimelineEditorHovered).toBe(false);
	});

	it("鼠标进入和离开时会同步 TimelineEditor hover 状态", () => {
		render(<TimelineEditor />, { wrapper });

		fireEvent.mouseEnter(screen.getByTestId("timeline-editor"));
		expect(timelineStore.getState().isTimelineEditorHovered).toBe(true);

		fireEvent.mouseLeave(screen.getByTestId("timeline-editor"));
		expect(timelineStore.getState().isTimelineEditorHovered).toBe(false);
	});

	it("有选中元素时 Delete 仍会删除 timeline element", () => {
		timelineStore.setState({
			elements: [
				createElement({
					id: "clip-delete",
					start: 0,
					end: 60,
					trackIndex: 0,
				}),
			],
			selectedIds: ["clip-delete"],
			primarySelectedId: "clip-delete",
		});
		render(<TimelineEditor />, { wrapper });

		fireEvent.keyDown(window, { key: "Delete" });

		expect(timelineStore.getState().elements).toHaveLength(0);
		expect(timelineStore.getState().selectedIds).toEqual([]);
		expect(timelineStore.getState().primarySelectedId).toBeNull();
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
			expect(timelineStore.getState().timelineMaxScrollLeft).toBeCloseTo(4448);
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

	it("播放头越过右边界后才跳转，边界按内容区宽度计算", async () => {
		timelineStore.setState({
			elements: [
				createElement({
					id: "clip-follow-overflow",
					start: 0,
					end: 3000,
					trackIndex: 0,
				}),
			],
			scrollLeft: 0,
			currentTime: 0,
			isPlaying: false,
			timelineScale: 1,
			fps: 30,
		});
		render(<TimelineEditor />, { wrapper });

		await waitFor(() => {
			expect(timelineStore.getState().timelineViewportWidth).toBe(800);
		});

		act(() => {
			timelineStore.setState({
				isPlaying: true,
				currentTime: 500,
			});
		});

		await waitFor(() => {
			expect(timelineStore.getState().scrollLeft).toBeCloseTo(
				resolveFollowTargetScrollLeft(500),
			);
		});
	});

	it("播放头越过左边界后也会触发跳转", async () => {
		timelineStore.setState({
			elements: [
				createElement({
					id: "clip-follow-left-overflow",
					start: 0,
					end: 3000,
					trackIndex: 0,
				}),
			],
			scrollLeft: 600,
			currentTime: 100,
			isPlaying: false,
			timelineScale: 1,
			fps: 30,
		});
		render(<TimelineEditor />, { wrapper });

		act(() => {
			timelineStore.setState({
				isPlaying: true,
			});
		});

		await waitFor(() => {
			expect(timelineStore.getState().scrollLeft).toBeCloseTo(
				resolveFollowTargetScrollLeft(100),
			);
		});
	});

	it("播放头在可视范围内时不触发自动跟随", async () => {
		timelineStore.setState({
			elements: [
				createElement({
					id: "clip-follow-visible",
					start: 0,
					end: 3000,
					trackIndex: 0,
				}),
			],
			scrollLeft: 0,
			currentTime: 0,
			isPlaying: false,
			timelineScale: 1,
			fps: 30,
		});
		render(<TimelineEditor />, { wrapper });

		act(() => {
			timelineStore.setState({
				isPlaying: true,
				currentTime: 430,
			});
		});

		await act(async () => {
			await Promise.resolve();
		});
		expect(timelineStore.getState().scrollLeft).toBe(0);
	});

	it("手动滚动后 300ms 内抑制跟随，超时后恢复", async () => {
		let mockNow = 10_000;
		vi.spyOn(Date, "now").mockImplementation(() => mockNow);
		timelineStore.setState({
			elements: [
				createElement({
					id: "clip-follow-debounce",
					start: 0,
					end: 3000,
					trackIndex: 0,
				}),
			],
			scrollLeft: 0,
			currentTime: 0,
			isPlaying: false,
			timelineScale: 1,
			fps: 30,
		});
		render(<TimelineEditor />, { wrapper });

		act(() => {
			timelineStore.setState({
				isPlaying: true,
				currentTime: 500,
			});
		});

		await waitFor(() => {
			expect(timelineStore.getState().scrollLeft).toBeCloseTo(
				resolveFollowTargetScrollLeft(500),
			);
		});

		act(() => {
			timelineStore.setState({ scrollLeft: 600 });
		});
		act(() => {
			timelineStore.setState({ currentTime: 900 });
		});

		await act(async () => {
			await Promise.resolve();
		});
		expect(timelineStore.getState().scrollLeft).toBe(600);

		mockNow += PLAYHEAD_FOLLOW_MANUAL_DEBOUNCE_MS + 1;
		act(() => {
			timelineStore.setState({ currentTime: 901 });
		});

		await waitFor(() => {
			expect(timelineStore.getState().scrollLeft).toBeCloseTo(
				resolveFollowTargetScrollLeft(901),
			);
		});
	});

	it("自动跟随写入不会被识别为手动滚动", async () => {
		const mockNow = 20_000;
		vi.spyOn(Date, "now").mockImplementation(() => mockNow);
		timelineStore.setState({
			elements: [
				createElement({
					id: "clip-follow-pending",
					start: 0,
					end: 3000,
					trackIndex: 0,
				}),
			],
			scrollLeft: 0,
			currentTime: 0,
			isPlaying: false,
			timelineScale: 1,
			fps: 30,
		});
		render(<TimelineEditor />, { wrapper });

		act(() => {
			timelineStore.setState({
				isPlaying: true,
				currentTime: 500,
			});
		});

		await waitFor(() => {
			expect(timelineStore.getState().scrollLeft).toBeCloseTo(
				resolveFollowTargetScrollLeft(500),
			);
		});

		act(() => {
			timelineStore.setState({ currentTime: 1200 });
		});

		await waitFor(() => {
			expect(timelineStore.getState().scrollLeft).toBeCloseTo(
				resolveFollowTargetScrollLeft(1200),
			);
		});
	});
});
