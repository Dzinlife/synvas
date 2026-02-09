import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetAudioEngineForTests,
	createClipGain,
	getAudioContext,
	setPreviewAudioDspSettings,
} from "./audioEngine";

type FakeGainNode = {
	gain: { value: number };
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
};

type FakeScriptProcessorNode = {
	bufferSize: number;
	context: FakeAudioContext;
	onaudioprocess: ((event: AudioProcessingEvent) => void) | null;
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
};

type FakeAudioContext = {
	sampleRate: number;
	destination: object;
	state: "running";
	currentTime: number;
	createGain: ReturnType<typeof vi.fn>;
	createScriptProcessor: ReturnType<typeof vi.fn>;
};

const createGainNode = (): FakeGainNode => ({
	gain: { value: 1 },
	connect: vi.fn(),
	disconnect: vi.fn(),
});

const createAudioContextMock = (): FakeAudioContext => {
	let context: FakeAudioContext;
	const createGain = vi.fn(() => createGainNode());
	const createScriptProcessor = vi.fn(
		(
			bufferSize: number,
			_numberOfInputChannels: number,
			_numberOfOutputChannels: number,
		): FakeScriptProcessorNode => ({
			bufferSize,
			context,
			onaudioprocess: null,
			connect: vi.fn(),
			disconnect: vi.fn(),
		}),
	);
	context = {
		sampleRate: 48_000,
		destination: {},
		state: "running" as const,
		currentTime: 0,
		createGain,
		createScriptProcessor,
	} satisfies FakeAudioContext;
	return context;
};

type BufferShape = {
	numberOfChannels: number;
	length: number;
	getChannelData: (index: number) => Float32Array;
};

const createAudioBufferLike = (channels: number[][]): BufferShape => {
	const data = channels.map((channel) => Float32Array.from(channel));
	return {
		numberOfChannels: data.length,
		length: data[0]?.length ?? 0,
		getChannelData: (index: number) => data[index] ?? new Float32Array(0),
	};
};

describe("audioEngine preview dsp graph", () => {
	type TestWindow = Window & {
		AudioContext?: typeof AudioContext;
		webkitAudioContext?: typeof AudioContext;
	};

	type GlobalWithWindow = typeof globalThis & {
		window?: TestWindow;
	};

	const globalWithWindow = globalThis as GlobalWithWindow;
	let hadWindow = false;
	let originalAudioContext: typeof AudioContext | undefined;
	let originalWebkitAudioContext: typeof AudioContext | undefined;
	let fakeContext: FakeAudioContext;

	beforeEach(() => {
		__resetAudioEngineForTests();
		fakeContext = createAudioContextMock();
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
		vi.restoreAllMocks();
	});

	it("初始化时会按默认 block size 构建主总线 DSP", () => {
		const context = getAudioContext();
		expect(context).toBe(fakeContext);

		expect(fakeContext.createScriptProcessor).toHaveBeenCalledTimes(1);
		expect(fakeContext.createScriptProcessor).toHaveBeenCalledWith(512, 2, 2);

		const masterGain = fakeContext.createGain.mock.results[0]
			?.value as FakeGainNode;
		const processor = fakeContext.createScriptProcessor.mock.results[0]
			?.value as FakeScriptProcessorNode;
		expect(masterGain.connect).toHaveBeenCalledWith(processor);
		expect(processor.connect).toHaveBeenCalledWith(fakeContext.destination);
	});

	it("更新 block size 会重建 ScriptProcessor 节点", () => {
		getAudioContext();
		const firstProcessor = fakeContext.createScriptProcessor.mock.results[0]
			?.value as FakeScriptProcessorNode;

		setPreviewAudioDspSettings({
			exportSampleRate: 48_000,
			exportBlockSize: 1024,
			masterGainDb: 0,
			compressor: {
				enabled: false,
				thresholdDb: -18,
				ratio: 4,
				kneeDb: 6,
				attackMs: 10,
				releaseMs: 120,
				makeupGainDb: 0,
			},
		});

		expect(fakeContext.createScriptProcessor).toHaveBeenCalledTimes(2);
		expect(fakeContext.createScriptProcessor).toHaveBeenNthCalledWith(
			2,
			1024,
			2,
			2,
		);
		expect(firstProcessor.disconnect).toHaveBeenCalledTimes(1);
	});

	it("主增益参数会在 DSP 回调中生效", () => {
		getAudioContext();
		setPreviewAudioDspSettings({
			exportSampleRate: 48_000,
			exportBlockSize: 512,
			masterGainDb: -6,
			compressor: {
				enabled: false,
				thresholdDb: -18,
				ratio: 4,
				kneeDb: 6,
				attackMs: 10,
				releaseMs: 120,
				makeupGainDb: 0,
			},
		});
		createClipGain();

		const processor = fakeContext.createScriptProcessor.mock.results.at(-1)
			?.value as FakeScriptProcessorNode;
		expect(processor.onaudioprocess).toBeTypeOf("function");
		if (!processor.onaudioprocess) return;

		const input = createAudioBufferLike([
			[1, 1, 1, 1],
			[1, 1, 1, 1],
		]);
		const output = createAudioBufferLike([
			[0, 0, 0, 0],
			[0, 0, 0, 0],
		]);
		processor.onaudioprocess({
			inputBuffer: input as unknown as AudioBuffer,
			outputBuffer: output as unknown as AudioBuffer,
		} as AudioProcessingEvent);

		const left = Array.from(output.getChannelData(0));
		const right = Array.from(output.getChannelData(1));
		for (const sample of [...left, ...right]) {
			expect(sample).toBeGreaterThan(0.49);
			expect(sample).toBeLessThan(0.51);
		}
	});
});
