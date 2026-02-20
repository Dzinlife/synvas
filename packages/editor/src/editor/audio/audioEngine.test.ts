import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetAudioEngineForTests,
	createClipGain,
	getAudioContext,
	getPreviewLoudnessSnapshot,
	setPreviewAudioDspSettings,
	subscribePreviewLoudness,
} from "./audioEngine";
import { PREVIEW_DSP_WORKLET_PROCESSOR_NAME } from "./previewDspConstants";

type FakeGainNode = {
	gain: { value: number };
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
};

type FakeAudioWorklet = {
	addModule: ReturnType<typeof vi.fn>;
};

type FakeAudioContext = {
	sampleRate: number;
	destination: object;
	state: "running";
	currentTime: number;
	audioWorklet: FakeAudioWorklet;
	createGain: ReturnType<typeof vi.fn>;
	resume: ReturnType<typeof vi.fn>;
};

type FakeAudioWorkletNodeInstance = {
	context: AudioContext;
	port: {
		postMessage: ReturnType<typeof vi.fn>;
		onmessage: ((event: MessageEvent) => void) | null;
	};
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
};

const sleepTick = async () =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});

const createGainNode = (): FakeGainNode => ({
	gain: { value: 1 },
	connect: vi.fn(),
	disconnect: vi.fn(),
});

const createAudioContextMock = (): FakeAudioContext => ({
	sampleRate: 48_000,
	destination: {},
	state: "running",
	currentTime: 0,
	audioWorklet: {
		addModule: vi.fn(async () => {}),
	},
	createGain: vi.fn(() => createGainNode()),
	resume: vi.fn(async () => {}),
});

