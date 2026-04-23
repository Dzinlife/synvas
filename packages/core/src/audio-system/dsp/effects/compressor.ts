import type { ExportAudioCompressorConfig } from "../../settings";

type CompressorRuntime = {
	envelope: number;
	attackCoeff: number;
	releaseCoeff: number;
};

export type CompressorState = {
	runtime: CompressorRuntime;
};

const AMP_EPSILON = 1e-12;

const dbToAmp = (db: number): number => Math.pow(10, db / 20);

const ampToDb = (amp: number): number =>
	20 * Math.log10(Math.max(amp, AMP_EPSILON));

const computeSmoothingCoeff = (timeMs: number, sampleRate: number): number => {
	const clampedTimeMs = Math.max(0.1, timeMs);
	const seconds = clampedTimeMs / 1000;
	return Math.exp(-1 / (seconds * sampleRate));
};

const resolveGainReductionDb = ({
	inputDb,
	thresholdDb,
	ratio,
	kneeDb,
}: {
	inputDb: number;
	thresholdDb: number;
	ratio: number;
	kneeDb: number;
}): number => {
	const slope = 1 - 1 / Math.max(1, ratio);
	if (kneeDb <= 0) {
		if (inputDb <= thresholdDb) return 0;
		return (inputDb - thresholdDb) * slope;
	}

	const kneeHalf = kneeDb / 2;
	const lower = thresholdDb - kneeHalf;
	const upper = thresholdDb + kneeHalf;
	if (inputDb <= lower) return 0;
	if (inputDb >= upper) {
		return (inputDb - thresholdDb) * slope;
	}

	const x = inputDb - lower;
	return (slope * x * x) / (2 * kneeDb);
};

export const createCompressorState = ({
	config,
	sampleRate,
}: {
	config: ExportAudioCompressorConfig;
	sampleRate: number;
}): CompressorState => {
	const safeSampleRate = Math.max(1, Math.round(sampleRate));
	return {
		runtime: {
			envelope: 0,
			attackCoeff: computeSmoothingCoeff(config.attackMs, safeSampleRate),
			releaseCoeff: computeSmoothingCoeff(config.releaseMs, safeSampleRate),
		},
	};
};

export const processCompressorInPlace = ({
	data,
	numberOfChannels,
	config,
	state,
}: {
	data: Float32Array;
	numberOfChannels: number;
	config: ExportAudioCompressorConfig;
	state: CompressorState;
}) => {
	if (!config.enabled) return;
	if (numberOfChannels <= 0) return;
	if (data.length === 0) return;

	const runtime = state.runtime;
	const makeupGain = dbToAmp(config.makeupGainDb);
	const safeChannels = Math.max(1, numberOfChannels);
	const frames = Math.floor(data.length / safeChannels);
	for (let frame = 0; frame < frames; frame += 1) {
		const base = frame * safeChannels;
		let detector = 0;
		for (let channel = 0; channel < safeChannels; channel += 1) {
			detector = Math.max(detector, Math.abs(data[base + channel] ?? 0));
		}

		const coeff =
			detector > runtime.envelope ? runtime.attackCoeff : runtime.releaseCoeff;
		runtime.envelope = coeff * runtime.envelope + (1 - coeff) * detector;
		if (runtime.envelope < AMP_EPSILON) {
			runtime.envelope = 0;
		}
		const inputDb = ampToDb(runtime.envelope);
		const reductionDb = resolveGainReductionDb({
			inputDb,
			thresholdDb: config.thresholdDb,
			ratio: config.ratio,
			kneeDb: config.kneeDb,
		});
		const gain = dbToAmp(-reductionDb) * makeupGain;
		for (let channel = 0; channel < safeChannels; channel += 1) {
			data[base + channel] = (data[base + channel] ?? 0) * gain;
		}
	}
};
