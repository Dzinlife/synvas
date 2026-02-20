// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import type { CanvasRef } from "react-skia-lite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { framesToTimecode } from "@/utils/timecode";
import PreviewToolbar from "./PreviewToolbar";

const { timelineState, playbackState, togglePlayMock } = vi.hoisted(() => ({
	timelineState: {
		currentTime: 120,
		previewTime: null as number | null,
		fps: 30,
	},
	playbackState: {
		isPlaying: false,
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
	togglePlayMock.mockReset();
});

const createCanvasRef = (): React.RefObject<CanvasRef | null> => {
	return {
		current: null,
	};
};

describe("PreviewToolbar", () => {
	it("响度表位于播放按钮左侧", () => {
		render(
			<PreviewToolbar
				effectiveZoomLevel={1}
				onZoomChange={vi.fn()}
				onResetView={vi.fn()}
				canvasRef={createCanvasRef()}
			/>,
		);

		const meter = screen.getByTestId("preview-loudness-meter");
		const playToggle = screen.getByTestId("preview-play-toggle");
		expect(
			meter.compareDocumentPosition(playToggle) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("播放按钮可触发切换且时间码与原逻辑一致", () => {
		timelineState.currentTime = 150;
		timelineState.previewTime = 90;
		timelineState.fps = 30;

		render(
			<PreviewToolbar
				effectiveZoomLevel={1}
				onZoomChange={vi.fn()}
				onResetView={vi.fn()}
				canvasRef={createCanvasRef()}
			/>,
		);

		fireEvent.click(screen.getByTestId("preview-play-toggle"));
		expect(togglePlayMock).toHaveBeenCalledTimes(1);

		const timecode = framesToTimecode(90, 30);
		expect(screen.getByTestId("preview-toolbar-timecode").textContent).toBe(
			timecode,
		);
	});
});
