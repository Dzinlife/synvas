import type { TimelineAsset, TimelineElement } from "core/element/types";
import { buildSplitElements } from "core/editor/command/split";
import type { CanvasSink } from "mediabunny";
import { acquireVideoAsset } from "@/assets/videoAsset";
import { framesToSeconds } from "@/utils/timecode";
import { isTransitionElement, reconcileTransitions } from "../utils/transitions";

export type QuickSplitMode = "fast" | "balanced" | "fine";

export interface QuickSplitOptions {
	sensitivity: number;
	minSegmentSeconds: number;
	mode: QuickSplitMode;
	signal?: AbortSignal;
	onProgress?: (progress: number) => void;
}

export interface QuickSplitAnalysisShot {
	start: number;
	end: number;
	peakScore: number;
}

export interface QuickSplitAnalysis {
	sampleFrames: number[];
	scores: number[];
	splitFrames: number[];
	shots: QuickSplitAnalysisShot[];
	strideFrames: number;
}

type QuickSplitCandidate = TimelineElement<{
	reversed?: boolean;
}>;

const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 36;
const FEATURE_EPSILON = 1e-6;
const HIST_BINS = 16;
const MOTION_COMPENSATION_SHIFT = 2;
const MAX_SAMPLES = 900;

export const QUICK_SPLIT_DEFAULTS: Readonly<
	Pick<QuickSplitOptions, "sensitivity" | "minSegmentSeconds" | "mode">
> = {
	sensitivity: 55,
	minSegmentSeconds: 0.8,
	mode: "balanced",
};

const createElementId = () => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `clip-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 6)}`;
};

const clamp = (value: number, min: number, max: number): number => {
	if (!Number.isFinite(value)) return min;
	return Math.max(min, Math.min(max, value));
};

const normalizeSensitivity = (value: number): number =>
	Math.round(clamp(value, 0, 100));

const normalizeMinSegmentSeconds = (value: number): number =>
	Number(clamp(value, 0.2, 5).toFixed(2));

const resolveStrideFrames = (mode: QuickSplitMode, fps: number): number => {
	const safeFps = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 30;
	if (mode === "fine") return 1;
	if (mode === "fast") return Math.max(1, Math.round(safeFps / 5));
	return Math.max(1, Math.round(safeFps / 10));
};

const normalizeMode = (mode: QuickSplitMode | undefined): QuickSplitMode => {
	if (mode === "fast" || mode === "fine") return mode;
	return "balanced";
};

const createProgressReporter = (
	onProgress?: (progress: number) => void,
): ((progress: number) => void) => {
	const REPORT_MIN_INTERVAL_MS = 500;
	let lastProgress = -1;
	let lastEmitTime = 0;
	return (progress) => {
		if (!onProgress) return;
		const normalized = clamp(progress, 0, 1);
		const now = Date.now();
		const isBoundary = normalized === 0 || normalized === 1;
		const isSmallDelta =
			lastProgress >= 0 &&
			Math.abs(normalized - lastProgress) < 0.005 &&
			normalized < 1;
		const isTooFrequent =
			lastEmitTime > 0 && now - lastEmitTime < REPORT_MIN_INTERVAL_MS;
		if (!isBoundary && (isSmallDelta || isTooFrequent)) return;
		lastProgress = normalized;
		lastEmitTime = now;
		onProgress(normalized);
	};
};

const createAbortError = (): Error => {
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
};

const throwIfAborted = (signal?: AbortSignal) => {
	if (!signal?.aborted) return;
	throw createAbortError();
};

export const isQuickSplitCandidateElement = (
	element: TimelineElement | null | undefined,
): element is QuickSplitCandidate => {
	if (!element || element.type !== "VideoClip") return false;
	return typeof element.assetId === "string" && element.assetId.length > 0;
};

export const resolveQuickSplitCandidate = (options: {
	elements: TimelineElement[];
	selectedIds: string[];
	primaryId: string | null;
}): QuickSplitCandidate | null => {
	const { elements, selectedIds, primaryId } = options;
	if (!primaryId) return null;
	if (selectedIds.length !== 1 || selectedIds[0] !== primaryId) return null;
	const target = elements.find((element) => element.id === primaryId) ?? null;
	if (!isQuickSplitCandidateElement(target)) return null;
	return target;
};

