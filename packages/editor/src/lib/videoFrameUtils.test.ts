import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoSample } from "mediabunny";
import {
	closeVideoFrame,
	closeVideoSample,
	normalizeVideoFrameColorSpace,
	probeVideoRawFrameAccess,
	videoSampleToColorManagedSkImage,
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
		expect(mocks.makeImageFromTextureSourceDirect).toHaveBeenCalledWith(frame, {
			colorConversion: "browser",
		});
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

	it("color-managed 版本会返回归一化视频色彩空间", () => {
		const frame = {
			colorSpace: {
				toJSON: () => ({
					primaries: "bt2020",
					transfer: "pq",
					matrix: "bt2020-ncl",
					fullRange: false,
				}),
			},
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

		expect(
			videoSampleToColorManagedSkImage(sample, {
				targetColorSpace: "display-p3",
			}),
		).toEqual({
			image,
			sourceColorSpace: {
				primaries: "bt2020",
				transfer: "pq",
				matrix: "bt2020-ncl",
				range: "limited",
				label: "Rec.2100 PQ",
			},
		});
		expect(mocks.makeImageFromTextureSourceDirect).toHaveBeenCalledWith(frame, {
			colorConversion: "browser",
			targetColorSpace: "display-p3",
		});
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

	it("会归一化常见 VideoFrame.colorSpace 元数据", () => {
		expect(
			normalizeVideoFrameColorSpace({
				colorSpace: {
					primaries: "smpte432",
					transfer: "iec61966-2-1",
					matrix: "rgb",
					fullRange: true,
				} as never,
			}),
		).toEqual({
			primaries: "display-p3",
			transfer: "srgb",
			matrix: "rgb",
			range: "full",
			label: "Display P3 SDR",
		});
		expect(
			normalizeVideoFrameColorSpace({
				colorSpace: {
					primaries: null,
					transfer: null,
					matrix: null,
					fullRange: null,
				} as never,
			}),
		).toEqual({
			primaries: "unknown",
			transfer: "unknown",
			matrix: "unknown",
			range: "unknown",
		});
	});

	it("会用 clone 探测 VideoSample 与 VideoFrame raw copy 能力", async () => {
		const sampleAllocationSize = vi.fn((options?: VideoFrameCopyToOptions) =>
			options?.format === "NV12" ? 10 : 12,
		);
		const sampleCopyTo = vi.fn(async () => [{ offset: 0, stride: 4 }]);
		const frameAllocationSize = vi.fn((options?: VideoFrameCopyToOptions) => {
			if (options?.format === "NV12") {
				throw new DOMException("unsupported", "NotSupportedError");
			}
			return 12;
		});
		const frameCopyTo = vi.fn(async () => [{ offset: 0, stride: 4 }]);
		const frame = {
			format: null,
			codedWidth: 2,
			codedHeight: 2,
			displayWidth: 2,
			displayHeight: 2,
			visibleRect: { x: 0, y: 0, width: 2, height: 2 },
			colorSpace: {
				toJSON: () => ({
					primaries: "bt2020",
					transfer: "hlg",
					matrix: "bt2020-ncl",
					fullRange: false,
				}),
			},
			allocationSize: frameAllocationSize,
			copyTo: frameCopyTo,
			close: vi.fn(),
		} as unknown as VideoFrame;
		const clonedSample = {
			toVideoFrame: vi.fn(() => frame),
			allocationSize: sampleAllocationSize,
			copyTo: sampleCopyTo,
			close: vi.fn(),
		};
		const sample = {
			clone: vi.fn(() => clonedSample),
			format: null,
			timestamp: 1,
			duration: 1 / 30,
			codedWidth: 2,
			codedHeight: 2,
			displayWidth: 2,
			displayHeight: 2,
			rotation: 0,
			visibleRect: { left: 0, top: 0, width: 2, height: 2 },
			colorSpace: {
				toJSON: () => ({
					primaries: "bt2020",
					transfer: "hlg",
					matrix: "bt2020-ncl",
					fullRange: false,
				}),
			},
		} as unknown as VideoSample;
		const consoleInfoSpy = vi
			.spyOn(console, "info")
			.mockImplementation(() => {});

		try {
			const result = await probeVideoRawFrameAccess(sample, {
				key: "asset-hlg",
				label: "unit",
				force: true,
			});

			expect(sample.clone).toHaveBeenCalledTimes(1);
			expect(clonedSample.toVideoFrame).toHaveBeenCalledTimes(1);
			expect(sampleAllocationSize).toHaveBeenCalledWith(undefined);
			expect(sampleAllocationSize).toHaveBeenCalledWith({ format: "I420" });
			expect(sampleAllocationSize).toHaveBeenCalledWith({ format: "NV12" });
			expect(frameAllocationSize).toHaveBeenCalledWith({ format: "NV12" });
			expect(sampleCopyTo).toHaveBeenCalledTimes(3);
			expect(frameCopyTo).toHaveBeenCalledTimes(2);
			expect(frame.close).toHaveBeenCalledTimes(1);
			expect(clonedSample.close).toHaveBeenCalledTimes(1);
			expect(result?.frame?.normalizedColorSpace).toEqual({
				primaries: "bt2020",
				transfer: "hlg",
				matrix: "bt2020-ncl",
				range: "limited",
				label: "Rec.2100 HLG",
			});
			expect(result?.access.videoFrame.at(-1)).toMatchObject({
				format: "NV12",
				allocationError: "NotSupportedError: unsupported",
			});
			expect(consoleInfoSpy).toHaveBeenCalledWith(
				"[VideoRawProbe] raw frame access",
				expect.objectContaining({ key: "asset-hlg" }),
			);
		} finally {
			consoleInfoSpy.mockRestore();
		}
	});
});
