// @vitest-environment jsdom

import type { TimelineElement } from "core/timeline-system/types";
import type { SkImage } from "react-skia-lite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEditorRuntime } from "@/scene-editor/runtime/testUtils";
import { createVideoClipModel, type VideoClipProps } from "./model";

const mocks = vi.hoisted(() => ({
	acquireVideoAsset: vi.fn(),
	acquireAudioAsset: vi.fn(),
	videoSampleToSkImage: vi.fn(),
	closeVideoSample: vi.fn(),
}));

vi.mock("@/assets/videoAsset", () => ({
	acquireVideoAsset: mocks.acquireVideoAsset,
}));

vi.mock("@/assets/audioAsset", () => ({
	acquireAudioAsset: mocks.acquireAudioAsset,
}));

vi.mock("@/lib/videoFrameUtils", () => ({
	closeVideoSample: mocks.closeVideoSample,
	videoSampleToSkImage: mocks.videoSampleToSkImage,
}));

type MockSkImage = SkImage & {
	id: string;
	ref: object | null;
	dispose: ReturnType<typeof vi.fn>;
};

type MockVideoSample = {
	timestamp: number;
	close: ReturnType<typeof vi.fn>;
};

const createMockImage = (id: string): MockSkImage => {
	const image = {
		id,
		ref: {},
		width: () => 320,
		height: () => 180,
		dispose: vi.fn(() => {
			image.ref = null as never;
		}),
	} as unknown as MockSkImage;
	return image;
};

const createSampleIterator = (
	sample: MockVideoSample,
): AsyncGenerator<MockVideoSample, void, unknown> =>
	(async function* () {
		yield sample;
	})();

const createVideoElement = (): TimelineElement<VideoClipProps> => ({
	id: "clip-1",
	type: "VideoClip",
	component: "video-clip",
	name: "Video Clip",
	assetId: "asset-video-1",
	timeline: {
		start: 0,
		end: 30,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:01:00",
		trackIndex: 0,
	},
	props: {
		uri: "file:///clip.mp4",
		start: 0,
		end: 30,
	},
});

const createVideoHandle = () => {
	const frameCache = new Map<number, SkImage>();
	const samples = vi.fn((time: number) =>
		createSampleIterator({
			timestamp: time,
			close: vi.fn(),
		}),
	);
	const asset = {
		uri: "file:///clip.mp4",
		input: {},
		videoSampleSink: { samples },
		duration: 5,
		videoRotation: 0,
		createVideoSampleSink: vi.fn(() => ({ samples })),
		frameCache,
		cacheAccessOrder: [],
		maxCacheBytes: 1024 * 1024,
		getCachedFrame: vi.fn((time: number) => frameCache.get(time)),
		storeFrame: vi.fn((time: number, frame: SkImage) => {
			frameCache.set(time, frame);
		}),
		clearCache: vi.fn(),
		pinFrame: vi.fn(),
		unpinFrame: vi.fn(),
	};
	return {
		asset,
		release: vi.fn(),
	};
};

describe("VideoClip model", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.acquireAudioAsset.mockRejectedValue(new Error("no audio"));
	});

	it("prepareFrame 遇到已释放的同帧 offscreenFrame 时会重新 seek", async () => {
		const runtime = createTestEditorRuntime("video-clip-stale-frame");
		const element = createVideoElement();
		runtime.timelineStore.setState({
			fps: 30,
			elements: [element],
		});
		const videoHandle = createVideoHandle();
		const firstFrame = createMockImage("frame-a");
		const secondFrame = createMockImage("frame-b");
		mocks.acquireVideoAsset.mockResolvedValue(videoHandle);
		mocks.videoSampleToSkImage
			.mockReturnValueOnce(firstFrame)
			.mockReturnValueOnce(secondFrame);

		const store = createVideoClipModel("clip-1", element.props, runtime);
		await store.getState().init();
		await store.getState().prepareFrame?.({
			element,
			displayTime: 0,
			fps: 30,
			phase: "beforeRender",
			frameChannel: "offscreen",
		});
		expect(store.getState().internal.offscreenFrame).toBe(firstFrame);

		firstFrame.dispose();
		await store.getState().prepareFrame?.({
			element,
			displayTime: 0,
			fps: 30,
			phase: "beforeRender",
			frameChannel: "offscreen",
		});

		expect(store.getState().internal.offscreenFrame).toBe(secondFrame);
		expect(videoHandle.asset.unpinFrame).toHaveBeenCalledWith(firstFrame);
		expect(videoHandle.asset.pinFrame).toHaveBeenCalledWith(secondFrame);

		store.getState().dispose();
	});
});
