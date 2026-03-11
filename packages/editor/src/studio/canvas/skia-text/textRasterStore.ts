import type { SkImage } from "react-skia-lite";
import { Skia } from "react-skia-lite";
import type {
	NormalizedSkiaUiTextRequest,
	NormalizedSkiaUiTextStyle,
	SkiaUiTextRequest,
	TextRasterEntry,
} from "./types";

interface TextKey {
	signature: string;
}

interface FinalizedTextEntryPayload {
	signature: string;
	image: SkImage | null;
}

interface MeasuredTextLayout {
	font: string;
	paddingPx: number;
	lineHeightPx: number;
	fontAscent: number;
	fontHeight: number;
	textWidth: number;
	textHeight: number;
}

interface StableFontMetrics {
	ascent: number;
	descent: number;
	height: number;
}

interface RasterTask {
	request: NormalizedSkiaUiTextRequest;
	resolve: () => void;
	reject: (error: unknown) => void;
}

interface RasterizedTextSprite {
	image: SkImage | null;
	textWidth: number;
	textHeight: number;
}

const DEFAULT_FONT_FAMILY =
	'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';
const DEFAULT_FONT_SIZE_PX = 12;
const DEFAULT_FONT_WEIGHT = "400";
const DEFAULT_LINE_HEIGHT_MULTIPLIER = 1.2;
const DEFAULT_TEXT_COLOR = "rgba(239,68,68,1)";
const DEFAULT_TEXT_PADDING_PX = 1;
const DEFAULT_DPR_BUCKET = 1;
const DEFAULT_ASCENT_FALLBACK_RATIO = 0.78;
const FALLBACK_MIN_TEXT_WIDTH_MULTIPLIER = 2;
const DEFAULT_TEXT_ELLIPSIS = "…";
const DEFAULT_FONT_METRICS_SAMPLE_TEXT = "Hg国";
const MAX_RASTERS_PER_FRAME = 8;
const MAX_RASTER_MS_PER_FRAME = 2;
const SWEEP_STEPS_PER_CALL = 12;

const entryByKey = new WeakMap<TextKey, TextRasterEntry>();
const keyRefBySignature = new Map<string, WeakRef<TextKey>>();
const inflightBySignature = new Map<string, Promise<void>>();
const subscriberBySignature = new Map<string, Set<() => void>>();
const retainedKeyBySignature = new Map<string, TextKey>();
const heldValueByKey = new WeakMap<TextKey, FinalizedTextEntryPayload>();
const taskBySignature = new Map<string, RasterTask>();
const rasterQueue: string[] = [];
const queuedSignatureSet = new Set<string>();

let sweepIterator: Iterator<[string, WeakRef<TextKey>], undefined> | null =
	null;
let scheduledFrameId: number | null = null;
let scheduledFrameType: "raf" | "timeout" | null = null;
let measureCanvas: HTMLCanvasElement | null = null;
let measureContext: CanvasRenderingContext2D | null = null;
const fontMetricsByFont = new Map<string, StableFontMetrics>();

let nowProvider = (): number => {
	if (
		typeof performance !== "undefined" &&
		typeof performance.now === "function"
	) {
		return performance.now();
	}
	return Date.now();
};

let rasterizeTextSpriteProvider = (
	request: NormalizedSkiaUiTextRequest,
): RasterizedTextSprite => rasterizeTextSpriteDefault(request);

const disposeImage = (image: SkImage | null | undefined) => {
	if (!image) return;
	try {
		image.dispose();
	} catch {}
};

const cleanupFinalizedEntry = (payload: FinalizedTextEntryPayload) => {
	disposeImage(payload.image);
	const keyRef = keyRefBySignature.get(payload.signature);
	if (keyRef && keyRef.deref() !== undefined) {
		return;
	}
	retainedKeyBySignature.delete(payload.signature);
	keyRefBySignature.delete(payload.signature);
	inflightBySignature.delete(payload.signature);
	taskBySignature.delete(payload.signature);
	subscriberBySignature.delete(payload.signature);
	queuedSignatureSet.delete(payload.signature);
};

const finalizationRegistry =
	typeof FinalizationRegistry === "function"
		? new FinalizationRegistry<FinalizedTextEntryPayload>((payload) => {
				cleanupFinalizedEntry(payload);
			})
		: null;

