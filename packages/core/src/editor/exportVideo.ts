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
import {
	createSkiaCanvasSurface,
	getSkiaRenderBackend,
	JsiSkSurface,
	Skia,
	SkiaSGRoot,
} from "react-skia-lite";
import type { TimelineElement } from "../element/types";
import { resolveTimelineElementClipGainLinear } from "./audio/clipGain";
import { renderMixedAudioForExport } from "./audio/dsp/exportRenderer";
import type { PartialExportAudioDspSettings } from "./audio/dsp/types";
import { chooseSessionInstructionCandidate } from "./audio/sessionInstructionSelector";
import {
	type AudioMixClip,
	type AudioMixInstruction,
	buildTransitionAudioMixPlan,
	type TransitionAudioCurve,
} from "./audio/transitionAudioMix";
import type {
	buildSkiaFrameSnapshotCore,
	buildSkiaRenderStateCore,
} from "./preview/buildSkiaTree";
import {
	resolveTransitionFrameState,
	type TransitionFrameState,
} from "./preview/transitionFrameState";
import type { TimelineTrack } from "./timeline/types";
import type { AudioTrackControlStateMap } from "./utils/audioTrackState";
import { resolveTimelineEndFrame } from "./utils/timelineEndFrame";
import { isTimelineTrackAudible } from "./utils/trackAudibility";
import { isVideoSourceAudioMuted } from "./utils/videoSourceAudio";

export type BuildSkiaFrameSnapshot = (
	args: Parameters<typeof buildSkiaFrameSnapshotCore>[0],
) => ReturnType<typeof buildSkiaFrameSnapshotCore>;

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
	isElementAudioEnabled?: (elementId: string) => boolean;
	dspConfig?: PartialExportAudioDspSettings;
};

export type ExportTimelineAsVideoOptions = {
	elements: TimelineElement[];
	tracks: TimelineTrack[];
	fps: number;
	canvasSize: { width: number; height: number };
	buildSkiaFrameSnapshot: BuildSkiaFrameSnapshot;
	buildSkiaRenderState?: BuildSkiaRenderState;
	filename?: string;
	startFrame?: number;
	endFrame?: number;
	signal?: AbortSignal;
	audio?: ExportTimelineAudioOptions;
	getModelStore?: NonNullable<
		Parameters<typeof buildSkiaFrameSnapshotCore>[0]["prepare"]
	>["getModelStore"];
	waitForReady?: () => Promise<void>;
	onFrame?: (frame: number) => void;
};

