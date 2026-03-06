// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompositionTimeline } from "./timeline";

const {
	timelineState,
	sceneReferenceState,
	hasSceneAudioState,
	getCompositionThumbnailMock,
	sceneWaveformCanvasMock,
} = vi.hoisted(() => ({
	timelineState: {
		element: {
			id: "composition-1",
			name: "Nested Scene",
			props: {
				sceneId: "scene-child",
			},
			timeline: {
				offset: 12,
			},
			clip: {},
		},
		scrollLeft: 0,
		tracks: [],
		audioTrackStates: {},
	},
	sceneReferenceState: {
		runtime: {
			ref: {
				sceneId: "scene-child",
			},
		},
		runtimeManager: {
			getTimelineRuntime: vi.fn(),
		},
		revision: 7,
		fps: 24,
		durationFrames: 96,
		canvasSize: {
			width: 160,
			height: 90,
		},
	},
	hasSceneAudioState: {
		value: true,
	},
	getCompositionThumbnailMock: vi.fn(),
	sceneWaveformCanvasMock: vi.fn(),
}));

vi.mock("@/scene-editor/contexts/TimelineContext", () => {
	return {
		useTimelineStore: (
			selector: (state: typeof timelineState) => unknown,
		) => selector({
			getElementById: () => timelineState.element,
			scrollLeft: timelineState.scrollLeft,
			tracks: timelineState.tracks,
			audioTrackStates: timelineState.audioTrackStates,
		} as unknown as typeof timelineState),
		useFps: () => ({
			fps: 30,
		}),
		useTimelineScale: () => ({
			timelineScale: 1,
		}),
	};
});

vi.mock("@/element/useSceneReferenceRuntimeState", () => ({
	useSceneReferenceRuntimeState: () => sceneReferenceState,
}));

vi.mock("@/scene-editor/audio/sceneReferenceAudio", () => ({
	hasSceneAudibleLeafAudio: () => hasSceneAudioState.value,
}));

vi.mock("@/scene-editor/utils/compositionAudioSeparation", () => ({
	isCompositionSourceAudioMuted: () => false,
}));

vi.mock("@/scene-editor/utils/trackAudibility", () => ({
	isTimelineTrackMuted: () => false,
}));

vi.mock("@/scene-editor/utils/timelineScale", () => ({
	getPixelsPerFrame: () => 2,
}));

vi.mock("@/element/SceneWaveformCanvas", () => ({
	SceneWaveformCanvas: (props: Record<string, unknown>) => {
		sceneWaveformCanvasMock(props);
		return <div data-testid="scene-waveform-canvas" />;
	},
}));

vi.mock("./thumbnailCache", () => ({
	getCompositionThumbnail: getCompositionThumbnailMock,
}));

vi.mock("@/element/AudioGainBaselineControl", () => ({
	AudioGainBaselineControl: () => <div data-testid="audio-gain-baseline" />,
}));

const createCanvasContext = () => ({
	setTransform: vi.fn(),
	scale: vi.fn(),
	drawImage: vi.fn(),
	clearRect: vi.fn(),
	fillRect: vi.fn(),
	fillText: vi.fn(),
});

describe("CompositionTimeline", () => {
	const nativeRequestAnimationFrame = window.requestAnimationFrame;
	const nativeCancelAnimationFrame = window.cancelAnimationFrame;
	const nativeGetContext = HTMLCanvasElement.prototype.getContext;
	let resizeObserverCallback: ResizeObserverCallback | null = null;

	beforeEach(() => {
		hasSceneAudioState.value = true;
		timelineState.element.clip = {};
		getCompositionThumbnailMock.mockReset();
		sceneWaveformCanvasMock.mockReset();
		getCompositionThumbnailMock.mockImplementation(async () => {
			const canvas = document.createElement("canvas");
			canvas.width = 80;
			canvas.height = 45;
			return canvas;
		});
		vi.stubGlobal(
			"ResizeObserver",
			class ResizeObserver {
				constructor(callback: ResizeObserverCallback) {
					resizeObserverCallback = callback;
				}
				observe() {}
				disconnect() {}
				unobserve() {}
			},
		);
		window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		}) as typeof window.requestAnimationFrame;
		window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;
		HTMLCanvasElement.prototype.getContext = vi
			.fn()
			.mockImplementation(() => createCanvasContext()) as typeof nativeGetContext;
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			() =>
				({
					left: 0,
					top: 0,
					right: 160,
					bottom: 40,
					width: 160,
					height: 40,
					x: 0,
					y: 0,
					toJSON: () => ({}),
				}) as DOMRect,
		);
	});

	afterEach(() => {
		cleanup();
		window.requestAnimationFrame = nativeRequestAnimationFrame;
		window.cancelAnimationFrame = nativeCancelAnimationFrame;
		HTMLCanvasElement.prototype.getContext = nativeGetContext;
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		resizeObserverCallback = null;
	});

	it("无可听叶子音频时不渲染波形层", () => {
		hasSceneAudioState.value = false;

		render(
			<div data-timeline-scroll-area>
				<div data-vertical-scroll-area>
					<CompositionTimeline
						id="composition-1"
						start={0}
						end={60}
						startTimecode="00:00:00:00"
						endTimecode="00:00:02:00"
						fps={30}
					/>
				</div>
			</div>,
		);

		expect(screen.queryByTestId("scene-waveform-canvas")).toBeNull();
	});

	it("会按当前 offset 请求子 scene 缩略图", async () => {
		render(
			<div data-timeline-scroll-area>
				<div data-vertical-scroll-area>
					<CompositionTimeline
						id="composition-1"
						start={0}
						end={60}
						startTimecode="00:00:00:00"
						endTimecode="00:00:02:00"
						fps={30}
					/>
				</div>
			</div>,
		);

		resizeObserverCallback?.([], {} as ResizeObserver);

		await waitFor(() => {
			expect(getCompositionThumbnailMock).toHaveBeenCalled();
		});

		expect(getCompositionThumbnailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				sceneRuntime: sceneReferenceState.runtime,
				runtimeManager: sceneReferenceState.runtimeManager,
				sceneRevision: 7,
				displayFrame: 10,
			}),
		);
	});
});
