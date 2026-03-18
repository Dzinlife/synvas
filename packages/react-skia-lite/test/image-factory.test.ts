import { afterEach, describe, expect, it, vi } from "vitest";

import { JsiSkData } from "../src/skia/web/JsiSkData";
import { JsiSkImageFactory } from "../src/skia/web/JsiSkImageFactory";
import { JsiVideo } from "../src/skia/web/JsiVideo";
import {
	__resetSkiaRenderBackendForTests,
	setSkiaRenderBackend,
} from "../src/skia/web/renderBackend";

const mocks = vi.hoisted(() => ({
	makeImageFromTextureSourceDirect: vi.fn(),
}));

vi.mock("../src/skia/web/makeTextureSourceImage", () => ({
	makeImageFromTextureSourceDirect: mocks.makeImageFromTextureSourceDirect,
}));

class FakeHTMLCanvasElement {
	width = 0;
	height = 0;
	getContext() {
		return null;
	}
}

class FakeHTMLImageElement {
	width = 0;
	height = 0;
	naturalWidth = 0;
	naturalHeight = 0;
}

class FakeHTMLVideoElement {
	width = 0;
	height = 0;
	videoWidth = 0;
	videoHeight = 0;
}

const installDOMStubs = () => {
	vi.stubGlobal("HTMLCanvasElement", FakeHTMLCanvasElement);
	vi.stubGlobal("HTMLImageElement", FakeHTMLImageElement);
	vi.stubGlobal("HTMLVideoElement", FakeHTMLVideoElement);
	vi.stubGlobal("document", {
		createElement(tagName: string) {
			if (tagName === "canvas") {
				return new FakeHTMLCanvasElement();
			}
			if (tagName === "img") {
				return new FakeHTMLImageElement();
			}
			if (tagName === "video") {
				return new FakeHTMLVideoElement();
			}
			throw new Error(`Unsupported element: ${tagName}`);
		},
		body: {
			appendChild: vi.fn(),
			removeChild: vi.fn(),
		},
	});
};

const createCanvasKitStub = () => {
	const makeImageMock = vi.fn(() => ({
		delete: vi.fn(),
		height: vi.fn(() => 24),
		width: vi.fn(() => 48),
		getImageInfo: vi.fn(() => ({
			width: 48,
			height: 24,
			colorType: { value: 4 },
			alphaType: { value: 3 },
		})),
		getColorSpace: vi.fn(() => ({})),
		readPixels: vi.fn(() => new Uint8Array(48 * 24 * 4)),
	}));
	const encodedImage = {
		delete: vi.fn(),
		height: vi.fn(() => 24),
		width: vi.fn(() => 48),
		getImageInfo: vi.fn(() => ({
			width: 48,
			height: 24,
			colorType: { value: 4 },
			alphaType: 3,
		})),
		readPixels: vi.fn(() => new Uint8Array(48 * 24 * 4)),
	};
	return {
		AlphaType: { Unpremul: 3 },
		ColorType: { RGBA_8888: 4 },
		ColorSpace: { SRGB: {} },
		MakeImage: makeImageMock,
		MakeImageFromEncoded: vi.fn(() => encodedImage),
		MakeLazyImageFromTextureSource: vi.fn(),
		MakeImageFromCanvasImageSource: vi.fn(),
	};
};