type ExportAudioTarget = {
	id: string;
	timeline: TimelineElement["timeline"];
	audioSink: AudioBufferSink;
	audioDuration: number;
	reversed: boolean;
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
	reversed: boolean;
	enabled: boolean;
	clipGain: number;
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

const OPFS_CLEANUP_DELAY_MS = 10 * 60_000;

const createAbortError = (): Error => {
	if (typeof DOMException !== "undefined") {
		return new DOMException("已取消", "AbortError");
	}
	const error = new Error("已取消");
	error.name = "AbortError";
	return error;
};

const throwIfAborted = (signal?: AbortSignal): void => {
	if (signal?.aborted) {
		throw createAbortError();
	}
};

const isAbortError = (error: unknown): boolean => {
	if (error instanceof DOMException) {
		return error.name === "AbortError";
	}
	return error instanceof Error && error.name === "AbortError";
};

const createSurfaceForExport = (
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
		if (!canvasKit) {
			throw new Error("CanvasKit 未初始化");
		}
		surface = createSkiaCanvasSurface(canvasKit, canvas);
		if (!surface) {
			throw new Error(
				`无法创建 ${getSkiaRenderBackend().kind} Surface`,
			);
		}
		return { surface, canvas };
	} catch {
		surface?.dispose();
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
	return Math.max(0, value);
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

const resolveExportAudioTransitionFrameState = (args: {
	elements: TimelineElement[];
	tracks: TimelineTrack[];
	frame: number;
}): TransitionFrameState => {
	return resolveTransitionFrameState({
		elements: args.elements,
		displayTime: args.frame,
		tracks: args.tracks,
		getTrackIndexForElement,
		isTransitionElement: (element) => element.type === "Transition",
	});
};

const resolveTimelineStart = (
	timeline: TimelineElement["timeline"],
): number => {
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
	const audioTrackStates = options.audio?.audioTrackStates ?? {};

	const clipTargets: ExportAudioClipTarget[] = [];
	const audioClips: AudioMixClip[] = [];
	for (const element of options.elements) {
		if (element.type !== "AudioClip" && element.type !== "VideoClip") continue;
		const source = getAudioSource?.(element.id);
		const hasValidSource = Boolean(
			source?.audioSink &&
				Number.isFinite(source.audioDuration) &&
				(source.audioDuration ?? 0) > 0,
		);

		const enabledByTrack =
			isTimelineTrackAudible(
				element.timeline,
				options.tracks,
				audioTrackStates,
			) && !(element.type === "VideoClip" && isVideoSourceAudioMuted(element));
		const enabledByCaller =
			options.audio?.isElementAudioEnabled?.(element.id) ?? true;
		const enabled = enabledByTrack && enabledByCaller;
		const audioDuration = hasValidSource ? (source?.audioDuration ?? 0) : 0;

		audioClips.push({
			id: element.id,
			timeline: element.timeline,
			audioDuration,
			enabled,
			reversed: Boolean(
				(element.props as { reversed?: unknown } | undefined)?.reversed,
			),
		});
		if (!hasValidSource || !source?.audioSink) continue;

		clipTargets.push({
			id: element.id,
			sessionKey: resolveAudioSessionKey(options, element.id),
			timeline: element.timeline,
			audioSink: source.audioSink,
			audioDuration,
			reversed: Boolean(
				(element.props as { reversed?: unknown } | undefined)?.reversed,
			),
			enabled,
			clipGain: resolveTimelineElementClipGainLinear(element),
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
			reversed: anchorClip.reversed,
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
		audioClips,
		audioClipTargetsById: new Map(clipTargets.map((clip) => [clip.id, clip])),
	};
};

type SessionInstructionCandidate = {
	clip: ExportAudioClipTarget;
	id: string;
	timelineStart: number;
	instruction: AudioMixInstruction | null;
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
		const planInstruction: AudioMixInstruction | null =
			plan.instructions[clip.id] ?? null;
		const instruction: AudioMixInstruction | null = planInstruction
			? {
					...planInstruction,
					gain: Math.max(0, planInstruction.gain * clipTarget.clipGain),
				}
			: null;
		const candidate: SessionInstructionCandidate = {
			clip: clipTarget,
			id: clipTarget.id,
			timelineStart: clipTarget.timeline.start ?? 0,
			instruction,
		};
		const existing = pickedBySessionKey.get(clipTarget.sessionKey);
		if (!existing) {
			pickedBySessionKey.set(clipTarget.sessionKey, candidate);
			continue;
		}
		pickedBySessionKey.set(
			clipTarget.sessionKey,
			chooseSessionInstructionCandidate(existing, candidate),
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
export const __chooseSessionInstructionForTests =
	chooseSessionInstructionCandidate;
export const __applyAudioMixPlanAtFrameForTests = applyAudioMixPlanAtFrame;
export const __resolveExportAudioTransitionFrameStateForTests =
	resolveExportAudioTransitionFrameState;
export const __createSurfaceForExportForTests = createSurfaceForExport;

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
		options.endFrame ?? resolveTimelineEndFrame(options.elements);
	const endFrame = Math.max(startFrame, Math.round(timelineEnd));
	if (endFrame <= startFrame) {
		throw new Error("导出失败：时间轴为空");
	}

	throwIfAborted(options.signal);
	if (options.waitForReady) {
		throwIfAborted(options.signal);
		await options.waitForReady();
		throwIfAborted(options.signal);
	}

	const totalFrames = endFrame - startFrame;
	const {
		audioTargets,
		audioTargetsBySessionKey,
		audioClips,
		audioClipTargetsById,
	} = collectExportAudioTargets(options, totalFrames);
	const transitionCurveById = collectTransitionCurveById(options.elements);

	let surface: JsiSkSurface | null = null;
	let renderCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
	let outputTarget: ExportOutputTarget | null = null;
	let output: Output<Mp4OutputFormat, BufferTarget | StreamTarget> | null =
		null;
	let shouldCleanupOutputTargetImmediately = true;
	let liveRoot: SkiaSGRoot | null = null;

	try {
		throwIfAborted(options.signal);
		outputTarget = await createExportOutputTarget();
		throwIfAborted(options.signal);
		console.info(`[Export] output target: ${outputTarget.kind}`);
		output = new Output({
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

		throwIfAborted(options.signal);
		await output.start();
		throwIfAborted(options.signal);

		const renderBackend = getSkiaRenderBackend();
		const usesFrameBoundCanvasSurface = renderBackend.kind === "webgpu";
		const useLiveRenderState =
			renderBackend.kind === "webgpu" &&
			typeof options.buildSkiaRenderState === "function";
		let skiaCanvas: ReturnType<JsiSkSurface["getCanvas"]> | null = null;
		const createActiveSurface = () => {
			const surfaceResult = createSurfaceForExport(
				exportCanvas,
				width,
				height,
			);
			if (!surfaceResult) {
				throw new Error(
					`导出失败：无法创建 ${renderBackend.kind} Surface`,
				);
			}
			const nextSurface = surfaceResult.surface;
			const nextRenderCanvas = surfaceResult.canvas;
			const nextSkiaCanvas = nextSurface.getCanvas();
			if (!nextRenderCanvas) {
				throw new Error("导出失败：无法获取导出画布");
			}
			return {
				surface: nextSurface,
				renderCanvas: nextRenderCanvas,
				skiaCanvas: nextSkiaCanvas,
			};
		};
		({ surface, renderCanvas, skiaCanvas } = createActiveSurface());
		if (useLiveRenderState) {
			liveRoot = new SkiaSGRoot(Skia);
		}

		const buildFrameArgs = (targetFrame: number) => ({
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
				awaitReady: true,
				forcePrepareFrames: true,
			},
		});

		const buildFrameSnapshot = (targetFrame: number) => {
			return options.buildSkiaFrameSnapshot(buildFrameArgs(targetFrame));
		};

		const buildFrameRenderState = (targetFrame: number) => {
			if (!options.buildSkiaRenderState) {
				throw new Error("导出失败：缺少 buildSkiaRenderState");
			}
			return options.buildSkiaRenderState(buildFrameArgs(targetFrame));
		};

		for (let frame = startFrame; frame < endFrame; frame += 1) {
			throwIfAborted(options.signal);
			options.onFrame?.(frame);

			throwIfAborted(options.signal);
			if (audioTargetsBySessionKey.size > 0) {
				const audioTransitionFrameState =
					resolveExportAudioTransitionFrameState({
						elements: options.elements,
						tracks: options.tracks,
						frame,
					});
				applyAudioMixPlanAtFrame({
					frame,
					startFrame,
					fps,
					audioClips,
					audioClipTargetsById,
					audioTargetsBySessionKey,
					transitionFrameState: audioTransitionFrameState,
					transitionCurveById,
				});
			}

			if (useLiveRenderState) {
				const renderState = await buildFrameRenderState(frame);
				const retainedResources: Array<() => void> = [];
				try {
					await renderState.ready;
					throwIfAborted(options.signal);

					if (usesFrameBoundCanvasSurface) {
						surface?.dispose();
						({ surface, renderCanvas, skiaCanvas } = createActiveSurface());
					}
					if (!surface || !skiaCanvas || !liveRoot) {
						throw new Error("导出失败：无法创建当前帧 Surface");
					}

					liveRoot.render(renderState.children);
					retainedResources.push(
						...liveRoot.drawOnCanvas(skiaCanvas, {
							retainResources: true,
						}),
					);
					surface.flush();
					throwIfAborted(options.signal);

					await videoSource.add(frame / fps, 1 / fps);
					throwIfAborted(options.signal);
				} finally {
					for (const cleanup of retainedResources) {
						try {
							cleanup();
						} catch {}
					}
					renderState.dispose?.();
				}
				continue;
			}

			const frameSnapshot = await buildFrameSnapshot(frame);
			try {
				await frameSnapshot.ready;
				throwIfAborted(options.signal);

				const picture = frameSnapshot.picture;
				if (!picture) {
					throw new Error(
						`导出失败：无法构建第 ${frame} 帧 picture（已中止导出）`,
					);
				}
				if (usesFrameBoundCanvasSurface) {
					surface?.dispose();
					({ surface, renderCanvas, skiaCanvas } = createActiveSurface());
				}
				if (!surface || !skiaCanvas) {
					throw new Error("导出失败：无法创建当前帧 Surface");
				}
				skiaCanvas.drawPicture(picture);
				surface.flush();
				throwIfAborted(options.signal);

				await videoSource.add(frame / fps, 1 / fps);
				throwIfAborted(options.signal);
			} finally {
				frameSnapshot.dispose?.();
			}
		}

		console.log("video canvas rendered");

		if (audioSource && audioTargets.length > 0) {
			throwIfAborted(options.signal);
			await renderMixedAudioForExport({
				targets: audioTargets,
				startFrame,
				endFrame,
				fps,
				audioSource,
				dspConfig: options.audio?.dspConfig,
				signal: options.signal,
			});
			throwIfAborted(options.signal);
		}

		console.log("audio mixed");

		throwIfAborted(options.signal);
		await output.finalize();
		console.log("output finalized");
		throwIfAborted(options.signal);
		const blob = await outputTarget.resolveBlob();
		throwIfAborted(options.signal);
		const filename = options.filename ?? `timeline-${Date.now()}.mp4`;
		downloadBlob(blob, filename);
		console.log("blob downloaded");
		if (outputTarget.kind === "opfs-stream") {
			// 下载可能仍在读取 OPFS 文件，延后删除临时文件避免网络错误
			scheduleDeferredCleanup(outputTarget);
			shouldCleanupOutputTargetImmediately = false;
		}
	} catch (error) {
		if (options.signal?.aborted || isAbortError(error)) {
			try {
				await output?.cancel();
			} catch {}
		}
		throw error;
	} finally {
		try {
			liveRoot?.unmount();
		} catch {}
		if (shouldCleanupOutputTargetImmediately) {
			await outputTarget?.cleanup();
		}
		try {
			if (surface && renderCanvas) {
				surface.dispose();
			}
		} catch {}
	}
};
