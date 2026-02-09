export const AUDIO_EXPORT_SAMPLE_RATE_VALUES = [44100, 48000] as const;
export type AudioExportSampleRate =
	(typeof AUDIO_EXPORT_SAMPLE_RATE_VALUES)[number];

export const AUDIO_EXPORT_BLOCK_SIZE_VALUES = [256, 512, 1024] as const;
export type AudioExportBlockSize =
	(typeof AUDIO_EXPORT_BLOCK_SIZE_VALUES)[number];

export type ExportAudioCompressorConfig = {
	enabled: boolean;
	thresholdDb: number;
	ratio: number;
	kneeDb: number;
	attackMs: number;
	releaseMs: number;
	makeupGainDb: number;
};

export type ExportAudioDspSettings = {
	exportSampleRate: AudioExportSampleRate;
	exportBlockSize: AudioExportBlockSize;
	masterGainDb: number;
	compressor: ExportAudioCompressorConfig;
};

export type PartialExportAudioDspSettings = {
	exportSampleRate?: AudioExportSampleRate;
	exportBlockSize?: AudioExportBlockSize;
	masterGainDb?: number;
	compressor?: Partial<ExportAudioCompressorConfig>;
};

export type ExportAudioDspConfig = ExportAudioDspSettings & {
	numberOfChannels: 2;
};

export const DEFAULT_EXPORT_AUDIO_COMPRESSOR_CONFIG: ExportAudioCompressorConfig =
	{
		enabled: false,
		thresholdDb: -18,
		ratio: 4,
		kneeDb: 6,
		attackMs: 10,
		releaseMs: 120,
		makeupGainDb: 0,
	};

export const DEFAULT_EXPORT_AUDIO_DSP_SETTINGS: ExportAudioDspSettings = {
	exportSampleRate: 48000,
	exportBlockSize: 512,
	masterGainDb: 0,
	compressor: { ...DEFAULT_EXPORT_AUDIO_COMPRESSOR_CONFIG },
};

export const normalizeExportAudioSampleRate = (
	value: unknown,
): AudioExportSampleRate => {
	if (value === 44100 || value === 48000) {
		return value;
	}
	return DEFAULT_EXPORT_AUDIO_DSP_SETTINGS.exportSampleRate;
};

export const normalizeExportAudioBlockSize = (
	value: unknown,
): AudioExportBlockSize => {
	if (value === 256 || value === 512 || value === 1024) {
		return value;
	}
	return DEFAULT_EXPORT_AUDIO_DSP_SETTINGS.exportBlockSize;
};

const normalizeFiniteNumber = (value: unknown, fallback: number): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return value;
};

export const normalizeExportAudioCompressorConfig = (
	value: Partial<ExportAudioCompressorConfig> | undefined,
): ExportAudioCompressorConfig => {
	return {
		enabled: value?.enabled ?? DEFAULT_EXPORT_AUDIO_COMPRESSOR_CONFIG.enabled,
		thresholdDb: normalizeFiniteNumber(
			value?.thresholdDb,
			DEFAULT_EXPORT_AUDIO_COMPRESSOR_CONFIG.thresholdDb,
		),
		ratio: Math.max(
			1,
			normalizeFiniteNumber(
				value?.ratio,
				DEFAULT_EXPORT_AUDIO_COMPRESSOR_CONFIG.ratio,
			),
		),
		kneeDb: Math.max(
			0,
			normalizeFiniteNumber(
				value?.kneeDb,
				DEFAULT_EXPORT_AUDIO_COMPRESSOR_CONFIG.kneeDb,
			),
		),
		attackMs: Math.max(
			0.1,
			normalizeFiniteNumber(
				value?.attackMs,
				DEFAULT_EXPORT_AUDIO_COMPRESSOR_CONFIG.attackMs,
			),
		),
		releaseMs: Math.max(
			0.1,
			normalizeFiniteNumber(
				value?.releaseMs,
				DEFAULT_EXPORT_AUDIO_COMPRESSOR_CONFIG.releaseMs,
			),
		),
		makeupGainDb: normalizeFiniteNumber(
			value?.makeupGainDb,
			DEFAULT_EXPORT_AUDIO_COMPRESSOR_CONFIG.makeupGainDb,
		),
	};
};

export const resolveExportAudioDspSettings = (
	value?: PartialExportAudioDspSettings,
): ExportAudioDspSettings => {
	return {
		exportSampleRate: normalizeExportAudioSampleRate(value?.exportSampleRate),
		exportBlockSize: normalizeExportAudioBlockSize(value?.exportBlockSize),
		masterGainDb: normalizeFiniteNumber(
			value?.masterGainDb,
			DEFAULT_EXPORT_AUDIO_DSP_SETTINGS.masterGainDb,
		),
		compressor: normalizeExportAudioCompressorConfig(value?.compressor),
	};
};

export const resolveExportAudioDspConfig = (
	value?: PartialExportAudioDspSettings,
): ExportAudioDspConfig => {
	return {
		...resolveExportAudioDspSettings(value),
		numberOfChannels: 2,
	};
};

export const cloneExportAudioDspSettings = (
	value: ExportAudioDspSettings,
): ExportAudioDspSettings => ({
	...value,
	compressor: { ...value.compressor },
});
