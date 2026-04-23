import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoSample } from "mediabunny";
import {
	closeVideoFrame,
	closeVideoSample,
	videoSampleToSkImage,
} from "./videoFrameUtils";

const mocks = vi.hoisted(() => ({
	getSkiaRenderBackend: vi.fn(),
	makeImageFromTextureSourceDirect: vi.fn(),
}));

vi.mock("react-skia-lite", () => ({
	getSkiaRenderBackend: mocks.getSkiaRenderBackend,
	makeImageFromTextureSourceDirect: mocks.makeImageFromTextureSourceDirect,
}));

describe("videoFrameUtils", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("WebGPU 下成功创建 SkImage 后会关闭 VideoFrame", () => {
		const frame = {
			close: vi.fn(),
		} as unknown as VideoFrame;
		const sample = {
			toVideoFrame: vi.fn(() => frame),
			close: vi.fn(),
		} as unknown as VideoSample;
		const image = { id: "image" };
		mocks.getSkiaRenderBackend.mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});
		mocks.makeImageFromTextureSourceDirect.mockReturnValue(image);

		expect(videoSampleToSkImage(sample)).toBe(image);
		expect(mocks.makeImageFromTextureSourceDirect).toHaveBeenCalledWith(frame);
		expect(frame.close).toHaveBeenCalledTimes(1);
		expect(sample.close).toHaveBeenCalledTimes(1);
	});

	it("WebGL 下成功创建 SkImage 后不会提前关闭 VideoFrame", () => {
		const frame = {
			close: vi.fn(),
		} as unknown as VideoFrame;
		const sample = {
			toVideoFrame: vi.fn(() => frame),
			close: vi.fn(),
		} as unknown as VideoSample;
		const image = { id: "image" };
		mocks.getSkiaRenderBackend.mockReturnValue({
			bundle: "webgl",
			kind: "webgl",
		});
		mocks.makeImageFromTextureSourceDirect.mockReturnValue(image);

		expect(videoSampleToSkImage(sample)).toBe(image);
		expect(frame.close).not.toHaveBeenCalled();
		expect(sample.close).toHaveBeenCalledTimes(1);
	});

	it("失败时仍会关闭 VideoFrame 与 sample", () => {
		const frame = {
			close: vi.fn(),
		} as unknown as VideoFrame;
		const sample = {
			toVideoFrame: vi.fn(() => frame),
			close: vi.fn(),
		} as unknown as VideoSample;
		mocks.getSkiaRenderBackend.mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});
		mocks.makeImageFromTextureSourceDirect.mockImplementation(() => {
			throw new Error("decode failed");
		});

		expect(videoSampleToSkImage(sample)).toBeNull();
		expect(frame.close).toHaveBeenCalled();
		expect(sample.close).toHaveBeenCalledTimes(1);
	});

	it("close helper 会吞掉底层 close 异常", () => {
		const frame = {
			close: vi.fn(() => {
				throw new Error("frame close failed");
			}),
		} as unknown as VideoFrame;
		const sample = {
			close: vi.fn(() => {
				throw new Error("sample close failed");
			}),
		} as unknown as VideoSample;

		expect(() => closeVideoFrame(frame)).not.toThrow();
		expect(() => closeVideoSample(sample)).not.toThrow();
	});
});
