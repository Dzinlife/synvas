// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const WIDTH = 640;
const HEIGHT = 360;

const {
	canvasSourceAddMock,
	videoSampleSourceAddMock,
	videoSampleCtorMock,
	videoSampleCloseMock,
	outputStartMock,
	outputFinalizeMock,
	outputCancelMock,
	createSkiaCanvasSurfaceMock,
	createSkiaWebGPUReadbackSurfaceMock,
	getSkiaRenderBackendMock,
	skiaRootRenderMock,
	skiaRootDrawOnCanvasMock,
	skiaRootUnmountMock,
	surfaceDisposeMock,
	surfaceFlushMock,
	skiaCanvasDrawPictureMock,
	skiaCanvasReadPixelsMock,
	canvas2dPutImageDataMock,
	readbackPixelsMock,
	flushPendingReadbacksMock,
	readbackDisposeMock,
} = vi.hoisted(() => ({
	canvasSourceAddMock: vi.fn(async () => {}),
	videoSampleSourceAddMock: vi.fn(async () => {}),
	videoSampleCtorMock: vi.fn(),
	videoSampleCloseMock: vi.fn(),
	outputStartMock: vi.fn(async () => {}),
	outputFinalizeMock: vi.fn(async () => {}),
	outputCancelMock: vi.fn(async () => {}),
	createSkiaCanvasSurfaceMock: vi.fn(),
	createSkiaWebGPUReadbackSurfaceMock: vi.fn(),
	getSkiaRenderBackendMock: vi.fn(),
	skiaRootRenderMock: vi.fn(),
	skiaRootDrawOnCanvasMock: vi.fn(() => []),
	skiaRootUnmountMock: vi.fn(),
	surfaceDisposeMock: vi.fn(),
	surfaceFlushMock: vi.fn(),
	skiaCanvasDrawPictureMock: vi.fn(),
	skiaCanvasReadPixelsMock: vi.fn(),
	canvas2dPutImageDataMock: vi.fn(),
	readbackPixelsMock: vi.fn(),
	flushPendingReadbacksMock: vi.fn(async () => {}),
	readbackDisposeMock: vi.fn(),
}));

vi.mock("mediabunny", () => ({
	AudioSampleSource: class {
		add = vi.fn();
	},
	BufferTarget: class {
		buffer = new Uint8Array([1, 2, 3]);
	},
	CanvasSource: class {
		add = canvasSourceAddMock;
	},
	Mp4OutputFormat: class {},
	Output: class {
		addVideoTrack = vi.fn();
		addAudioTrack = vi.fn();
		start = outputStartMock;
		finalize = outputFinalizeMock;
		cancel = outputCancelMock;
	},
	QUALITY_HIGH: 1_000_000,
	StreamTarget: class {},
	VideoSample: class {
		close = videoSampleCloseMock;

		constructor(...args: unknown[]) {
			videoSampleCtorMock(...args);
		}
	},
	VideoSampleSource: class {
		add = videoSampleSourceAddMock;
	},
}));

vi.mock("react-skia-lite", () => ({
	createSkiaCanvasSurface: createSkiaCanvasSurfaceMock,
	createSkiaWebGPUReadbackSurface: createSkiaWebGPUReadbackSurfaceMock,
	getSkiaRenderBackend: getSkiaRenderBackendMock,
	JsiSkSurface: class {
		ref: any;
		private cleanup?: () => void;

		constructor(_canvasKit: unknown, ref: any, cleanup?: () => void) {
			this.ref = ref;
			this.cleanup = cleanup;
		}

		getCanvas() {
			return this.ref.getCanvas();
		}

		flush() {
			this.ref.flush();
		}

		dispose() {
			this.ref.delete?.();
			this.cleanup?.();
		}

		width() {
			return this.ref.width();
		}

		height() {
			return this.ref.height();
		}

		makeImageSnapshot() {
			return this.ref.makeImageSnapshot();
		}
	},
	Skia: { id: "skia" },
	SkiaSGRoot: class {
		render = skiaRootRenderMock;
		drawOnCanvas = skiaRootDrawOnCanvasMock;
		unmount = skiaRootUnmountMock;
	},
}));

