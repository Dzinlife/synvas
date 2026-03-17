// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

		constructor(_options: unknown) {}
	}

	class MockCanvasSink {
		constructor(
			_publicTrack: unknown,
			_publicOptions: unknown,
		) {}
	}

	class MockUrlSource {
		constructor(_url: string) {}
	}

	class MockStreamSource {
		constructor(_options: unknown) {}
	}

	return {
		videoTrack,
		Input: MockInput,
		CanvasSink: MockCanvasSink,
		UrlSource: MockUrlSource,
		StreamSource: MockStreamSource,
		resolveProjectOpfsFile: vi.fn(),
	};
});

vi.mock("mediabunny", () => ({
	ALL_FORMATS: {},
	CanvasSink: mocks.CanvasSink,
	Input: mocks.Input,
	StreamSource: mocks.StreamSource,
	UrlSource: mocks.UrlSource,
}));

vi.mock("@/lib/projectOpfsStorage", () => ({
	resolveProjectOpfsFile: mocks.resolveProjectOpfsFile,
}));

const createMockImage = (width: number, height: number, id: string) => ({
	id,
	width: () => width,
	height: () => height,
	dispose: vi.fn(),
});

describe("videoAsset", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete (window as Window & { aiNleElectron?: unknown }).aiNleElectron;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		delete (window as Window & { aiNleElectron?: unknown }).aiNleElectron;
	});

	it("超过字节预算时会回收最旧的视频帧", async () => {
		const handle = await acquireVideoAsset("https://example.com/video-cache.mp4");
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
});