const readFrameCanvasAtTime = async (
	videoSink: CanvasSink,
	time: number,
	signal?: AbortSignal,
): Promise<HTMLCanvasElement | OffscreenCanvas | null> => {
	throwIfAborted(signal);
	const iterator = videoSink.canvases(time);
	try {
		const frame = (await iterator.next()).value;
		throwIfAborted(signal);
		const canvas = frame?.canvas;
		const hasOffscreenCanvas = typeof OffscreenCanvas !== "undefined";
		if (
			canvas instanceof HTMLCanvasElement ||
			(hasOffscreenCanvas && canvas instanceof OffscreenCanvas)
		) {
			return canvas;
		}
		return null;
	} finally {
		await iterator.return?.();
	}
};

interface FrameFeatures {
	luma: Float32Array;
	edge: Float32Array;
	hist: Float32Array;
	meanLuma: number;
}

const buildLumaAndHistogram = (
	imageData: ImageData,
): {
	luma: Float32Array;
	hist: Float32Array;
	meanLuma: number;
} => {
	const pixelCount = imageData.width * imageData.height;
	const luma = new Float32Array(pixelCount);
	const hist = new Float32Array(HIST_BINS);
	let sum = 0;
	for (let i = 0; i < pixelCount; i += 1) {
		const base = i * 4;
		const r = imageData.data[base] ?? 0;
		const g = imageData.data[base + 1] ?? 0;
		const b = imageData.data[base + 2] ?? 0;
		const value = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		luma[i] = value;
		sum += value;
		const bin = Math.min(HIST_BINS - 1, Math.floor(value * HIST_BINS));
		hist[bin] = (hist[bin] ?? 0) + 1;
	}
	for (let i = 0; i < HIST_BINS; i += 1) {
		hist[i] = (hist[i] ?? 0) / Math.max(1, pixelCount);
	}
	return {
		luma,
		hist,
		meanLuma: sum / Math.max(1, pixelCount),
	};
};

const buildEdgeMap = (
	luma: Float32Array,
	width: number,
	height: number,
): Float32Array => {
	const edge = new Float32Array(luma.length);
	if (width < 3 || height < 3) return edge;

	for (let y = 1; y < height - 1; y += 1) {
		for (let x = 1; x < width - 1; x += 1) {
			const tl = luma[(y - 1) * width + (x - 1)] ?? 0;
			const tc = luma[(y - 1) * width + x] ?? 0;
			const tr = luma[(y - 1) * width + (x + 1)] ?? 0;
			const ml = luma[y * width + (x - 1)] ?? 0;
			const mr = luma[y * width + (x + 1)] ?? 0;
			const bl = luma[(y + 1) * width + (x - 1)] ?? 0;
			const bc = luma[(y + 1) * width + x] ?? 0;
			const br = luma[(y + 1) * width + (x + 1)] ?? 0;

			const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
			const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
			const magnitude = Math.min(1, Math.hypot(gx, gy) / 4);
			edge[y * width + x] = magnitude;
		}
	}
	return edge;
};