import { exportTimelineAsVideoCore } from "./exportVideo";

const createMockSurface = (width = WIDTH, height = HEIGHT) => ({
	delete: surfaceDisposeMock,
	flush: surfaceFlushMock,
	width: () => width,
	height: () => height,
	getCanvas: () => ({
		drawPicture: skiaCanvasDrawPictureMock,
		readPixels: skiaCanvasReadPixelsMock,
	}),
	makeImageSnapshot: vi.fn(() => ({
		makeNonTextureImage: vi.fn(() => ({
			getImageInfo: vi.fn(() => ({
				width,
				height,
			})),
			readPixels: vi.fn(() => new Uint8Array(width * height * 4).fill(255)),
			dispose: vi.fn(),
		})),
		dispose: vi.fn(),
	})),
});

const createRenderState = () => ({
	children: ["frame-tree"],
	orderedElements: [],
	visibleElements: [],
	transitionFrameState: {
		activeTransitions: [],
		hiddenElementIds: [],
	},
	ready: Promise.resolve(),
	dispose: vi.fn(),
});

describe("exportTimelineAsVideoCore live render", () => {
	beforeEach(() => {
		canvasSourceAddMock.mockClear();
		videoSampleSourceAddMock.mockClear();
		videoSampleCtorMock.mockClear();
		videoSampleCloseMock.mockClear();
		outputStartMock.mockClear();
		outputFinalizeMock.mockClear();
		outputCancelMock.mockClear();
		createSkiaCanvasSurfaceMock.mockReset();
		createSkiaWebGPUReadbackSurfaceMock.mockReset();
		getSkiaRenderBackendMock.mockReset();
		skiaRootRenderMock.mockReset();
		skiaRootDrawOnCanvasMock.mockReset();
		skiaRootUnmountMock.mockReset();
		surfaceDisposeMock.mockReset();
		surfaceFlushMock.mockReset();
		skiaCanvasDrawPictureMock.mockReset();
		skiaCanvasReadPixelsMock.mockReset();
		canvas2dPutImageDataMock.mockReset();
		readbackPixelsMock.mockReset();
		flushPendingReadbacksMock.mockReset();
		readbackDisposeMock.mockReset();
		skiaRootDrawOnCanvasMock.mockReturnValue([]);
		skiaCanvasReadPixelsMock.mockReturnValue(
			new Uint8Array(WIDTH * HEIGHT * 4).fill(255),
		);
		readbackPixelsMock.mockResolvedValue({
			pixels: new Uint8Array(WIDTH * HEIGHT * 4).fill(255),
			width: WIDTH,
			height: HEIGHT,
			bytesPerRow: WIDTH * 4,
			format: "BGRA",
		});

		getSkiaRenderBackendMock.mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
			device: { id: "device" },
			deviceContext: { id: "gpu-context" },
		});
		createSkiaCanvasSurfaceMock.mockImplementation(() => ({
			getCanvas: () => ({
				drawPicture: skiaCanvasDrawPictureMock,
			}),
			flush: surfaceFlushMock,
			dispose: surfaceDisposeMock,
		}));
		createSkiaWebGPUReadbackSurfaceMock.mockImplementation(() => ({
			surface: createMockSurface(),
			readbackPixels: readbackPixelsMock,
			flushPendingReadbacks: flushPendingReadbacksMock,
			dispose: readbackDisposeMock,
		}));
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
			((contextId: string) => {
				if (contextId === "2d") {
					return {
						putImageData: canvas2dPutImageDataMock,
					} as unknown as CanvasRenderingContext2D;
				}
				return null;
			}) as never,
		);
		vi.stubGlobal(
			"ImageData",
			class MockImageData {
				constructor(
					public data: Uint8ClampedArray,
					public width: number,
					public height: number,
				) {}
			},
		);
		Object.defineProperty(URL, "createObjectURL", {
			value: vi.fn(() => "blob:test"),
			configurable: true,
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			value: vi.fn(),
			configurable: true,
		});
		HTMLAnchorElement.prototype.click = vi.fn();
	});

	it("WebGPU 导出改用 react-skia-lite readback helper", async () => {
		const buildSkiaFrameSnapshot = vi.fn(async () => ({
			children: [],
			orderedElements: [],
			visibleElements: [],
			transitionFrameState: {
				activeTransitions: [],
				hiddenElementIds: [],
			},
			picture: { id: "picture" } as never,
			ready: Promise.resolve(),
			dispose: vi.fn(),
		}));
		const buildSkiaRenderState = vi.fn(async () => createRenderState());

		await exportTimelineAsVideoCore({
			elements: [],
			tracks: [],
			fps: 30,
			canvasSize: { width: WIDTH, height: HEIGHT },
			startFrame: 0,
			endFrame: 3,
			buildSkiaFrameSnapshot,
			buildSkiaRenderState,
		});

		expect(buildSkiaRenderState).toHaveBeenCalledTimes(3);
		expect(buildSkiaFrameSnapshot).not.toHaveBeenCalled();
		expect(createSkiaWebGPUReadbackSurfaceMock).toHaveBeenCalledTimes(1);
		expect(createSkiaWebGPUReadbackSurfaceMock).toHaveBeenCalledWith(
			WIDTH,
			HEIGHT,
			expect.objectContaining({
				backend: expect.objectContaining({
					kind: "webgpu",
				}),
				label: "export-readback",
			}),
		);
		expect(skiaRootRenderMock).toHaveBeenCalledTimes(3);
		expect(skiaRootDrawOnCanvasMock).toHaveBeenCalledTimes(3);
		expect(readbackPixelsMock).toHaveBeenCalledTimes(3);
		expect(flushPendingReadbacksMock).toHaveBeenCalledTimes(1);
		expect(canvasSourceAddMock).not.toHaveBeenCalled();
		expect(videoSampleSourceAddMock).toHaveBeenCalledTimes(3);
		expect(videoSampleCtorMock).toHaveBeenNthCalledWith(
			1,
			expect.any(Uint8Array),
			expect.objectContaining({
				format: "BGRA",
				codedWidth: WIDTH,
				codedHeight: HEIGHT,
				layout: [{ offset: 0, stride: WIDTH * 4 }],
			}),
		);
		expect(readbackDisposeMock).toHaveBeenCalledTimes(1);
		expect(skiaRootUnmountMock).toHaveBeenCalledTimes(1);
	});

	it("helper readback 失败时会退回 canvas sample", async () => {
		const buildSkiaRenderState = vi.fn(async () => createRenderState());
		readbackPixelsMock.mockRejectedValueOnce(new Error("map failed"));

		await exportTimelineAsVideoCore({
			elements: [],
			tracks: [],
			fps: 30,
			canvasSize: { width: WIDTH, height: HEIGHT },
			startFrame: 0,
			endFrame: 1,
			buildSkiaFrameSnapshot: vi.fn(async () => ({
				children: [],
				orderedElements: [],
				visibleElements: [],
				transitionFrameState: {
					activeTransitions: [],
					hiddenElementIds: [],
				},
				picture: { id: "picture" } as never,
				ready: Promise.resolve(),
				dispose: vi.fn(),
			})),
			buildSkiaRenderState,
		});

		expect(readbackPixelsMock).toHaveBeenCalledTimes(1);
		expect(flushPendingReadbacksMock).toHaveBeenCalledTimes(2);
		expect(videoSampleSourceAddMock).toHaveBeenCalledTimes(1);
		expect(canvas2dPutImageDataMock).toHaveBeenCalledTimes(1);
		expect(videoSampleCtorMock).toHaveBeenCalledTimes(1);
		expect(videoSampleCtorMock.mock.calls[0]?.[0]).not.toBeInstanceOf(Uint8Array);
		expect(videoSampleCtorMock.mock.calls[0]?.[1]).toEqual(
			expect.objectContaining({
				timestamp: 0,
				duration: 1 / 30,
			}),
		);
		expect(readbackDisposeMock).toHaveBeenCalledTimes(1);
	});
});
