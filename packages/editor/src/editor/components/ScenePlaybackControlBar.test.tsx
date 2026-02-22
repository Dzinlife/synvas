// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { framesToTimecode } from "@/utils/timecode";
import ScenePlaybackControlBar from "./ScenePlaybackControlBar";

const { timelineState, playbackState, previewState, togglePlaybackMock } =
	vi.hoisted(() => ({
		timelineState: {
			currentTime: 120,
			previewTime: null as number | null,
			fps: 30,
			elements: [],
			canvasSize: { width: 1920, height: 1080 },
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
		togglePlaybackMock: vi.fn(),
	}));

vi.mock("@/editor/contexts/TimelineContext", () => {
	const useTimelineStore = ((
		selector: (state: typeof timelineState) => unknown,
	) =>
		selector(
			timelineState,
		)) as unknown as typeof import("@/editor/contexts/TimelineContext").useTimelineStore;
	return {
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

vi.mock("@/editor/exportVideo", () => ({
	exportTimelineAsVideo: vi.fn(async () => {}),
}));

vi.mock("@/editor/runtime/EditorRuntimeProvider", () => ({
	useEditorRuntime: () =>
		({
			id: "test-runtime",
		}) as unknown,
	useActiveTimelineRuntime: () =>
		({
			id: "scene:scene-1",
			ref: {
				kind: "scene",
				sceneId: "scene-1",
			},
		}) as unknown,
}));

vi.mock("@/studio/scene/usePlaybackOwnerController", () => ({
	usePlaybackOwnerController: () => ({
		togglePlayback: togglePlaybackMock,
		isOwnerPlaying: () => playbackState.isPlaying,
	}),
}));

afterEach(() => {
	cleanup();
});

beforeEach(() => {
	timelineState.currentTime = 120;
	timelineState.previewTime = null;
	timelineState.fps = 30;
	timelineState.elements = [];
	timelineState.canvasSize = { width: 1920, height: 1080 };
	playbackState.isPlaying = false;
	previewState.zoomLevel = 1;
	previewState.pinchState.isPinching = false;
	previewState.pinchState.currentZoom = 1;
	previewState.fitZoomLevel = 1;
	previewState.setZoomLevel.mockReset();
	previewState.resetPanOffset.mockReset();
	togglePlaybackMock.mockReset();
});

describe("ScenePlaybackControlBar", () => {
	it("播放按钮可触发切换且时间码正确", () => {
		timelineState.currentTime = 150;
		timelineState.previewTime = 90;
		timelineState.fps = 30;

		render(<ScenePlaybackControlBar onExitFocus={vi.fn()} />);

		fireEvent.click(screen.getByRole("button", { name: "播放 / 暂停" }));
		expect(togglePlaybackMock).toHaveBeenCalledTimes(1);
		expect(screen.getByText(framesToTimecode(90, 30))).toBeTruthy();
	});

	it("退出按钮可触发回调", () => {
		const onExitFocus = vi.fn();
		render(<ScenePlaybackControlBar onExitFocus={onExitFocus} />);
		fireEvent.click(screen.getByRole("button", { name: "退出 Scene" }));
		expect(onExitFocus).toHaveBeenCalledTimes(1);
	});
});
