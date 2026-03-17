import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createSkiaCanvasSurface,
	createSkiaOffscreenSurface,
	invalidateSkiaWebGPUCanvasContext,
} from "../src/skia/web/surfaceFactory";

describe("surfaceFactory", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("WebGPU offscreen surface 会创建 GPU 纹理并在释放时销毁", () => {
		const deleteMock = vi.fn();
		const flushMock = vi.fn();
		const snapshotDeleteMock = vi.fn();
		const textureA = { destroy: vi.fn() };
		const textureB = { destroy: vi.fn() };
		const createTextureMock = vi
			.fn()
			.mockReturnValueOnce(textureA)
			.mockReturnValueOnce(textureB);
		const makeGPUTextureSurfaceMock = vi.fn(
			(
				_deviceContext: unknown,
				_texture: GPUTexture,
				_textureFormat: GPUTextureFormat,
				width: number,
				height: number,
			) => ({
				delete: deleteMock,
				flush: flushMock,
				width: () => width,
				height: () => height,
				getCanvas: () => ({
					clear: vi.fn(),
					save: vi.fn(),
					restore: vi.fn(),
					scale: vi.fn(),
					drawPicture: vi.fn(),
				}),
				makeImageSnapshot: vi.fn(() => ({
					delete: snapshotDeleteMock,
				})),
			}),
		);
		const canvasKit = {
			MakeGPUTextureSurface: makeGPUTextureSurfaceMock,
		} as never;
		const backend = {
			bundle: "webgpu",
			kind: "webgpu",
			device: {
				createTexture: createTextureMock,
			},
			deviceContext: { id: "ctx" },
		} as const;
		vi.stubGlobal("navigator", {
			gpu: {
				getPreferredCanvasFormat: vi.fn(() => "rgba8unorm"),
			},
		});

		const firstSurface = createSkiaOffscreenSurface(canvasKit, 64, 32, backend);
		const secondSurface = createSkiaOffscreenSurface(
			canvasKit,
			128,
			72,
			backend,
		);

		firstSurface?.flush();
		firstSurface?.makeImageSnapshot();
		firstSurface?.dispose();
		secondSurface?.dispose();

		expect(createTextureMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				size: {
					width: 64,
					height: 32,
				},
				format: "rgba8unorm",
			}),
		);
		expect(createTextureMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				size: {
					width: 128,
					height: 72,
				},
				format: "rgba8unorm",
			}),
		);
		expect(makeGPUTextureSurfaceMock).toHaveBeenNthCalledWith(
			1,
			backend.deviceContext,
			textureA,
			"rgba8unorm",
			64,
			32,
			undefined,
		);
		expect(makeGPUTextureSurfaceMock).toHaveBeenNthCalledWith(
			2,
			backend.deviceContext,
			textureB,
			"rgba8unorm",
			128,
			72,
			undefined,
		);
		expect(flushMock).toHaveBeenCalledTimes(1);
		expect(deleteMock).toHaveBeenCalledTimes(2);
		expect(textureA.destroy).toHaveBeenCalledTimes(1);
		expect(textureB.destroy).toHaveBeenCalledTimes(1);
		expect(snapshotDeleteMock).not.toHaveBeenCalled();
	});

	it("WebGPU canvas surface 会复用已配置的 canvas context", () => {
		const gpuCanvasContext = {
			id: "canvas-context",
		};
		const makeGPUCanvasContextMock = vi.fn(() => gpuCanvasContext);
		const makeGPUCanvasSurfaceMock = vi.fn(() => ({
			delete: vi.fn(),
			flush: vi.fn(),
			width: () => 64,
			height: () => 32,
			getCanvas: () => ({
				clear: vi.fn(),
				save: vi.fn(),
				restore: vi.fn(),
				scale: vi.fn(),
				drawPicture: vi.fn(),
			}),
			makeImageSnapshot: vi.fn(),
		}));
		const canvasKit = {
			MakeGPUCanvasContext: makeGPUCanvasContextMock,
			MakeGPUCanvasSurface: makeGPUCanvasSurfaceMock,
		} as never;
		const canvas = {} as HTMLCanvasElement;
		const backend = {
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: { id: "ctx" },
		} as const;
		vi.stubGlobal("navigator", {
			gpu: {
				getPreferredCanvasFormat: vi.fn(() => "rgba8unorm"),
			},
		});

		const firstSurface = createSkiaCanvasSurface(canvasKit, canvas, backend);
		const secondSurface = createSkiaCanvasSurface(canvasKit, canvas, backend);
		invalidateSkiaWebGPUCanvasContext(canvas);
		const thirdSurface = createSkiaCanvasSurface(canvasKit, canvas, backend);

		firstSurface?.dispose();
		secondSurface?.dispose();
		thirdSurface?.dispose();

		expect(makeGPUCanvasContextMock).toHaveBeenCalledTimes(2);
		expect(makeGPUCanvasContextMock).toHaveBeenNthCalledWith(
			1,
			backend.deviceContext,
			canvas,
			{ format: "rgba8unorm" },
		);
		expect(makeGPUCanvasContextMock).toHaveBeenNthCalledWith(
			2,
			backend.deviceContext,
			canvas,
			{ format: "rgba8unorm" },
		);
		expect(makeGPUCanvasSurfaceMock).toHaveBeenCalledTimes(3);
		expect(makeGPUCanvasSurfaceMock).toHaveBeenNthCalledWith(1, gpuCanvasContext);
		expect(makeGPUCanvasSurfaceMock).toHaveBeenNthCalledWith(2, gpuCanvasContext);
		expect(makeGPUCanvasSurfaceMock).toHaveBeenNthCalledWith(3, gpuCanvasContext);
	});
});
