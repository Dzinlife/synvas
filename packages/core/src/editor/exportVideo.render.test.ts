// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	canvasSourceAddMock,
	outputStartMock,
	outputFinalizeMock,
	outputCancelMock,
	createSkiaCanvasSurfaceMock,
	getSkiaRenderBackendMock,
	skiaRootRenderMock,
	skiaRootDrawOnCanvasMock,
	skiaRootUnmountMock,
	surfaceDisposeMock,
	surfaceFlushMock,
	skiaCanvasDrawPictureMock,
} = vi.hoisted(() => ({
	canvasSourceAddMock: vi.fn(async () => {}),
	outputStartMock: vi.fn(async () => {}),
	outputFinalizeMock: vi.fn(async () => {}),
	outputCancelMock: vi.fn(async () => {}),
	createSkiaCanvasSurfaceMock: vi.fn(),
	getSkiaRenderBackendMock: vi.fn(),
	skiaRootRenderMock: vi.fn(),
	skiaRootDrawOnCanvasMock: vi.fn(() => []),
	skiaRootUnmountMock: vi.fn(),
	surfaceDisposeMock: vi.fn(),
	surfaceFlushMock: vi.fn(),
	skiaCanvasDrawPictureMock: vi.fn(),
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
}));

vi.mock("react-skia-lite", () => ({
	createSkiaCanvasSurface: createSkiaCanvasSurfaceMock,
	getSkiaRenderBackend: getSkiaRenderBackendMock,
	JsiSkSurface: class {},
	Skia: { id: "skia" },
	SkiaSGRoot: class {
		render = skiaRootRenderMock;
		drawOnCanvas = skiaRootDrawOnCanvasMock;
		unmount = skiaRootUnmountMock;
	},
}));

import { exportTimelineAsVideoCore } from "./exportVideo";

describe("exportTimelineAsVideoCore live render", () => {
	beforeEach(() => {
		canvasSourceAddMock.mockClear();
		outputStartMock.mockClear();
		outputFinalizeMock.mockClear();
		outputCancelMock.mockClear();
		createSkiaCanvasSurfaceMock.mockReset();
		getSkiaRenderBackendMock.mockReset();
		skiaRootRenderMock.mockReset();
		skiaRootDrawOnCanvasMock.mockReset();
		skiaRootUnmountMock.mockReset();
		surfaceDisposeMock.mockReset();
		surfaceFlushMock.mockReset();
		skiaCanvasDrawPictureMock.mockReset();
		skiaRootDrawOnCanvasMock.mockReturnValue([]);
		getSkiaRenderBackendMock.mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
		});
		createSkiaCanvasSurfaceMock.mockImplementation(() => ({
			getCanvas: () => ({
				drawPicture: skiaCanvasDrawPictureMock,
			}),
			flush: surfaceFlushMock,
			dispose: surfaceDisposeMock,
		}));
		(globalThis as { CanvasKit?: unknown }).CanvasKit = { id: "canvaskit" };
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

	it("WebGPU 导出优先走 live render state，不再录根帧 picture", async () => {
		const buildSkiaFrameSnapshot = vi.fn(async () => ({
			children: [],
			orderedElements: [],
			visibleElements: [],
			transitionFrameState: {
				activeTransitions: [],
				hiddenElementIds: [],
			},
			picture: { id: "picture" },
			ready: Promise.resolve(),
			dispose: vi.fn(),
		}));
		const buildSkiaRenderState = vi.fn(async () => ({
			children: ["frame-tree"],
			orderedElements: [],
			visibleElements: [],
			transitionFrameState: {
				activeTransitions: [],
				hiddenElementIds: [],
			},
			ready: Promise.resolve(),
			dispose: vi.fn(),
		}));

		await exportTimelineAsVideoCore({
			elements: [],
			tracks: [],
			fps: 30,
			canvasSize: { width: 640, height: 360 },
			startFrame: 0,
			endFrame: 1,
			buildSkiaFrameSnapshot,
			buildSkiaRenderState,
		});

		expect(buildSkiaRenderState).toHaveBeenCalledTimes(1);
		expect(buildSkiaFrameSnapshot).not.toHaveBeenCalled();
		expect(skiaRootRenderMock).toHaveBeenCalledWith(["frame-tree"]);
		expect(skiaRootDrawOnCanvasMock).toHaveBeenCalledTimes(1);
		expect(skiaCanvasDrawPictureMock).not.toHaveBeenCalled();
		expect(canvasSourceAddMock).toHaveBeenCalledTimes(1);
		expect(skiaRootUnmountMock).toHaveBeenCalledTimes(1);
	});
});
