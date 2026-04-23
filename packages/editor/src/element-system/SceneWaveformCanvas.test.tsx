// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneWaveformCanvas } from "./SceneWaveformCanvas";

const {
	getSceneWaveformThumbnailMock,
	setTransformMock,
	clearRectMock,
	drawImageMock,
} = vi.hoisted(() => ({
	getSceneWaveformThumbnailMock: vi.fn(),
	setTransformMock: vi.fn(),
	clearRectMock: vi.fn(),
	drawImageMock: vi.fn(),
}));

vi.mock("./sceneWaveformCache", () => ({
	getSceneWaveformThumbnail: getSceneWaveformThumbnailMock,
}));

vi.mock("@/scene-editor/utils/timelineScale", () => ({
	getPixelsPerFrame: (_fps: number, timelineScale: number) => 2 * timelineScale,
}));

const createCanvasContext = () => ({
	setTransform: setTransformMock,
	clearRect: clearRectMock,
	drawImage: drawImageMock,
});

describe("SceneWaveformCanvas", () => {
	const nativeRequestAnimationFrame = window.requestAnimationFrame;
	const nativeCancelAnimationFrame = window.cancelAnimationFrame;
	const nativeGetContext = HTMLCanvasElement.prototype.getContext;
	let resizeObserverCallback: ResizeObserverCallback | null = null;

	beforeEach(() => {
		getSceneWaveformThumbnailMock.mockReset();
		setTransformMock.mockReset();
		clearRectMock.mockReset();
		drawImageMock.mockReset();
		getSceneWaveformThumbnailMock.mockImplementation(
			(params: { width: number; height: number; pixelRatio: number }) => {
				const canvas = document.createElement("canvas");
				canvas.width = Math.max(
					1,
					Math.round(params.width * params.pixelRatio),
				);
				canvas.height = Math.max(
					1,
					Math.round(params.height * params.pixelRatio),
				);
				return Promise.resolve(canvas);
			},
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
			.mockImplementation(() =>
				createCanvasContext(),
			) as typeof nativeGetContext;
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

	it("timelineScale 变化后会重新请求更高精度的波形", async () => {
		const props = {
			sceneRuntime: {
				ref: {
					sceneId: "scene-child",
				},
			} as never,
			runtimeManager: {
				getTimelineRuntime: vi.fn(),
			} as never,
			sceneRevision: 5,
			sourceFps: 24,
			gainDb: 3,
			start: 0,
			end: 90,
			fps: 30,
			offsetFrames: 15,
			scrollLeft: 0,
			color: "rgba(34, 211, 238, 0.92)",
		};
		const { rerender } = render(
			<div data-timeline-scroll-area>
				<div data-vertical-scroll-area>
					<SceneWaveformCanvas {...props} timelineScale={1} />
				</div>
			</div>,
		);

		resizeObserverCallback?.([], {} as ResizeObserver);

		await waitFor(() => {
			expect(getSceneWaveformThumbnailMock).toHaveBeenCalledTimes(1);
		});

		rerender(
			<div data-timeline-scroll-area>
				<div data-vertical-scroll-area>
					<SceneWaveformCanvas {...props} timelineScale={2} />
				</div>
			</div>,
		);

		await waitFor(() => {
			expect(getSceneWaveformThumbnailMock).toHaveBeenCalledTimes(2);
		});

		expect(getSceneWaveformThumbnailMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				sceneRevision: 5,
				windowStartFrame: 12,
				windowEndFrame: 53,
				width: 200,
				height: 40,
				pixelRatio: 1,
			}),
		);
	});

	it("拖拽 gain 时会继续复用旧波形，避免短暂消失", async () => {
		const firstWaveform = document.createElement("canvas");
		firstWaveform.width = 200;
		firstWaveform.height = 40;
		const resolveNextWaveformRef: {
			current: ((value: HTMLCanvasElement | null) => void) | null;
		} = {
			current: null,
		};
		const nextWaveformPromise = new Promise<HTMLCanvasElement | null>(
			(resolve) => {
				resolveNextWaveformRef.current = resolve;
			},
		);
		getSceneWaveformThumbnailMock
			.mockReset()
			.mockResolvedValueOnce(firstWaveform)
			.mockImplementationOnce(() => nextWaveformPromise)
			.mockImplementation(
				(params: { width: number; height: number; pixelRatio: number }) => {
					const canvas = document.createElement("canvas");
					canvas.width = Math.max(
						1,
						Math.round(params.width * params.pixelRatio),
					);
					canvas.height = Math.max(
						1,
						Math.round(params.height * params.pixelRatio),
					);
					return Promise.resolve(canvas);
				},
			);

		const props = {
			sceneRuntime: {
				ref: {
					sceneId: "scene-child",
				},
			} as never,
			runtimeManager: {
				getTimelineRuntime: vi.fn(),
			} as never,
			sceneRevision: 5,
			sourceFps: 24,
			start: 0,
			end: 90,
			fps: 30,
			timelineScale: 1,
			offsetFrames: 15,
			scrollLeft: 0,
			color: "rgba(34, 211, 238, 0.92)",
		};

		const { rerender } = render(
			<div data-timeline-scroll-area>
				<div data-vertical-scroll-area>
					<SceneWaveformCanvas {...props} gainDb={0} />
				</div>
			</div>,
		);

		resizeObserverCallback?.([], {} as ResizeObserver);

		await waitFor(() => {
			expect(getSceneWaveformThumbnailMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(drawImageMock).toHaveBeenCalled();
		});

		drawImageMock.mockClear();

		rerender(
			<div data-timeline-scroll-area>
				<div data-vertical-scroll-area>
					<SceneWaveformCanvas {...props} gainDb={6} />
				</div>
			</div>,
		);

		await waitFor(() => {
			expect(getSceneWaveformThumbnailMock).toHaveBeenCalledTimes(2);
		});
		expect(drawImageMock).toHaveBeenCalled();

		if (resolveNextWaveformRef.current) {
			resolveNextWaveformRef.current(document.createElement("canvas"));
		}
	});
});
