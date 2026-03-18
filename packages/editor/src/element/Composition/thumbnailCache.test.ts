// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCompositionThumbnail } from "./thumbnailCache";

const {
	buildSkiaFrameSnapshotMock,
	buildSkiaRenderStateMock,
	makeSurfaceMock,
	makeOffscreenMock,
	drawPictureMock,
	saveMock,
	restoreMock,
	translateMock,
	scaleMock,
	flushMock,
	readPixelsMock,
	surfaceDisposeMock,
	getSkiaRenderBackendMock,
	skiaRootRenderMock,
	skiaRootDrawOnCanvasMock,
	skiaRootUnmountMock,
} = vi.hoisted(() => ({
	buildSkiaFrameSnapshotMock: vi.fn(),
	buildSkiaRenderStateMock: vi.fn(),
	makeSurfaceMock: vi.fn(),
	makeOffscreenMock: vi.fn(),
	drawPictureMock: vi.fn(),
	saveMock: vi.fn(),
	restoreMock: vi.fn(),
	translateMock: vi.fn(),
	scaleMock: vi.fn(),
	flushMock: vi.fn(),
	readPixelsMock: vi.fn(),
	surfaceDisposeMock: vi.fn(),
	getSkiaRenderBackendMock: vi.fn(),
	skiaRootRenderMock: vi.fn(),
	skiaRootDrawOnCanvasMock: vi.fn(() => []),
	skiaRootUnmountMock: vi.fn(),
}));

vi.mock("@/scene-editor/preview/buildSkiaTree", () => ({
	buildSkiaFrameSnapshot: buildSkiaFrameSnapshotMock,
	buildSkiaRenderState: buildSkiaRenderStateMock,
}));

vi.mock("react-skia-lite", () => ({
	getSkiaRenderBackend: getSkiaRenderBackendMock,
	ColorType: {
		RGBA_8888: 4,
	},
	AlphaType: {
		Unpremul: 3,
	},
	Skia: {
		XYWHRect: (x: number, y: number, width: number, height: number) => ({
			x,
			y,
			width,
			height,
		}),
		Surface: {
			Make: makeSurfaceMock,
			MakeOffscreen: makeOffscreenMock,
		},
	},
	SkiaSGRoot: class {
		render = skiaRootRenderMock;
		drawOnCanvas = skiaRootDrawOnCanvasMock;
		unmount = skiaRootUnmountMock;
	},
}));

