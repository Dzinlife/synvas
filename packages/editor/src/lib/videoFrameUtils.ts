import type { VideoSample, VideoSampleSink } from "mediabunny";
import {
	makeImageFromTextureSourceDirect,
	type SkImage,
} from "react-skia-lite";

export const closeVideoSample = (sample: VideoSample | null | undefined) => {
	try {
		sample?.close();
	} catch {}
};

export const closeVideoFrame = (frame: VideoFrame | null | undefined) => {
	try {
		frame?.close();
	} catch {}
};

export const getVideoSampleAfterTime = async (
	videoSampleSink: Pick<VideoSampleSink, "samples">,
	time: number,
): Promise<VideoSample | null> => {
	let iterator: AsyncGenerator<VideoSample, void, unknown> | null = null;
	try {
		iterator = videoSampleSink.samples(time);
		const first = await iterator.next();
		return first.value ?? null;
	} finally {
		await iterator?.return?.();
	}
};

export const videoSampleToSkImage = (
	sample: VideoSample,
): SkImage | null => {
	let frame: VideoFrame | null = null;
	try {
		frame = sample.toVideoFrame();
		return makeImageFromTextureSourceDirect(frame);
	} catch (error) {
		console.warn("VideoSample to SkImage failed:", error);
		closeVideoFrame(frame);
		return null;
	} finally {
		// sample 与生成出来的 VideoFrame 生命周期分离，这里只关闭 sample 本体。
		closeVideoSample(sample);
	}
};