describe("audioEngine preview dsp graph", () => {
	type TestWindow = Window & {
		AudioContext?: typeof AudioContext;
		webkitAudioContext?: typeof AudioContext;
	};

	type GlobalWithWindow = typeof globalThis & {
		window?: TestWindow;
		AudioWorkletNode?: typeof AudioWorkletNode;
	};

	const globalWithWindow = globalThis as GlobalWithWindow;
	let hadWindow = false;
	let hadAudioWorkletNode = false;
	let originalAudioContext: typeof AudioContext | undefined;
	let originalWebkitAudioContext: typeof AudioContext | undefined;
	let originalAudioWorkletNode: typeof AudioWorkletNode | undefined;

	let fakeContext: FakeAudioContext;
	let fakeAudioWorkletNodeCtor: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		__resetAudioEngineForTests();
		fakeContext = createAudioContextMock();
		fakeAudioWorkletNodeCtor = vi.fn(
			(
				context: AudioContext,
				_name: string,
				_options?: AudioWorkletNodeOptions,
			): FakeAudioWorkletNodeInstance => ({
				context,
				port: {
					postMessage: vi.fn(),
					onmessage: null,
				},
				connect: vi.fn(),
				disconnect: vi.fn(),
			}),
		);

		hadWindow = "window" in globalWithWindow && !!globalWithWindow.window;
		if (!globalWithWindow.window) {
			Object.defineProperty(globalWithWindow, "window", {
				configurable: true,
				writable: true,
				value: {},
			});
		}
		const targetWindow = globalWithWindow.window as TestWindow;
		originalAudioContext = targetWindow.AudioContext;
		originalWebkitAudioContext = targetWindow.webkitAudioContext;
		Object.defineProperty(targetWindow, "AudioContext", {
			configurable: true,
			writable: true,
			value: vi.fn(
				() => fakeContext as unknown as AudioContext,
			) as unknown as typeof AudioContext,
		});
		Object.defineProperty(targetWindow, "webkitAudioContext", {
			configurable: true,
			writable: true,
			value: undefined,
		});

		hadAudioWorkletNode = "AudioWorkletNode" in globalWithWindow;
		originalAudioWorkletNode = globalWithWindow.AudioWorkletNode;
		Object.defineProperty(globalWithWindow, "AudioWorkletNode", {
			configurable: true,
			writable: true,
			value: fakeAudioWorkletNodeCtor as unknown as typeof AudioWorkletNode,
		});
	});

	afterEach(() => {
		__resetAudioEngineForTests();
		const targetWindow = globalWithWindow.window as TestWindow;
		Object.defineProperty(targetWindow, "AudioContext", {
			configurable: true,
			writable: true,
			value: originalAudioContext,
		});
		Object.defineProperty(targetWindow, "webkitAudioContext", {
			configurable: true,
			writable: true,
			value: originalWebkitAudioContext,
		});
		if (!hadWindow) {
			Reflect.deleteProperty(globalWithWindow, "window");
		}
		if (hadAudioWorkletNode) {
			Object.defineProperty(globalWithWindow, "AudioWorkletNode", {
				configurable: true,
				writable: true,
				value: originalAudioWorkletNode,
			});
		} else {
			Reflect.deleteProperty(globalWithWindow, "AudioWorkletNode");
		}
		vi.restoreAllMocks();
	});

	it("初始化时会异步加载 AudioWorklet 并建立 DSP 节点", async () => {
		const context = getAudioContext();
		expect(context).toBe(fakeContext);

		expect(fakeContext.audioWorklet.addModule).toHaveBeenCalledTimes(1);
		expect(fakeAudioWorkletNodeCtor).toHaveBeenCalledTimes(0);

		await sleepTick();

		expect(fakeAudioWorkletNodeCtor).toHaveBeenCalledTimes(1);
		expect(fakeAudioWorkletNodeCtor).toHaveBeenCalledWith(
			fakeContext,
			PREVIEW_DSP_WORKLET_PROCESSOR_NAME,
			expect.objectContaining({
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [2],
			}),
		);
	});

	it("更新 DSP 设置会通过 worklet port 下发参数", async () => {
		getAudioContext();
		await sleepTick();

		const node = fakeAudioWorkletNodeCtor.mock.results[0]
			?.value as FakeAudioWorkletNodeInstance;
		expect(node).toBeDefined();

		setPreviewAudioDspSettings({
			exportSampleRate: 48_000,
			exportBlockSize: 1024,
			masterGainDb: -3,
			compressor: {
				enabled: true,
				thresholdDb: -20,
				ratio: 3,
				kneeDb: 8,
				attackMs: 12,
				releaseMs: 180,
				makeupGainDb: 1.2,
			},
		});

		expect(node.port.postMessage).toHaveBeenCalled();
		const payload = node.port.postMessage.mock.calls.at(-1)?.[0] as
			| {
					type: string;
					config?: { masterGainDb?: number; exportBlockSize?: number };
			  }
			| undefined;
		expect(payload?.type).toBe("config");
		expect(payload?.config?.masterGainDb).toBe(-3);
		expect(payload?.config?.exportBlockSize).toBe(1024);
	});

	it("createClipGain 会连接到 master bus", () => {
		const clipGain = createClipGain();
		expect(clipGain).toBeTruthy();

		const masterGain = fakeContext.createGain.mock.results[0]
			?.value as FakeGainNode;
		const clipGainNode = fakeContext.createGain.mock.results[1]
			?.value as FakeGainNode;
		expect(masterGain).toBeDefined();
		expect(clipGainNode).toBeDefined();
		expect(clipGainNode.connect).toHaveBeenCalledWith(masterGain);
	});

	it("收到 meter 消息后会更新响度快照并通知订阅者", async () => {
		getAudioContext();
		await sleepTick();

		const node = fakeAudioWorkletNodeCtor.mock.results[0]
			?.value as FakeAudioWorkletNodeInstance;
		expect(node).toBeDefined();

		const loudnessListener = vi.fn();
		const unsubscribe = subscribePreviewLoudness(loudnessListener);

		node.port.onmessage?.({
			data: {
				type: "meter",
				leftRms: 0.23,
				rightRms: 0.31,
				leftPeak: 0.67,
				rightPeak: 0.75,
			},
		} as MessageEvent);

		const snapshot = getPreviewLoudnessSnapshot();
		expect(snapshot.leftRms).toBeCloseTo(0.23);
		expect(snapshot.rightRms).toBeCloseTo(0.31);
		expect(snapshot.leftPeak).toBeCloseTo(0.67);
		expect(snapshot.rightPeak).toBeCloseTo(0.75);
		expect(snapshot.updatedAtMs).toBeGreaterThan(0);

		expect(loudnessListener).toHaveBeenCalledTimes(1);
		expect(loudnessListener).toHaveBeenLastCalledWith(
			expect.objectContaining({
				leftRms: 0.23,
				rightRms: 0.31,
				leftPeak: 0.67,
				rightPeak: 0.75,
			}),
		);

		unsubscribe();
		node.port.onmessage?.({
			data: {
				type: "meter",
				leftRms: 0.1,
				rightRms: 0.1,
				leftPeak: 0.2,
				rightPeak: 0.2,
			},
		} as MessageEvent);
		expect(loudnessListener).toHaveBeenCalledTimes(1);
	});
});
