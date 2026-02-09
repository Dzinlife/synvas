import {
	type AudioBufferSink,
	AudioBufferSource,
	BufferTarget,
	CanvasSource,
	Mp4OutputFormat,
	Output,
	QUALITY_HIGH,
	StreamTarget,
	type WrappedAudioBuffer,
} from "mediabunny";
import { JsiSkSurface, Skia, SkiaSGRoot } from "react-skia-lite";
import type { TimelineElement } from "../dsl/types";
import { framesToSeconds } from "../utils/timecode";
import {
	type AudioMixClip,
	type AudioMixInstruction,
	buildTransitionAudioMixPlan,
	type TransitionAudioCurve,
} from "./audio/transitionAudioMix";
import type { buildSkiaRenderStateCore } from "./preview/buildSkiaTree";
import type { TransitionFrameState } from "./preview/transitionFrameState";
import type { TimelineTrack } from "./timeline/types";
import type { AudioTrackControlStateMap } from "./utils/audioTrackState";
import { isTimelineTrackAudible } from "./utils/trackAudibility";
import { isVideoSourceAudioMuted } from "./utils/videoSourceAudio";

export type BuildSkiaRenderState = (
	args: Parameters<typeof buildSkiaRenderStateCore>[0],
) => ReturnType<typeof buildSkiaRenderStateCore>;

export type ExportElementAudioSource = {
	audioSink: AudioBufferSink | null;
	audioDuration: number;
};

export type ExportTimelineAudioOptions = {
	audioTrackStates?: AudioTrackControlStateMap;
	getAudioSourceByElementId?: (
		elementId: string,
	) => ExportElementAudioSource | null | undefined;
};

export type ExportTimelineAsVideoOptions = {
	elements: TimelineElement[];
	tracks: TimelineTrack[];
	fps: number;
	canvasSize: { width: number; height: number };
	buildSkiaRenderState: BuildSkiaRenderState;
	filename?: string;
	startFrame?: number;
	endFrame?: number;
	audio?: ExportTimelineAudioOptions;
	getModelStore?: NonNullable<
		Parameters<typeof buildSkiaRenderStateCore>[0]["prepare"]
	>["getModelStore"];
	waitForReady?: () => Promise<void>;
	onFrame?: (frame: number) => void;
};

type ExportAudioTarget = {
	id: string;
	timeline: TimelineElement["timeline"];
	audioSink: AudioBufferSink;
	audioDuration: number;
	enabled: boolean;
	gains: Float32Array;
	hasAudibleFrame: boolean;
	sourceRangeStart: number;
	sourceRangeEnd: number;
};

const AUDIO_EPSILON = 1e-6;
const FALLBACK_OFFLINE_SAMPLE_RATE = 48_000;

const getTrackIndexForElement = (element: TimelineElement) =>
	element.timeline.trackIndex ?? 0;

const sortByTrackIndex = (items: TimelineElement[]) => {
	return items
		.map((el, index) => ({
			el,
			index,
			trackIndex: getTrackIndexForElement(el),
		}))
		.sort((a, b) => {
			if (a.trackIndex !== b.trackIndex) {
				return a.trackIndex - b.trackIndex;
			}
			return a.index - b.index;
		})
		.map(({ el }) => el);
};

const cleanupWebGLContext = (canvas: HTMLCanvasElement | OffscreenCanvas) => {
	const ctx = canvas.getContext("webgl2") as WebGL2RenderingContext;
	if (!ctx) return;
	const loseContext = ctx.getExtension("WEBGL_lose_context");
	loseContext?.loseContext();
};

const DOWNLOAD_URL_REVOKE_DELAY_MS = 60_000;
const OPFS_CLEANUP_DELAY_MS = 10 * 60_000;

const createWebGLSurfaceForExport = (
	canvas: HTMLCanvasElement | OffscreenCanvas,
	width: number,
	height: number,
): {
	surface: JsiSkSurface;
	canvas: HTMLCanvasElement | OffscreenCanvas;
} | null => {
	if (canvas.width !== width) {
		canvas.width = width;
	}
	if (canvas.height !== height) {
		canvas.height = height;
	}

	let surface: JsiSkSurface | null = null;
	try {
		const canvasKit = (globalThis as { CanvasKit?: any }).CanvasKit;
		if (!canvasKit?.MakeWebGLCanvasSurface) {
			throw new Error("CanvasKit 未初始化");
		}
		const ctx = canvas.getContext("webgl2") as WebGL2RenderingContext;
		if (ctx) {
			ctx.drawingBufferColorSpace = "display-p3";
		}
		const webglSurface = canvasKit.MakeWebGLCanvasSurface(canvas);
		if (!webglSurface) {
			throw new Error("无法创建 WebGL Surface");
		}
		surface = new JsiSkSurface(canvasKit, webglSurface);
		return { surface, canvas };
	} catch {
		if (surface) {
			surface.ref.delete();
		}
		cleanupWebGLContext(canvas);
		return null;
	}
};

