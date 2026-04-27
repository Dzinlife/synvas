// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkImage } from "react-skia-lite";
import { acquireVideoAsset } from "./videoAsset";

const mocks = vi.hoisted(() => {
	const videoTrack = {
		codec: "vp9",
		canDecode: vi.fn(async () => true),
		canBeTransparent: vi.fn(async () => false),
	};

	class MockInput {
		computeDuration = vi.fn(async () => 10);
		getPrimaryVideoTrack = vi.fn(async () => videoTrack);
	}

	class MockVideoSampleSink {}

	class MockUrlSource {}

	class MockStreamSource {}

	return {
		videoTrack,
		Input: MockInput,
		VideoSampleSink: MockVideoSampleSink,
		UrlSource: MockUrlSource,
		StreamSource: MockStreamSource,
		resolveProjectOpfsFile: vi.fn(),
	};
});

vi.mock("mediabunny", () => ({
	ALL_FORMATS: {},
	Input: mocks.Input,
	StreamSource: mocks.StreamSource,
	UrlSource: mocks.UrlSource,
	VideoSampleSink: mocks.VideoSampleSink,
}));

vi.mock("@/lib/projectOpfsStorage", () => ({
	resolveProjectOpfsFile: mocks.resolveProjectOpfsFile,
}));

type MockSkImage = SkImage & {
	id: string;
	ref: object | null;
	dispose: ReturnType<typeof vi.fn>;
};

const createMockImage = (
	width: number,
	height: number,
	id: string,
): MockSkImage => {
	const image = {
		id,
		ref: {},
		width: () => width,
		height: () => height,
		dispose: vi.fn(() => {
			image.ref = null as never;
		}),
	} as unknown as MockSkImage;
	return image;
};

describe("videoAsset", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete (window as Window & { synvasElectron?: unknown }).synvasElectron;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		delete (window as Window & { synvasElectron?: unknown }).synvasElectron;
	});

	it("超过字节预算时会回收最旧的视频帧", async () => {
		const handle = await acquireVideoAsset(
			"https://example.com/video-cache.mp4",
		);
		const { asset } = handle;
		const side = Math.ceil(Math.sqrt(asset.maxCacheBytes / 2 / 4)) + 1;
		const frameA = createMockImage(side, side, "frame-a");
		const frameB = createMockImage(side, side, "frame-b");

		asset.storeFrame(0, frameA);
		asset.storeFrame(1, frameB);

		expect(asset.getCachedFrame(0)).toBeUndefined();
		expect(asset.getCachedFrame(1)).toBe(frameB);
		expect(frameA.dispose).toHaveBeenCalledTimes(1);
		expect(frameB.dispose).not.toHaveBeenCalled();

		handle.release();
		expect(frameB.dispose).toHaveBeenCalledTimes(1);
	});

	it("清理非 pinned 缓存时保留正在使用的视频帧", async () => {
		const handle = await acquireVideoAsset(
			"https://example.com/video-pinned.mp4",
		);
		const { asset } = handle;
		const pinnedFrame = createMockImage(320, 180, "frame-pinned");
		const idleFrame = createMockImage(320, 180, "frame-idle");

		asset.storeFrame(0, pinnedFrame);
		asset.storeFrame(1, idleFrame);
		asset.pinFrame(pinnedFrame);
		asset.clearCache({ includePinned: false });

		expect(asset.getCachedFrame(0)).toBe(pinnedFrame);
		expect(asset.getCachedFrame(1)).toBeUndefined();
		expect(pinnedFrame.dispose).not.toHaveBeenCalled();
		expect(idleFrame.dispose).toHaveBeenCalledTimes(1);

		asset.unpinFrame(pinnedFrame);
		handle.release();
		expect(pinnedFrame.dispose).toHaveBeenCalledTimes(1);
	});

	it("命中已释放帧时会从缓存剔除并返回空", async () => {
		const handle = await acquireVideoAsset(
			"https://example.com/video-stale.mp4",
		);
		const { asset } = handle;
		const frame = createMockImage(320, 180, "frame-stale");

		asset.storeFrame(0, frame);
		frame.dispose();

		expect(asset.getCachedFrame(0)).toBeUndefined();
		expect(asset.frameCache.has(0)).toBe(false);

		handle.release();
	});
});