describe("imageFactory", () => {
	afterEach(() => {
		__resetSkiaRenderBackendForTests();
		mocks.makeImageFromTextureSourceDirect.mockReset();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("WebGPU 下 HTMLImageElement 会保留原生图像路径", () => {
		installDOMStubs();
		setSkiaRenderBackend({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});
		const canvasKit = createCanvasKitStub();
		const factory = new JsiSkImageFactory(canvasKit as never);
		mocks.makeImageFromTextureSourceDirect.mockReturnValue({
			ref: canvasKit.MakeImage(),
		});
		const imageElement = document.createElement(
			"img",
		) as unknown as FakeHTMLImageElement;
		imageElement.width = 48;
		imageElement.height = 24;
		imageElement.naturalWidth = 48;
		imageElement.naturalHeight = 24;

		const image = factory.MakeImageFromNativeBuffer(imageElement);

		expect(image).toBeTruthy();
		expect(mocks.makeImageFromTextureSourceDirect).toHaveBeenCalledTimes(1);
		expect(canvasKit.MakeLazyImageFromTextureSource).not.toHaveBeenCalled();
		expect(canvasKit.MakeImageFromCanvasImageSource).not.toHaveBeenCalled();
	});

	it("WebGPU 下视频不会退回 WebGL 共享纹理路径", () => {
		installDOMStubs();
		setSkiaRenderBackend({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});
		const canvasKit = createCanvasKitStub();
		const factory = new JsiSkImageFactory(canvasKit as never);
		mocks.makeImageFromTextureSourceDirect.mockReturnValue({
			ref: canvasKit.MakeImage(),
		});
		const videoElement = document.createElement(
			"video",
		) as unknown as FakeHTMLVideoElement;
		videoElement.videoWidth = 64;
		videoElement.videoHeight = 36;
		const video = new JsiVideo(factory, videoElement);

		video.setSurface({} as never);
		const image = video.nextImage();

		expect(image).toBeTruthy();
		expect(mocks.makeImageFromTextureSourceDirect).toHaveBeenCalledTimes(1);
		expect(canvasKit.MakeLazyImageFromTextureSource).not.toHaveBeenCalled();
		video.dispose();
	});

	it("WebGL 下仍保留懒纹理图像路径", () => {
		installDOMStubs();
		setSkiaRenderBackend({
			bundle: "webgl",
			kind: "webgl",
		});
		const canvasKit = createCanvasKitStub();
		const factory = new JsiSkImageFactory(canvasKit as never);
		const imageElement = document.createElement(
			"img",
		) as unknown as FakeHTMLImageElement;
		imageElement.width = 32;
		imageElement.height = 16;

		const image = factory.MakeImageFromNativeBuffer(imageElement);

		expect(image).toBeTruthy();
		expect(canvasKit.MakeLazyImageFromTextureSource).toHaveBeenCalledTimes(1);
		expect(canvasKit.MakeImage).not.toHaveBeenCalled();
	});

	it("WebGPU 下 encoded image 保留解码结果", () => {
		setSkiaRenderBackend({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});
		const canvasKit = createCanvasKitStub();
		const factory = new JsiSkImageFactory(canvasKit as never);
		const data = new JsiSkData(
			canvasKit as never,
			new Uint8Array([1, 2, 3, 4]).buffer,
		);

		const image = factory.MakeImageFromEncoded(data);

		expect(image).toBeTruthy();
		expect(canvasKit.MakeImageFromEncoded).toHaveBeenCalledTimes(1);
		expect(canvasKit.MakeImage).not.toHaveBeenCalled();
	});

	it("WebGPU 下带 surface 但缺少共享纹理 helper 时回退常规创建路径", () => {
		installDOMStubs();
		setSkiaRenderBackend({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});
		const canvasKit = {
			...createCanvasKitStub(),
		} as never;
		const factory = new JsiSkImageFactory(canvasKit);
		mocks.makeImageFromTextureSourceDirect.mockReturnValue({
			ref: canvasKit.MakeImage(),
		});
		const imageElement = document.createElement(
			"img",
		) as unknown as FakeHTMLImageElement;
		imageElement.width = 32;
		imageElement.height = 16;
		const surface = {
			ref: {},
		} as never;

		const image = factory.MakeImageFromNativeBuffer(imageElement, surface);

		expect(image).toBeTruthy();
		expect(mocks.makeImageFromTextureSourceDirect).toHaveBeenCalledTimes(1);
		expect(canvasKit.MakeLazyImageFromTextureSource).not.toHaveBeenCalled();
	});
});
