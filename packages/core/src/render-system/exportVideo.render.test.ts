// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const WIDTH = 640;
const HEIGHT = 360;

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
import {
	COLOR_SPACE_PRESETS,
	DEFAULT_COLOR_MANAGEMENT_SETTINGS,
} from "../color-management";

const createMockSurface = () => ({
	getCanvas: () => ({
		drawPicture: skiaCanvasDrawPictureMock,
	}),
	flush: surfaceFlushMock,
	dispose: surfaceDisposeMock,
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
		canvasSourceAddMock.mockReset();
		outputStartMock.mockReset();
		outputFinalizeMock.mockReset();
		outputCancelMock.mockReset();
		createSkiaCanvasSurfaceMock.mockReset();
		getSkiaRenderBackendMock.mockReset();
		skiaRootRenderMock.mockReset();
		skiaRootDrawOnCanvasMock.mockReset();
		skiaRootUnmountMock.mockReset();
		surfaceDisposeMock.mockReset();
		surfaceFlushMock.mockReset();
		skiaCanvasDrawPictureMock.mockReset();

		skiaRootDrawOnCanvasMock.mockReturnValue([]);
		(globalThis as { CanvasKit?: unknown }).CanvasKit = { id: "canvaskit" };
		getSkiaRenderBackendMock.mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
			device: { id: "device" },
			deviceContext: { id: "gpu-context" },
		});
		createSkiaCanvasSurfaceMock.mockImplementation(() => createMockSurface());
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

	it("WebGPU 导出会走 CanvasSource 并按帧创建/释放 surface", async () => {
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
		expect(createSkiaCanvasSurfaceMock).toHaveBeenCalledTimes(3);
		expect(skiaRootRenderMock).toHaveBeenCalledTimes(3);
		expect(skiaRootDrawOnCanvasMock).toHaveBeenCalledTimes(3);
		expect(surfaceFlushMock).toHaveBeenCalledTimes(3);
		expect(surfaceDisposeMock).toHaveBeenCalledTimes(3);
		expect(canvasSourceAddMock).toHaveBeenCalledTimes(3);
		expect(canvasSourceAddMock).toHaveBeenNthCalledWith(1, 0, 1 / 30);
		expect(canvasSourceAddMock).toHaveBeenNthCalledWith(2, 1 / 30, 1 / 30);
		expect(canvasSourceAddMock).toHaveBeenNthCalledWith(3, 2 / 30, 1 / 30);
		expect(skiaRootUnmountMock).toHaveBeenCalledTimes(1);
	});

	it("P3 SDR 导出会把 surface 目标切到 Display P3", async () => {
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
			endFrame: 1,
			buildSkiaFrameSnapshot,
			buildSkiaRenderState,
			colorSettings: {
				...DEFAULT_COLOR_MANAGEMENT_SETTINGS,
				export: COLOR_SPACE_PRESETS.displayP3Sdr,
			},
		});

		expect(createSkiaCanvasSurfaceMock).toHaveBeenCalledWith(
			(globalThis as { CanvasKit?: unknown }).CanvasKit,
			expect.anything(),
			expect.objectContaining({ kind: "webgpu" }),
			{ colorSpace: "p3" },
		);
	});

	it("WebGPU surface 创建失败时会直接报错，不再回退", async () => {
		createSkiaCanvasSurfaceMock.mockReturnValue(null);
		const buildSkiaRenderState = vi.fn(async () => createRenderState());

		await expect(
			exportTimelineAsVideoCore({
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
			}),
		).rejects.toThrow("导出失败：无法创建 webgpu Surface");

		expect(canvasSourceAddMock).not.toHaveBeenCalled();
		expect(surfaceDisposeMock).not.toHaveBeenCalled();
		expect(skiaRootUnmountMock).toHaveBeenCalledTimes(1);
	});
});