const extractFrameFeatures = (
	source: HTMLCanvasElement | OffscreenCanvas,
	scratchCtx: CanvasRenderingContext2D,
): FrameFeatures => {
	scratchCtx.clearRect(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
	scratchCtx.drawImage(source, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
	const imageData = scratchCtx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
	const { luma, hist, meanLuma } = buildLumaAndHistogram(imageData);
	const edge = buildEdgeMap(luma, SAMPLE_WIDTH, SAMPLE_HEIGHT);
	return {
		luma,
		edge,
		hist,
		meanLuma,
	};
};

const resolveOverlapRange = (size: number, offset: number) => ({
	start: Math.max(0, -offset),
	end: Math.min(size, size - offset),
});

const meanAbsDiffWithShift = (
	prev: Float32Array,
	curr: Float32Array,
	width: number,
	height: number,
	dx: number,
	dy: number,
): { diff: number; count: number } => {
	const xRange = resolveOverlapRange(width, dx);
	const yRange = resolveOverlapRange(height, dy);
	if (xRange.end <= xRange.start || yRange.end <= yRange.start) {
		return { diff: 1, count: 0 };
	}
	let sum = 0;
	let count = 0;
	for (let y = yRange.start; y < yRange.end; y += 1) {
		for (let x = xRange.start; x < xRange.end; x += 1) {
			const prevIndex = y * width + x;
			const currIndex = (y + dy) * width + (x + dx);
			sum += Math.abs((prev[prevIndex] ?? 0) - (curr[currIndex] ?? 0));
			count += 1;
		}
	}
	if (count === 0) return { diff: 1, count: 0 };
	return { diff: sum / count, count };
};

const resolveBestShift = (
	prevLuma: Float32Array,
	currLuma: Float32Array,
): { dx: number; dy: number; lumaDiff: number } => {
	let bestDx = 0;
	let bestDy = 0;
	let bestDiff = Number.POSITIVE_INFINITY;
	for (let dy = -MOTION_COMPENSATION_SHIFT; dy <= MOTION_COMPENSATION_SHIFT; dy += 1) {
		for (
			let dx = -MOTION_COMPENSATION_SHIFT;
			dx <= MOTION_COMPENSATION_SHIFT;
			dx += 1
		) {
			const { diff } = meanAbsDiffWithShift(
				prevLuma,
				currLuma,
				SAMPLE_WIDTH,
				SAMPLE_HEIGHT,
				dx,
				dy,
			);
			if (diff < bestDiff) {
				bestDiff = diff;
				bestDx = dx;
				bestDy = dy;
			}
		}
	}
	if (!Number.isFinite(bestDiff)) {
		return { dx: 0, dy: 0, lumaDiff: 1 };
	}
	return {
		dx: bestDx,
		dy: bestDy,
		lumaDiff: clamp(bestDiff, 0, 1),
	};
};

const histogramChiSquareDistance = (
	a: Float32Array,
	b: Float32Array,
): number => {
	let sum = 0;
	for (let i = 0; i < HIST_BINS; i += 1) {
		const left = a[i] ?? 0;
		const right = b[i] ?? 0;
		const diff = left - right;
		sum += (diff * diff) / (left + right + FEATURE_EPSILON);
	}
	return clamp(0.5 * sum, 0, 1);
};

const buildRawScores = (features: FrameFeatures[]): number[] => {
	if (features.length < 2) return [];
	const scores: number[] = [];
	for (let i = 1; i < features.length; i += 1) {
		const prev = features[i - 1];
		const curr = features[i];
		if (!prev || !curr) continue;
		const bestShift = resolveBestShift(prev.luma, curr.luma);
		const edgeDiff = meanAbsDiffWithShift(
			prev.edge,
			curr.edge,
			SAMPLE_WIDTH,
			SAMPLE_HEIGHT,
			bestShift.dx,
			bestShift.dy,
		).diff;
		const histDiff = histogramChiSquareDistance(prev.hist, curr.hist);
		const score =
			0.55 * bestShift.lumaDiff +
			0.3 * histDiff +
			0.15 * clamp(edgeDiff, 0, 1);
		scores.push(clamp(score, 0, 1));
	}
	return scores;
};

const applyFlashSuppression = (
	scores: number[],
	meanLumaSeries: number[],
): number[] => {
	if (scores.length <= 1 || meanLumaSeries.length < 3) return scores;
	const next = [...scores];
	for (let i = 0; i < scores.length - 1; i += 1) {
		const d1 = (meanLumaSeries[i + 1] ?? 0) - (meanLumaSeries[i] ?? 0);
		const d2 = (meanLumaSeries[i + 2] ?? 0) - (meanLumaSeries[i + 1] ?? 0);
		const isFlashLike =
			Math.abs(d1) >= 0.22 &&
			Math.abs(d2) >= 0.12 &&
			Math.sign(d1) !== 0 &&
			Math.sign(d2) !== 0 &&
			Math.sign(d1) !== Math.sign(d2);
		if (!isFlashLike) continue;
		next[i] = (next[i] ?? 0) * 0.35;
		next[i + 1] = (next[i + 1] ?? 0) * 0.35;
	}
	return next;
};

const getPercentile = (values: number[], percentile: number): number => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = clamp(percentile, 0, 100) / 100;
	const index = rank * (sorted.length - 1);
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	if (lower === upper) {
		return sorted[lower] ?? 0;
	}
	const lowerValue = sorted[lower] ?? 0;
	const upperValue = sorted[upper] ?? lowerValue;
	const weight = index - lower;
	return lowerValue + (upperValue - lowerValue) * weight;
};

const getMedian = (values: number[]): number => getPercentile(values, 50);

const getMad = (values: number[]): number => {
	if (values.length === 0) return 0;
	const median = getMedian(values);
	const deviations = values.map((value) => Math.abs(value - median));
	return getMedian(deviations);
};

export const computeQuickSplitFramesFromScores = (options: {
	sampleFrames: number[];
	scores: number[];
	startFrame: number;
	endFrame: number;
	sensitivity: number;
	minGapFrames: number;
}): number[] => {
	const {
		sampleFrames,
		scores,
		startFrame,
		endFrame,
		sensitivity,
		minGapFrames,
	} = options;
	if (scores.length === 0 || sampleFrames.length < 2) return [];

	const normalizedSensitivity = normalizeSensitivity(sensitivity);
	const sensitivityRatio = normalizedSensitivity / 100;
	const percentileThreshold = getPercentile(
		scores,
		95 - 20 * sensitivityRatio,
	);
	const median = getMedian(scores);
	const mad = getMad(scores);
	const robustThreshold = median + (2.2 - 1.2 * sensitivityRatio) * mad;
	const threshold = Math.max(percentileThreshold, robustThreshold);
	const minGap = Math.max(1, Math.round(minGapFrames));
	const keptFrames: number[] = [];
	const keptScores: number[] = [];

	for (let i = 0; i < scores.length; i += 1) {
		const score = scores[i] ?? 0;
		if (score < threshold) continue;
		const prev = i > 0 ? (scores[i - 1] ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
		const next = i < scores.length - 1
			? (scores[i + 1] ?? Number.NEGATIVE_INFINITY)
			: Number.NEGATIVE_INFINITY;
		const isPeak = score >= prev && score > next;
		if (!isPeak) continue;

		const splitFrame = sampleFrames[i + 1];
		if (!Number.isFinite(splitFrame)) continue;
		if (splitFrame - startFrame < minGap) continue;
		if (endFrame - splitFrame < minGap) continue;

		const lastIndex = keptFrames.length - 1;
		if (lastIndex >= 0) {
			const lastFrame = keptFrames[lastIndex] ?? 0;
			if (splitFrame - lastFrame < minGap) {
				const lastScore = keptScores[lastIndex] ?? Number.NEGATIVE_INFINITY;
				if (score > lastScore) {
					keptFrames[lastIndex] = splitFrame;
					keptScores[lastIndex] = score;
				}
				continue;
			}
		}

		keptFrames.push(splitFrame);
		keptScores.push(score);
	}

	return Array.from(new Set(keptFrames)).sort((a, b) => a - b);
};

const buildShots = (options: {
	startFrame: number;
	endFrame: number;
	splitFrames: number[];
	sampleFrames: number[];
	scores: number[];
}): QuickSplitAnalysisShot[] => {
	const { startFrame, endFrame, splitFrames, sampleFrames, scores } = options;
	const boundaries = [startFrame, ...splitFrames, endFrame];
	const shots: QuickSplitAnalysisShot[] = [];
	for (let index = 0; index < boundaries.length - 1; index += 1) {
		const start = boundaries[index] ?? 0;
		const end = boundaries[index + 1] ?? 0;
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
		let peakScore = 0;
		for (let i = 0; i < scores.length; i += 1) {
			const frame = sampleFrames[i + 1];
			if (!Number.isFinite(frame)) continue;
			if (frame < start || frame >= end) continue;
			peakScore = Math.max(peakScore, scores[i] ?? 0);
		}
		shots.push({ start, end, peakScore });
	}
	return shots;
};

const remapTransitionsAfterSplit = (
	elements: TimelineElement[],
	options: {
		clipId: string;
		rightClipId: string;
		originalEnd: number;
	},
): TimelineElement[] => {
	const { clipId, rightClipId, originalEnd } = options;
	let didChange = false;
	const next = elements.map((element) => {
		if (!isTransitionElement(element)) return element;
		const transition = element.transition;
		if (!transition) return element;
		if (transition.fromId !== clipId) return element;
		if (transition.boundry !== originalEnd) return element;
		didChange = true;
		return {
			...element,
			transition: {
				...transition,
				fromId: rightClipId,
			},
		};
	});
	return didChange ? next : elements;
};

const collectRequestedFrames = (
	startFrame: number,
	endFrame: number,
	strideFrames: number,
): number[] => {
	if (endFrame - startFrame < 2) return [];
	const frames: number[] = [startFrame];
	for (
		let frame = startFrame + strideFrames;
		frame < endFrame - 1;
		frame += strideFrames
	) {
		frames.push(frame);
	}
	frames.push(endFrame - 1);
	return Array.from(new Set(frames)).sort((a, b) => a - b);
};

const calculateQuickSplitVideoTime = (options: {
	start: number;
	timelineTime: number;
	videoDuration: number;
	reversed?: boolean;
	offset?: number;
	clipDuration?: number;
}): number => {
	const { start, timelineTime, videoDuration, reversed, offset = 0, clipDuration } =
		options;
	const relativeTime = timelineTime - start;
	const safeOffset = Math.max(0, Number.isFinite(offset) ? offset : 0);
	const safeVideoDuration = Math.max(0, videoDuration);
	const safeClipDuration =
		clipDuration ?? Math.max(0, safeVideoDuration - safeOffset);

	if (reversed) {
		const reversedTime = safeOffset + safeClipDuration - relativeTime;
		return Math.min(safeVideoDuration, Math.max(0, reversedTime));
	}
	const forwardTime = safeOffset + relativeTime;
	return Math.min(safeVideoDuration, Math.max(0, forwardTime));
};

export const analyzeVideoChangeForElement = async (options: {
	element: QuickSplitCandidate;
	fps: number;
	getProjectAssetById: (assetId: string) => TimelineAsset | null;
	sensitivity?: number;
	minSegmentSeconds?: number;
	mode?: QuickSplitMode;
	signal?: AbortSignal;
	onProgress?: (progress: number) => void;
}): Promise<QuickSplitAnalysis> => {
	const { element, fps, signal } = options;
	const mode = normalizeMode(options.mode);
	const sensitivity = normalizeSensitivity(
		options.sensitivity ?? QUICK_SPLIT_DEFAULTS.sensitivity,
	);
	const minSegmentSeconds = normalizeMinSegmentSeconds(
		options.minSegmentSeconds ?? QUICK_SPLIT_DEFAULTS.minSegmentSeconds,
	);
	const reportProgress = createProgressReporter(options.onProgress);
	reportProgress(0);

	if (!isQuickSplitCandidateElement(element)) {
		reportProgress(1);
		return {
			sampleFrames: [],
			scores: [],
			splitFrames: [],
			shots: [],
			strideFrames: resolveStrideFrames(mode, fps),
		};
	}

	const startFrame = element.timeline.start;
	const endFrame = element.timeline.end;
	const totalFrames = Math.max(0, endFrame - startFrame);
	if (totalFrames < 2) {
		reportProgress(1);
		return {
			sampleFrames: [],
			scores: [],
			splitFrames: [],
			shots: [{ start: startFrame, end: endFrame, peakScore: 0 }],
			strideFrames: resolveStrideFrames(mode, fps),
		};
	}

	let strideFrames = resolveStrideFrames(mode, fps);
	const estimatedSamples = Math.ceil(totalFrames / strideFrames) + 1;
	if (estimatedSamples > MAX_SAMPLES) {
		strideFrames = Math.max(1, Math.ceil(totalFrames / Math.max(2, MAX_SAMPLES)));
	}

	const requestedFrames = collectRequestedFrames(startFrame, endFrame, strideFrames);
	if (requestedFrames.length < 2) {
		reportProgress(1);
		return {
			sampleFrames: [],
			scores: [],
			splitFrames: [],
			shots: [{ start: startFrame, end: endFrame, peakScore: 0 }],
			strideFrames,
		};
	}

	const startSeconds = framesToSeconds(startFrame, fps);
	const clipDurationSeconds = framesToSeconds(totalFrames, fps);
	const offsetSeconds = framesToSeconds(element.timeline.offset ?? 0, fps);
	const reversed = Boolean(element.props.reversed);

	const scratchCanvas = document.createElement("canvas");
	scratchCanvas.width = SAMPLE_WIDTH;
	scratchCanvas.height = SAMPLE_HEIGHT;
	const scratchCtx = scratchCanvas.getContext("2d", {
		willReadFrequently: true,
	});
	if (!scratchCtx) {
		throw new Error("无法创建帧分析上下文");
	}

	const source = options.getProjectAssetById(element.assetId ?? "");
	if (!source?.uri) {
		throw new Error("视频源不存在或无效");
	}
	const handle = await acquireVideoAsset(source.uri);
	try {
		const videoSink = handle.asset.createVideoSink();
		const sampledFrames: number[] = [];
		const features: FrameFeatures[] = [];
		for (let index = 0; index < requestedFrames.length; index += 1) {
			const timelineFrame = requestedFrames[index] ?? startFrame;
			throwIfAborted(signal);
			const timelineTime = framesToSeconds(timelineFrame, fps);
			const sourceTime = calculateQuickSplitVideoTime({
				start: startSeconds,
				timelineTime,
				videoDuration: handle.asset.duration,
				reversed,
				offset: offsetSeconds,
				clipDuration: clipDurationSeconds,
			});
			const clampedTime = Math.min(
				Math.max(0, sourceTime),
				Math.max(0, handle.asset.duration - 0.001),
			);
			const frameCanvas = await readFrameCanvasAtTime(videoSink, clampedTime, signal);
			if (frameCanvas) {
				const frameFeatures = extractFrameFeatures(frameCanvas, scratchCtx);
				sampledFrames.push(timelineFrame);
				features.push(frameFeatures);
			}
			reportProgress((index + 1) / requestedFrames.length);
		}

		if (sampledFrames.length < 2 || features.length < 2) {
			reportProgress(1);
			return {
				sampleFrames: sampledFrames,
				scores: [],
				splitFrames: [],
				shots: [{ start: startFrame, end: endFrame, peakScore: 0 }],
				strideFrames,
			};
		}

		const rawScores = buildRawScores(features);
		const lumaSeries = features.map((feature) => feature.meanLuma);
		const scores = applyFlashSuppression(rawScores, lumaSeries);
		const minGapFrames = Math.max(
			Math.round(minSegmentSeconds * Math.max(1, Math.round(fps))),
			strideFrames,
		);
		const splitFrames = computeQuickSplitFramesFromScores({
			sampleFrames: sampledFrames,
			scores,
			startFrame,
			endFrame,
			sensitivity,
			minGapFrames,
		});
		const shots = buildShots({
			startFrame,
			endFrame,
			splitFrames,
			sampleFrames: sampledFrames,
			scores,
		});
		reportProgress(1);

		return {
			sampleFrames: sampledFrames,
			scores,
			splitFrames,
			shots,
			strideFrames,
		};
	} finally {
		handle.release();
	}
};

export const applyQuickSplitFrames = (options: {
	elements: TimelineElement[];
	targetId: string;
	splitFrames: number[];
	fps: number;
	createElementId?: () => string;
}): TimelineElement[] => {
	const { elements, targetId, splitFrames, fps } = options;
	if (splitFrames.length === 0) return elements;
	const targetIndex = elements.findIndex((element) => element.id === targetId);
	if (targetIndex < 0) return elements;
	const target = elements[targetIndex];
	if (target.type !== "VideoClip") return elements;

	const normalizedFrames = Array.from(new Set(splitFrames))
		.map((frame) => Math.round(frame))
		.filter(
			(frame) => frame > target.timeline.start && frame < target.timeline.end,
		)
		.sort((a, b) => a - b);
	if (normalizedFrames.length === 0) return elements;

	const buildId = options.createElementId ?? createElementId;
	const segments: TimelineElement[] = [];
	let working = target;
	for (const splitFrame of normalizedFrames) {
		const nextId = buildId();
		const { left, right } = buildSplitElements(working, splitFrame, fps, nextId);
		segments.push(left);
		working = right;
	}
	segments.push(working);
	const lastSegment = segments[segments.length - 1] ?? target;

	const next = [...elements];
	next.splice(targetIndex, 1, ...segments);
	const remapped = remapTransitionsAfterSplit(next, {
		clipId: target.id,
		rightClipId: lastSegment.id,
		originalEnd: target.timeline.end,
	});
	return reconcileTransitions(remapped, fps);
};