const getMeasureContext = (): CanvasRenderingContext2D | null => {
	if (measureContext) return measureContext;
	if (typeof document === "undefined") return null;
	measureCanvas = document.createElement("canvas");
	measureContext = measureCanvas.getContext("2d");
	return measureContext;
};

const estimateTextWidth = (text: string, fontSizePx: number): number => {
	let units = 0;
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		if (code <= 0x7f) {
			units += 0.6;
			continue;
		}
		if (code >= 0x4e00 && code <= 0x9fff) {
			units += 1;
			continue;
		}
		units += 0.8;
	}
	return Math.max(
		fontSizePx * FALLBACK_MIN_TEXT_WIDTH_MULTIPLIER,
		units * fontSizePx,
	);
};

const normalizeDprBucket = (value: number | undefined): number => {
	if (Number.isFinite(value) && (value ?? 0) > 0) {
		return Math.round((value ?? DEFAULT_DPR_BUCKET) * 100) / 100;
	}
	if (
		typeof window !== "undefined" &&
		Number.isFinite(window.devicePixelRatio) &&
		window.devicePixelRatio > 0
	) {
		return Math.round(window.devicePixelRatio * 100) / 100;
	}
	return DEFAULT_DPR_BUCKET;
};

const normalizeTextStyle = (
	style: SkiaUiTextRequest["style"],
): NormalizedSkiaUiTextStyle => {
	const fontSizePx =
		Number.isFinite(style?.fontSizePx) && (style?.fontSizePx ?? 0) > 0
			? (style?.fontSizePx ?? DEFAULT_FONT_SIZE_PX)
			: DEFAULT_FONT_SIZE_PX;
	const lineHeightPx =
		Number.isFinite(style?.lineHeightPx) && (style?.lineHeightPx ?? 0) > 0
			? (style?.lineHeightPx ?? fontSizePx * DEFAULT_LINE_HEIGHT_MULTIPLIER)
			: fontSizePx * DEFAULT_LINE_HEIGHT_MULTIPLIER;
	const paddingPx =
		Number.isFinite(style?.paddingPx) && (style?.paddingPx ?? 0) >= 0
			? (style?.paddingPx ?? DEFAULT_TEXT_PADDING_PX)
			: DEFAULT_TEXT_PADDING_PX;
	const fontFamily = style?.fontFamily?.trim() || DEFAULT_FONT_FAMILY;
	const rawFontWeight = style?.fontWeight;
	const fontWeight =
		typeof rawFontWeight === "number"
			? `${rawFontWeight}`
			: rawFontWeight?.trim() || DEFAULT_FONT_WEIGHT;
	return {
		fontFamily,
		fontSizePx,
		fontWeight,
		lineHeightPx,
		color: style?.color?.trim() || DEFAULT_TEXT_COLOR,
		paddingPx,
	};
};

const buildCanvasFont = (style: NormalizedSkiaUiTextStyle): string =>
	`${style.fontWeight} ${style.fontSizePx}px ${style.fontFamily}`;

const resolvePositiveMetric = (value: number | undefined): number | null => {
	return Number.isFinite(value) && (value ?? 0) > 0 ? (value ?? 0) : null;
};

const resolveNonNegativeMetric = (value: number | undefined): number | null => {
	return Number.isFinite(value) && (value ?? 0) >= 0 ? (value ?? 0) : null;
};

const resolveStableFontMetrics = (
	style: NormalizedSkiaUiTextStyle,
	font: string,
	context: CanvasRenderingContext2D | null,
): StableFontMetrics => {
	const cachedMetrics = fontMetricsByFont.get(font);
	if (cachedMetrics) {
		return cachedMetrics;
	}

	const fallbackAscent = style.fontSizePx * DEFAULT_ASCENT_FALLBACK_RATIO;
	const fallbackDescent = Math.max(1, style.fontSizePx - fallbackAscent);
	let ascent = fallbackAscent;
	let descent = fallbackDescent;

	if (context) {
		context.font = font;
		const metrics = context.measureText(DEFAULT_FONT_METRICS_SAMPLE_TEXT);
		const fontBoundingBoxAscent = resolvePositiveMetric(
			metrics.fontBoundingBoxAscent,
		);
		const fontBoundingBoxDescent = resolveNonNegativeMetric(
			metrics.fontBoundingBoxDescent,
		);
		if (fontBoundingBoxAscent !== null && fontBoundingBoxDescent !== null) {
			ascent = fontBoundingBoxAscent;
			descent = fontBoundingBoxDescent;
		} else {
			const actualBoundingBoxAscent = resolvePositiveMetric(
				metrics.actualBoundingBoxAscent,
			);
			const actualBoundingBoxDescent = resolveNonNegativeMetric(
				metrics.actualBoundingBoxDescent,
			);
			if (actualBoundingBoxAscent !== null) {
				ascent = actualBoundingBoxAscent;
			}
			if (actualBoundingBoxDescent !== null) {
				descent = actualBoundingBoxDescent;
			}
		}
	}

	const stableMetrics = {
		ascent,
		descent,
		height: Math.max(1, ascent + descent),
	};
	fontMetricsByFont.set(font, stableMetrics);
	return stableMetrics;
};