const downloadBlob = (blob: Blob, filename: string): void => {
	const link = document.createElement("a");
	const url = URL.createObjectURL(blob);
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
};

const scheduleDeferredCleanup = (target: ExportOutputTarget): void => {
	setTimeout(() => {
		void target.cleanup();
	}, OPFS_CLEANUP_DELAY_MS);
};

type ExportOutputTarget = {
	kind: "opfs-stream" | "buffer-memory";
	target: BufferTarget | StreamTarget;
	resolveBlob: () => Promise<Blob>;
	cleanup: () => Promise<void>;
};

const createBufferExportTarget = (): ExportOutputTarget => {
	const target = new BufferTarget();
	return {
		kind: "buffer-memory",
		target,
		resolveBlob: async () => {
			if (!target.buffer) {
				throw new Error("导出失败：无法获取输出数据");
			}
			return new Blob([target.buffer], { type: "video/mp4" });
		},
		cleanup: async () => {},
	};
};

const createOpfsExportTarget = async (): Promise<ExportOutputTarget | null> => {
	const nav = (globalThis as { navigator?: any }).navigator;
	const getDirectory = nav?.storage?.getDirectory;
	if (typeof getDirectory !== "function") return null;
	if (typeof WritableStream === "undefined") return null;

	try {
		const root = await getDirectory.call(nav.storage);
		const exportDir = await root.getDirectoryHandle(".ai-nle-export", {
			create: true,
		});
		const tempName = `timeline-${Date.now()}-${Math.random()
			.toString(36)
			.slice(2)}.mp4`;
		const fileHandle = await exportDir.getFileHandle(tempName, {
			create: true,
		});
		const writable = await fileHandle.createWritable();
		if (!(writable instanceof WritableStream)) {
			await writable.close?.();
			return null;
		}

		const target = new StreamTarget(writable, {
			chunked: true,
		});
		return {
			kind: "opfs-stream",
			target,
			resolveBlob: async () => {
				return fileHandle.getFile();
			},
			cleanup: async () => {
				try {
					await exportDir.removeEntry(tempName);
				} catch {}
			},
		};
	} catch (error) {
		console.warn("创建 OPFS 导出目标失败，将回退内存导出:", error);
		return null;
	}
};

const createExportOutputTarget = async (): Promise<ExportOutputTarget> => {
	const opfsTarget = await createOpfsExportTarget();
	if (opfsTarget) return opfsTarget;
	return createBufferExportTarget();
};

const clampGain = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
};

const resolveTransitionCurve = (
	value: unknown,
): TransitionAudioCurve | undefined => {
	if (value === "equal-power" || value === "linear") {
		return value;
	}
	return undefined;
};

const collectTransitionCurveById = (
	elements: TimelineElement[],
): Record<string, TransitionAudioCurve | undefined> => {
	const curveById: Record<string, TransitionAudioCurve | undefined> = {};
	for (const element of elements) {
		if (element.type !== "Transition") continue;
		curveById[element.id] = resolveTransitionCurve(
			(element.props as { audioCurve?: unknown } | undefined)?.audioCurve,
		);
	}
	return curveById;
};

const collectExportAudioTargets = (
	options: ExportTimelineAsVideoOptions,
	totalFrames: number,
): ExportAudioTarget[] => {
	const getAudioSource = options.audio?.getAudioSourceByElementId;
	if (!getAudioSource) return [];
	const audioTrackStates = options.audio?.audioTrackStates ?? {};

	const targets: ExportAudioTarget[] = [];
	for (const element of options.elements) {
		if (element.type !== "AudioClip" && element.type !== "VideoClip") continue;
		const source = getAudioSource(element.id);
		if (!source?.audioSink) continue;
		if (!Number.isFinite(source.audioDuration) || source.audioDuration <= 0)
			continue;

		const enabled =
			isTimelineTrackAudible(
				element.timeline,
				options.tracks,
				audioTrackStates,
			) && !(element.type === "VideoClip" && isVideoSourceAudioMuted(element));

		targets.push({
			id: element.id,
			timeline: element.timeline,
			audioSink: source.audioSink,
			audioDuration: source.audioDuration,
			enabled,
			gains: new Float32Array(totalFrames),
			hasAudibleFrame: false,
			sourceRangeStart: Number.POSITIVE_INFINITY,
			sourceRangeEnd: 0,
		});
	}
	return targets;
};

