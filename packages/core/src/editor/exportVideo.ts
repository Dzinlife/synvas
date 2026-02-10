import {
	type AudioBufferSink,
	AudioSampleSource,
	BufferTarget,
	CanvasSource,
	Mp4OutputFormat,
	Output,
	QUALITY_HIGH,
	StreamTarget,
} from "mediabunny";
import { JsiSkSurface, Skia, SkiaSGRoot } from "react-skia-lite";
import type { TimelineElement } from "../dsl/types";
import { renderMixedAudioForExport } from "./audio/dsp/exportRenderer";
import type { PartialExportAudioDspSettings } from "./audio/dsp/types";
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
	getAudioSessionKeyByElementId?: (
		elementId: string,
	) => string | null | undefined;
	dspConfig?: PartialExportAudioDspSettings;
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

type ExportAudioClipTarget = {
	id: string;
	sessionKey: string;
	timeline: TimelineElement["timeline"];
	audioSink: AudioBufferSink;
	audioDuration: number;
	enabled: boolean;
};

type CollectedExportAudioTargets = {
	audioTargets: ExportAudioTarget[];
	audioTargetsBySessionKey: Map<string, ExportAudioTarget>;
	audioClips: AudioMixClip[];
	audioClipTargetsById: Map<string, ExportAudioClipTarget>;
};

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

const resolveTimelineStart = (timeline: TimelineElement["timeline"]): number => {
	const start = timeline.start;
	if (!Number.isFinite(start)) return 0;
	return Math.round(start);
};

const pickSessionAnchorClip = (
	current: ExportAudioClipTarget,
	candidate: ExportAudioClipTarget,
): ExportAudioClipTarget => {
	const currentStart = resolveTimelineStart(current.timeline);
	const candidateStart = resolveTimelineStart(candidate.timeline);
	if (candidateStart < currentStart) return candidate;
	if (currentStart < candidateStart) return current;
	return candidate.id.localeCompare(current.id) < 0 ? candidate : current;
};

const resolveAudioSessionKey = (
	options: ExportTimelineAsVideoOptions,
	elementId: string,
): string => {
	const key = options.audio?.getAudioSessionKeyByElementId?.(elementId);
	if (typeof key === "string" && key.length > 0) return key;
	return `clip:${elementId}`;
};

const collectExportAudioTargets = (
	options: ExportTimelineAsVideoOptions,
	totalFrames: number,
): CollectedExportAudioTargets => {
	const getAudioSource = options.audio?.getAudioSourceByElementId;
	if (!getAudioSource) {
		return {
			audioTargets: [],
			audioTargetsBySessionKey: new Map(),
			audioClips: [],
			audioClipTargetsById: new Map(),
		};
	}
	const audioTrackStates = options.audio?.audioTrackStates ?? {};

	const clipTargets: ExportAudioClipTarget[] = [];
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

		clipTargets.push({
			id: element.id,
			sessionKey: resolveAudioSessionKey(options, element.id),
			timeline: element.timeline,
			audioSink: source.audioSink,
			audioDuration: source.audioDuration,
			enabled,
		});
	}

	const anchorBySession = new Map<string, ExportAudioClipTarget>();
	const enabledBySession = new Map<string, boolean>();
	for (const clip of clipTargets) {
		const currentAnchor = anchorBySession.get(clip.sessionKey);
		anchorBySession.set(
			clip.sessionKey,
			currentAnchor ? pickSessionAnchorClip(currentAnchor, clip) : clip,
		);
		enabledBySession.set(
			clip.sessionKey,
			Boolean(enabledBySession.get(clip.sessionKey)) || clip.enabled,
		);
	}

	const audioTargetsBySessionKey = new Map<string, ExportAudioTarget>();
	for (const [sessionKey, anchorClip] of anchorBySession.entries()) {
		audioTargetsBySessionKey.set(sessionKey, {
			id: sessionKey,
			timeline: anchorClip.timeline,
			audioSink: anchorClip.audioSink,
			audioDuration: anchorClip.audioDuration,
			enabled: enabledBySession.get(sessionKey) ?? anchorClip.enabled,
			gains: new Float32Array(totalFrames),
			hasAudibleFrame: false,
			sourceRangeStart: Number.POSITIVE_INFINITY,
			sourceRangeEnd: 0,
		});
	}

	return {
		audioTargets: Array.from(audioTargetsBySessionKey.values()),
		audioTargetsBySessionKey,
		audioClips: clipTargets.map((clip) => ({
			id: clip.id,
			timeline: clip.timeline,
			audioDuration: clip.audioDuration,
			enabled: clip.enabled,
		})),
		audioClipTargetsById: new Map(clipTargets.map((clip) => [clip.id, clip])),
	};
};

