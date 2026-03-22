// @vitest-environment jsdom

import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetAudioOwnerForTests,
	getOwner,
	requestOwner,
} from "@/audio/owner";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";

const mocks = vi.hoisted(() => {
	const createFrameController = () => {
		const getOrBuildCurrent = vi.fn(
			async (
				frameIndex: number,
				factory: (index: number) => Promise<unknown>,
			) => {
				const state = await factory(frameIndex);
				return {
					key: frameIndex,
					epoch: 0,
					status: "ready" as const,
					disposeTransferred: false,
					promise: Promise.resolve(state),
					state,
				};
			},
		);
		return {
			reconcileFrame: vi.fn(),
			getOrBuildCurrent,
			takeDispose: vi.fn(),
			commitFrame: vi.fn(),
			invalidateAll: vi.fn(),
			disposeAll: vi.fn(),
			cacheSize: 0,
		};
	};

	return {
		acquireVideoAsset: vi.fn(),
		acquireAudioAsset: vi.fn(),
		createAudioPlaybackController: vi.fn(),
		stepVideoPlaybackSession: vi.fn(),
		retainVideoPlaybackSession: vi.fn(),
		releaseVideoPlaybackSession: vi.fn(),
		stopVideoPlaybackSession: vi.fn(),
		getAudioContext: vi.fn(),
		createFramePrecompileController: vi.fn(),
		createFrameController,
		videoSampleToSkImage: vi.fn(),
		closeVideoSample: vi.fn(),
	};
});

vi.mock("@/assets/videoAsset", () => ({
	acquireVideoAsset: mocks.acquireVideoAsset,
}));

vi.mock("@/assets/audioAsset", () => ({
	acquireAudioAsset: mocks.acquireAudioAsset,
}));

vi.mock("@/audio/playback", () => ({
	createAudioPlaybackController: mocks.createAudioPlaybackController,
}));

vi.mock("@/element/VideoClip/videoPlaybackSessionPool", () => ({
	stepVideoPlaybackSession: mocks.stepVideoPlaybackSession,
	retainVideoPlaybackSession: mocks.retainVideoPlaybackSession,
	releaseVideoPlaybackSession: mocks.releaseVideoPlaybackSession,
	stopVideoPlaybackSession: mocks.stopVideoPlaybackSession,
}));

vi.mock("@/audio/engine", () => ({
	getAudioContext: mocks.getAudioContext,
}));

vi.mock("core/editor/preview/framePrecompileController", () => ({
	createFramePrecompileController: mocks.createFramePrecompileController,
}));

vi.mock("@/lib/videoFrameUtils", () => ({
	videoSampleToSkImage: mocks.videoSampleToSkImage,
	closeVideoSample: mocks.closeVideoSample,
}));

import {
	__resetVideoNodePlaybackControllersForTests,
	getVideoNodePlaybackController,
	releaseVideoNodePlaybackController,
	retainVideoNodePlaybackController,
} from "./playbackController";

const createSampleIterator = (
	frames: Array<{ timestamp: number; close?: () => void }>,
) => {
	let index = 0;
	return {
		next: vi.fn(async () => {
			if (index >= frames.length) {
				return { value: undefined, done: true };
			}
			const value = frames[index];
			index += 1;
			return { value, done: false };
		}),
		return: vi.fn(async () => ({ value: undefined, done: true })),
		[Symbol.asyncIterator]() {
			return this;
		},
	} as unknown as AsyncGenerator<
		{ timestamp: number; close?: () => void },
		void,
		unknown
	>;
};

const createVideoHandle = (duration = 10) => {
	const frameCache = new Map<number, unknown>();
	const samplesMock = vi.fn((_startTimestamp = 0, _endTimestamp = Infinity) =>
		createSampleIterator([]),
	);
	const asset = {
		duration,
		videoSampleSink: {
			samples: samplesMock,
		} as never,
		getCachedFrame: vi.fn((time: number) => frameCache.get(time)),
		storeFrame: vi.fn((time: number, frame: unknown) => {
			frameCache.set(time, frame);
		}),
		pinFrame: vi.fn(),
		unpinFrame: vi.fn(),
	};
	return {
		handle: {
			asset,
			release: vi.fn(),
		},
		frameCache,
		samplesMock,
	};
};

const createAudioHandle = () => {
	return {
		asset: {
			duration: 10,
			createAudioSink: vi.fn(() => null),
		},
		release: vi.fn(),
	};
};

const createRuntimeManager = (pauseSpy: ReturnType<typeof vi.fn>) => {
	return {
		getTimelineRuntime: vi.fn(() => ({
			timelineStore: {
				getState: () => ({
					pause: pauseSpy,
				}),
			},
		})),
	} as unknown as StudioRuntimeManager;
};

