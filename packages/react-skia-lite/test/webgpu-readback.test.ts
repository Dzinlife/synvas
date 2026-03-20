import { describe, expect, it, vi } from "vitest";

import { createSkiaWebGPUReadbackSurface } from "../src/skia/web/webgpuReadback";

const WIDTH = 321;
const HEIGHT = 180;
const TIGHT_BYTES_PER_ROW = WIDTH * 4;

const createMockSurfaceRef = (
	width = WIDTH,
	height = HEIGHT,
	deleteMock = vi.fn(),
) => ({
	delete: deleteMock,
	flush: vi.fn(),
	width: () => width,
	height: () => height,
	getCanvas: () => ({
		clear: vi.fn(),
		save: vi.fn(),
		restore: vi.fn(),
		scale: vi.fn(),
		drawPicture: vi.fn(),
	}),
	makeImageSnapshot: vi.fn(),
});

const createMockGPUDevice = (options?: {
	onSubmittedWorkDone?: () => Promise<void>;
}) => {
	const textureDestroyMock = vi.fn();
	const createTextureMock = vi.fn(() => ({
		destroy: textureDestroyMock,
	}));
	const copyTextureToBufferMock = vi.fn();
	const queueSubmitMock = vi.fn();
	const bufferDestroyMocks: Array<ReturnType<typeof vi.fn>> = [];
	const createBufferMock = vi.fn((descriptor: { size: number }) => {
		const destroy = vi.fn();
		bufferDestroyMocks.push(destroy);
		return {
			mapAsync: vi.fn(async () => {}),
			getMappedRange: vi.fn(() => new ArrayBuffer(descriptor.size)),
			unmap: vi.fn(),
			destroy,
		};
	});
	const createCommandEncoderMock = vi.fn(() => ({
		copyTextureToBuffer: copyTextureToBufferMock,
		finish: vi.fn(() => ({ id: Symbol("command-buffer") })),
	}));
	const device = {
		createTexture: createTextureMock,
		createBuffer: createBufferMock,
		createCommandEncoder: createCommandEncoderMock,
		queue: {
			submit: queueSubmitMock,
			onSubmittedWorkDone:
				options?.onSubmittedWorkDone ?? vi.fn(async () => {}),
		},
	} as unknown as GPUDevice;
	return {
		device,
		createTextureMock,
		createBufferMock,
		copyTextureToBufferMock,
		queueSubmitMock,
		bufferDestroyMocks,
		textureDestroyMock,
	};
};

