// @vitest-environment jsdom

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
			ColorSpace: { SRGB: "srgb", DISPLAY_P3: "display-p3" },
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
				colorSpace: "srgb",
			},
		);
		expect(makeGPUCanvasContextMock).toHaveBeenNthCalledWith(
			2,
			backend.deviceContext,
			canvas,
			{
				format: "rgba8unorm",
				alphaMode: "premultiplied",
				colorSpace: "srgb",
			},
		);
		expect(makeGPUCanvasSurfaceMock).toHaveBeenCalledTimes(3);
		expect(makeGPUCanvasSurfaceMock).toHaveBeenNthCalledWith(
			1,
			gpuCanvasContext,
			"srgb",
		);
		expect(makeGPUCanvasSurfaceMock).toHaveBeenNthCalledWith(
			2,
			gpuCanvasContext,
			"srgb",
		);
		expect(makeGPUCanvasSurfaceMock).toHaveBeenNthCalledWith(
			3,
			gpuCanvasContext,
			"srgb",
		);
	});

	it("WebGPU canvas surface 会在设备支持时配置 Display P3", () => {
		const previousMatchMedia = window.matchMedia;
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: vi.fn((query: string) => ({
				matches: query === "(color-gamut: p3)",
				media: query,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			})),
		});
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
			ColorSpace: { SRGB: "srgb", DISPLAY_P3: "display-p3" },
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

		try {
			const surface = createSkiaCanvasSurface(canvasKit, canvas, backend, {
				colorSpace: "p3",
			});
			surface?.dispose();
		} finally {
			Object.defineProperty(window, "matchMedia", {
				configurable: true,
				value: previousMatchMedia,
			});
		}

		expect(makeGPUCanvasContextMock).toHaveBeenCalledWith(
			backend.deviceContext,
			canvas,
			{
				format: "rgba8unorm",
				alphaMode: "premultiplied",
				colorSpace: "display-p3",
			},
		);
		expect(makeGPUCanvasSurfaceMock).toHaveBeenCalledWith(
			gpuCanvasContext,
			"display-p3",
		);
	});

	it("WebGL offscreen surface 缺少当前 GrDirectContext 时直接失败", () => {
		const canvasKit = {
			getCurrentGrDirectContext: vi.fn(() => null),
			MakeRenderTarget: vi.fn(),
			MakeSurface: vi.fn(),
		} as never;
		const backend = {
			bundle: "webgl",
			kind: "webgl",
		} as const;

		const surface = createSkiaOffscreenSurface(canvasKit, 96, 54, backend);
		surface?.dispose();

		expect(surface).toBeNull();
		expect(canvasKit.getCurrentGrDirectContext).toHaveBeenCalledTimes(2);
		expect(canvasKit.MakeRenderTarget).not.toHaveBeenCalled();
		expect(canvasKit.MakeSurface).not.toHaveBeenCalled();
	});

	it("WebGL canvas surface 会在设备支持时使用 Display P3", () => {
		const previousMatchMedia = window.matchMedia;
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: vi.fn((query: string) => ({
				matches: query === "(color-gamut: p3)",
				media: query,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			})),
		});
		const webglContext = {
			drawingBufferColorSpace: "srgb",
		};
		const surfaceDeleteMock = vi.fn();
		const grContext = {
			delete: vi.fn(),
		};
		const canvasKit = {
			ColorSpace: { SRGB: "srgb", DISPLAY_P3: "display-p3" },
			GetWebGLContext: vi.fn(() => 11),
			MakeWebGLContext: vi.fn(() => grContext),
			MakeOnScreenGLSurface: vi.fn(() => ({
				delete: surfaceDeleteMock,
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
		} as never;
		const canvas = {
			width: 64,
			height: 32,
			getContext: vi.fn(() => webglContext),
		} as unknown as HTMLCanvasElement;
		const backend = {
			bundle: "webgl",
			kind: "webgl",
		} as const;

		try {
			const surface = createSkiaCanvasSurface(canvasKit, canvas, backend, {
				colorSpace: "p3",
			});
			surface?.dispose();
		} finally {
			Object.defineProperty(window, "matchMedia", {
				configurable: true,
				value: previousMatchMedia,
			});
		}

		expect(webglContext.drawingBufferColorSpace).toBe("display-p3");
		expect(canvasKit.GetWebGLContext).toHaveBeenCalledWith(canvas);
		expect(canvasKit.MakeWebGLContext).toHaveBeenCalledWith(11);
		expect(canvasKit.MakeOnScreenGLSurface).toHaveBeenCalledWith(
			grContext,
			64,
			32,
			"display-p3",
		);
		expect(grContext.delete).not.toHaveBeenCalled();
		expect(surfaceDeleteMock).toHaveBeenCalledTimes(1);
	});

	it("WebGL Display P3 surface 创建失败时回退到 sRGB WebGL surface", () => {
		const previousMatchMedia = window.matchMedia;
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: vi.fn((query: string) => ({
				matches: query === "(color-gamut: p3)",
				media: query,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			})),
		});
		const webglContext = {
			drawingBufferColorSpace: "display-p3",
		};
		const surfaceDeleteMock = vi.fn();
		const grContext = {
			delete: vi.fn(),
		};
		const surface = {
			delete: surfaceDeleteMock,
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
		};
		const canvasKit = {
			ColorSpace: { SRGB: "srgb", DISPLAY_P3: "display-p3" },
			GetWebGLContext: vi.fn(() => 12),
			MakeWebGLContext: vi.fn(() => grContext),
			MakeOnScreenGLSurface: vi
				.fn()
				.mockReturnValueOnce(null)
				.mockReturnValueOnce(surface),
		} as never;
		const canvas = {
			width: 64,
			height: 32,
			getContext: vi.fn(() => webglContext),
		} as unknown as HTMLCanvasElement;
		const backend = {
			bundle: "webgl",
			kind: "webgl",
		} as const;

		try {
			const result = createSkiaCanvasSurface(canvasKit, canvas, backend, {
				colorSpace: "p3",
			});
			result?.dispose();
		} finally {
			Object.defineProperty(window, "matchMedia", {
				configurable: true,
				value: previousMatchMedia,
			});
		}

		expect(canvasKit.MakeOnScreenGLSurface).toHaveBeenNthCalledWith(
			1,
			grContext,
			64,
			32,
			"display-p3",
		);
		expect(canvasKit.MakeOnScreenGLSurface).toHaveBeenNthCalledWith(
			2,
			grContext,
			64,
			32,
			"srgb",
		);
		expect(webglContext.drawingBufferColorSpace).toBe("srgb");
		expect(grContext.delete).not.toHaveBeenCalled();
		expect(surfaceDeleteMock).toHaveBeenCalledTimes(1);
	});

	it("WebGL offscreen surface 会激活主画布 context 后复用 RenderTarget", () => {
		const screenSurfaceDeleteMock = vi.fn();
		const offscreenSurfaceDeleteMock = vi.fn();
		const screenGrContext = {
			delete: vi.fn(),
			isDeleted: vi.fn(() => false),
		};
		const canvasKit = {
			ColorSpace: { SRGB: "srgb" },
			GetWebGLContext: vi.fn(() => 9),
			MakeWebGLContext: vi.fn(() => screenGrContext),
			MakeOnScreenGLSurface: vi.fn(() => ({
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
			setCurrentContext: vi.fn(() => true),
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
			width: 64,
			height: 32,
			getContext: vi.fn(() => null),
		} as unknown as HTMLCanvasElement;

		const screenSurface = createSkiaCanvasSurface(canvasKit, canvas, backend);
		const offscreenSurface = createSkiaOffscreenSurface(canvasKit, 64, 32, backend);

		offscreenSurface?.dispose();
		screenSurface?.dispose();

		expect(canvasKit.setCurrentContext).toHaveBeenCalledWith(9);
		expect(canvasKit.MakeOnScreenGLSurface).toHaveBeenCalledWith(
			screenGrContext,
			64,
			32,
			"srgb",
		);
		expect(canvasKit.MakeRenderTarget).toHaveBeenCalledWith(
			screenGrContext,
			64,
			32,
		);
		expect(canvasKit.MakeSurface).not.toHaveBeenCalled();
		expect(screenGrContext.delete).not.toHaveBeenCalled();
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