const measureTextWidth = (
	text: string,
	style: NormalizedSkiaUiTextStyle,
): number => {
	if (!text) return 0;
	const context = getMeasureContext();
	const fallbackWidth = estimateTextWidth(text, style.fontSizePx);
	if (!context) return fallbackWidth;
	context.font = buildCanvasFont(style);
	const metrics = context.measureText(text);
	if (Number.isFinite(metrics.width) && metrics.width > 0) {
		return metrics.width;
	}
	return fallbackWidth;
};

const fitTextToMaxWidth = (
	text: string,
	style: NormalizedSkiaUiTextStyle,
	maxWidthPx: number | undefined,
): string => {
	if (!text) return "";
	if (!Number.isFinite(maxWidthPx)) return text;
	const availableWidth = Math.max(0, (maxWidthPx ?? 0) - style.paddingPx * 2);
	if (availableWidth <= 0) return "";
	if (measureTextWidth(text, style) <= availableWidth) {
		return text;
	}

	const ellipsisWidth = measureTextWidth(DEFAULT_TEXT_ELLIPSIS, style);
	if (ellipsisWidth > availableWidth) {
		return "";
	}

	const glyphs = Array.from(text);
	let low = 0;
	let high = glyphs.length;

	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		const candidate = `${glyphs.slice(0, middle).join("")}${DEFAULT_TEXT_ELLIPSIS}`;
		if (measureTextWidth(candidate, style) <= availableWidth) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}

	if (low <= 0) return DEFAULT_TEXT_ELLIPSIS;
	return `${glyphs.slice(0, low).join("")}${DEFAULT_TEXT_ELLIPSIS}`;
};

const measureTextLayout = (
	request: NormalizedSkiaUiTextRequest,
): MeasuredTextLayout => {
	const context = getMeasureContext();
	const fallbackWidth = estimateTextWidth(
		request.text,
		request.style.fontSizePx,
	);
	const font = buildCanvasFont(request.style);
	let measuredWidth = fallbackWidth;
	const stableFontMetrics = resolveStableFontMetrics(
		request.style,
		font,
		context,
	);

	if (context) {
		context.font = font;
		const metrics = context.measureText(request.text);
		if (Number.isFinite(metrics.width) && metrics.width > 0) {
			measuredWidth = metrics.width;
		}
	}

	const lineHeightPx = Math.max(
		request.style.lineHeightPx,
		stableFontMetrics.height,
	);
	const textWidth = Math.max(
		1,
		Math.ceil(measuredWidth + request.style.paddingPx * 2),
	);
	const textHeight = Math.max(
		1,
		Math.ceil(lineHeightPx + request.style.paddingPx * 2),
	);

	return {
		font,
		paddingPx: request.style.paddingPx,
		lineHeightPx,
		fontAscent: stableFontMetrics.ascent,
		fontHeight: stableFontMetrics.height,
		textWidth,
		textHeight,
	};
};

