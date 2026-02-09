import {
	createCompressorState,
	processCompressorInPlace,
	type CompressorState,
} from "core/editor/audio/dsp/effects/compressor";
import {
	type PartialExportAudioDspSettings,
	type ExportAudioDspSettings,
	resolveExportAudioDspSettings,
} from "core/editor/audio/dsp/types";
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
	processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

type DspConfigMessage = {
	type: "config";
	config?: PartialExportAudioDspSettings;
};

const AUDIO_EPSILON = 1e-6;

const dbToAmp = (db: number): number => Math.pow(10, db / 20);

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
			this.compressorState = createCompressorState({
				config: this.settings.compressor,
				sampleRate,
			});
		};
	}

	private renderToInterleavedBuffer(
		input: Float32Array[],
		output: Float32Array[],
	): Float32Array {
		const channels = output.length;
		const frames = output[0]?.length ?? 0;
		const interleaved = new Float32Array(frames * channels);
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

	private writeInterleavedToOutput(output: Float32Array[], interleaved: Float32Array) {
		const channels = output.length;
		const frames = output[0]?.length ?? 0;
		for (let channel = 0; channel < channels; channel += 1) {
			const channelData = output[channel];
			for (let frame = 0; frame < frames; frame += 1) {
				channelData[frame] = interleaved[frame * channels + channel] ?? 0;
			}
		}
	}

	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const output = outputs[0];
		if (!output || output.length === 0) return true;

		const input = inputs[0] ?? [];
		const interleaved = this.renderToInterleavedBuffer(input, output);
		const masterGain = dbToAmp(this.settings.masterGainDb);
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
		return true;
	}
}

registerProcessor(PREVIEW_DSP_WORKLET_PROCESSOR_NAME, PreviewDspProcessor);
