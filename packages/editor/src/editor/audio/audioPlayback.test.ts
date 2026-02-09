import type { TimelineMeta } from "core/dsl/types";
import type { AudioBufferSink } from "mediabunny";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetAudioPlaybackRuntimeForTests,
	createAudioPlaybackController,
} from "./audioPlayback";

const mocks = vi.hoisted(() => {
	const fakeGain = () => ({
		gain: {
			value: 1,
			cancelScheduledValues: vi.fn(),
			setValueAtTime: vi.fn(),
			linearRampToValueAtTime: vi.fn(),
		},
		connect: vi.fn(),
		disconnect: vi.fn(),
	});
	const context = {
		currentTime: 0,
		destination: {},
		createGain: vi.fn(() => ({
			gain: {
				value: 1,
				cancelScheduledValues: vi.fn(),
				setValueAtTime: vi.fn(),
				linearRampToValueAtTime: vi.fn(),
			},
			connect: vi.fn(),
			disconnect: vi.fn(),
		})),
		createBufferSource: vi.fn(() => ({
			buffer: null,
			connect: vi.fn(),
			disconnect: vi.fn(),
			start: vi.fn(),
			stop: vi.fn(),
			onended: null as (() => void) | null,
		})),
	} as unknown as AudioContext;
	return {
		context,
		createClipGain: vi.fn(() => fakeGain() as unknown as GainNode),
		ensureAudioContext: vi.fn(async () => context),
		getAudioContext: vi.fn(() => context),
	};
});

vi.mock("@/editor/audio/audioEngine", () => ({
	createClipGain: mocks.createClipGain,
	ensureAudioContext: mocks.ensureAudioContext,
	getAudioContext: mocks.getAudioContext,
}));

const baseTimeline: TimelineMeta = {
	start: 0,
	end: 300,
	startTimecode: "",
	endTimecode: "",
	offset: 0,
	trackIndex: -1,
};

const createSink = () => {
	return {
		buffers: vi.fn((start: number) =>
			(async function* () {
				yield {
					timestamp: start,
					buffer: {} as AudioBuffer,
				};
			})(),
		),
	} as unknown as AudioBufferSink;
};

describe("audioPlayback runtime sharing", () => {
	beforeEach(() => {
		__resetAudioPlaybackRuntimeForTests();
		(mocks.context as { currentTime: number }).currentTime = 0;
		vi.clearAllMocks();
	});

	afterEach(() => {
		__resetAudioPlaybackRuntimeForTests();
	});

	it("同一 runtime key 会复用播放会话", async () => {
		const sink = createSink();
		const getState = () => ({
			uri: "a.mp3",
			audioSink: sink,
			audioDuration: 20,
		});
		const createController = () =>
			createAudioPlaybackController({
				getTimeline: () => baseTimeline,
				getFps: () => 30,
				getState,
				getRuntimeKey: () => "session:shared",
			});

		const controllerA = createController();
		const controllerB = createController();

		await controllerA.stepPlayback(1);
		(mocks.context as { currentTime: number }).currentTime = 0.15;
		await controllerB.stepPlayback(1.1);

		expect(sink.buffers).toHaveBeenCalledTimes(1);

		controllerA.dispose();
		controllerB.dispose();
	});

	it("不同 runtime key 会分别启动播放会话", async () => {
		const sink = createSink();
		const getState = () => ({
			uri: "a.mp3",
			audioSink: sink,
			audioDuration: 20,
		});
		const controllerA = createAudioPlaybackController({
			getTimeline: () => baseTimeline,
			getFps: () => 30,
			getState,
			getRuntimeKey: () => "session:a",
		});
		const controllerB = createAudioPlaybackController({
			getTimeline: () => baseTimeline,
			getFps: () => 30,
			getState,
			getRuntimeKey: () => "session:b",
		});

		await controllerA.stepPlayback(1);
		(mocks.context as { currentTime: number }).currentTime = 0.15;
		await controllerB.stepPlayback(1.1);

		expect(sink.buffers).toHaveBeenCalledTimes(2);

		controllerA.dispose();
		controllerB.dispose();
	});

	it("播放中回跳重启时会使用淡出停止旧 source", async () => {
		const sink = createSink();
		const getState = () => ({
			uri: "a.mp3",
			audioSink: sink,
			audioDuration: 20,
		});
		const controller = createAudioPlaybackController({
			getTimeline: () => baseTimeline,
			getFps: () => 30,
			getState,
			getRuntimeKey: () => "session:seek",
		});

		await controller.stepPlayback(1);
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 0);
		});
		(mocks.context as { currentTime: number }).currentTime = 0.2;
		await controller.stepPlayback(0.7);

		const createBufferSourceMock = mocks.context.createBufferSource as unknown as {
			mock: {
				results: Array<{ value: { stop: ReturnType<typeof vi.fn> } }>;
			};
		};
		const firstSource = createBufferSourceMock.mock.results[0]?.value;
		expect(firstSource?.stop).toHaveBeenCalled();
		const firstStopCallArg = firstSource?.stop.mock.calls[0]?.[0];
		expect(firstStopCallArg).toBeGreaterThan(0.2);

		controller.dispose();
	});

	it("共享 session 启动后会持续读取到音频末尾，避免切点后跑空静音", async () => {
		const sink = createSink();
		const getState = () => ({
			uri: "a.mp3",
			audioSink: sink,
			audioDuration: 20,
		});
		const controller = createAudioPlaybackController({
			getTimeline: () => baseTimeline,
			getFps: () => 30,
			getState,
			getRuntimeKey: () => "session:cut",
		});

		await controller.stepPlayback({
			timelineTimeSeconds: 1,
			gain: 1,
			activeWindow: { start: 0, end: 2 },
			sourceTime: 1,
			sourceRange: { start: 0, end: 2 },
		});

		expect(sink.buffers).toHaveBeenCalledTimes(1);
		expect(sink.buffers).toHaveBeenNthCalledWith(1, 1, 20);

		controller.dispose();
	});

	it("seekEpoch 变化会强制重建播放，避免沿用旧流", async () => {
		const sink = createSink();
		let seekEpoch = 0;
		const getState = () => ({
			uri: "a.mp3",
			audioSink: sink,
			audioDuration: 20,
		});
		const controller = createAudioPlaybackController({
			getTimeline: () => baseTimeline,
			getFps: () => 30,
			getState,
			getSeekEpoch: () => seekEpoch,
			getRuntimeKey: () => "session:seek-epoch",
		});

		await controller.stepPlayback(5);
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 0);
		});
		(mocks.context as { currentTime: number }).currentTime = 0.1;
		await controller.stepPlayback(5.05);
		expect(sink.buffers).toHaveBeenCalledTimes(1);

		seekEpoch = 1;
		(mocks.context as { currentTime: number }).currentTime = 0.12;
		await controller.stepPlayback(5.08);
		expect(sink.buffers).toHaveBeenCalledTimes(2);
		const createBufferSourceMock = mocks.context.createBufferSource as unknown as {
			mock: {
				results: Array<{ value: { stop: ReturnType<typeof vi.fn> } }>;
			};
		};
		const firstSource = createBufferSourceMock.mock.results[0]?.value;
		expect(firstSource?.stop).toHaveBeenCalled();
		const firstStopCallArg = firstSource?.stop.mock.calls[0]?.[0];
		expect(firstStopCallArg).toBeGreaterThan(0.12);
		expect(firstStopCallArg).toBeLessThan(0.13);

		controller.dispose();
	});
});
