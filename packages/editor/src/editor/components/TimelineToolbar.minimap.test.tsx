// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TimelineToolbar from "./TimelineToolbar";

const { setTimelineScaleMock } = vi.hoisted(() => ({
	setTimelineScaleMock: vi.fn(),
}));

vi.mock("react-skia-lite", () => ({
	Skia: {},
}));

vi.mock("../contexts/PreviewProvider", () => ({
	usePreview: () => ({
		canvasRef: { current: null },
	}),
}));

vi.mock("../contexts/TimelineContext", () => {
	const noop = vi.fn();
	const storeState = {
		currentTime: 0,
		canvasSize: { width: 1920, height: 1080 },
		timelineViewportWidth: 320,
	};
	const useTimelineStore = ((selector: (state: typeof storeState) => unknown) =>
		selector(
			storeState,
		)) as typeof import("../contexts/TimelineContext").useTimelineStore;
	return {
		useAttachments: () => ({
			attachments: new Map(),
			autoAttach: true,
			setAutoAttach: noop,
		}),
		useElements: () => ({
			elements: [],
			setElements: noop,
		}),
		useFps: () => ({
			fps: 30,
		}),
		useMultiSelect: () => ({
			selectedIds: [],
			primaryId: null,
		}),
		usePlaybackControl: () => ({
			isPlaying: false,
			togglePlay: noop,
		}),
		usePreviewAxis: () => ({
			previewAxisEnabled: true,
			setPreviewAxisEnabled: noop,
		}),
		useRippleEditing: () => ({
			rippleEditingEnabled: false,
			setRippleEditingEnabled: noop,
		}),
		useSnap: () => ({
			snapEnabled: true,
			setSnapEnabled: noop,
		}),
		useTimelineHistory: () => ({
			canUndo: false,
			canRedo: false,
			undo: noop,
			redo: noop,
		}),
		useTimelineScale: () => ({
			timelineScale: 1,
			setTimelineScale: setTimelineScaleMock,
		}),
		useTimelineStore,
		useTracks: () => ({
			tracks: [],
			audioTrackStates: {},
		}),
	};
});

vi.mock("./AsrDialog", () => ({
	default: () => <div>ASR</div>,
}));

vi.mock("./ExportVideoDialog", () => ({
	default: () => <div>ExportVideoDialog</div>,
}));

vi.mock("./TimelineMinimap", () => ({
	default: () => <section aria-label="timeline minimap" />,
}));

afterEach(() => {
	cleanup();
});

describe("TimelineToolbar minimap", () => {
	it("缩放按钮会使用中心锚点更新时间轴缩放", () => {
		setTimelineScaleMock.mockClear();
		render(<TimelineToolbar />);
		fireEvent.click(screen.getByTitle("放大时间轴"));
		expect(setTimelineScaleMock).toHaveBeenCalledWith(1.1, {
			anchorOffsetPx: 160,
		});
	});

	it("隐藏 DSP 控件并显示 minimap", () => {
		render(<TimelineToolbar />);
		expect(screen.queryByText("DSP")).toBeNull();
		expect(screen.queryByText("Master")).toBeNull();
		expect(screen.getAllByLabelText("timeline minimap").length).toBe(1);
	});
});