const rasterizeTextSpriteDefault = (
	request: NormalizedSkiaUiTextRequest,
): RasterizedTextSprite => {
	if (!request.text) {
		return {
			image: null,
			textWidth: 0,
			textHeight: 0,
		};
	}
	const measuredLayout = measureTextLayout(request);
	if (typeof document === "undefined") {
		return {
			image: null,
			textWidth: measuredLayout.textWidth,
			textHeight: measuredLayout.textHeight,
		};
	}
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) {
		return {
			image: null,
			textWidth: measuredLayout.textWidth,
			textHeight: measuredLayout.textHeight,
		};
	}

	const dprBucket = request.dprBucket;
	canvas.width = Math.max(1, Math.ceil(measuredLayout.textWidth * dprBucket));
	canvas.height = Math.max(1, Math.ceil(measuredLayout.textHeight * dprBucket));
	context.setTransform(dprBucket, 0, 0, dprBucket, 0, 0);
	context.clearRect(0, 0, measuredLayout.textWidth, measuredLayout.textHeight);
	context.font = measuredLayout.font;
	context.textAlign = "left";
	context.textBaseline = "alphabetic";
	context.fillStyle = request.style.color;
	const baselineY =
		measuredLayout.paddingPx +
		(measuredLayout.lineHeightPx - measuredLayout.fontHeight) / 2 +
		measuredLayout.fontAscent;
	context.fillText(request.text, measuredLayout.paddingPx, baselineY);

	try {
		return {
			image: Skia.Image.MakeImageFromNativeBuffer(canvas),
			textWidth: measuredLayout.textWidth,
			textHeight: measuredLayout.textHeight,
		};
	} catch {
		return {
			image: null,
			textWidth: measuredLayout.textWidth,
			textHeight: measuredLayout.textHeight,
		};
	}
};

const resolveTextKey = (signature: string): TextKey | null => {
	const keyRef = keyRefBySignature.get(signature);
	if (!keyRef) return null;
	const key = keyRef.deref();
	if (!key) {
		keyRefBySignature.delete(signature);
		return null;
	}
	return key;
};

const getTextRasterEntry = (signature: string): TextRasterEntry | null => {
	const key = resolveTextKey(signature);
	if (!key) return null;
	return entryByKey.get(key) ?? null;
};

const createTextRasterEntry = (
	request: NormalizedSkiaUiTextRequest,
): { key: TextKey; entry: TextRasterEntry } => {
	const key: TextKey = { signature: request.signature };
	const payload: FinalizedTextEntryPayload = {
		signature: request.signature,
		image: null,
	};
	const isEmptyText = request.text.length === 0;
	const measuredLayout = isEmptyText ? null : measureTextLayout(request);
	const entry: TextRasterEntry = {
		cacheKey: request.signature,
		text: request.text,
		image: null,
		textWidth: measuredLayout?.textWidth ?? 0,
		textHeight: measuredLayout?.textHeight ?? 0,
		ready: isEmptyText,
	};
	entryByKey.set(key, entry);
	keyRefBySignature.set(request.signature, new WeakRef(key));
	if ((subscriberBySignature.get(request.signature)?.size ?? 0) > 0) {
		retainedKeyBySignature.set(request.signature, key);
	}
	heldValueByKey.set(key, payload);
	finalizationRegistry?.register(key, payload, key);
	return { key, entry };
};

const getOrCreateTextRasterEntry = (
	request: NormalizedSkiaUiTextRequest,
): { key: TextKey; entry: TextRasterEntry } => {
	sweepWeakIndex();
	const key = resolveTextKey(request.signature);
	if (!key) return createTextRasterEntry(request);
	const cachedEntry = entryByKey.get(key);
	if (cachedEntry) return { key, entry: cachedEntry };
	return createTextRasterEntry(request);
};

const notifySubscribers = (signature: string) => {
	const subscribers = subscriberBySignature.get(signature);
	if (!subscribers || subscribers.size === 0) return;
	for (const callback of [...subscribers]) {
		try {
			callback();
		} catch (error) {
			console.warn("Skia UI 文本订阅回调执行失败:", error);
		}
	}
};

const processRasterTask = (signature: string) => {
	const task = taskBySignature.get(signature);
	if (!task) return;
	taskBySignature.delete(signature);
	try {
		const { key, entry } = getOrCreateTextRasterEntry(task.request);
		if (!entry.ready) {
			const nextSprite = rasterizeTextSpriteProvider(task.request);
			const previousImage = entry.image;
			if (previousImage !== nextSprite.image) {
				disposeImage(previousImage);
			}
			entry.image = nextSprite.image;
			entry.textWidth = nextSprite.textWidth;
			entry.textHeight = nextSprite.textHeight;
			entry.ready = true;
			const payload = heldValueByKey.get(key);
			if (payload) {
				payload.image = nextSprite.image;
			}
		}
		task.resolve();
	} catch (error) {
		task.reject(error);
	} finally {
		inflightBySignature.delete(signature);
		notifySubscribers(signature);
	}
};