describe("Composition thumbnailCache", () => {
	beforeEach(() => {
		buildSkiaFrameSnapshotMock.mockReset();
		buildSkiaRenderStateMock.mockReset();
		makeSurfaceMock.mockReset();
		makeOffscreenMock.mockReset();
		drawPictureMock.mockReset();
		saveMock.mockReset();
		restoreMock.mockReset();
		translateMock.mockReset();
		scaleMock.mockReset();
		flushMock.mockReset();
		readPixelsMock.mockReset();
		surfaceDisposeMock.mockReset();
		getSkiaRenderBackendMock.mockReset();
		skiaRootRenderMock.mockReset();
		skiaRootDrawOnCanvasMock.mockReset();
		skiaRootUnmountMock.mockReset();
		skiaRootDrawOnCanvasMock.mockReturnValue([]);
		getSkiaRenderBackendMock.mockReturnValue({
			bundle: "webgl",
			kind: "webgl",
		});

		readPixelsMock.mockReturnValue(new Uint8Array(4));
		const surfaceMock = {
			getCanvas: () => ({
				clear: vi.fn(),
				save: saveMock,
				restore: restoreMock,
				translate: translateMock,
				scale: scaleMock,
				drawPicture: drawPictureMock,
				readPixels: readPixelsMock,
			}),
			flush: flushMock,
			dispose: surfaceDisposeMock,
		};
		makeSurfaceMock.mockReturnValue(surfaceMock);
		makeOffscreenMock.mockReturnValue(surfaceMock);
		buildSkiaFrameSnapshotMock.mockResolvedValue({
			picture: { id: "picture-1" },
			dispose: vi.fn(),
		});
		buildSkiaRenderStateMock.mockResolvedValue({
			children: ["live-node"],
			ready: Promise.resolve(),
			dispose: vi.fn(),
		});
		vi.stubGlobal(
			"ImageData",
			class ImageData {
				constructor(
					public data: Uint8ClampedArray,
					public width: number,
					public height: number,
				) {}
			},
		);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
			() =>
				({
					putImageData: vi.fn(),
				}) as never,
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("渲染 Composition 缩略图时会复用单个 offscreen surface，并等待帧准备完成后再截图", async () => {
		const firstCanvas = await getCompositionThumbnail({
			sceneRuntime: {
				ref: {
					sceneId: "scene-child",
				},
				modelRegistry: {
					get: vi.fn(),
				},
				timelineStore: {
					getState: () => ({
						elements: [],
						tracks: [],
						fps: 30,
						canvasSize: {
							width: 1920,
							height: 1080,
						},
					}),
				},
			} as never,
			runtimeManager: {
				getTimelineRuntime: vi.fn(() => null),
			} as never,
			sceneRevision: 1,
			displayFrame: 12,
			width: 80,
			height: 45,
			pixelRatio: 1,
		});
		const secondCanvas = await getCompositionThumbnail({
			sceneRuntime: {
				ref: {
					sceneId: "scene-child",
				},
				modelRegistry: {
					get: vi.fn(),
				},
				timelineStore: {
					getState: () => ({
						elements: [],
						tracks: [],
						fps: 30,
						canvasSize: {
							width: 1920,
							height: 1080,
						},
					}),
				},
			} as never,
			runtimeManager: {
				getTimelineRuntime: vi.fn(() => null),
			} as never,
			sceneRevision: 2,
			displayFrame: 24,
			width: 120,
			height: 68,
			pixelRatio: 1,
		});

		expect(firstCanvas).toBeInstanceOf(HTMLCanvasElement);
		expect(secondCanvas).toBeInstanceOf(HTMLCanvasElement);
		expect(makeOffscreenMock).toHaveBeenCalledTimes(1);
		expect(makeOffscreenMock).toHaveBeenCalledWith(512, 512);
		expect(makeSurfaceMock).not.toHaveBeenCalled();
		expect(buildSkiaFrameSnapshotMock).toHaveBeenCalledWith(
			expect.objectContaining({
				prepare: expect.objectContaining({
					canvasSize: {
						width: 1920,
						height: 1080,
					},
					forcePrepareFrames: true,
					awaitReady: true,
				}),
			}),
			expect.any(Object),
		);
		expect(saveMock).toHaveBeenCalledTimes(2);
		expect(translateMock).toHaveBeenCalledWith(0, 0);
		expect(scaleMock).toHaveBeenCalledWith(80 / 1920, 80 / 1920);
		expect(drawPictureMock).toHaveBeenCalledWith({ id: "picture-1" });
		expect(restoreMock).toHaveBeenCalledTimes(2);
		expect(readPixelsMock).toHaveBeenCalledTimes(2);
	});

	it("WebGPU 下会直接渲染 live render state，而不是先录 picture", async () => {
		getSkiaRenderBackendMock.mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
		});

		const canvas = await getCompositionThumbnail({
			sceneRuntime: {
				ref: {
					sceneId: "scene-live-thumb",
				},
				modelRegistry: {
					get: vi.fn(),
				},
				timelineStore: {
					getState: () => ({
						elements: [],
						tracks: [],
						fps: 30,
						canvasSize: {
							width: 1920,
							height: 1080,
						},
					}),
				},
			} as never,
			runtimeManager: {
				getTimelineRuntime: vi.fn(() => null),
			} as never,
			sceneRevision: 3,
			displayFrame: 36,
			width: 80,
			height: 45,
			pixelRatio: 1,
		});

		expect(canvas).toBeInstanceOf(HTMLCanvasElement);
		expect(buildSkiaRenderStateMock).toHaveBeenCalledWith(
			expect.objectContaining({}),
			expect.any(Object),
		);
		expect(buildSkiaFrameSnapshotMock).not.toHaveBeenCalled();
		expect(skiaRootRenderMock).toHaveBeenCalledTimes(1);
		expect(skiaRootDrawOnCanvasMock).toHaveBeenCalledTimes(1);
		expect(drawPictureMock).not.toHaveBeenCalled();
		expect(readPixelsMock).toHaveBeenCalledTimes(1);
		expect(skiaRootUnmountMock).toHaveBeenCalledTimes(1);
	});
});
