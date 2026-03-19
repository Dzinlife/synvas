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

	it("WebGPU offscreen surface 改走 Graphite RenderTarget", () => {
		const deleteMock = vi.fn();
		const flushMock = vi.fn();
		const snapshotDeleteMock = vi.fn();
		const renderTargetMock = vi.fn(
			(_deviceContext: unknown, imageInfo: { width: number; height: number }) => ({
				delete: deleteMock,
				flush: flushMock,
				width: () => imageInfo.width,
				height: () => imageInfo.height,
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
			ColorType: { RGBA_8888: "rgba8888" },
			AlphaType: { Premul: "premul" },
			ColorSpace: { SRGB: "srgb" },
			SkSurfaces: {
				RenderTarget: renderTargetMock,
			},
		} as never;
		const backend = {
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: { id: "ctx" },
		} as const;

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

		expect(renderTargetMock).toHaveBeenNthCalledWith(
			1,
			backend.deviceContext,
			expect.objectContaining({
				width: 64,
				height: 32,
				colorType: "rgba8888",
				alphaType: "premul",
				colorSpace: "srgb",
			}),
			false,
			undefined,
			"",
		);
		expect(renderTargetMock).toHaveBeenNthCalledWith(
			2,
			backend.deviceContext,
			expect.objectContaining({
				width: 128,
				height: 72,
				colorType: "rgba8888",
				alphaType: "premul",
				colorSpace: "srgb",
			}),
			false,
			undefined,
			"",
		);
		expect(flushMock).toHaveBeenCalledTimes(1);
		expect(deleteMock).toHaveBeenCalledTimes(2);
		expect(snapshotDeleteMock).not.toHaveBeenCalled();
	});

	it("WebGPU offscreen surface 不再自行创建外部 GPUTexture", () => {
		const deleteMock = vi.fn();
		const renderTargetMock = vi.fn(
			(_deviceContext: unknown, imageInfo: { width: number; height: number }) => ({
				delete: deleteMock,
				flush: vi.fn(),
				width: () => imageInfo.width,
				height: () => imageInfo.height,
				getCanvas: () => ({
					clear: vi.fn(),
					save: vi.fn(),
					restore: vi.fn(),
					scale: vi.fn(),
					drawPicture: vi.fn(),
				}),
				makeImageSnapshot: vi.fn(),
			}),
		);
		const canvasKit = {
			ColorType: { RGBA_8888: "rgba8888" },
			AlphaType: { Premul: "premul" },
			ColorSpace: { SRGB: "srgb" },
			SkSurfaces: {
				RenderTarget: renderTargetMock,
			},
		} as never;
		const backend = {
			bundle: "webgpu",
			kind: "webgpu",
			device: {
				createTexture: vi.fn(),
			} as unknown as GPUDevice,
			deviceContext: { id: "ctx" },
		} as const;

		const surface = createSkiaOffscreenSurface(canvasKit, 64, 32, backend);
		surface?.dispose();

		expect(deleteMock).toHaveBeenCalledTimes(1);
		expect(backend.device.createTexture).not.toHaveBeenCalled();
		expect(renderTargetMock).toHaveBeenCalledTimes(1);
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
			{
				format: "rgba8unorm",
				alphaMode: "premultiplied",
			},
		);
		expect(makeGPUCanvasContextMock).toHaveBeenNthCalledWith(
			2,
			backend.deviceContext,
			canvas,
			{
				format: "rgba8unorm",
				alphaMode: "premultiplied",
			},
		);
		expect(makeGPUCanvasSurfaceMock).toHaveBeenCalledTimes(3);
		expect(makeGPUCanvasSurfaceMock).toHaveBeenNthCalledWith(1, gpuCanvasContext);
		expect(makeGPUCanvasSurfaceMock).toHaveBeenNthCalledWith(2, gpuCanvasContext);
		expect(makeGPUCanvasSurfaceMock).toHaveBeenNthCalledWith(3, gpuCanvasContext);
	});

	it("WebGL offscreen surface 会创建 RenderTarget 并在释放时回收上下文", () => {
		const grContextDeleteMock = vi.fn();
		const loseContextMock = vi.fn();
		const deleteContextMock = vi.fn();
		const renderTargetDeleteMock = vi.fn();
		const canvasKit = {
			GetWebGLContext: vi.fn(() => 7),
			MakeWebGLContext: vi.fn(() => ({
				delete: grContextDeleteMock,
			})),
			MakeRenderTarget: vi.fn(() => ({
				delete: renderTargetDeleteMock,
				flush: vi.fn(),
				width: () => 96,
				height: () => 54,
				getCanvas: () => ({
					clear: vi.fn(),
					save: vi.fn(),
					restore: vi.fn(),
					scale: vi.fn(),
					drawPicture: vi.fn(),
				}),
				makeImageSnapshot: vi.fn(),
			})),
			deleteContext: deleteContextMock,
		} as never;
		const backend = {
			bundle: "webgl",
			kind: "webgl",
		} as const;
		vi.stubGlobal(
			"OffscreenCanvas",
			class FakeOffscreenCanvas {
				width: number;
				height: number;

				constructor(width: number, height: number) {
					this.width = width;
					this.height = height;
				}

				getContext() {
					return {
						getExtension: () => ({
							loseContext: loseContextMock,
						}),
					};
				}
			} as unknown as typeof OffscreenCanvas,
		);

		const surface = createSkiaOffscreenSurface(canvasKit, 96, 54, backend);

		surface?.dispose();

		expect(canvasKit.GetWebGLContext).toHaveBeenCalledTimes(1);
		expect(canvasKit.MakeWebGLContext).toHaveBeenCalledWith(7);
		expect(canvasKit.MakeRenderTarget).toHaveBeenCalledWith(
			expect.objectContaining({
				delete: grContextDeleteMock,
			}),
			96,
			54,
		);
		expect(renderTargetDeleteMock).toHaveBeenCalledTimes(1);
		expect(grContextDeleteMock).toHaveBeenCalledTimes(1);
		expect(deleteContextMock).toHaveBeenCalledWith(7);
		expect(loseContextMock).toHaveBeenCalledTimes(1);
	});

	it("WebGL offscreen surface 优先复用当前 GrDirectContext", () => {
		const renderTargetDeleteMock = vi.fn();
		const currentGrContext = {
			isDeleted: vi.fn(() => false),
		};
		const canvasKit = {
			getCurrentGrDirectContext: vi.fn(() => currentGrContext),
			MakeRenderTarget: vi.fn(() => ({
				delete: renderTargetDeleteMock,
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
			})),
			GetWebGLContext: vi.fn(),
			MakeWebGLContext: vi.fn(),
		} as never;
		const backend = {
			bundle: "webgl",
			kind: "webgl",
		} as const;

		const surface = createSkiaOffscreenSurface(canvasKit, 64, 32, backend);

		surface?.dispose();

		expect(canvasKit.getCurrentGrDirectContext).toHaveBeenCalledTimes(1);
		expect(canvasKit.MakeRenderTarget).toHaveBeenCalledWith(
			currentGrContext,
			64,
			32,
		);
		expect(canvasKit.GetWebGLContext).not.toHaveBeenCalled();
		expect(canvasKit.MakeWebGLContext).not.toHaveBeenCalled();
		expect(renderTargetDeleteMock).toHaveBeenCalledTimes(1);
	});
});
