import {
	type CompressorState,
	createCompressorState,
	processCompressorInPlace,
} from "core/audio-system/dsp/effects/compressor";
import {
	type ExportAudioDspSettings,
	type PartialExportAudioDspSettings,
	resolveExportAudioDspSettings,
} from "core/audio-system/settings";
import { PREVIEW_DSP_WORKLET_PROCESSOR_NAME } from "./previewDspConstants";

declare const sampleRate: number;

declare abstract class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor(options?: AudioWorkletNodeOptions);
	process(
		inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Record<string, Float32Array>,
	): boolean;
}

declare function registerProcessor(
	name: string,
	processorCtor: new (
		options?: AudioWorkletNodeOptions,
	) => AudioWorkletProcessor,
): void;

type DspConfigMessage = {
	type: "config";
	config?: PartialExportAudioDspSettings;
};

type DspMeterMessage = {
	type: "meter";
	leftRms: number;
	rightRms: number;
	leftPeak: number;
	rightPeak: number;
};

const AUDIO_EPSILON = 1e-6;
const METER_REPORT_RATE_HZ = 30;

const dbToAmp = (db: number): number => 10 ** (db / 20);

const clampUnit = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
};

const clampPcmInPlace = (data: Float32Array) => {
	for (let i = 0; i < data.length; i += 1) {
		const sample = data[i] ?? 0;
		if (sample > 1) {
			data[i] = 1;
			continue;
		}
		if (sample < -1) {
			data[i] = -1;
		}
	}
};

class PreviewDspProcessor extends AudioWorkletProcessor {
	private settings: ExportAudioDspSettings;
	private compressorState: CompressorState;
	private interleavedBuffer = new Float32Array(0);
	private readonly meterReportIntervalFrames = Math.max(
		1,
		Math.round(sampleRate / METER_REPORT_RATE_HZ),
	);
	private meterAccumulatedFrames = 0;
	private meterLeftSquareSum = 0;
	private meterRightSquareSum = 0;
	private meterLeftPeak = 0;
	private meterRightPeak = 0;

	constructor(options?: AudioWorkletNodeOptions) {
		super(options);
		const config = (
			options?.processorOptions as { config?: PartialExportAudioDspSettings }
		)?.config;
		this.settings = resolveExportAudioDspSettings(config);
		this.compressorState = createCompressorState({
			config: this.settings.compressor,
			sampleRate,
		});
		this.port.onmessage = (event: MessageEvent<DspConfigMessage>) => {
			const message = event.data;
			if (!message || message.type !== "config") return;
			this.settings = resolveExportAudioDspSettings(message.config);
			const nextState = createCompressorState({
				config: this.settings.compressor,
				sampleRate,
			});
			nextState.runtime.envelope = this.compressorState.runtime.envelope;
			this.compressorState = nextState;
		};
	}

	private ensureInterleavedBuffer(size: number): Float32Array {
		if (this.interleavedBuffer.length < size) {
			this.interleavedBuffer = new Float32Array(size);
		}
		return this.interleavedBuffer.subarray(0, size);
	}

	private renderToInterleavedBuffer(
		input: Float32Array[],
		output: Float32Array[],
	): Float32Array {
		const channels = output.length;
		const frames = output[0]?.length ?? 0;
		const interleaved = this.ensureInterleavedBuffer(frames * channels);
		for (let channel = 0; channel < channels; channel += 1) {
			const sourceChannel =
				channel < input.length ? channel : input.length === 1 ? 0 : -1;
			const sourceData = sourceChannel >= 0 ? input[sourceChannel] : null;
			for (let frame = 0; frame < frames; frame += 1) {
				interleaved[frame * channels + channel] = sourceData?.[frame] ?? 0;
			}
		}
		return interleaved;
	}

	private writeInterleavedToOutput(
		output: Float32Array[],
		interleaved: Float32Array,
	) {
		const channels = output.length;
		const frames = output[0]?.length ?? 0;
		for (let channel = 0; channel < channels; channel += 1) {
			const channelData = output[channel];
			for (let frame = 0; frame < frames; frame += 1) {
				channelData[frame] = interleaved[frame * channels + channel] ?? 0;
			}
		}
	}

