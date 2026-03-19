import { describe, expect, it, vi } from "vitest";

import { createSkiaWebGPUReadbackSurface } from "../src/skia/web/webgpuReadback";

const WIDTH = 321;
const HEIGHT = 180;
const BYTES_PER_ROW = 1536;

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
	it("创建 texture-backed surface 并复用两个 readback buffer", async () => {
		const surfaceDeleteMock = vi.fn();
		const wrapBackendTextureMock = vi.fn(() =>
			createMockSurfaceRef(WIDTH, HEIGHT, surfaceDeleteMock),
		);
		const {
			device,
			createTextureMock,
			createBufferMock,
			copyTextureToBufferMock,
			queueSubmitMock,
			bufferDestroyMocks,
			textureDestroyMock,
		} = createMockGPUDevice();
		const readbackSurface = createSkiaWebGPUReadbackSurface(WIDTH, HEIGHT, {
			CanvasKit: {
				ColorSpace: {
					SRGB: "srgb",
				},
				SkSurfaces: {
					WrapBackendTexture: wrapBackendTextureMock,
				},
			} as never,
			backend: {
				bundle: "webgpu",
				kind: "webgpu",
				device,
				deviceContext: { id: "gpu-context" },
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
			{ id: "gpu-context" },
			expect.objectContaining({
				destroy: textureDestroyMock,
			}),
			"srgb",
			undefined,
			undefined,
			undefined,
			"export-readback",
		);
		expect(createBufferMock).toHaveBeenCalledTimes(2);
		expect(copyTextureToBufferMock).toHaveBeenCalledTimes(3);
		expect(queueSubmitMock).toHaveBeenCalledTimes(3);
		expect(firstFrame).toEqual(
			expect.objectContaining({
				width: WIDTH,
				height: HEIGHT,
				bytesPerRow: BYTES_PER_ROW,
				format: "BGRA",
			}),
		);
		expect(firstFrame.pixels).toBeInstanceOf(Uint8Array);
		expect(firstFrame.pixels).toHaveLength(BYTES_PER_ROW * HEIGHT);
		expect(bufferDestroyMocks).toHaveLength(2);
		expect(bufferDestroyMocks[0]).toHaveBeenCalledTimes(1);
		expect(bufferDestroyMocks[1]).toHaveBeenCalledTimes(1);
		expect(surfaceDeleteMock).toHaveBeenCalledTimes(1);
		expect(textureDestroyMock).toHaveBeenCalledTimes(1);
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
				deviceContext: { id: "gpu-context" },
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