const SESSION_INSTRUCTION_EPSILON = 1e-6;

type SessionInstructionCandidate = {
	clip: ExportAudioClipTarget;
	instruction: AudioMixInstruction | null;
};

const chooseSessionInstruction = (
	current: SessionInstructionCandidate,
	candidate: SessionInstructionCandidate,
): SessionInstructionCandidate => {
	if (!current.instruction && candidate.instruction) return candidate;
	if (current.instruction && !candidate.instruction) return current;
	if (!current.instruction && !candidate.instruction) return current;
	if (!current.instruction || !candidate.instruction) return current;

	const currentGain = current.instruction.gain ?? 0;
	const candidateGain = candidate.instruction.gain ?? 0;
	if (candidateGain > currentGain + SESSION_INSTRUCTION_EPSILON) return candidate;
	if (currentGain > candidateGain + SESSION_INSTRUCTION_EPSILON) return current;

	const currentStart = resolveTimelineStart(current.clip.timeline);
	const candidateStart = resolveTimelineStart(candidate.clip.timeline);
	if (candidateStart > currentStart) return candidate;
	if (currentStart > candidateStart) return current;

	if (candidate.clip.id.localeCompare(current.clip.id) > 0) {
		return candidate;
	}
	return current;
};

const applyAudioMixPlanAtFrame = ({
	frame,
	startFrame,
	fps,
	audioClips,
	audioClipTargetsById,
	audioTargetsBySessionKey,
	transitionFrameState,
	transitionCurveById,
}: {
	frame: number;
	startFrame: number;
	fps: number;
	audioClips: AudioMixClip[];
	audioClipTargetsById: Map<string, ExportAudioClipTarget>;
	audioTargetsBySessionKey: Map<string, ExportAudioTarget>;
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

	for (const target of audioTargetsBySessionKey.values()) {
		target.gains[frameIndex] = 0;
	}

	const pickedBySessionKey = new Map<string, SessionInstructionCandidate>();
	for (const clip of audioClips) {
		const clipTarget = audioClipTargetsById.get(clip.id);
		if (!clipTarget) continue;
		const instruction: AudioMixInstruction | null =
			plan.instructions[clip.id] ?? null;
		const candidate: SessionInstructionCandidate = {
			clip: clipTarget,
			instruction,
		};
		const existing = pickedBySessionKey.get(clipTarget.sessionKey);
		if (!existing) {
			pickedBySessionKey.set(clipTarget.sessionKey, candidate);
			continue;
		}
		pickedBySessionKey.set(
			clipTarget.sessionKey,
			chooseSessionInstruction(existing, candidate),
		);
	}

	for (const [sessionKey, picked] of pickedBySessionKey.entries()) {
		const target = audioTargetsBySessionKey.get(sessionKey);
		if (!target) continue;
		const instruction = picked.instruction;
		if (!instruction) continue;

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

export const __collectExportAudioTargetsForTests = collectExportAudioTargets;
export const __chooseSessionInstructionForTests = chooseSessionInstruction;
export const __applyAudioMixPlanAtFrameForTests = applyAudioMixPlanAtFrame;

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
	const {
		audioTargets,
		audioTargetsBySessionKey,
		audioClips,
		audioClipTargetsById,
	} = collectExportAudioTargets(options, totalFrames);
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

		let audioSource: AudioSampleSource | null = null;
		if (audioTargets.length > 0) {
			audioSource = new AudioSampleSource({
				codec: "aac",
				bitrate: QUALITY_HIGH,
			});
			output.addAudioTrack(audioSource);
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
				if (audioTargetsBySessionKey.size > 0) {
					applyAudioMixPlanAtFrame({
						frame,
						startFrame,
						fps,
						audioClips,
						audioClipTargetsById,
						audioTargetsBySessionKey,
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
			await renderMixedAudioForExport({
				targets: audioTargets,
				startFrame,
				endFrame,
				fps,
				audioSource,
				dspConfig: options.audio?.dspConfig,
			});
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
