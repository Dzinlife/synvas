import {
	createCompressorState,
	processCompressorInPlace,
	type CompressorState,
} from "core/editor/audio/dsp/effects/compressor";
import {
	DEFAULT_EXPORT_AUDIO_DSP_SETTINGS,
	type ExportAudioDspSettings,
	resolveExportAudioDspSettings,
} from "core/editor/audio/dsp/types";

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterDspNode: ScriptProcessorNode | null = null;
let interleavedBlockBuffer = new Float32Array(0);
let compressorState: CompressorState | null = null;

const createDefaultAudioSettings = (): ExportAudioDspSettings => ({
	...DEFAULT_EXPORT_AUDIO_DSP_SETTINGS,
	compressor: { ...DEFAULT_EXPORT_AUDIO_DSP_SETTINGS.compressor },
});

let previewAudioSettings: ExportAudioDspSettings = createDefaultAudioSettings();
let previewMasterGain = 1;

const AUDIO_EPSILON = 1e-6;
const PREVIEW_DSP_CHANNELS = 2;

const dbToAmp = (db: number): number => Math.pow(10, db / 20);

const applyMasterGain = (data: Float32Array, gain: number) => {
	if (Math.abs(gain - 1) <= AUDIO_EPSILON) return;
	for (let i = 0; i < data.length; i += 1) {
		data[i] = (data[i] ?? 0) * gain;
	}
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

const ensureInterleavedBuffer = (size: number): Float32Array => {
	if (interleavedBlockBuffer.length < size) {
		interleavedBlockBuffer = new Float32Array(size);
	}
	return interleavedBlockBuffer.subarray(0, size);
};

const resetCompressorState = (sampleRate: number) => {
	compressorState = createCompressorState({
		config: previewAudioSettings.compressor,
		sampleRate,
	});
};

const readInputToInterleaved = (
	inputBuffer: AudioBuffer,
	outputChannels: number,
	frameCount: number,
	interleaved: Float32Array,
) => {
	const inputChannels = inputBuffer.numberOfChannels;
	for (let channel = 0; channel < outputChannels; channel += 1) {
		const sourceChannel =
			channel < inputChannels ? channel : inputChannels === 1 ? 0 : -1;
		const inputChannelData =
			sourceChannel >= 0 ? inputBuffer.getChannelData(sourceChannel) : null;
		for (let frame = 0; frame < frameCount; frame += 1) {
			interleaved[frame * outputChannels + channel] =
				inputChannelData?.[frame] ?? 0;
		}
	}
};

const writeInterleavedToOutput = (
	outputBuffer: AudioBuffer,
	outputChannels: number,
	frameCount: number,
	interleaved: Float32Array,
) => {
	for (let channel = 0; channel < outputBuffer.numberOfChannels; channel += 1) {
		const output = outputBuffer.getChannelData(channel);
		if (channel >= outputChannels) {
			output.fill(0);
			continue;
		}
		for (let frame = 0; frame < frameCount; frame += 1) {
			output[frame] = interleaved[frame * outputChannels + channel] ?? 0;
		}
	}
};

const processPreviewBlock = (
	event: AudioProcessingEvent,
	contextSampleRate: number,
) => {
	const outputChannels = Math.max(1, event.outputBuffer.numberOfChannels);
	const frameCount = event.outputBuffer.length;
	if (frameCount <= 0) return;

	const interleaved = ensureInterleavedBuffer(frameCount * outputChannels);
	readInputToInterleaved(
		event.inputBuffer,
		outputChannels,
		frameCount,
		interleaved,
	);

	applyMasterGain(interleaved, previewMasterGain);
	if (!compressorState) {
		resetCompressorState(contextSampleRate);
	}
	if (compressorState) {
		processCompressorInPlace({
			data: interleaved,
			numberOfChannels: outputChannels,
			config: previewAudioSettings.compressor,
			state: compressorState,
		});
	}
	clampPcmInPlace(interleaved);
	writeInterleavedToOutput(
		event.outputBuffer,
		outputChannels,
		frameCount,
		interleaved,
	);
};

const disconnectMasterDspNode = () => {
	if (!masterDspNode) return;
	masterDspNode.onaudioprocess = null;
	try {
		masterDspNode.disconnect();
	} catch {}
	masterDspNode = null;
};

const rebuildMasterDspGraph = (context: AudioContext) => {
	if (!masterGain) return;

	try {
		masterGain.disconnect();
	} catch {}
	disconnectMasterDspNode();

	const dspNode = context.createScriptProcessor(
		previewAudioSettings.exportBlockSize,
		PREVIEW_DSP_CHANNELS,
		PREVIEW_DSP_CHANNELS,
	);
	dspNode.onaudioprocess = (event) => {
		processPreviewBlock(event, context.sampleRate);
	};
	masterGain.connect(dspNode);
	dspNode.connect(context.destination);

	masterDspNode = dspNode;
	interleavedBlockBuffer = new Float32Array(0);
	resetCompressorState(context.sampleRate);
};

const ensureMasterDspGraph = (context: AudioContext) => {
	if (!masterGain) return;
	if (
		!masterDspNode ||
		masterDspNode.context !== context ||
		masterDspNode.bufferSize !== previewAudioSettings.exportBlockSize
	) {
		rebuildMasterDspGraph(context);
	}
};

const resolveAudioContext = (): AudioContext | null => {
	if (typeof window === "undefined") return null;
	const AudioContextImpl =
		window.AudioContext ||
		(window as Window & { webkitAudioContext?: typeof AudioContext })
			.webkitAudioContext;
	if (!AudioContextImpl) return null;
	if (!audioContext) {
		audioContext = new AudioContextImpl();
	}
	return audioContext;
};

export const setPreviewAudioDspSettings = (
	settings: ExportAudioDspSettings | undefined,
) => {
	const next = resolveExportAudioDspSettings(settings);
	previewAudioSettings = {
		...next,
		compressor: { ...next.compressor },
	};
	previewMasterGain = dbToAmp(previewAudioSettings.masterGainDb);
	const context = audioContext;
	if (!context || !masterGain) return;
	if (
		!masterDspNode ||
		masterDspNode.context !== context ||
		masterDspNode.bufferSize !== previewAudioSettings.exportBlockSize
	) {
		rebuildMasterDspGraph(context);
		return;
	}
	resetCompressorState(context.sampleRate);
};

export const getAudioContext = (): AudioContext | null => {
	const context = resolveAudioContext();
	if (!context) return null;
	if (!masterGain) {
		masterGain = context.createGain();
		masterGain.gain.value = 1;
	}
	ensureMasterDspGraph(context);
	return context;
};

export const ensureAudioContext = async (): Promise<AudioContext | null> => {
	const context = getAudioContext();
	if (!context) return null;
	if (context.state === "suspended") {
		try {
			await context.resume();
		} catch {
			return context;
		}
	}
	return context;
};

export const getMasterGain = (): GainNode | null => {
	getAudioContext();
	return masterGain;
};

export const createClipGain = (): GainNode | null => {
	const context = getAudioContext();
	if (!context) return null;
	const master = getMasterGain();
	if (!master) return null;
	const gain = context.createGain();
	gain.gain.value = 1;
	gain.connect(master);
	return gain;
};

export const __resetAudioEngineForTests = () => {
	try {
		masterGain?.disconnect();
	} catch {}
	disconnectMasterDspNode();
	masterGain = null;
	audioContext = null;
	interleavedBlockBuffer = new Float32Array(0);
	compressorState = null;
	previewAudioSettings = createDefaultAudioSettings();
	previewMasterGain = dbToAmp(previewAudioSettings.masterGainDb);
};
