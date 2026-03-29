import type { CanvasNode } from "core/studio/types";
import {
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ClipOp,
	Group,
	Picture,
	type SharedValue,
	type SkFont,
	Skia,
	type SkPaint,
	type SkPicture,
	type SkTypeface,
	useSharedValue,
} from "react-skia-lite";
import {
	type CanvasCameraState,
	type CanvasNodeLayoutState,
	isCanvasScreenRectVisible,
	resolveCanvasNodeLayoutScreenFrame,
	resolveCanvasViewportRect,
} from "./canvasNodeLabelUtils";

const LABEL_FONT_SIZE_PX = 12;
const LABEL_LINE_HEIGHT_MULTIPLIER = 1.2;
const LABEL_LINE_HEIGHT_PX = LABEL_FONT_SIZE_PX * LABEL_LINE_HEIGHT_MULTIPLIER;
const LABEL_TEXT_HEIGHT_PX = Math.ceil(LABEL_LINE_HEIGHT_PX);
const LABEL_TEXT_COLOR = "rgba(255,255,255,0.92)";
const LABEL_GAP_PX = 6;
const LABEL_DIMMED_OPACITY = 0.45;
const LABEL_MIN_VISIBLE_WIDTH_PX = 24;
const LABEL_TEXT_ELLIPSIS = "…";
const LABEL_FONT_URI = "/Roboto-Medium.ttf";

let labelListenerSeed = 74_001;
let sharedLabelTypeface: SkTypeface | null = null;
let sharedLabelTypefacePromise: Promise<SkTypeface | null> | null = null;

interface CanvasNodeLabelLayerProps {
	width: number;
	height: number;
	camera: SharedValue<CanvasCameraState>;
	getNodeLayout: (nodeId: string) => SharedValue<CanvasNodeLayoutState> | null;
	nodes: CanvasNode[];
	focusedNodeId: string | null;
}

interface CanvasNodeLabelCandidate {
	nodeId: string;
	node: CanvasNode;
	text: string;
	opacity: number;
}

interface LabelMeasureCacheEntry {
	text: string;
	fontVersion: number;
	segments: string[];
	cumulativeAdvances: number[];
	fullAdvance: number;
	lastWidthKey: number | null;
	lastRenderedText: string;
}

interface ListenerCapableSharedValue<T = unknown> {
	value: T;
	addListener?: (listenerID: number, listener: (value: T) => void) => void;
	removeListener?: (listenerID: number) => void;
}

const createEmptyPicture = (): SkPicture => {
	const recorder = Skia.PictureRecorder();
	recorder.beginRecording();
	return recorder.finishRecordingAsPicture();
};

const setPictureSharedValue = (
	picture: SharedValue<SkPicture>,
	nextPicture: SkPicture,
) => {
	const modify = (
		picture as {
			modify?: (
				modifier: (value: SkPicture) => SkPicture,
				forceUpdate?: boolean,
			) => void;
		}
	).modify;
	if (typeof modify === "function") {
		modify(() => nextPicture, true);
		return;
	}
	(picture as { value: SkPicture }).value = nextPicture;
};

const resolveFallbackTextAdvance = (text: string): number => {
	return Math.max(0, Array.from(text).length * (LABEL_FONT_SIZE_PX * 0.6));
};

const loadLabelTypeface = async (): Promise<SkTypeface | null> => {
	if (sharedLabelTypeface) return sharedLabelTypeface;
	if (!sharedLabelTypefacePromise) {
		sharedLabelTypefacePromise = (async () => {
			try {
				const dataFactory = (
					Skia as {
						Data?: { fromURI?: (uri: string) => Promise<unknown> };
					}
				).Data;
				const typefaceFactory = (
					Skia as {
						Typeface?: {
							MakeFreeTypeFaceFromData?: (data: unknown) => SkTypeface | null;
						};
					}
				).Typeface;
				if (
					typeof dataFactory?.fromURI !== "function" ||
					typeof typefaceFactory?.MakeFreeTypeFaceFromData !== "function"
				) {
					return null;
				}
				const fontData = await dataFactory.fromURI(LABEL_FONT_URI);
				sharedLabelTypeface =
					typefaceFactory.MakeFreeTypeFaceFromData(fontData) ?? null;
				return sharedLabelTypeface;
			} catch (error) {
				console.warn(
					"[CanvasNodeLabelLayer] Failed to load label font:",
					error,
				);
				return null;
			}
		})();
	}
	return sharedLabelTypefacePromise;
};