const drainRasterQueueFrame = () => {
	scheduledFrameId = null;
	scheduledFrameType = null;
	if (rasterQueue.length === 0) return;
	const frameStart = nowProvider();
	let processedCount = 0;
	while (rasterQueue.length > 0 && processedCount < MAX_RASTERS_PER_FRAME) {
		if (processedCount > 0) {
			const elapsedMs = nowProvider() - frameStart;
			if (elapsedMs >= MAX_RASTER_MS_PER_FRAME) {
				break;
			}
		}
		const signature = rasterQueue.shift();
		if (!signature) break;
		queuedSignatureSet.delete(signature);
		processRasterTask(signature);
		processedCount += 1;
	}
	if (rasterQueue.length > 0) {
		scheduleRasterQueueFrame();
	}
};

const scheduleRasterQueueFrame = () => {
	if (scheduledFrameId !== null) return;
	if (
		typeof window !== "undefined" &&
		typeof window.requestAnimationFrame === "function"
	) {
		scheduledFrameType = "raf";
		scheduledFrameId = window.requestAnimationFrame(() => {
			drainRasterQueueFrame();
		});
		return;
	}
	scheduledFrameType = "timeout";
	scheduledFrameId = setTimeout(() => {
		drainRasterQueueFrame();
	}, 0) as unknown as number;
};

const cancelScheduledFrame = () => {
	if (scheduledFrameId === null) return;
	if (scheduledFrameType === "raf") {
		window.cancelAnimationFrame(scheduledFrameId);
	} else {
		clearTimeout(scheduledFrameId);
	}
	scheduledFrameId = null;
	scheduledFrameType = null;
};

const sweepWeakIndex = () => {
	if (keyRefBySignature.size === 0) {
		sweepIterator = null;
		return;
	}
	if (!sweepIterator) {
		sweepIterator = keyRefBySignature.entries();
	}
	for (let step = 0; step < SWEEP_STEPS_PER_CALL; step += 1) {
		const next = sweepIterator.next();
		if (next.done) {
			sweepIterator = null;
			break;
		}
		const [signature, keyRef] = next.value;
		if (keyRef.deref() !== undefined) continue;
		retainedKeyBySignature.delete(signature);
		keyRefBySignature.delete(signature);
		inflightBySignature.delete(signature);
		taskBySignature.delete(signature);
		subscriberBySignature.delete(signature);
		queuedSignatureSet.delete(signature);
	}
};

const resolveRequestNumericValue = (
	value: number | { value: unknown } | undefined,
): number | undefined => {
	if (Number.isFinite(value)) {
		return value as number;
	}
	if (typeof value !== "object" || value === null || !("value" in value)) {
		return undefined;
	}
	const sharedValue = (value as { value?: unknown }).value;
	if (!Number.isFinite(sharedValue)) {
		return undefined;
	}
	return sharedValue as number;
};

const toNormalizedTextRequest = (
	request: SkiaUiTextRequest | NormalizedSkiaUiTextRequest,
): NormalizedSkiaUiTextRequest => {
	if ("signature" in request && typeof request.signature === "string") {
		return request;
	}
	const sourceRequest = request as SkiaUiTextRequest;
	const text = String(sourceRequest.text ?? "");
	const style = normalizeTextStyle(sourceRequest.style);
	const dprBucket = normalizeDprBucket(sourceRequest.dprBucket);
	const fittedText = fitTextToMaxWidth(
		text,
		style,
		resolveRequestNumericValue(
			sourceRequest.maxWidthPx as number | { value: unknown } | undefined,
		),
	);
	const signature = JSON.stringify([
		fittedText,
		style.fontFamily,
		style.fontSizePx,
		style.fontWeight,
		style.lineHeightPx,
		style.color,
		style.paddingPx,
		dprBucket,
	]);
	return {
		text: fittedText,
		style,
		dprBucket,
		signature,
	};
};

export const normalizeTextSignature = (request: SkiaUiTextRequest): string => {
	return toNormalizedTextRequest(request).signature;
};

export const resolveTextRasterEntry = (
	request: SkiaUiTextRequest | NormalizedSkiaUiTextRequest,
): TextRasterEntry => {
	const normalizedRequest = toNormalizedTextRequest(request);
	const { entry } = getOrCreateTextRasterEntry(normalizedRequest);
	return entry;
};

