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

	it("WebGPU offscreen surface 默认按 devicePixelRatio 分配并预缩放", () => {
		const scaleMock = vi.fn();
		const renderTargetMock = vi.fn(
			(_deviceContext: unknown, imageInfo: { width: number; height: number }) => ({
				delete: vi.fn(),
				flush: vi.fn(),
				width: () => imageInfo.width,
				height: () => imageInfo.height,
				getCanvas: () => ({
					clear: vi.fn(),
					save: vi.fn(),
					restore: vi.fn(),
					scale: scaleMock,
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
			device: {} as GPUDevice,
			deviceContext: { id: "ctx" },
		} as const;
		vi.stubGlobal("window", {
			devicePixelRatio: 2,
		});

		const surface = createSkiaOffscreenSurface(canvasKit, 64, 32, backend);
		surface?.dispose();

		expect(renderTargetMock).toHaveBeenCalledWith(
			backend.deviceContext,
			expect.objectContaining({
				width: 128,
				height: 64,
			}),
			false,
			undefined,
			"",
		);
		expect(scaleMock).toHaveBeenCalledWith(2, 2);
	});

	it("offscreen surface 允许显式传入 pixelRatio=1 禁用 dpr 放大", () => {
		const scaleMock = vi.fn();
		const renderTargetMock = vi.fn(
			(_deviceContext: unknown, imageInfo: { width: number; height: number }) => ({
				delete: vi.fn(),
				flush: vi.fn(),
				width: () => imageInfo.width,
				height: () => imageInfo.height,
				getCanvas: () => ({
					clear: vi.fn(),
					save: vi.fn(),
					restore: vi.fn(),
					scale: scaleMock,
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
			device: {} as GPUDevice,
			deviceContext: { id: "ctx" },
		} as const;
		vi.stubGlobal("window", {
			devicePixelRatio: 2,
		});

		const surface = createSkiaOffscreenSurface(canvasKit, 64, 32, backend, 1);
		surface?.dispose();

		expect(renderTargetMock).toHaveBeenCalledWith(
			backend.deviceContext,
			expect.objectContaining({
				width: 64,
				height: 32,
			}),
			false,
			undefined,
			"",
		);
		expect(scaleMock).not.toHaveBeenCalled();
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
		const canvas = {
			getContext: vi.fn(() => null),
		} as unknown as HTMLCanvasElement;
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

	it("WebGL offscreen surface 缺少当前 GrDirectContext 时回退到软件 surface", () => {
		const surfaceDeleteMock = vi.fn();
		const canvasKit = {
			getCurrentGrDirectContext: vi.fn(() => null),
			MakeRenderTarget: vi.fn(),
			MakeSurface: vi.fn(() => ({
				delete: surfaceDeleteMock,
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
		} as never;
		const backend = {
			bundle: "webgl",
			kind: "webgl",
		} as const;

		const surface = createSkiaOffscreenSurface(canvasKit, 96, 54, backend);
		surface?.dispose();

		expect(canvasKit.getCurrentGrDirectContext).toHaveBeenCalledTimes(2);
		expect(canvasKit.MakeRenderTarget).not.toHaveBeenCalled();
		expect(canvasKit.MakeSurface).toHaveBeenCalledWith(96, 54);
		expect(surfaceDeleteMock).toHaveBeenCalledTimes(1);
	});

	it("WebGL offscreen surface 会激活主画布 context 后复用 RenderTarget", () => {
		const screenSurfaceDeleteMock = vi.fn();
		const offscreenSurfaceDeleteMock = vi.fn();
		const currentGrContext = {
			isDeleted: vi.fn(() => false),
		};
		let hasCurrentContext = false;
		const canvasKit = {
			MakeWebGLCanvasSurface: vi.fn(() => ({
				_context: 9,
				delete: screenSurfaceDeleteMock,
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
			setCurrentContext: vi.fn((context: unknown) => {
				if (context === 9) {
					hasCurrentContext = true;
					return true;
				}
				return false;
			}),
			getCurrentGrDirectContext: vi.fn(() =>
				hasCurrentContext ? currentGrContext : null,
			),
			MakeRenderTarget: vi.fn(() => ({
				delete: offscreenSurfaceDeleteMock,
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
			MakeSurface: vi.fn(),
		} as never;
		const backend = {
			bundle: "webgl",
			kind: "webgl",
		} as const;
		const canvas = {
			getContext: vi.fn(() => null),
		} as unknown as HTMLCanvasElement;

		const screenSurface = createSkiaCanvasSurface(canvasKit, canvas, backend);
		const offscreenSurface = createSkiaOffscreenSurface(canvasKit, 64, 32, backend);

		offscreenSurface?.dispose();
		screenSurface?.dispose();

		expect(canvasKit.setCurrentContext).toHaveBeenCalledWith(9);
		expect(canvasKit.MakeRenderTarget).toHaveBeenCalledWith(
			currentGrContext,
			64,
			32,
		);
		expect(canvasKit.MakeSurface).not.toHaveBeenCalled();
		expect(offscreenSurfaceDeleteMock).toHaveBeenCalledTimes(1);
		expect(screenSurfaceDeleteMock).toHaveBeenCalledTimes(1);
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