const useCanvasNodeLabelTypeface = (): SkTypeface | null => {
	const [typeface, setTypeface] = useState<SkTypeface | null>(() => {
		return sharedLabelTypeface;
	});
	useEffect(() => {
		let cancelled = false;
		void loadLabelTypeface().then((loadedTypeface) => {
			if (cancelled || !loadedTypeface) return;
			setTypeface(loadedTypeface);
		});
		return () => {
			cancelled = true;
		};
	}, []);
	return typeface;
};

const measureTextAdvance = (
	font: SkFont,
	text: string,
	paint: SkPaint,
): number => {
	if (!text) return 0;
	try {
		const glyphIds = font.getGlyphIDs(text);
		if (glyphIds.length === 0) return 0;
		const widths = font.getGlyphWidths(glyphIds, paint);
		let total = 0;
		for (const width of widths) {
			total += width;
		}
		return Math.max(0, total);
	} catch {
		return resolveFallbackTextAdvance(text);
	}
};

const buildMeasureCacheEntry = (
	font: SkFont,
	text: string,
	paint: SkPaint,
	fontVersion: number,
): LabelMeasureCacheEntry => {
	const segments = Array.from(text);
	const cumulativeAdvances = [0];
	let runningAdvance = 0;
	for (const segment of segments) {
		runningAdvance += measureTextAdvance(font, segment, paint);
		cumulativeAdvances.push(runningAdvance);
	}
	return {
		text,
		fontVersion,
		segments,
		cumulativeAdvances,
		fullAdvance: runningAdvance,
		lastWidthKey: null,
		lastRenderedText: "",
	};
};

const resolveEllipsizedLabelText = (
	entry: LabelMeasureCacheEntry,
	maxWidthPx: number,
	ellipsisAdvancePx: number,
): string => {
	const widthKey = Math.max(0, Math.floor(maxWidthPx));
	if (entry.lastWidthKey === widthKey) {
		return entry.lastRenderedText;
	}
	if (entry.fullAdvance <= widthKey) {
		entry.lastWidthKey = widthKey;
		entry.lastRenderedText = entry.text;
		return entry.text;
	}
	if (ellipsisAdvancePx <= 0 || widthKey < ellipsisAdvancePx) {
		entry.lastWidthKey = widthKey;
		entry.lastRenderedText = "";
		return "";
	}
	const availableWidth = widthKey - ellipsisAdvancePx;
	let low = 0;
	let high = entry.segments.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		const advance = entry.cumulativeAdvances[mid] ?? Number.POSITIVE_INFINITY;
		if (advance <= availableWidth) {
			low = mid;
			continue;
		}
		high = mid - 1;
	}
	const visibleCount = Math.max(0, low);
	const nextText =
		visibleCount <= 0
			? LABEL_TEXT_ELLIPSIS
			: `${entry.segments.slice(0, visibleCount).join("")}${LABEL_TEXT_ELLIPSIS}`;
	entry.lastWidthKey = widthKey;
	entry.lastRenderedText = nextText;
	return nextText;
};