export const subscribeTextRaster = (
	signature: string,
	callback: () => void,
): (() => void) => {
	let subscriberSet = subscriberBySignature.get(signature);
	if (!subscriberSet) {
		subscriberSet = new Set();
		subscriberBySignature.set(signature, subscriberSet);
	}
	subscriberSet.add(callback);
	const key = resolveTextKey(signature);
	if (key) {
		retainedKeyBySignature.set(signature, key);
	}
	return () => {
		const currentSet = subscriberBySignature.get(signature);
		if (!currentSet) return;
		currentSet.delete(callback);
		if (currentSet.size === 0) {
			subscriberBySignature.delete(signature);
			retainedKeyBySignature.delete(signature);
		}
	};
};

export const enqueueTextRaster = (
	signature: string,
	request: SkiaUiTextRequest | NormalizedSkiaUiTextRequest,
): Promise<void> => {
	const normalizedRequest = toNormalizedTextRequest(request);
	if (normalizedRequest.signature !== signature) {
		return enqueueTextRaster(normalizedRequest.signature, normalizedRequest);
	}
	sweepWeakIndex();
	const entry = getTextRasterEntry(signature);
	if (entry?.ready) {
		return Promise.resolve();
	}
	const inflight = inflightBySignature.get(signature);
	if (inflight) {
		return inflight;
	}
	const promise = new Promise<void>((resolve, reject) => {
		taskBySignature.set(signature, {
			request: normalizedRequest,
			resolve,
			reject,
		});
	});
	inflightBySignature.set(signature, promise);
	if (!queuedSignatureSet.has(signature)) {
		queuedSignatureSet.add(signature);
		rasterQueue.push(signature);
	}
	scheduleRasterQueueFrame();
	return promise;
};

export const __cleanupFinalizedTextEntryForTests = (
	payload: FinalizedTextEntryPayload,
) => {
	cleanupFinalizedEntry(payload);
};

export const __processSkiaUiTextRasterQueueFrameForTests = () => {
	drainRasterQueueFrame();
};

export const __setSkiaUiTextRasterNowProviderForTests = (
	provider: (() => number) | null,
) => {
	nowProvider =
		provider ??
		(() => {
			if (
				typeof performance !== "undefined" &&
				typeof performance.now === "function"
			) {
				return performance.now();
			}
			return Date.now();
		});
};

export const __setSkiaUiTextRasterizerForTests = (
	provider:
		| ((request: NormalizedSkiaUiTextRequest) => RasterizedTextSprite)
		| null,
) => {
	rasterizeTextSpriteProvider =
		provider ?? ((request) => rasterizeTextSpriteDefault(request));
};

export const __peekTextRasterEntryForTests = (
	signature: string,
): TextRasterEntry | null => {
	return getTextRasterEntry(signature);
};

export const __injectCollectedWeakRefForTests = (signature: string) => {
	keyRefBySignature.set(signature, {
		deref: () => undefined,
	} as unknown as WeakRef<TextKey>);
};

export const __hasWeakIndexSignatureForTests = (signature: string): boolean => {
	return keyRefBySignature.has(signature);
};

export const __getSkiaUiTextStoreStatsForTests = () => {
	return {
		keyRefCount: keyRefBySignature.size,
		retainedKeyCount: retainedKeyBySignature.size,
		inflightCount: inflightBySignature.size,
		subscriberCount: subscriberBySignature.size,
		queueCount: rasterQueue.length,
		taskCount: taskBySignature.size,
	};
};

export const __resetSkiaUiTextStoreForTests = () => {
	cancelScheduledFrame();
	for (const [signature, keyRef] of keyRefBySignature.entries()) {
		const key = keyRef.deref();
		if (!key) continue;
		const entry = entryByKey.get(key);
		disposeImage(entry?.image);
		finalizationRegistry?.unregister(key);
		keyRefBySignature.delete(signature);
	}
	retainedKeyBySignature.clear();
	inflightBySignature.clear();
	subscriberBySignature.clear();
	taskBySignature.clear();
	rasterQueue.length = 0;
	queuedSignatureSet.clear();
	sweepIterator = null;
	measureCanvas = null;
	measureContext = null;
	fontMetricsByFont.clear();
	__setSkiaUiTextRasterNowProviderForTests(null);
	__setSkiaUiTextRasterizerForTests(null);
};

export const __sweepWeakTextIndexForTests = () => {
	sweepWeakIndex();
};