const applyAudioMixPlanAtFrame = ({
	frame,
	startFrame,
	fps,
	audioClips,
	audioTargetsById,
	transitionFrameState,
	transitionCurveById,
}: {
	frame: number;
	startFrame: number;
	fps: number;
	audioClips: AudioMixClip[];
	audioTargetsById: Map<string, ExportAudioTarget>;
	transitionFrameState: TransitionFrameState;
	transitionCurveById: Record<string, TransitionAudioCurve | undefined>;
}) => {
	const plan = buildTransitionAudioMixPlan({
		displayTimeFrames: frame,
		fps,
		clips: audioClips,
		activeTransitions: transitionFrameState.activeTransitions,
		transitionCurves: transitionCurveById,
	});
	const frameIndex = frame - startFrame;
	if (frameIndex < 0) return;

	for (const clip of audioClips) {
		const target = audioTargetsById.get(clip.id);
		if (!target) continue;

		const instruction: AudioMixInstruction | undefined =
			plan.instructions[clip.id];
		if (!instruction) {
			target.gains[frameIndex] = 0;
			continue;
		}

		const gain = clampGain(instruction.gain);
		target.gains[frameIndex] = gain;
		if (gain > 0) {
			target.hasAudibleFrame = true;
		}

		if (!instruction.sourceRange) continue;
		const sourceStart = instruction.sourceRange.start;
		const sourceEnd = instruction.sourceRange.end;
		if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd)) continue;

		target.sourceRangeStart = Math.min(target.sourceRangeStart, sourceStart);
		target.sourceRangeEnd = Math.max(target.sourceRangeEnd, sourceEnd);
	}
};

const decodeTargetAudioChunks = async (
	target: ExportAudioTarget,
): Promise<WrappedAudioBuffer[]> => {
	const decodeStart = Math.max(0, target.sourceRangeStart);
	const decodeEnd = Math.min(target.audioDuration, target.sourceRangeEnd);
	if (decodeEnd - decodeStart <= AUDIO_EPSILON) {
		return [];
	}

	const chunks: WrappedAudioBuffer[] = [];
	for await (const wrapped of target.audioSink.buffers(
		decodeStart,
		decodeEnd,
	)) {
		const buffer = wrapped?.buffer;
		if (!buffer) continue;
		const timestamp = Number.isFinite(wrapped.timestamp)
			? wrapped.timestamp
			: 0;
		const duration =
			Number.isFinite(wrapped.duration) && wrapped.duration > 0
				? wrapped.duration
				: buffer.duration;

		const chunkEnd = timestamp + duration;
		if (chunkEnd <= decodeStart + AUDIO_EPSILON) continue;
		if (timestamp >= decodeEnd - AUDIO_EPSILON) continue;

		chunks.push({
			buffer,
			timestamp,
			duration,
		});
	}
	return chunks;
};

const applyGainAutomationByFrame = ({
	gainParam,
	gains,
	fps,
	exportDuration,
}: {
	gainParam: AudioParam;
	gains: Float32Array;
	fps: number;
	exportDuration: number;
}) => {
	const frameDuration = 1 / fps;
	gainParam.cancelScheduledValues(0);
	gainParam.setValueAtTime(0, 0);

	for (let i = 0; i < gains.length; i += 1) {
		const t0 = Math.min(exportDuration, i * frameDuration);
		const t1 = Math.min(exportDuration, (i + 1) * frameDuration);
		const g0 = clampGain(gains[i] ?? 0);
		const g1 = clampGain(i + 1 < gains.length ? (gains[i + 1] ?? 0) : 0);

		gainParam.setValueAtTime(g0, t0);
		if (t1 > t0) {
			gainParam.linearRampToValueAtTime(g1, t1);
		}
	}

	gainParam.setValueAtTime(0, exportDuration);
};

