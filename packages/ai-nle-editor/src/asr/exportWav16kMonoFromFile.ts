import {
	ALL_FORMATS,
	AudioBufferSink,
	AudioBufferSource,
	BlobSource,
	BufferTarget,
	Input,
	Output,
	WavOutputFormat,
} from "mediabunny";
import { DEFAULT_TARGET_SAMPLE_RATE, mixToMono, resampleToTarget } from "./audioProcessing";

export async function exportWav16kMonoFromFile(options: {
	file: File;
	signal: AbortSignal;
}): Promise<Uint8Array> {
	const { file, signal } = options;
	if (signal.aborted) {
		throw new DOMException("已取消", "AbortError");
	}

	const input = new Input({
		source: new BlobSource(file),
		formats: ALL_FORMATS,
	});

	const audioTrack = await input.getPrimaryAudioTrack();
	if (!audioTrack) {
		throw new Error("未找到音频轨道");
	}
	if (audioTrack.codec === null) {
		throw new Error("不支持的音频编解码器");
	}
	if (!(await audioTrack.canDecode())) {
		throw new Error("无法解码音频轨道");
	}

	const audioSink = new AudioBufferSink(audioTrack);

	const target = new BufferTarget();
	const output = new Output({
		format: new WavOutputFormat(),
		target,
	});

	// whisper.cpp 的 whisper-cli 要求 16-bit WAV；这里用 pcm-s16 + 16kHz + mono。
	const source = new AudioBufferSource({
		codec: "pcm-s16",
	});
	output.addAudioTrack(source);
	await output.start();

	let failed = false;
	try {
		// buffers() 需要 duration 参数；这里通过 computeDuration 拿一个尽可能准确的值。
		const duration = await input.computeDuration();
		const totalDuration = Number.isFinite(duration) && duration > 0 ? duration : 1;

		for await (const wrappedBuffer of audioSink.buffers(0, totalDuration)) {
			if (signal.aborted) {
				throw new DOMException("已取消", "AbortError");
			}
			const buffer = wrappedBuffer?.buffer;
			if (!buffer) continue;

			const mono = mixToMono(buffer);
			const resampled = await resampleToTarget(
				mono,
				buffer.sampleRate,
				DEFAULT_TARGET_SAMPLE_RATE,
			);

			const outBuffer = new AudioBuffer({
				length: resampled.length,
				numberOfChannels: 1,
				sampleRate: DEFAULT_TARGET_SAMPLE_RATE,
			});
			// TS 的 TypedArray 泛型默认允许 SharedArrayBuffer，这里收窄到 ArrayBuffer 以满足 WebAudio API 签名。
			outBuffer.copyToChannel(resampled as Float32Array<ArrayBuffer>, 0);

			await source.add(outBuffer);
		}
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		// 确保输出流被关闭；如果主流程已失败，忽略 finalize 的二次错误以保留原始异常。
		try {
			await output.finalize();
		} catch (error) {
			if (!failed) throw error;
		}
	}

	if (!target.buffer) {
		throw new Error("导出失败：无法获取输出数据");
	}
	return new Uint8Array(target.buffer);
}