describe("webgpuReadback", () => {
	it("优先使用 CanvasKit 异步读回 API", async () => {
		const surfaceDeleteMock = vi.fn();
		const wrapBackendTextureMock = vi.fn(() =>
			createMockSurfaceRef(WIDTH, HEIGHT, surfaceDeleteMock),
		);
		const readSurfacePixelsAsyncMock = vi.fn(async () => ({
			planes: [new Uint8Array(TIGHT_BYTES_PER_ROW * HEIGHT).fill(7)],
			rowBytes: [TIGHT_BYTES_PER_ROW],
			count: 1,
			width: WIDTH,
			height: HEIGHT,
		}));
		const checkAsyncWorkCompletionMock = vi.fn();
		const {
			device,
			createTextureMock,
			createBufferMock,
			bufferDestroyMocks,
			textureDestroyMock,
		} = createMockGPUDevice();
		const readbackSurface = createSkiaWebGPUReadbackSurface(WIDTH, HEIGHT, {
			CanvasKit: {
				ColorSpace: {
					SRGB: "srgb",
				},
				ColorType: {
					RGBA_8888: "rgba-8888",
					BGRA_8888: "bgra-8888",
				},
				AlphaType: {
					Premul: "premul",
				},
				RescaleGamma: {
					Linear: "linear",
				},
				RescaleMode: {
					Linear: "linear",
				},
				SkSurfaces: {
					WrapBackendTexture: wrapBackendTextureMock,
				},
			} as never,
			backend: {
				bundle: "webgpu",
				kind: "webgpu",
				device,
				deviceContext: {
					id: "gpu-context",
					ReadSurfacePixelsAsync: readSurfacePixelsAsyncMock,
					checkAsyncWorkCompletion: checkAsyncWorkCompletionMock,
				},
			},
			label: "export-readback",
			textureFormat: "bgra8unorm",
		});

		expect(readbackSurface).not.toBeNull();

		const firstFrame = await readbackSurface!.readbackPixels();
		await readbackSurface!.readbackPixels();
		await readbackSurface!.readbackPixels();
		await readbackSurface!.flushPendingReadbacks();
		readbackSurface!.dispose();
		await Promise.resolve();
		await Promise.resolve();

		expect(createTextureMock).toHaveBeenCalledTimes(1);
		expect(wrapBackendTextureMock).toHaveBeenCalledTimes(1);
		expect(wrapBackendTextureMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: "gpu-context" }),
			expect.objectContaining({
				destroy: textureDestroyMock,
			}),
			"srgb",
			undefined,
			undefined,
			undefined,
			"export-readback",
		);
		expect(readSurfacePixelsAsyncMock).toHaveBeenCalledTimes(3);
		expect(checkAsyncWorkCompletionMock).toHaveBeenCalled();
		expect(createBufferMock).toHaveBeenCalledTimes(0);
		expect(firstFrame).toEqual(
			expect.objectContaining({
				width: WIDTH,
				height: HEIGHT,
				bytesPerRow: TIGHT_BYTES_PER_ROW,
				format: "BGRA",
			}),
		);
		expect(firstFrame.pixels).toBeInstanceOf(Uint8Array);
		expect(firstFrame.pixels).toHaveLength(TIGHT_BYTES_PER_ROW * HEIGHT);
		expect(bufferDestroyMocks).toHaveLength(0);
		expect(surfaceDeleteMock).toHaveBeenCalledTimes(1);
		expect(textureDestroyMock).toHaveBeenCalledTimes(1);
	});

	it("CanvasKit 异步读回返回空结果时会直接报错", async () => {
		const surfaceDeleteMock = vi.fn();
		const wrapBackendTextureMock = vi.fn(() =>
			createMockSurfaceRef(WIDTH, HEIGHT, surfaceDeleteMock),
		);
		const readSurfacePixelsAsyncMock = vi.fn(async () => null);
		const {
			device,
			createBufferMock,
			textureDestroyMock,
		} = createMockGPUDevice();
		const readbackSurface = createSkiaWebGPUReadbackSurface(WIDTH, HEIGHT, {
			CanvasKit: {
				ColorSpace: {
					SRGB: "srgb",
				},
				ColorType: {
					RGBA_8888: "rgba-8888",
					BGRA_8888: "bgra-8888",
				},
				AlphaType: {
					Premul: "premul",
				},
				RescaleGamma: {
					Linear: "linear",
				},
				RescaleMode: {
					Linear: "linear",
				},
				SkSurfaces: {
					WrapBackendTexture: wrapBackendTextureMock,
				},
			} as never,
			backend: {
				bundle: "webgpu",
				kind: "webgpu",
				device,
				deviceContext: {
					id: "gpu-context",
					ReadSurfacePixelsAsync: readSurfacePixelsAsyncMock,
					checkAsyncWorkCompletion: vi.fn(),
				},
			},
			textureFormat: "bgra8unorm",
		});

		expect(readbackSurface).not.toBeNull();
		await expect(readbackSurface!.readbackPixels()).rejects.toThrow(
			"CanvasKit 异步读回结果为空",
		);
		await readbackSurface!.flushPendingReadbacks();
		readbackSurface!.dispose();
		await Promise.resolve();
		await Promise.resolve();

		expect(readSurfacePixelsAsyncMock).toHaveBeenCalledTimes(1);
		expect(createBufferMock).toHaveBeenCalledTimes(0);
		expect(surfaceDeleteMock).toHaveBeenCalledTimes(1);
		expect(textureDestroyMock).toHaveBeenCalledTimes(1);
	});

	it("会轮询 checkAsyncWorkCompletion 等待异步读回完成", async () => {
		const surfaceDeleteMock = vi.fn();
		let resolveRead: ((value: {
			planes: Uint8Array[];
			rowBytes: number[];
			count: number;
			width: number;
			height: number;
		} | null) => void) | null = null;
		const readSurfacePixelsAsyncMock = vi.fn(
			() =>
				new Promise<{
					planes: Uint8Array[];
					rowBytes: number[];
					count: number;
					width: number;
					height: number;
				} | null>((resolve) => {
					resolveRead = resolve;
				}),
		);
		const checkAsyncWorkCompletionMock = vi.fn(() => {
			if (!resolveRead) {
				return;
			}
			resolveRead({
				planes: [new Uint8Array(TIGHT_BYTES_PER_ROW * HEIGHT).fill(3)],
				rowBytes: [TIGHT_BYTES_PER_ROW],
				count: 1,
				width: WIDTH,
				height: HEIGHT,
			});
			resolveRead = null;
		});
		const { device } = createMockGPUDevice();
		const readbackSurface = createSkiaWebGPUReadbackSurface(WIDTH, HEIGHT, {
			CanvasKit: {
				ColorSpace: {
					SRGB: "srgb",
				},
				ColorType: {
					RGBA_8888: "rgba-8888",
					BGRA_8888: "bgra-8888",
				},
				AlphaType: {
					Premul: "premul",
				},
				RescaleGamma: {
					Linear: "linear",
				},
				RescaleMode: {
					Linear: "linear",
				},
				SkSurfaces: {
					WrapBackendTexture: vi.fn(() =>
						createMockSurfaceRef(WIDTH, HEIGHT, surfaceDeleteMock),
					),
				},
			} as never,
			backend: {
				bundle: "webgpu",
				kind: "webgpu",
				device,
				deviceContext: {
					id: "gpu-context",
					ReadSurfacePixelsAsync: readSurfacePixelsAsyncMock,
					checkAsyncWorkCompletion: checkAsyncWorkCompletionMock,
				},
			},
			textureFormat: "rgba8unorm",
		});

		expect(readbackSurface).not.toBeNull();

		const frame = await readbackSurface!.readbackPixels();
		readbackSurface!.dispose();

		expect(frame.bytesPerRow).toBe(TIGHT_BYTES_PER_ROW);
		expect(checkAsyncWorkCompletionMock).toHaveBeenCalled();
		expect(surfaceDeleteMock).toHaveBeenCalledTimes(1);
	});

	it("dispose 会等 queue idle 后再销毁 texture", async () => {
		let resolveQueueIdle: (() => void) | null = null;
		const surfaceDeleteMock = vi.fn();
		const {
			device,
			textureDestroyMock,
		} = createMockGPUDevice({
			onSubmittedWorkDone: () =>
				new Promise<void>((resolve) => {
					resolveQueueIdle = resolve;
				}),
		});
		const readbackSurface = createSkiaWebGPUReadbackSurface(WIDTH, HEIGHT, {
			CanvasKit: {
				ColorSpace: {
					SRGB: "srgb",
				},
				ColorType: {
					RGBA_8888: "rgba-8888",
					BGRA_8888: "bgra-8888",
				},
				AlphaType: {
					Premul: "premul",
				},
				RescaleGamma: {
					Linear: "linear",
				},
				RescaleMode: {
					Linear: "linear",
				},
				SkSurfaces: {
					WrapBackendTexture: vi.fn(() =>
						createMockSurfaceRef(WIDTH, HEIGHT, surfaceDeleteMock),
					),
				},
			} as never,
			backend: {
				bundle: "webgpu",
				kind: "webgpu",
				device,
				deviceContext: {
					id: "gpu-context",
					ReadSurfacePixelsAsync: vi.fn(async () => ({
						planes: [new Uint8Array(TIGHT_BYTES_PER_ROW * HEIGHT)],
						rowBytes: [TIGHT_BYTES_PER_ROW],
						count: 1,
						width: WIDTH,
						height: HEIGHT,
					})),
					checkAsyncWorkCompletion: vi.fn(),
				},
			},
			textureFormat: "rgba8unorm",
		});

		expect(readbackSurface).not.toBeNull();

		readbackSurface!.dispose();
		expect(surfaceDeleteMock).toHaveBeenCalledTimes(1);
		expect(textureDestroyMock).not.toHaveBeenCalled();

		resolveQueueIdle?.();
		await Promise.resolve();
		await Promise.resolve();

		expect(textureDestroyMock).toHaveBeenCalledTimes(1);
	});
});