const mixAudioTargetsForExport = async ({
	targets,
	startFrame,
	endFrame,
	fps,
}: {
	targets: ExportAudioTarget[];
	startFrame: number;
	endFrame: number;
	fps: number;
}): Promise<AudioBuffer | null> => {
	if (typeof OfflineAudioContext === "undefined") {
		console.warn("导出音频混音失败：当前环境不支持 OfflineAudioContext");
		return null;
	}

	const activeTargets = targets.filter(
		(target) =>
			target.enabled &&
			target.hasAudibleFrame &&
			target.sourceRangeEnd - target.sourceRangeStart > AUDIO_EPSILON,
	);
	if (activeTargets.length === 0) return null;

	const decodedChunksById = new Map<string, WrappedAudioBuffer[]>();
	let maxChannels = 1;
	let sampleRate = FALLBACK_OFFLINE_SAMPLE_RATE;

	for (const target of activeTargets) {
		try {
			const chunks = await decodeTargetAudioChunks(target);
			if (chunks.length === 0) continue;
			decodedChunksById.set(target.id, chunks);
			for (const chunk of chunks) {
				maxChannels = Math.max(maxChannels, chunk.buffer.numberOfChannels);
				if (
					Number.isFinite(chunk.buffer.sampleRate) &&
					chunk.buffer.sampleRate > 0
				) {
					sampleRate = chunk.buffer.sampleRate;
				}
			}
		} catch (error) {
			console.warn(`导出音频解码失败（${target.id}），已跳过该片段:`, error);
		}
	}

	if (decodedChunksById.size === 0) return null;

	const exportDuration = framesToSeconds(endFrame - startFrame, fps);
	if (exportDuration <= AUDIO_EPSILON) return null;
	const exportStartSeconds = framesToSeconds(startFrame, fps);

	const offlineContext = new OfflineAudioContext(
		Math.max(1, maxChannels),
		Math.max(1, Math.ceil(exportDuration * sampleRate)),
		sampleRate,
	);

	for (const target of activeTargets) {
		const chunks = decodedChunksById.get(target.id);
		if (!chunks || chunks.length === 0) continue;

		const gainNode = offlineContext.createGain();
		gainNode.connect(offlineContext.destination);
		applyGainAutomationByFrame({
			gainParam: gainNode.gain,
			gains: target.gains,
			fps,
			exportDuration,
		});

		const clipStartSeconds = framesToSeconds(target.timeline.start ?? 0, fps);
		const clipOffsetSeconds = framesToSeconds(target.timeline.offset ?? 0, fps);
		const decodeStart = Math.max(0, target.sourceRangeStart);
		const decodeEnd = Math.min(target.audioDuration, target.sourceRangeEnd);

		for (const chunk of chunks) {
			const sourceNode = offlineContext.createBufferSource();
			sourceNode.buffer = chunk.buffer;
			sourceNode.connect(gainNode);

			const chunkDuration =
				Number.isFinite(chunk.duration) && chunk.duration > 0
					? chunk.duration
					: chunk.buffer.duration;
			const chunkSourceStart = chunk.timestamp;
			const chunkSourceEnd = chunkSourceStart + chunkDuration;
			const playSourceStart = Math.max(chunkSourceStart, decodeStart);
			const playSourceEnd = Math.min(chunkSourceEnd, decodeEnd);
			if (playSourceEnd - playSourceStart <= AUDIO_EPSILON) continue;

			let when =
				playSourceStart -
				clipOffsetSeconds +
				clipStartSeconds -
				exportStartSeconds;
			let bufferOffset = playSourceStart - chunkSourceStart;
			let playDuration = playSourceEnd - playSourceStart;

			if (when < 0) {
				const shift = -when;
				bufferOffset += shift;
				when = 0;
				playDuration -= shift;
			}
			if (playDuration <= AUDIO_EPSILON) continue;
			if (when >= exportDuration) continue;
			if (when + playDuration > exportDuration) {
				playDuration = exportDuration - when;
			}
			if (playDuration <= AUDIO_EPSILON) continue;

			sourceNode.start(when, bufferOffset, playDuration);
		}
	}

	return offlineContext.startRendering();
};

