const resolveSourceSample = (
	channels: readonly Float32Array[],
	sourceChannelCount: number,
	frameIndex: number,
	targetChannelIndex: number,
): number => {
	if (sourceChannelCount === 0) return 0;
	if (sourceChannelCount === 1) {
		return channels[0]?.[frameIndex] ?? 0;
	}
	if (targetChannelIndex < sourceChannelCount) {
		return channels[targetChannelIndex]?.[frameIndex] ?? 0;
	}
	if (targetChannelIndex === 0) {
		let sum = 0;
		for (let i = 0; i < sourceChannelCount; i += 1) {
			sum += channels[i]?.[frameIndex] ?? 0;
		}
		return sum / sourceChannelCount;
	}
	return 0;
};

export type ResampledInterleavedBuffer = {
	numberOfChannels: number;
	numberOfFrames: number;
	sampleRate: number;
	data: Float32Array;
};

export const resampleAudioBufferToInterleaved = ({
	source,
	targetSampleRate,
	targetNumberOfChannels,
}: {
	source: AudioBuffer;
	targetSampleRate: number;
	targetNumberOfChannels: number;
}): ResampledInterleavedBuffer => {
	const sourceSampleRate = Number.isFinite(source.sampleRate)
		? source.sampleRate
		: targetSampleRate;
	const sourceChannelCount = Math.max(1, source.numberOfChannels || 1);
	const sourceFrameCount = Math.max(0, source.length || 0);
	const safeTargetRate = Math.max(1, Math.round(targetSampleRate));
	const safeTargetChannels = Math.max(1, Math.round(targetNumberOfChannels));

	if (sourceFrameCount <= 0) {
		return {
			numberOfChannels: safeTargetChannels,
			numberOfFrames: 0,
			sampleRate: safeTargetRate,
			data: new Float32Array(0),
		};
	}

	const outputFrameCount = Math.max(
		1,
		Math.round((sourceFrameCount * safeTargetRate) / sourceSampleRate),
	);
	const output = new Float32Array(outputFrameCount * safeTargetChannels);

	const sourceChannels = Array.from(
		{ length: sourceChannelCount },
		(_, index) => source.getChannelData(index),
	);

	if (
		sourceSampleRate === safeTargetRate &&
		sourceChannelCount === safeTargetChannels
	) {
		for (let frame = 0; frame < outputFrameCount; frame += 1) {
			const base = frame * safeTargetChannels;
			for (let channel = 0; channel < safeTargetChannels; channel += 1) {
				output[base + channel] = sourceChannels[channel]?.[frame] ?? 0;
			}
		}
		return {
			numberOfChannels: safeTargetChannels,
			numberOfFrames: outputFrameCount,
			sampleRate: safeTargetRate,
			data: output,
		};
	}

	const maxSourceIndex = Math.max(0, sourceFrameCount - 1);
	const sourceStep = sourceSampleRate / safeTargetRate;
	for (let outFrame = 0; outFrame < outputFrameCount; outFrame += 1) {
		const sourcePos = outFrame * sourceStep;
		const sourceLower = Math.min(maxSourceIndex, Math.floor(sourcePos));
		const sourceUpper = Math.min(maxSourceIndex, sourceLower + 1);
		const sourceMix = sourcePos - sourceLower;
		const outBase = outFrame * safeTargetChannels;

		for (let channel = 0; channel < safeTargetChannels; channel += 1) {
			const lower = resolveSourceSample(
				sourceChannels,
				sourceChannelCount,
				sourceLower,
				channel,
			);
			const upper = resolveSourceSample(
				sourceChannels,
				sourceChannelCount,
				sourceUpper,
				channel,
			);
			output[outBase + channel] = lower + (upper - lower) * sourceMix;
		}
	}

	return {
		numberOfChannels: safeTargetChannels,
		numberOfFrames: outputFrameCount,
		sampleRate: safeTargetRate,
		data: output,
	};
};
