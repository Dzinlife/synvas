const AUDIO_EPSILON = 1e-6;

export type PreparedMixTarget = {
	id: string;
	enabled: boolean;
	clipStartSeconds: number;
	clipOffsetSeconds: number;
	clipDurationSeconds: number;
	reversed: boolean;
	decodeStartSeconds: number;
	decodeEndSeconds: number;
	sourceData: Float32Array;
	sourceFrameCount: number;
	gains: Float32Array;
};

const clamp01 = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
};

const resolveGainAtFrame = ({
	gains,
	frameFloat,
}: {
	gains: Float32Array;
	frameFloat: number;
}): number => {
	if (!Number.isFinite(frameFloat) || frameFloat < 0) return 0;
	const baseIndex = Math.floor(frameFloat);
	if (baseIndex >= gains.length) return 0;
	const ratio = frameFloat - baseIndex;
	const g0 = clamp01(gains[baseIndex] ?? 0);
	const g1 = clamp01(gains[baseIndex + 1] ?? 0);
	return g0 + (g1 - g0) * ratio;
};

export const mixTargetsIntoBlock = ({
	targets,
	output,
	outputStartFrame,
	outputFrameCount,
	outputSampleRate,
	numberOfChannels,
	exportStartSeconds,
	fps,
}: {
	targets: PreparedMixTarget[];
	output: Float32Array;
	outputStartFrame: number;
	outputFrameCount: number;
	outputSampleRate: number;
	numberOfChannels: number;
	exportStartSeconds: number;
	fps: number;
}) => {
	output.fill(0);
	if (targets.length === 0) return;
	const safeChannels = Math.max(1, numberOfChannels);
	const safeSampleRate = Math.max(1, outputSampleRate);
	const gainStep = fps / safeSampleRate;

	for (const target of targets) {
		if (!target.enabled) continue;
		if (target.sourceFrameCount <= 0) continue;
		if (target.decodeEndSeconds - target.decodeStartSeconds <= AUDIO_EPSILON) {
			continue;
		}

		const initialTimelineTime =
			exportStartSeconds + outputStartFrame / safeSampleRate;
		const initialSourceTime = target.reversed
			? target.clipOffsetSeconds +
				target.clipDurationSeconds -
				(initialTimelineTime - target.clipStartSeconds)
			: target.clipOffsetSeconds +
				(initialTimelineTime - target.clipStartSeconds);
		let sourceFrameFloat =
			(initialSourceTime - target.decodeStartSeconds) * safeSampleRate;
		const sourceStep = target.reversed ? -1 : 1;
		let gainFrameFloat = outputStartFrame * gainStep;
		const sourceLastFrame = target.sourceFrameCount - 1;

		for (let frame = 0; frame < outputFrameCount; frame += 1) {
			const gain = resolveGainAtFrame({
				gains: target.gains,
				frameFloat: gainFrameFloat,
			});
			if (gain > AUDIO_EPSILON) {
				const sourceLower = Math.floor(sourceFrameFloat);
				if (sourceLower >= 0 && sourceLower <= sourceLastFrame) {
					const sourceUpper = Math.min(sourceLastFrame, sourceLower + 1);
					const sourceMix = sourceFrameFloat - sourceLower;
					const outBase = frame * safeChannels;
					const sourceBaseLower = sourceLower * safeChannels;
					const sourceBaseUpper = sourceUpper * safeChannels;

					for (let channel = 0; channel < safeChannels; channel += 1) {
						const lower = target.sourceData[sourceBaseLower + channel] ?? 0;
						const upper = target.sourceData[sourceBaseUpper + channel] ?? 0;
						const sample = lower + (upper - lower) * sourceMix;
						output[outBase + channel] += sample * gain;
					}
				}
			}

			sourceFrameFloat += sourceStep;
			gainFrameFloat += gainStep;
		}
	}
};