export const exportTimelineAsVideoCore = async (
	options: ExportTimelineAsVideoOptions,
): Promise<void> => {
	const fps = Number.isFinite(options.fps)
		? Math.round(options.fps)
		: Math.round(30);

	const width = Math.round(options.canvasSize.width);
	const height = Math.round(options.canvasSize.height);
	if (!width || !height) {
		throw new Error("导出失败：无法获取画布尺寸");
	}

	const startFrame = Math.max(0, Math.round(options.startFrame ?? 0));
	const timelineEnd =
		options.endFrame ??
		options.elements.reduce(
			(max, el) => Math.max(max, Math.round(el.timeline.end ?? 0)),
			0,
		);
	const endFrame = Math.max(startFrame, Math.round(timelineEnd));
	if (endFrame <= startFrame) {
		throw new Error("导出失败：时间轴为空");
	}

	if (options.waitForReady) {
		await options.waitForReady();
	}

	const totalFrames = endFrame - startFrame;
	const audioTargets = collectExportAudioTargets(options, totalFrames);
	const audioTargetsById = new Map(
		audioTargets.map((target) => [target.id, target]),
	);
	const audioClips: AudioMixClip[] = audioTargets.map((target) => ({
		id: target.id,
		timeline: target.timeline,
		audioDuration: target.audioDuration,
		enabled: target.enabled,
	}));
	const transitionCurveById = collectTransitionCurveById(options.elements);

	let root: SkiaSGRoot | null = null;
	let surface: JsiSkSurface | null = null;
	let webglCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
	let outputTarget: ExportOutputTarget | null = null;
	let shouldCleanupOutputTargetImmediately = true;

	try {
		outputTarget = await createExportOutputTarget();
		console.info(`[Export] output target: ${outputTarget.kind}`);
		const output = new Output({
			format: new Mp4OutputFormat(),
			target: outputTarget.target,
		});

		const exportCanvas =
			typeof OffscreenCanvas !== "undefined"
				? new OffscreenCanvas(width, height)
				: (() => {
						const canvas = document.createElement("canvas");
						canvas.width = width;
						canvas.height = height;
						return canvas;
					})();

		const videoSource = new CanvasSource(exportCanvas, {
			codec: "avc",
			bitrate: QUALITY_HIGH,
		});
		output.addVideoTrack(videoSource, { frameRate: fps });

		let audioSource: AudioBufferSource | null = null;
		if (audioTargets.length > 0) {
			try {
				audioSource = new AudioBufferSource({
					codec: "aac",
					bitrate: QUALITY_HIGH,
				});
				output.addAudioTrack(audioSource);
			} catch (error) {
				console.warn("创建导出音轨失败，将回退为仅视频导出:", error);
				audioSource = null;
			}
		}

		await output.start();

		root = new SkiaSGRoot(Skia);
		const webglResult = createWebGLSurfaceForExport(
			exportCanvas,
			width,
			height,
		);
		if (!webglResult) {
			throw new Error("导出失败：无法创建 WebGL Surface");
		}
		surface = webglResult.surface;
		webglCanvas = webglResult.canvas;
		if (!surface) {
			throw new Error("导出失败：无法创建离屏画布");
		}
		const skiaCanvas = surface.getCanvas();
		if (!webglCanvas) {
			throw new Error("导出失败：无法获取 WebGL 画布");
		}

		const buildFrameState = (targetFrame: number) => {
			return options.buildSkiaRenderState({
				elements: options.elements,
				displayTime: targetFrame,
				tracks: options.tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: true,
					fps,
					canvasSize: { width, height },
					getModelStore: options.getModelStore,
					prepareTransitionPictures: true,
				},
			});
		};

		for (let frame = startFrame; frame < endFrame; frame += 1) {
			options.onFrame?.(frame);
			const frameState = await buildFrameState(frame);
			if (!frameState) {
				continue;
			}

			try {
				if (audioTargetsById.size > 0) {
					applyAudioMixPlanAtFrame({
						frame,
						startFrame,
						fps,
						audioClips,
						audioTargetsById,
						transitionFrameState: frameState.transitionFrameState,
						transitionCurveById,
					});
				}

				await frameState.ready;

				await root.render(frameState.children);
				// 渲染树已包含全屏背景 Fill，避免额外 clear 触发 CanvasKit 崩溃路径
				root.drawOnCanvas(skiaCanvas);
				surface.flush();

				await videoSource.add(frame / fps, 1 / fps);
			} finally {
				frameState.dispose?.();
			}
		}

		console.log("video canvas rendered");

		if (audioSource && audioTargets.length > 0) {
			try {
				const mixedBuffer = await mixAudioTargetsForExport({
					targets: audioTargets,
					startFrame,
					endFrame,
					fps,
				});
				if (mixedBuffer) {
					await audioSource.add(mixedBuffer);
				}
			} catch (error) {
				console.warn("导出音频混音失败，已回退为仅视频导出:", error);
			}
		}

		console.log("audio mixed");

		await output.finalize();
		console.log("output finalized");
		const blob = await outputTarget.resolveBlob();
		const filename = options.filename ?? `timeline-${Date.now()}.mp4`;
		downloadBlob(blob, filename);
		console.log("blob downloaded");
		if (outputTarget.kind === "opfs-stream") {
			// 下载可能仍在读取 OPFS 文件，延后删除临时文件避免网络错误
			scheduleDeferredCleanup(outputTarget);
			shouldCleanupOutputTargetImmediately = false;
		}
	} finally {
		if (shouldCleanupOutputTargetImmediately) {
			await outputTarget?.cleanup();
		}
		try {
			root?.unmount();
		} catch {}
		try {
			if (surface && webglCanvas) {
				surface.ref.delete();
				cleanupWebGLContext(webglCanvas);
			}
		} catch {}
	}
};
