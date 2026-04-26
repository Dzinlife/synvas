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

const RAW_VIDEO_PROBE_FORMATS = ["I420", "NV12"] as const;
const RAW_VIDEO_PROBE_MAX_COPY_BYTES = 64 * 1024 * 1024;
const probedVideoRawAccessKeys = new Set<string>();

type RawVideoProbeFormat = "native" | (typeof RAW_VIDEO_PROBE_FORMATS)[number];

interface RawVideoCopySource {
	allocationSize(options?: VideoFrameCopyToOptions): number;
	copyTo(
		destination: AllowSharedBufferSource,
		options?: VideoFrameCopyToOptions,
	): Promise<PlaneLayout[]>;
}

interface VideoRawAccessProbeAttempt {
	format: RawVideoProbeFormat;
	allocationSize?: number;
	allocationError?: string;
	copySupported?: boolean;
	copyError?: string;
	copySkipped?: string;
	layouts?: Array<Pick<PlaneLayout, "offset" | "stride">>;
}

export interface VideoRawFrameAccessProbeResult {
	label?: string;
	key: string;
	sample: {
		format: string | null;
		timestamp: number | null;
		duration: number | null;
		codedWidth: number | null;
		codedHeight: number | null;
		displayWidth: number | null;
		displayHeight: number | null;
		rotation: number | null;
		visibleRect: ReturnType<typeof serializeRect>;
		colorSpace: ReturnType<typeof serializeRawVideoColorSpace>;
	};
	frame?: {
		format: string | null;
		codedWidth: number | null;
		codedHeight: number | null;
		displayWidth: number | null;
		displayHeight: number | null;
		visibleRect: ReturnType<typeof serializeRect>;
		colorSpace: ReturnType<typeof serializeRawVideoColorSpace>;
		normalizedColorSpace: ColorSpaceDescriptor;
	};
	access: {
		sample: VideoRawAccessProbeAttempt[];
		videoFrame: VideoRawAccessProbeAttempt[];
	};
	error?: string;
}

export interface ProbeVideoRawFrameAccessOptions {
	key?: string;
	label?: string;
	force?: boolean;
}

const describeRawProbeError = (error: unknown): string => {
	if (error instanceof Error) {
		return `${error.name}: ${error.message}`;
	}
	return String(error);
};

const serializeRawVideoColorSpace = (
	value: RawVideoColorSpace | null | undefined,
) => value?.toJSON?.() ?? value ?? null;

type RectLike =
	| {
			x?: number;
			y?: number;
			left?: number;
			top?: number;
			width?: number;
			height?: number;
	  }
	| null
	| undefined;

const serializeRect = (rect: RectLike) => {
	if (!rect) return null;
	return {
		x: rect.x ?? rect.left ?? 0,
		y: rect.y ?? rect.top ?? 0,
		width: rect.width ?? 0,
		height: rect.height ?? 0,
	};
};

const getFiniteNumber = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const createRawProbeKey = (sample: VideoSample): string => {
	const colorSpace = serializeRawVideoColorSpace(
		sample.colorSpace as RawVideoColorSpace | undefined,
	);
	return JSON.stringify({
		format: sample.format ?? null,
		codedWidth: sample.codedWidth,
		codedHeight: sample.codedHeight,
		displayWidth: sample.displayWidth,
		displayHeight: sample.displayHeight,
		colorSpace,
	});
};

const createCopyOptions = (
	format: RawVideoProbeFormat,
): VideoFrameCopyToOptions | undefined => {
	if (format === "native") return undefined;
	return { format: format as VideoPixelFormat };
};

const probeCopySource = async (
	source: RawVideoCopySource,
): Promise<VideoRawAccessProbeAttempt[]> => {
	const attempts: VideoRawAccessProbeAttempt[] = [];
	const formats: RawVideoProbeFormat[] = ["native", ...RAW_VIDEO_PROBE_FORMATS];
	for (const format of formats) {
		const options = createCopyOptions(format);
		const attempt: VideoRawAccessProbeAttempt = { format };
		attempts.push(attempt);

		try {
			attempt.allocationSize = source.allocationSize(options);
		} catch (error) {
			attempt.allocationError = describeRawProbeError(error);
			continue;
		}

		if (
			!Number.isFinite(attempt.allocationSize) ||
			attempt.allocationSize < 0
		) {
			attempt.copySkipped = "invalid allocation size";
			continue;
		}

		if (attempt.allocationSize > RAW_VIDEO_PROBE_MAX_COPY_BYTES) {
			attempt.copySkipped = `allocation exceeds ${RAW_VIDEO_PROBE_MAX_COPY_BYTES} bytes`;
			continue;
		}

		try {
			const destination = new Uint8Array(attempt.allocationSize);
			const layouts = await source.copyTo(destination, options);
			attempt.copySupported = true;
			attempt.layouts = layouts.map(({ offset, stride }) => ({
				offset,
				stride,
			}));
		} catch (error) {
			attempt.copySupported = false;
			attempt.copyError = describeRawProbeError(error);
		}
	}
	return attempts;
};

export const probeVideoRawFrameAccess = async (
	sample: VideoSample,
	options: ProbeVideoRawFrameAccessOptions = {},
): Promise<VideoRawFrameAccessProbeResult | null> => {
	const key = options.key ?? createRawProbeKey(sample);
	if (!options.force && probedVideoRawAccessKeys.has(key)) return null;
	probedVideoRawAccessKeys.add(key);

	let clonedSample: VideoSample | null = null;
	let frame: VideoFrame | null = null;
	const result: VideoRawFrameAccessProbeResult = {
		label: options.label,
		key,
		sample: {
			format: sample.format ?? null,
			timestamp: getFiniteNumber(sample.timestamp),
			duration: getFiniteNumber(sample.duration),
			codedWidth: getFiniteNumber(sample.codedWidth),
			codedHeight: getFiniteNumber(sample.codedHeight),
			displayWidth: getFiniteNumber(sample.displayWidth),
			displayHeight: getFiniteNumber(sample.displayHeight),
			rotation: getFiniteNumber(sample.rotation),
			visibleRect: serializeRect(sample.visibleRect),
			colorSpace: serializeRawVideoColorSpace(
				sample.colorSpace as RawVideoColorSpace | undefined,
			),
		},
		access: {
			sample: [],
			videoFrame: [],
		},
	};

	try {
		clonedSample = sample.clone();
		frame = clonedSample.toVideoFrame();
		result.frame = {
			format: frame.format ?? null,
			codedWidth: getFiniteNumber(frame.codedWidth),
			codedHeight: getFiniteNumber(frame.codedHeight),
			displayWidth: getFiniteNumber(frame.displayWidth),
			displayHeight: getFiniteNumber(frame.displayHeight),
			visibleRect: serializeRect(frame.visibleRect),
			colorSpace: serializeRawVideoColorSpace(
				frame.colorSpace as RawVideoColorSpace | undefined,
			),
			normalizedColorSpace: normalizeVideoFrameColorSpace(frame),
		};

		result.access.sample = await probeCopySource(clonedSample);
		result.access.videoFrame = await probeCopySource(frame);
	} catch (error) {
		result.error = describeRawProbeError(error);
	} finally {
		closeVideoFrame(frame);
		closeVideoSample(clonedSample);
	}

	console.info("[VideoRawProbe] raw frame access", result);
	return result;
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
	const shouldCloseFrameAfterUpload = getSkiaRenderBackend().kind === "webgpu";
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
): SkImage | null =>
	videoSampleToColorManagedSkImage(sample, options)?.image ?? null;
