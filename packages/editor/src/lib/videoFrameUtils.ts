import {
	COLOR_SPACE_PRESETS,
	getColorSpacePresetKey,
	type ColorMatrix,
	type ColorPrimaries,
	type ColorRange,
	type ColorSpaceDescriptor,
	type ColorTransfer,
} from "core";
import type { VideoSample, VideoSampleSink } from "mediabunny";
import {
	getSkiaRenderBackend,
	makeImageFromTextureSourceDirect,
	type SkImage,
	type TextureSourceImageOptions,
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

type RawVideoColorSpace = {
	fullRange?: boolean | null;
	matrix?: string | null;
	primaries?: string | null;
	transfer?: string | null;
	toJSON?: () => {
		fullRange?: boolean | null;
		matrix?: string | null;
		primaries?: string | null;
		transfer?: string | null;
	};
};

const normalizeVideoPrimaries = (
	value: string | null | undefined,
): ColorPrimaries => {
	switch (value) {
		case "display-p3":
		case "p3":
		case "smpte432":
			return "display-p3";
		case "bt2020":
			return "bt2020";
		case "bt709":
		case "bt470bg":
		case "smpte170m":
			return "srgb";
		default:
			return "unknown";
	}
};

const normalizeVideoTransfer = (
	value: string | null | undefined,
): ColorTransfer => {
	switch (value) {
		case "srgb":
		case "iec61966-2-1":
			return "srgb";
		case "bt709":
		case "smpte170m":
			return "bt709";
		case "pq":
		case "smpte2084":
			return "pq";
		case "hlg":
		case "arib-std-b67":
			return "hlg";
		case "linear":
			return "linear";
		default:
			return "unknown";
	}
};

const normalizeVideoMatrix = (
	value: string | null | undefined,
): ColorMatrix => {
	switch (value) {
		case "rgb":
			return "rgb";
		case "bt709":
		case "bt470bg":
		case "smpte170m":
			return "bt709";
		case "bt2020":
		case "bt2020-ncl":
			return "bt2020-ncl";
		default:
			return "unknown";
	}
};

const normalizeVideoRange = (
	fullRange: boolean | null | undefined,
): ColorRange => {
	if (fullRange === true) return "full";
	if (fullRange === false) return "limited";
	return "unknown";
};

const withPresetLabel = (
	descriptor: ColorSpaceDescriptor,
): ColorSpaceDescriptor => {
	const presetKey = getColorSpacePresetKey(descriptor);
	if (!presetKey || presetKey === "unknown") return descriptor;
	return {
		...descriptor,
		label: COLOR_SPACE_PRESETS[presetKey].label,
	};
};

export const normalizeVideoFrameColorSpace = (
	frame: Pick<VideoFrame, "colorSpace"> | null | undefined,
): ColorSpaceDescriptor => {
	const rawColorSpace = frame?.colorSpace as RawVideoColorSpace | undefined;
	const serialized = rawColorSpace?.toJSON?.() ?? rawColorSpace;
	return withPresetLabel({
		primaries: normalizeVideoPrimaries(serialized?.primaries),
		transfer: normalizeVideoTransfer(serialized?.transfer),
		matrix: normalizeVideoMatrix(serialized?.matrix),
		range: normalizeVideoRange(serialized?.fullRange),
	});
};

export interface ColorManagedVideoFrameImage {
	image: SkImage;
	sourceColorSpace: ColorSpaceDescriptor;
}

export const videoSampleToColorManagedSkImage = (
	sample: VideoSample,
	options?: TextureSourceImageOptions,
): ColorManagedVideoFrameImage | null => {
	let frame: VideoFrame | null = null;
	const shouldCloseFrameAfterUpload =
		getSkiaRenderBackend().kind === "webgpu";
	try {
		frame = sample.toVideoFrame();
		const sourceColorSpace = normalizeVideoFrameColorSpace(frame);
		const image = makeImageFromTextureSourceDirect(frame, {
			colorConversion: "browser",
			...options,
		});
		return image ? { image, sourceColorSpace } : null;
	} catch (error) {
		console.warn("VideoSample to SkImage failed:", error);
		closeVideoFrame(frame);
		return null;
	} finally {
		if (shouldCloseFrameAfterUpload) {
			// WebGPU 路径会先把外部帧拷进内部纹理，拷贝完成后即可释放 VideoFrame。
			closeVideoFrame(frame);
		}
		// sample 与生成出来的 VideoFrame 生命周期分离，这里只关闭 sample 本体。
		closeVideoSample(sample);
	}
};

export const videoSampleToSkImage = (
	sample: VideoSample,
	options?: TextureSourceImageOptions,
): SkImage | null => videoSampleToColorManagedSkImage(sample, options)?.image ?? null;
