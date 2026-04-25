import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	canvasKit: {
		ColorType: { RGBA_8888: "rgba8888" },
		AlphaType: { Unpremul: "unpremul" },
		ColorSpace: { SRGB: "srgb", DISPLAY_P3: "display-p3" },
		MakeLazyImageFromTextureSource: vi.fn(),
		MakeImageFromCanvasImageSource: vi.fn(),
		SkImages: {
			WrapTexture: vi.fn(),
		},
	},
}));

vi.mock("../src/skia/Skia", () => ({
	CanvasKit: mocks.canvasKit,
}));

import {
	__resetSkiaRenderBackendForTests,
	setSkiaRenderBackend,
} from "../src/skia/web/renderBackend";
import { makeImageFromTextureSourceDirect } from "../src/skia/web/makeTextureSourceImage";

describe("makeTextureSourceImage", () => {
	afterEach(() => {
		__resetSkiaRenderBackendForTests();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		mocks.canvasKit.MakeLazyImageFromTextureSource.mockReset();
		mocks.canvasKit.MakeImageFromCanvasImageSource.mockReset();
		mocks.canvasKit.SkImages.WrapTexture.mockReset();
	});

	it("WebGPU 上传 P3 target 时会请求浏览器转换并用 Display P3 包装纹理", () => {
		const texture = {
			width: 64,
			height: 32,
			format: "bgra8unorm",
			usage: 1,
			destroy: vi.fn(),
		};
		const device = {
			createTexture: vi.fn(() => texture),
			queue: {
				copyExternalImageToTexture: vi.fn(),
				onSubmittedWorkDone: vi.fn(async () => undefined),
			},
		};
		const image = {
			delete: vi.fn(),
		};
		mocks.canvasKit.SkImages.WrapTexture.mockReturnValue(image);
		setSkiaRenderBackend({
			bundle: "webgpu",
			kind: "webgpu",
			device: device as unknown as GPUDevice,
			deviceContext: { id: "ctx" } as never,
		});
		vi.stubGlobal("navigator", {
			gpu: {
				getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
			},
		});

		const result = makeImageFromTextureSourceDirect(
			{ width: 64, height: 32 } as never,
			{ targetColorSpace: "display-p3" },
		);

		expect(result).toBeTruthy();
		expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledWith(
			{ source: expect.anything() },
			{ texture, colorSpace: "display-p3" },
			{ width: 64, height: 32 },
		);
		expect(mocks.canvasKit.SkImages.WrapTexture).toHaveBeenCalledWith(
			{ id: "ctx" },
			texture,
			"rgba8888",
			"unpremul",
			"display-p3",
			undefined,
			undefined,
			expect.any(Function),
		);
	});

	it("WebGPU 默认使用 sRGB target", () => {
		const texture = {
			width: 8,
			height: 4,
			format: "bgra8unorm",
			usage: 1,
			destroy: vi.fn(),
		};
		const device = {
			createTexture: vi.fn(() => texture),
			queue: {
				copyExternalImageToTexture: vi.fn(),
				onSubmittedWorkDone: vi.fn(async () => undefined),
			},
		};
		mocks.canvasKit.SkImages.WrapTexture.mockReturnValue({ delete: vi.fn() });
		setSkiaRenderBackend({
			bundle: "webgpu",
			kind: "webgpu",
			device: device as unknown as GPUDevice,
			deviceContext: { id: "ctx" } as never,
		});

		makeImageFromTextureSourceDirect({ width: 8, height: 4 } as never);

		expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledWith(
			{ source: expect.anything() },
			{ texture, colorSpace: "srgb" },
			{ width: 8, height: 4 },
		);
		expect(mocks.canvasKit.SkImages.WrapTexture).toHaveBeenCalledWith(
			{ id: "ctx" },
			texture,
			"rgba8888",
			"unpremul",
			"srgb",
			undefined,
			undefined,
			expect.any(Function),
		);
	});

	it("WebGL 忽略 P3 target 并保留 sRGB 兼容纹理路径", () => {
		const image = {
			delete: vi.fn(),
		};
		mocks.canvasKit.MakeLazyImageFromTextureSource.mockReturnValue(image);
		setSkiaRenderBackend({ bundle: "webgl", kind: "webgl" });

		const result = makeImageFromTextureSourceDirect(
			{ width: 16, height: 9 } as never,
			{ targetColorSpace: "display-p3" },
		);

		expect(result).toBeTruthy();
		expect(mocks.canvasKit.MakeLazyImageFromTextureSource).toHaveBeenCalledTimes(1);
		expect(mocks.canvasKit.SkImages.WrapTexture).not.toHaveBeenCalled();
	});
});
