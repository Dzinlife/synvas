// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneWaveformCanvas } from "./SceneWaveformCanvas";

const { getSceneWaveformThumbnailMock } = vi.hoisted(() => ({
	getSceneWaveformThumbnailMock: vi.fn(),
}));

vi.mock("./sceneWaveformCache", () => ({
	getSceneWaveformThumbnail: getSceneWaveformThumbnailMock,
}));

vi.mock("@/scene-editor/utils/timelineScale", () => ({
	getPixelsPerFrame: () => 2,
}));

const createCanvasContext = () => ({
	setTransform: vi.fn(),
	clearRect: vi.fn(),
	drawImage: vi.fn(),
});

describe("SceneWaveformCanvas", () => {
	const nativeRequestAnimationFrame = window.requestAnimationFrame;
	const nativeCancelAnimationFrame = window.cancelAnimationFrame;
	const nativeGetContext = HTMLCanvasElement.prototype.getContext;
	let resizeObserverCallback: ResizeObserverCallback | null = null;

	beforeEach(() => {
		getSceneWaveformThumbnailMock.mockReset();
		getSceneWaveformThumbnailMock.mockResolvedValue(
			document.createElement("canvas"),
		);
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
					right: 200,
					bottom: 40,
					width: 200,
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

	it("会按可视窗口和 offset 请求场景混合波形", async () => {
		render(
			<div data-timeline-scroll-area>
				<div data-vertical-scroll-area>
					<SceneWaveformCanvas
						sceneRuntime={
							{
								ref: {
									sceneId: "scene-child",
								},
							} as never
						}
						runtimeManager={
							{
								getTimelineRuntime: vi.fn(),
							} as never
						}
						sceneRevision={5}
						sourceFps={24}
						gainDb={3}
						start={0}
						end={90}
						fps={30}
						timelineScale={1}
						offsetFrames={15}
						scrollLeft={0}
						color="rgba(34, 211, 238, 0.92)"
					/>
				</div>
			</div>,
		);

		resizeObserverCallback?.([], {} as ResizeObserver);

		await waitFor(() => {
			expect(getSceneWaveformThumbnailMock).toHaveBeenCalled();
		});

		expect(getSceneWaveformThumbnailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				sceneRuntime: expect.objectContaining({
					ref: expect.objectContaining({
						sceneId: "scene-child",
					}),
				}),
				sceneRevision: 5,
				windowStartFrame: 12,
				windowEndFrame: 92,
				width: 200,
				height: 40,
				pixelRatio: 1,
				gainDb: 3,
			}),
		);
	});
});
