export const DEFAULT_TARGET_SAMPLE_RATE = 16000;

export const mixToMono = (buffer: AudioBuffer): Float32Array => {
	if (buffer.numberOfChannels === 1) {
		return buffer.getChannelData(0).slice();
	}
	const length = buffer.length;
	const output = new Float32Array(length);
	for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
		const data = buffer.getChannelData(channel);
		for (let i = 0; i < length; i += 1) {
			output[i] += data[i];
		}
	}
	for (let i = 0; i < length; i += 1) {
		output[i] /= buffer.numberOfChannels;
	}
	return output;
};

const resampleLinear = (
	samples: Float32Array,
	sourceRate: number,
	targetRate: number,
): Float32Array => {
	if (sourceRate === targetRate) return samples;
	const ratio = sourceRate / targetRate;
	const targetLength = Math.max(1, Math.round(samples.length / ratio));
	const output = new Float32Array(targetLength);
	for (let i = 0; i < targetLength; i += 1) {
		const srcIndex = i * ratio;
		const left = Math.floor(srcIndex);
		const right = Math.min(samples.length - 1, left + 1);
		const t = srcIndex - left;
		output[i] = (1 - t) * samples[left] + t * samples[right];
	}
	return output;
};

export const resampleToTarget = async (
	monoSamples: Float32Array,
	sourceRate: number,
	targetRate: number,
): Promise<Float32Array> => {
	if (sourceRate === targetRate) return monoSamples;

	type OfflineAudioContextConstructor = typeof OfflineAudioContext;
	const OfflineAudioContextImpl =
		globalThis.OfflineAudioContext ||
		(
			globalThis as typeof globalThis & {
				webkitOfflineAudioContext?: OfflineAudioContextConstructor;
			}
		).webkitOfflineAudioContext;

	// 在大多数现代浏览器/Chromium 中可用；不可用时退化为线性插值重采样。
	if (!OfflineAudioContextImpl) {
		return resampleLinear(monoSamples, sourceRate, targetRate);
	}

	const duration = monoSamples.length / sourceRate;
	const targetLength = Math.max(1, Math.round(duration * targetRate));
	const context = new OfflineAudioContextImpl(1, targetLength, targetRate);

	const buffer = context.createBuffer(1, monoSamples.length, sourceRate);
	// TS 的 TypedArray 泛型默认允许 SharedArrayBuffer，这里收窄到 ArrayBuffer 以满足 WebAudio API 签名。
	buffer.copyToChannel(monoSamples as Float32Array<ArrayBuffer>, 0);
	const source = context.createBufferSource();
	source.buffer = buffer;
	source.connect(context.destination);
	source.start(0);

	const rendered: AudioBuffer = await context.startRendering();
	return rendered.getChannelData(0);
};
