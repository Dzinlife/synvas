// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { framesToTimecode } from "@/utils/timecode";
import PreviewControlBar from "./PreviewControlBar";

const { timelineState, playbackState, previewState, togglePlayMock } =
	vi.hoisted(() => ({
		timelineState: {
			currentTime: 120,
			previewTime: null as number | null,
			fps: 30,
		},
		playbackState: {
			isPlaying: false,
		},
		previewState: {
			zoomLevel: 1,
			pinchState: {
				isPinching: false,
				currentZoom: 1,
			},
			setZoomLevel: vi.fn(),
			resetPanOffset: vi.fn(),
			fitZoomLevel: 1,
			canvasRef: {
				current: null,
			},
		},
		togglePlayMock: vi.fn(),
	}));

vi.mock("@/editor/contexts/TimelineContext", () => {
	const useTimelineStore = ((
		selector: (state: typeof timelineState) => unknown,
	) =>
		selector(
			timelineState,
		)) as typeof import("@/editor/contexts/TimelineContext").useTimelineStore;
	return {
		usePlaybackControl: () => ({
			isPlaying: playbackState.isPlaying,
			togglePlay: togglePlayMock,
			play: vi.fn(),
			pause: vi.fn(),
		}),
		useTimelineStore,
	};
});

vi.mock("./PreviewLoudnessMeterCanvas", () => ({
	default: () => <div data-testid="preview-loudness-meter" />,
}));

vi.mock("@/editor/contexts/PreviewProvider", () => ({
	usePreview: () => previewState,
}));

vi.mock("@/dsl/export", () => ({
	exportCanvasAsImage: vi.fn(async () => {}),
}));

afterEach(() => {
	cleanup();
});

beforeEach(() => {
	timelineState.currentTime = 120;
	timelineState.previewTime = null;
	timelineState.fps = 30;
	playbackState.isPlaying = false;
	previewState.zoomLevel = 1;
	previewState.pinchState.isPinching = false;
	previewState.pinchState.currentZoom = 1;
	previewState.fitZoomLevel = 1;
	previewState.setZoomLevel.mockReset();
	previewState.resetPanOffset.mockReset();
	togglePlayMock.mockReset();
});

describe("PreviewControlBar", () => {
	it("播放按钮可触发切换且时间码与原逻辑一致", () => {
		timelineState.currentTime = 150;
		timelineState.previewTime = 90;
		timelineState.fps = 30;

		render(<PreviewControlBar />);

		fireEvent.click(screen.getByTestId("preview-control-play-toggle"));
		expect(togglePlayMock).toHaveBeenCalledTimes(1);

		const timecode = framesToTimecode(90, 30);
		expect(screen.getByTestId("preview-control-bar-timecode").textContent).toBe(
			timecode,
		);
	});
});
