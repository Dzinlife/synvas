import {
	mixTargetsIntoBlock,
	type PreparedMixTarget,
} from "core/editor/audio/dsp/blockMixer";
import {
	createCompressorState,
	processCompressorInPlace,
} from "core/editor/audio/dsp/effects/compressor";
import { resampleAudioBufferToInterleaved } from "core/editor/audio/dsp/resampler";
import { describe, expect, it } from "vitest";

const createMockAudioBuffer = ({
	sampleRate,
	channels,
}: {
	sampleRate: number;
	channels: Float32Array[];
}): AudioBuffer => {
	const length = channels[0]?.length ?? 0;
	return {
		sampleRate,
		numberOfChannels: channels.length,
		length,
		duration: length / sampleRate,
		getChannelData(index: number) {
			return channels[index] ?? new Float32Array(length);
		},
	} as unknown as AudioBuffer;
};

describe("audio dsp core", () => {
	it("resampler 应将 44.1k 单声道转为 48k 双声道", () => {
		const sourceFrames = 44_100;
		const source = new Float32Array(sourceFrames);
		for (let i = 0; i < sourceFrames; i += 1) {
			source[i] = i / sourceFrames;
		}
		const buffer = createMockAudioBuffer({
			sampleRate: 44_100,
			channels: [source],
		});

		const resampled = resampleAudioBufferToInterleaved({
			source: buffer,
			targetSampleRate: 48_000,
			targetNumberOfChannels: 2,
		});

		expect(resampled.sampleRate).toBe(48_000);
		expect(resampled.numberOfChannels).toBe(2);
		expect(resampled.numberOfFrames).toBe(48_000);
		expect(Number.isFinite(resampled.data[1234] ?? NaN)).toBe(true);
		expect(resampled.data[4000]).toBeCloseTo(resampled.data[4001], 6);
	});

	it("block mixer 在帧边界应连续变化，不出现突刺", () => {
		const sampleRate = 48_000;
		const fps = 30;
		const frameSamples = sampleRate / fps;
		const sourceFrames = Math.round(frameSamples * 4);
		const sourceData = new Float32Array(sourceFrames * 2).fill(1);
		const target: PreparedMixTarget = {
			id: "a",
			enabled: true,
			clipStartSeconds: 0,
			clipOffsetSeconds: 0,
			decodeStartSeconds: 0,
			decodeEndSeconds: sourceFrames / sampleRate,
			sourceData,
			sourceFrameCount: sourceFrames,
			gains: Float32Array.from([0, 1, 1]),
		};
		const outputFrames = Math.round(frameSamples * 2);
		const output = new Float32Array(outputFrames * 2);

		mixTargetsIntoBlock({
			targets: [target],
			output,
			outputStartFrame: 0,
			outputFrameCount: outputFrames,
			outputSampleRate: sampleRate,
			numberOfChannels: 2,
			exportStartSeconds: 0,
			fps,
		});

		const boundary = Math.round(frameSamples);
		const left = output[(boundary - 1) * 2] ?? 0;
		const right = output[boundary * 2] ?? 0;
		expect(output[0]).toBeCloseTo(0, 5);
		expect(right).toBeGreaterThanOrEqual(left);
		expect(Math.abs(right - left)).toBeLessThan(0.01);
	});

	it("compressor 开启后应压低高电平信号", () => {
		const sampleRate = 48_000;
		const numberOfChannels = 2;
		const frameCount = 4_800;
		const data = new Float32Array(frameCount * numberOfChannels).fill(1);
		const state = createCompressorState({
			config: {
				enabled: true,
				thresholdDb: -24,
				ratio: 6,
				kneeDb: 6,
				attackMs: 0.1,
				releaseMs: 80,
				makeupGainDb: 0,
			},
			sampleRate,
		});

		processCompressorInPlace({
			data,
			numberOfChannels,
			config: {
				enabled: true,
				thresholdDb: -24,
				ratio: 6,
				kneeDb: 6,
				attackMs: 0.1,
				releaseMs: 80,
				makeupGainDb: 0,
			},
			state,
		});

		let peak = 0;
		for (let i = 0; i < data.length; i += 1) {
			peak = Math.max(peak, Math.abs(data[i] ?? 0));
		}
		expect(peak).toBeLessThan(0.7);
	});
});