export const CanvasNodeLabelLayer = ({
	width,
	height,
	camera,
	getNodeLayout,
	nodes,
	focusedNodeId,
}: CanvasNodeLabelLayerProps) => {
	const labelTypeface = useCanvasNodeLabelTypeface();
	const viewport = useMemo(() => {
		return resolveCanvasViewportRect(width, height);
	}, [height, width]);
	const labelCandidates = useMemo<CanvasNodeLabelCandidate[]>(() => {
		if (width <= 0 || height <= 0) return [];
		return nodes
			.map((node) => {
				const labelText = node.name.trim();
				if (!labelText) return null;
				return {
					nodeId: node.id,
					node,
					text: labelText,
					opacity:
						focusedNodeId && node.id !== focusedNodeId
							? LABEL_DIMMED_OPACITY
							: 1,
				};
			})
			.filter((candidate): candidate is CanvasNodeLabelCandidate => {
				return candidate !== null;
			});
	}, [focusedNodeId, height, nodes, width]);
	const layoutByNodeId = useMemo(() => {
		const map = new Map<string, SharedValue<CanvasNodeLayoutState> | null>();
		for (const candidate of labelCandidates) {
			map.set(candidate.nodeId, getNodeLayout(candidate.nodeId));
		}
		return map;
	}, [getNodeLayout, labelCandidates]);
	const emptyPicture = useMemo(() => {
		return createEmptyPicture();
	}, []);
	const picture = useSharedValue<SkPicture>(emptyPicture);
	const textPaint = useMemo(() => {
		const paint = Skia.Paint();
		paint.setAntiAlias(true);
		paint.setColor(Skia.Color(LABEL_TEXT_COLOR));
		return paint;
	}, []);
	const alphaPaint = useMemo(() => {
		const paint = Skia.Paint();
		paint.setAntiAlias(true);
		return paint;
	}, []);
	const textFont = useMemo(() => {
		const font = Skia.Font(labelTypeface ?? undefined, LABEL_FONT_SIZE_PX);
		font.setLinearMetrics(true);
		font.setSubpixel(true);
		return font;
	}, [labelTypeface]);
	const textFontVersion = labelTypeface ? 1 : 0;
	const ellipsisAdvancePx = useMemo(() => {
		return measureTextAdvance(textFont, LABEL_TEXT_ELLIPSIS, textPaint);
	}, [textFont, textPaint]);
	const baselineOffsetPx = useMemo(() => {
		const metrics = textFont.getMetrics();
		const textHeight = Math.max(1, metrics.descent - metrics.ascent);
		return (
			-metrics.ascent + Math.max(0, (LABEL_TEXT_HEIGHT_PX - textHeight) / 2)
		);
	}, [textFont]);
	const measureCacheByNodeIdRef = useRef<Map<string, LabelMeasureCacheEntry>>(
		new Map(),
	);
	const rebuildFrameRef = useRef<number | null>(null);
	const rebuildTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const deferredDisposeFrameRef = useRef<number | null>(null);
	const deferredDisposeQueueRef = useRef<SkPicture[]>([]);
	const lifecycleEpochRef = useRef(0);

	const flushDeferredPictureDisposal = useEffectEvent(() => {
		const pending = deferredDisposeQueueRef.current;
		deferredDisposeQueueRef.current = [];
		for (const stalePicture of pending) {
			try {
				stalePicture.dispose();
			} catch {}
		}
	});

	const cancelDeferredPictureDisposal = useEffectEvent(() => {
		const frameId = deferredDisposeFrameRef.current;
		if (frameId === null) return;
		if (
			frameId >= 0 &&
			typeof window !== "undefined" &&
			typeof window.cancelAnimationFrame === "function"
		) {
			window.cancelAnimationFrame(frameId);
		}
		deferredDisposeFrameRef.current = null;
	});

	const enqueuePictureDisposal = useEffectEvent(
		(stalePicture: SkPicture | null | undefined) => {
			if (!stalePicture || stalePicture === emptyPicture) {
				return;
			}
			if (
				typeof window === "undefined" ||
				typeof window.requestAnimationFrame !== "function"
			) {
				try {
					stalePicture.dispose();
				} catch {}
				return;
			}
			deferredDisposeQueueRef.current.push(stalePicture);
			if (deferredDisposeFrameRef.current !== null) {
				return;
			}
			deferredDisposeFrameRef.current = -1;
			const frameId = window.requestAnimationFrame(() => {
				deferredDisposeFrameRef.current = null;
				flushDeferredPictureDisposal();
			});
			if (deferredDisposeFrameRef.current === null) {
				return;
			}
			deferredDisposeFrameRef.current = frameId;
		},
	);

	const pruneMeasureCache = useEffectEvent((activeNodeIdSet: Set<string>) => {
		for (const nodeId of measureCacheByNodeIdRef.current.keys()) {
			if (activeNodeIdSet.has(nodeId)) continue;
			measureCacheByNodeIdRef.current.delete(nodeId);
		}
	});

	const ensureMeasureEntry = useEffectEvent(
		(nodeId: string, text: string): LabelMeasureCacheEntry => {
			const cachedEntry = measureCacheByNodeIdRef.current.get(nodeId);
			if (
				cachedEntry &&
				cachedEntry.text === text &&
				cachedEntry.fontVersion === textFontVersion
			) {
				return cachedEntry;
			}
			const nextEntry = buildMeasureCacheEntry(
				textFont,
				text,
				textPaint,
				textFontVersion,
			);
			measureCacheByNodeIdRef.current.set(nodeId, nextEntry);
			return nextEntry;
		},
	);

	const commitPicture = useEffectEvent((nextPicture: SkPicture) => {
		const previousPicture = picture.value;
		if (previousPicture === nextPicture) {
			return;
		}
		setPictureSharedValue(picture, nextPicture);
		enqueuePictureDisposal(previousPicture);
	});

	const rebuildPicture = useCallback(() => {
		const activeNodeIdSet = new Set(
			labelCandidates.map((candidate) => candidate.nodeId),
		);
		pruneMeasureCache(activeNodeIdSet);
		if (width <= 0 || height <= 0 || labelCandidates.length === 0) {
			commitPicture(emptyPicture);
			return;
		}

		const recorder = Skia.PictureRecorder();
		const canvas = recorder.beginRecording({
			x: 0,
			y: 0,
			width: Math.max(1, width),
			height: Math.max(1, height),
		});
		const cameraState = camera.value;
		let hasVisibleLabel = false;

		for (const candidate of labelCandidates) {
			const layout = layoutByNodeId.get(candidate.nodeId);
			const frame = resolveCanvasNodeLayoutScreenFrame(
				layout?.value ?? candidate.node,
				cameraState,
			);
			const frameWidthPx = Math.max(0, Math.floor(frame.width));
			const isVisibleByWidth = frameWidthPx >= LABEL_MIN_VISIBLE_WIDTH_PX;
			if (!isVisibleByWidth || !isCanvasScreenRectVisible(frame, viewport)) {
				continue;
			}
			const measureEntry = ensureMeasureEntry(candidate.nodeId, candidate.text);
			const renderedText = resolveEllipsizedLabelText(
				measureEntry,
				frameWidthPx,
				ellipsisAdvancePx,
			);
			if (!renderedText) {
				continue;
			}
			const labelY = frame.y - LABEL_GAP_PX - LABEL_TEXT_HEIGHT_PX;
			const labelRect = {
				x: frame.x,
				y: labelY,
				width: frameWidthPx,
				height: LABEL_TEXT_HEIGHT_PX,
			};
			const requiresDimLayer = candidate.opacity < 0.999;
			if (requiresDimLayer) {
				alphaPaint.setAlphaf(candidate.opacity);
				canvas.saveLayer(alphaPaint, labelRect, null);
			}
			canvas.save();
			canvas.clipRect(labelRect, ClipOp.Intersect, true);
			canvas.drawText(
				renderedText,
				frame.x,
				labelY + baselineOffsetPx,
				textPaint,
				textFont,
			);
			canvas.restore();
			if (requiresDimLayer) {
				canvas.restore();
			}
			hasVisibleLabel = true;
		}

		const nextPicture = recorder.finishRecordingAsPicture();
		if (!hasVisibleLabel) {
			try {
				nextPicture.dispose();
			} catch {}
			commitPicture(emptyPicture);
			return;
		}
		commitPicture(nextPicture);
	}, [
		alphaPaint,
		baselineOffsetPx,
		camera,
		commitPicture,
		ellipsisAdvancePx,
		emptyPicture,
		ensureMeasureEntry,
		height,
		labelCandidates,
		layoutByNodeId,
		pruneMeasureCache,
		textFont,
		textPaint,
		viewport,
		width,
	]);

	const cancelScheduledRebuild = useCallback(() => {
		if (rebuildFrameRef.current !== null) {
			if (
				rebuildFrameRef.current >= 0 &&
				typeof window !== "undefined" &&
				typeof window.cancelAnimationFrame === "function"
			) {
				window.cancelAnimationFrame(rebuildFrameRef.current);
			}
			rebuildFrameRef.current = null;
		}
		if (rebuildTimeoutRef.current !== null) {
			clearTimeout(rebuildTimeoutRef.current);
			rebuildTimeoutRef.current = null;
		}
	}, []);

	const schedulePictureRebuild = useCallback(() => {
		if (
			rebuildFrameRef.current !== null ||
			rebuildTimeoutRef.current !== null
		) {
			return;
		}
		if (
			typeof window !== "undefined" &&
			typeof window.requestAnimationFrame === "function"
		) {
			rebuildFrameRef.current = -1;
			const frameId = window.requestAnimationFrame(() => {
				rebuildFrameRef.current = null;
				rebuildPicture();
			});
			if (rebuildFrameRef.current === null) {
				return;
			}
			rebuildFrameRef.current = frameId;
			return;
		}
		rebuildTimeoutRef.current = setTimeout(() => {
			rebuildTimeoutRef.current = null;
			rebuildPicture();
		}, 0);
	}, [rebuildPicture]);

	useEffect(() => {
		rebuildPicture();
	}, [rebuildPicture]);

	useEffect(() => {
		const detachListeners: Array<() => void> = [];
		const attachListener = (
			sharedValue:
				| ListenerCapableSharedValue<CanvasCameraState>
				| ListenerCapableSharedValue<CanvasNodeLayoutState>
				| null
				| undefined,
		) => {
			if (typeof sharedValue?.addListener !== "function") {
				return;
			}
			const listenerId = labelListenerSeed;
			labelListenerSeed += 1;
			sharedValue.addListener(listenerId, () => {
				schedulePictureRebuild();
			});
			detachListeners.push(() => {
				sharedValue.removeListener?.(listenerId);
			});
		};
		attachListener(camera as ListenerCapableSharedValue<CanvasCameraState>);
		for (const layout of layoutByNodeId.values()) {
			attachListener(
				layout as ListenerCapableSharedValue<CanvasNodeLayoutState> | null,
			);
		}
		return () => {
			for (const detach of detachListeners) {
				detach();
			}
			cancelScheduledRebuild();
		};
	}, [camera, cancelScheduledRebuild, layoutByNodeId, schedulePictureRebuild]);

	useEffect(() => {
		lifecycleEpochRef.current += 1;
		const mountEpoch = lifecycleEpochRef.current;
		return () => {
			const finalizeDispose = () => {
				if (lifecycleEpochRef.current !== mountEpoch) {
					return;
				}
				cancelScheduledRebuild();
				cancelDeferredPictureDisposal();
				flushDeferredPictureDisposal();
				measureCacheByNodeIdRef.current.clear();
				const currentPicture = picture.value;
				if (currentPicture !== emptyPicture) {
					try {
						currentPicture.dispose();
					} catch {}
				}
				try {
					emptyPicture.dispose();
				} catch {}
				try {
					textPaint.dispose();
				} catch {}
				try {
					alphaPaint.dispose();
				} catch {}
				try {
					textFont.dispose();
				} catch {}
			};
			setTimeout(() => {
				finalizeDispose();
			}, 0);
		};
	}, [
		alphaPaint,
		cancelDeferredPictureDisposal,
		cancelScheduledRebuild,
		emptyPicture,
		flushDeferredPictureDisposal,
		picture,
		textFont,
		textPaint,
	]);

	if (width <= 0 || height <= 0 || labelCandidates.length === 0) {
		return null;
	}

	return (
		<Group zIndex={999_999} pointerEvents="none">
			<Picture picture={picture} pointerEvents="none" />
		</Group>
	);
};