	private resetMeterAccumulator() {
		this.meterAccumulatedFrames = 0;
		this.meterLeftSquareSum = 0;
		this.meterRightSquareSum = 0;
		this.meterLeftPeak = 0;
		this.meterRightPeak = 0;
	}

	private flushMeter() {
		const totalFrames = this.meterAccumulatedFrames;
		if (totalFrames <= 0) return;
		const invFrames = 1 / totalFrames;
		const message: DspMeterMessage = {
			type: "meter",
			leftRms: clampUnit(Math.sqrt(this.meterLeftSquareSum * invFrames)),
			rightRms: clampUnit(Math.sqrt(this.meterRightSquareSum * invFrames)),
			leftPeak: clampUnit(this.meterLeftPeak),
			rightPeak: clampUnit(this.meterRightPeak),
		};
		this.port.postMessage(message);
		this.resetMeterAccumulator();
	}

	private collectMeterFromOutput(output: Float32Array[]) {
		const frames = output[0]?.length ?? 0;
		if (frames <= 0) return;
		const leftData = output[0];
		const rightData = output[1] ?? output[0];
		let leftSquareSum = 0;
		let rightSquareSum = 0;
		let leftPeak = 0;
		let rightPeak = 0;
		for (let frame = 0; frame < frames; frame += 1) {
			const leftSample = leftData?.[frame] ?? 0;
			const rightSample = rightData?.[frame] ?? 0;
			const leftAbs = Math.abs(leftSample);
			const rightAbs = Math.abs(rightSample);
			leftSquareSum += leftSample * leftSample;
			rightSquareSum += rightSample * rightSample;
			if (leftAbs > leftPeak) leftPeak = leftAbs;
			if (rightAbs > rightPeak) rightPeak = rightAbs;
		}
		this.meterAccumulatedFrames += frames;
		this.meterLeftSquareSum += leftSquareSum;
		this.meterRightSquareSum += rightSquareSum;
		if (leftPeak > this.meterLeftPeak) this.meterLeftPeak = leftPeak;
		if (rightPeak > this.meterRightPeak) this.meterRightPeak = rightPeak;
		if (this.meterAccumulatedFrames >= this.meterReportIntervalFrames) {
			this.flushMeter();
		}
	}

	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const output = outputs[0];
		if (!output || output.length === 0) return true;

		const input = inputs[0] ?? [];
		const masterGain = dbToAmp(this.settings.masterGainDb);
		if (
			Math.abs(masterGain - 1) <= AUDIO_EPSILON &&
			!this.settings.compressor.enabled
		) {
			const channels = output.length;
			const frames = output[0]?.length ?? 0;
			for (let channel = 0; channel < channels; channel += 1) {
				const sourceChannel =
					channel < input.length ? channel : input.length === 1 ? 0 : -1;
				const sourceData = sourceChannel >= 0 ? input[sourceChannel] : null;
				const targetData = output[channel];
				for (let frame = 0; frame < frames; frame += 1) {
					targetData[frame] = sourceData?.[frame] ?? 0;
				}
			}
			this.collectMeterFromOutput(output);
			return true;
		}

		const interleaved = this.renderToInterleavedBuffer(input, output);
		if (Math.abs(masterGain - 1) > AUDIO_EPSILON) {
			for (let i = 0; i < interleaved.length; i += 1) {
				interleaved[i] = (interleaved[i] ?? 0) * masterGain;
			}
		}
		processCompressorInPlace({
			data: interleaved,
			numberOfChannels: output.length,
			config: this.settings.compressor,
			state: this.compressorState,
		});
		clampPcmInPlace(interleaved);
		this.writeInterleavedToOutput(output, interleaved);
		this.collectMeterFromOutput(output);
		return true;
	}
}

registerProcessor(PREVIEW_DSP_WORKLET_PROCESSOR_NAME, PreviewDspProcessor);