const createRetainableFrame = (id: string) => {
	const retained = {
		id: `${id}:retained`,
		dispose: vi.fn(),
	};
	const frame = {
		id,
		dispose: vi.fn(),
		makeNonTextureImage: vi.fn(() => retained),
	};
	return {
		frame,
		retained,
	};
};

describe("video playbackController", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		__resetAudioOwnerForTests();
		__resetVideoNodePlaybackControllersForTests();
		mocks.getAudioContext.mockReturnValue(null);
		mocks.stepVideoPlaybackSession.mockResolvedValue(null);
		mocks.createAudioPlaybackController.mockReturnValue({
			stepPlayback: vi.fn(async () => {}),
			setGain: vi.fn(),
			stopPlayback: vi.fn(),
			dispose: vi.fn(),
		});
		mocks.videoSampleToSkImage.mockReturnValue({
			dispose: vi.fn(),
		});
		mocks.createFramePrecompileController.mockImplementation(() => {
			return mocks.createFrameController();
		});
	});

	afterEach(() => {
		__resetAudioOwnerForTests();
		__resetVideoNodePlaybackControllersForTests();
	});

	it("会在 owner 抢占时暂停并保持进度", async () => {
		const frameController = mocks.createFrameController();
		mocks.createFramePrecompileController.mockReturnValue(frameController);
		const video = createVideoHandle(10);
		const audio = createAudioHandle();
		mocks.acquireVideoAsset.mockResolvedValue(video.handle);
		mocks.acquireAudioAsset.mockResolvedValue(audio);
		const pauseSceneSpy = vi.fn();
		const runtimeManager = createRuntimeManager(pauseSceneSpy);
		const requestAnimationFrameSpy = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation(() => 1);
		const cancelAnimationFrameSpy = vi
			.spyOn(window, "cancelAnimationFrame")
			.mockImplementation(() => {});

		const controller = retainVideoNodePlaybackController("node-owner");
		controller.bind({
			assetUri: "file:///owner.mp4",
			fps: 30,
			runtimeManager,
		});

		await waitFor(() => {
			expect(controller.getSnapshot().isReady).toBe(true);
		});

		requestOwner("scene:scene-1");
		await controller.play();

		expect(pauseSceneSpy).toHaveBeenCalledTimes(1);
		expect(getOwner()).toBe("canvas-node:video:node-owner");
		expect(controller.getSnapshot().isPlaying).toBe(true);

		requestOwner("scene:scene-2");
		await waitFor(() => {
			expect(controller.getSnapshot().isPlaying).toBe(false);
		});
		expect(controller.getSnapshot().currentTime).toBeGreaterThanOrEqual(0);

		releaseVideoNodePlaybackController("node-owner");
		requestAnimationFrameSpy.mockRestore();
		cancelAnimationFrameSpy.mockRestore();
	});

	it("getVideoNodePlaybackController 仅在 controller 已存在时返回实例", () => {
		expect(getVideoNodePlaybackController("node-readonly")).toBeNull();
		const retained = retainVideoNodePlaybackController("node-readonly");
		expect(getVideoNodePlaybackController("node-readonly")).toBe(retained);
		releaseVideoNodePlaybackController("node-readonly");
		expect(getVideoNodePlaybackController("node-readonly")).toBeNull();
	});

	it("inactive bind 不会触发素材加载", async () => {
		const controller = retainVideoNodePlaybackController("node-inactive-bind");
		controller.bind({
			assetUri: "file:///inactive-bind.mp4",
			fps: 30,
			runtimeManager: null,
			active: false,
		});

		await Promise.resolve();
		expect(mocks.acquireVideoAsset).not.toHaveBeenCalled();
		expect(controller.getSnapshot().isReady).toBe(false);
		expect(controller.getSnapshot().currentFrame).toBeNull();

		releaseVideoNodePlaybackController("node-inactive-bind");
	});

	it("deactive 会 full unload 并保留当前播放头冻结帧", async () => {
		const video = createVideoHandle(10);
		const audio = createAudioHandle();
		const { frame, retained } = createRetainableFrame("frame-2");
		video.frameCache.set(2, frame);
		mocks.acquireVideoAsset.mockResolvedValue(video.handle);
		mocks.acquireAudioAsset.mockResolvedValue(audio);

		const controller = retainVideoNodePlaybackController("node-deactive-unload");
		controller.bind({
			assetUri: "file:///deactive-unload.mp4",
			fps: 30,
			runtimeManager: null,
		});
		await waitFor(() => {
			expect(controller.getSnapshot().isReady).toBe(true);
		});

		await controller.seekToTime(2);
		expect(controller.getSnapshot().currentFrame).toBe(frame);
		expect(controller.getSnapshot().currentTime).toBe(2);

		controller.bind({
			assetUri: "file:///deactive-unload.mp4",
			fps: 30,
			runtimeManager: null,
			active: false,
		});

		expect(video.handle.release).toHaveBeenCalledTimes(1);
		expect(controller.getSnapshot().isReady).toBe(false);
		expect(controller.getSnapshot().currentTime).toBe(2);
		expect(controller.getSnapshot().currentFrame).toBe(retained);

		releaseVideoNodePlaybackController("node-deactive-unload");
	});

	it("reactive 后会按缓存播放头时间恢复加载与 seek", async () => {
		const videoA = createVideoHandle(10);
		const videoB = createVideoHandle(10);
		const audioA = createAudioHandle();
		const audioB = createAudioHandle();
		const frameA = createRetainableFrame("frame-a");
		const frameB = { id: "frame-b", dispose: vi.fn() } as never;
		videoA.frameCache.set(2, frameA.frame);
		videoB.frameCache.set(2, frameB);
		mocks.acquireVideoAsset
			.mockResolvedValueOnce(videoA.handle)
			.mockResolvedValueOnce(videoB.handle);
		mocks.acquireAudioAsset
			.mockResolvedValueOnce(audioA)
			.mockResolvedValueOnce(audioB);

		const controller = retainVideoNodePlaybackController("node-reactive-resume");
		controller.bind({
			assetUri: "file:///reactive-resume.mp4",
			fps: 30,
			runtimeManager: null,
		});
		await waitFor(() => {
			expect(controller.getSnapshot().isReady).toBe(true);
		});
		await controller.seekToTime(2);
		expect(controller.getSnapshot().currentFrame).toBe(frameA.frame);

		controller.bind({
			assetUri: "file:///reactive-resume.mp4",
			fps: 30,
			runtimeManager: null,
			active: false,
		});
		expect(controller.getSnapshot().currentTime).toBe(2);

		controller.bind({
			assetUri: "file:///reactive-resume.mp4",
			fps: 30,
			runtimeManager: null,
			active: true,
		});

		await waitFor(() => {
			expect(controller.getSnapshot().isReady).toBe(true);
			expect(controller.getSnapshot().currentTime).toBe(2);
			expect(controller.getSnapshot().currentFrame).toBe(frameB);
		});
		expect(mocks.acquireVideoAsset).toHaveBeenCalledTimes(2);

		releaseVideoNodePlaybackController("node-reactive-resume");
		await waitFor(() => {
			expect(frameA.retained.dispose).toHaveBeenCalledTimes(1);
		});
	});

	it("seek 会合并最新请求并做时间钳制", async () => {
		const video = createVideoHandle(10);
		const audio = createAudioHandle();
		mocks.acquireVideoAsset.mockResolvedValue(video.handle);
		mocks.acquireAudioAsset.mockResolvedValue(audio);
		const steppedTimes: number[] = [];
		mocks.stepVideoPlaybackSession.mockImplementation(
			async ({ targetTime }: { targetTime: number }) => {
				steppedTimes.push(targetTime);
				await Promise.resolve();
				return null;
			},
		);

		const controller = retainVideoNodePlaybackController("node-seek");
		controller.bind({
			assetUri: "file:///seek.mp4",
			fps: 30,
			runtimeManager: null,
		});

		await waitFor(() => {
			expect(controller.getSnapshot().isReady).toBe(true);
		});

		steppedTimes.length = 0;
		mocks.stepVideoPlaybackSession.mockClear();

		const seek1 = controller.seekToTime(1);
		const seek2 = controller.seekToTime(4);
		const seek3 = controller.seekToTime(20);
		await Promise.all([seek1, seek2, seek3]);

		expect(controller.getSnapshot().currentTime).toBe(10);
		expect(steppedTimes).toContain(10);
		expect(steppedTimes.length).toBe(2);

		releaseVideoNodePlaybackController("node-seek");
	});

	it("播放步进返回空帧时会保留上一帧避免闪烁", async () => {
		const video = createVideoHandle(10);
		const audio = createAudioHandle();
		const firstFrame = {} as never;
		video.frameCache.set(0, firstFrame);
		mocks.acquireVideoAsset.mockResolvedValue(video.handle);
		mocks.acquireAudioAsset.mockResolvedValue(audio);
		mocks.stepVideoPlaybackSession.mockResolvedValue(null);

		const controller = retainVideoNodePlaybackController("node-hold-frame");
		controller.bind({
			assetUri: "file:///hold-frame.mp4",
			fps: 30,
			runtimeManager: null,
		});

		await waitFor(() => {
			expect(controller.getSnapshot().isReady).toBe(true);
		});

		await controller.seekToTime(0);
		expect(controller.getSnapshot().currentFrame).toBe(firstFrame);
		video.handle.asset.unpinFrame.mockClear();

		await controller.seekToTime(1 / 30, { fromPlayback: true });
		expect(controller.getSnapshot().currentTime).toBeCloseTo(1 / 30, 6);
		expect(controller.getSnapshot().currentFrame).toBe(firstFrame);
		expect(video.handle.asset.unpinFrame).not.toHaveBeenCalled();

		releaseVideoNodePlaybackController("node-hold-frame");
	});

	it("拖拽 seek 返回空帧时会保留上一帧避免清屏", async () => {
		const video = createVideoHandle(10);
		const audio = createAudioHandle();
		const firstFrame = {} as never;
		video.frameCache.set(0, firstFrame);
		mocks.acquireVideoAsset.mockResolvedValue(video.handle);
		mocks.acquireAudioAsset.mockResolvedValue(audio);
		mocks.stepVideoPlaybackSession.mockResolvedValue(null);

		const controller = retainVideoNodePlaybackController(
			"node-hold-scrub-frame",
		);
		controller.bind({
			assetUri: "file:///hold-scrub-frame.mp4",
			fps: 30,
			runtimeManager: null,
		});

		await waitFor(() => {
			expect(controller.getSnapshot().isReady).toBe(true);
		});

		await controller.seekToTime(0);
		expect(controller.getSnapshot().currentFrame).toBe(firstFrame);
		video.handle.asset.unpinFrame.mockClear();

		await controller.seekToTime(2);
		expect(controller.getSnapshot().currentTime).toBe(2);
		expect(controller.getSnapshot().currentFrame).toBe(firstFrame);
		expect(video.handle.asset.unpinFrame).not.toHaveBeenCalled();

		releaseVideoNodePlaybackController("node-hold-scrub-frame");
	});

	it("拖拽 seek 在流式空帧时会回退单帧解码", async () => {
		const video = createVideoHandle(10);
		const audio = createAudioHandle();
		mocks.acquireVideoAsset.mockResolvedValue(video.handle);
		mocks.acquireAudioAsset.mockResolvedValue(audio);
		mocks.stepVideoPlaybackSession.mockResolvedValue(null);
		video.samplesMock.mockImplementation((startTimestamp: number) =>
			createSampleIterator([
				{
					timestamp: startTimestamp + 1 / 60,
					close: vi.fn(),
				},
			]),
		);

		const controller = retainVideoNodePlaybackController("node-scrub-fallback");
		controller.bind({
			assetUri: "file:///scrub-fallback.mp4",
			fps: 30,
			runtimeManager: null,
		});

		await waitFor(() => {
			expect(controller.getSnapshot().isReady).toBe(true);
		});

		const seek1 = controller.seekToTime(1);
		const seek2 = controller.seekToTime(2.5);
		const seek3 = controller.seekToTime(4);
		await Promise.all([seek1, seek2, seek3]);

		expect(controller.getSnapshot().currentTime).toBe(4);
		expect(controller.getSnapshot().currentFrame).not.toBeNull();
		expect(video.samplesMock).toHaveBeenCalled();

		releaseVideoNodePlaybackController("node-scrub-fallback");
	});

	it("lookahead 会在跳跃 seek 与暂停时失效重建", async () => {
		const frameController = mocks.createFrameController();
		mocks.createFramePrecompileController.mockReturnValue(frameController);
		const video = createVideoHandle(10);
		const audio = createAudioHandle();
		mocks.acquireVideoAsset.mockResolvedValue(video.handle);
		mocks.acquireAudioAsset.mockResolvedValue(audio);
		const requestAnimationFrameSpy = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation(() => 1);
		const cancelAnimationFrameSpy = vi
			.spyOn(window, "cancelAnimationFrame")
			.mockImplementation(() => {});

		const controller = retainVideoNodePlaybackController("node-lookahead");
		controller.bind({
			assetUri: "file:///lookahead.mp4",
			fps: 30,
			runtimeManager: null,
		});

		await waitFor(() => {
			expect(controller.getSnapshot().isReady).toBe(true);
		});

		await controller.play();
		frameController.getOrBuildCurrent.mockClear();
		frameController.invalidateAll.mockClear();

		await controller.seekToTime(1 / 30, { fromPlayback: true });
		expect(frameController.getOrBuildCurrent).toHaveBeenCalled();

		await controller.seekToTime(2, { fromPlayback: true });
		expect(frameController.invalidateAll).toHaveBeenCalled();
		const invalidateCountAfterJump =
			frameController.invalidateAll.mock.calls.length;

		controller.pause();
		expect(frameController.invalidateAll.mock.calls.length).toBeGreaterThan(
			invalidateCountAfterJump,
		);

		releaseVideoNodePlaybackController("node-lookahead");
		requestAnimationFrameSpy.mockRestore();
		cancelAnimationFrameSpy.mockRestore();
	});
});
