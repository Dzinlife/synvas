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
	Skia,
	type SkParagraph,
	type SkPicture,
	type SkTypefaceFontProvider,
	useDerivedValue,
	useSharedValue,
} from "react-skia-lite";
import {
	FONT_REGISTRY_PRIMARY_FAMILY,
	fontRegistry,
	type RunPlan,
} from "@/typography/fontRegistry";
import {
	type CanvasCameraState,
	type CanvasNodeLayoutState,
	isCanvasScreenRectVisible,
	resolveCanvasCameraScreenOffset,
	resolveCanvasNodeLayoutScreenFrame,
	resolveCanvasViewportRect,
} from "./canvasNodeLabelUtils";

const LABEL_FONT_SIZE_PX = 12;
const LABEL_LINE_HEIGHT_MULTIPLIER = 1;
const LABEL_LINE_HEIGHT_PX = LABEL_FONT_SIZE_PX * LABEL_LINE_HEIGHT_MULTIPLIER;
const LABEL_TEXT_HEIGHT_PX = Math.ceil(LABEL_LINE_HEIGHT_PX);
const LABEL_TEXT_CLIP_PADDING_TOP_PX = 0;
const LABEL_TEXT_CLIP_PADDING_BOTTOM_PX = 1;
const LABEL_TEXT_COLOR = "rgba(255,255,255,0.92)";
const LABEL_LINE_HEIGHT_SAMPLE_TEXT = "Hg";
const LABEL_GAP_PX = 5;
const LABEL_DIMMED_OPACITY = 0.45;
const LABEL_MIN_VISIBLE_WIDTH_PX = 24;
const LABEL_TEXT_ELLIPSIS = "…";
const LABEL_PAN_COMPENSATION_ZOOM_EPSILON = 1e-6;
const LABEL_PAN_COMPENSATION_TRANSLATE_EPSILON = 1e-4;

type LabelPanCompensationTransform = Array<
	{ translateX: number } | { translateY: number }
>;

const LABEL_PAN_COMPENSATION_IDENTITY_TRANSFORM: LabelPanCompensationTransform =
	[{ translateX: 0 }, { translateY: 0 }];

let labelListenerSeed = 74_001;

interface CanvasNodeLabelLayerProps {
	width: number;
	height: number;
	camera: SharedValue<CanvasCameraState>;
	getNodeLayout: (nodeId: string) => SharedValue<CanvasNodeLayoutState> | null;
	nodes: CanvasNode[];
	focusedNodeId: string | null;
	onHitTesterChange?: (tester: CanvasNodeLabelHitTester | null) => void;
}

interface CanvasNodeLabelHitRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface CanvasNodeLabelHitTranslate {
	translateX: number;
	translateY: number;
}

export interface CanvasNodeLabelHitEntry {
	nodeId: string;
	zIndex: number;
	isFrame: boolean;
	rect: CanvasNodeLabelHitRect;
	cameraSnapshot: CanvasCameraState;
}

export interface CanvasNodeLabelHitTester {
	hitTest: (
		localX: number,
		localY: number,
		liveCamera: CanvasCameraState,
	) => string[];
}

interface CanvasNodeLabelCandidate {
	nodeId: string;
	node: CanvasNode;
	text: string;
	opacity: number;
}

interface LabelParagraphCacheEntry {
	text: string;
	fontRevision: number;
	paragraph: SkParagraph;
}

const appendFontFamilies = (
	baseFontFamilies: string[],
	extraFontFamilies: string[],
): string[] => {
	const merged: string[] = [];
	const seen = new Set<string>();
	for (const family of [...baseFontFamilies, ...extraFontFamilies]) {
		if (!family || seen.has(family)) continue;
		seen.add(family);
		merged.push(family);
	}
	return merged;
};

const collectRunPlanFamilies = (runPlan: RunPlan[]): string[] => {
	const merged: string[] = [];
	const seen = new Set<string>();
	for (const run of runPlan) {
		for (const family of run.fontFamilies) {
			if (!family || seen.has(family)) continue;
			seen.add(family);
			merged.push(family);
		}
	}
	return merged;
};

interface ListenerCapableSharedValue<T = unknown> {
	value: T;
	addListener?: (listenerID: number, listener: (value: T) => void) => void;
	removeListener?: (listenerID: number) => void;
}

const createEmptyPicture = (): SkPicture => {
	const recorder = Skia.PictureRecorder();
	let canvas: ReturnType<typeof recorder.beginRecording> | null = null;
	try {
		canvas = recorder.beginRecording();
		return recorder.finishRecordingAsPicture();
	} finally {
		(canvas as { dispose?: () => void } | null)?.dispose?.();
		recorder.dispose?.();
	}
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

const setCameraSnapshotSharedValue = (
	cameraSnapshot: SharedValue<CanvasCameraState>,
	nextCamera: CanvasCameraState,
) => {
	const modify = (
		cameraSnapshot as {
			modify?: (
				modifier: (value: CanvasCameraState) => CanvasCameraState,
				forceUpdate?: boolean,
			) => void;
		}
	).modify;
	if (typeof modify === "function") {
		modify(() => nextCamera, true);
		return;
	}
	(cameraSnapshot as { value: CanvasCameraState }).value = nextCamera;
};

const disposeParagraph = (paragraph: SkParagraph | null | undefined) => {
	if (!paragraph) return;
	try {
		paragraph.dispose();
	} catch {}
};

const resolveLabelPanCompensation = (
	liveCamera: CanvasCameraState,
	snapshotCamera: CanvasCameraState,
): CanvasNodeLabelHitTranslate => {
	if (
		Math.abs(liveCamera.zoom - snapshotCamera.zoom) >
		LABEL_PAN_COMPENSATION_ZOOM_EPSILON
	) {
		return {
			translateX: 0,
			translateY: 0,
		};
	}
	const liveOffset = resolveCanvasCameraScreenOffset(liveCamera);
	const snapshotOffset = resolveCanvasCameraScreenOffset(snapshotCamera);
	const translateX = liveOffset.x - snapshotOffset.x;
	const translateY = liveOffset.y - snapshotOffset.y;
	if (
		Math.abs(translateX) <= LABEL_PAN_COMPENSATION_TRANSLATE_EPSILON &&
		Math.abs(translateY) <= LABEL_PAN_COMPENSATION_TRANSLATE_EPSILON
	) {
		return {
			translateX: 0,
			translateY: 0,
		};
	}
	return {
		translateX,
		translateY,
	};
};

const buildLabelParagraph = ({
	text,
	runPlan,
	fontProvider,
	ellipsisFontFamilies,
}: {
	text: string;
	runPlan: RunPlan[];
	fontProvider: SkTypefaceFontProvider | null;
	ellipsisFontFamilies: string[];
}): SkParagraph => {
	const paragraphStyle = {
		maxLines: 1,
		ellipsis: LABEL_TEXT_ELLIPSIS,
	};
	const baseFontFamilies = appendFontFamilies(
		[FONT_REGISTRY_PRIMARY_FAMILY],
		ellipsisFontFamilies,
	);
	const baseStyle = {
		color: Skia.Color(LABEL_TEXT_COLOR),
		fontSize: LABEL_FONT_SIZE_PX,
		heightMultiplier: LABEL_LINE_HEIGHT_MULTIPLIER,
		...(fontProvider ? { fontFamilies: baseFontFamilies } : {}),
	};
	const builder = fontProvider
		? Skia.ParagraphBuilder.Make(paragraphStyle, fontProvider)
		: Skia.ParagraphBuilder.Make(paragraphStyle);
	try {
		if (runPlan.length <= 0) {
			builder.pushStyle(baseStyle).addText(text).pop();
			return builder.build();
		}
		for (const run of runPlan) {
			if (!run.text) continue;
			const runFontFamilies = appendFontFamilies(
				run.fontFamilies.length > 0
					? run.fontFamilies
					: [FONT_REGISTRY_PRIMARY_FAMILY],
				ellipsisFontFamilies,
			);
			builder
				.pushStyle({
					...baseStyle,
					...(fontProvider
						? {
								fontFamilies: runFontFamilies,
							}
						: {}),
				})
				.addText(run.text)
				.pop();
		}
		return builder.build();
	} finally {
		builder.dispose();
	}
};

export const CanvasNodeLabelLayer = ({
	width,
	height,
	camera,
	getNodeLayout,
	nodes,
	focusedNodeId,
	onHitTesterChange,
}: CanvasNodeLabelLayerProps) => {
	const [fontProvider, setFontProvider] =
		useState<SkTypefaceFontProvider | null>(null);
	const [fontRegistryRevision, setFontRegistryRevision] = useState(0);
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
	const labelCoverageText = useMemo(() => {
		if (labelCandidates.length <= 0) return "";
		// 覆盖集只关心字符集合，不需要换行分隔，避免注入控制字符。
		const labelText = labelCandidates
			.map((candidate) => candidate.text)
			.join("");
		// 省略号由 paragraph 在布局阶段注入，需提前纳入覆盖集，避免 glyph 缺失。
		// line-height 使用样本文字测量，样本字符也要进入覆盖集。
		return `${labelText}${LABEL_TEXT_ELLIPSIS}${LABEL_LINE_HEIGHT_SAMPLE_TEXT}`;
	}, [labelCandidates]);
	const ellipsisFontFamilies = useMemo(() => {
		void fontRegistryRevision;
		const ellipsisRunPlan =
			fontRegistry.getParagraphRunPlan(LABEL_TEXT_ELLIPSIS);
		// 缩放会改变截断位置，需保证所有 run 都能回退到可渲染省略号的字体链。
		return collectRunPlanFamilies(ellipsisRunPlan);
	}, [fontRegistryRevision]);
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
	const pictureCameraSnapshot = useSharedValue<CanvasCameraState>(camera.value);
	const picturePanCompensationTransform =
		useDerivedValue<LabelPanCompensationTransform>(() => {
			const liveCamera = camera.value;
			const snapshotCamera = pictureCameraSnapshot.value;
			const { translateX, translateY } = resolveLabelPanCompensation(
				liveCamera,
				snapshotCamera,
			);
			if (translateX === 0 && translateY === 0) {
				return LABEL_PAN_COMPENSATION_IDENTITY_TRANSFORM;
			}
			return [{ translateX }, { translateY }];
		});
	const alphaPaint = useMemo(() => {
		const paint = Skia.Paint();
		paint.setAntiAlias(true);
		return paint;
	}, []);
	const measuredLabelContentHeight = useMemo(() => {
		void fontRegistryRevision;
		if (!fontProvider) return LABEL_TEXT_HEIGHT_PX;
		try {
			const sampleParagraph = buildLabelParagraph({
				text: LABEL_LINE_HEIGHT_SAMPLE_TEXT,
				runPlan: fontRegistry.getParagraphRunPlan(
					LABEL_LINE_HEIGHT_SAMPLE_TEXT,
				),
				fontProvider,
				ellipsisFontFamilies,
			});
			try {
				sampleParagraph.layout(1_024);
				const sampleHeight = Math.max(
					1,
					Math.ceil(sampleParagraph.getHeight()),
				);
				return Math.max(LABEL_TEXT_HEIGHT_PX, sampleHeight);
			} finally {
				disposeParagraph(sampleParagraph);
			}
		} catch (error) {
			console.warn(
				"[CanvasNodeLabelLayer] Failed to measure label sample height:",
				error,
			);
			return LABEL_TEXT_HEIGHT_PX;
		}
	}, [ellipsisFontFamilies, fontProvider, fontRegistryRevision]);
	const paragraphCacheByNodeIdRef = useRef<
		Map<string, LabelParagraphCacheEntry>
	>(new Map());
	const rebuildFrameRef = useRef<number | null>(null);
	const rebuildTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const deferredDisposeFrameRef = useRef<number | null>(null);
	const deferredDisposeQueueRef = useRef<SkPicture[]>([]);
	const labelHitEntriesRef = useRef<CanvasNodeLabelHitEntry[]>([]);
	const lifecycleEpochRef = useRef(0);

	const hitTestLabelNodeIds = useEffectEvent(
		(localX: number, localY: number, liveCamera: CanvasCameraState): string[] => {
			if (!Number.isFinite(localX) || !Number.isFinite(localY)) {
				return [];
			}
			const hitNodeIds: string[] = [];
			for (const entry of labelHitEntriesRef.current) {
				const { translateX, translateY } = resolveLabelPanCompensation(
					liveCamera,
					entry.cameraSnapshot,
				);
				const left = entry.rect.x + translateX;
				const right = left + entry.rect.width;
				const top = entry.rect.y + translateY;
				const bottom = top + entry.rect.height;
				if (
					localX >= left &&
					localX <= right &&
					localY >= top &&
					localY <= bottom
				) {
					hitNodeIds.push(entry.nodeId);
				}
			}
			return hitNodeIds;
		},
	);
	const labelHitTester = useMemo<CanvasNodeLabelHitTester>(() => {
		return {
			hitTest: (localX, localY, liveCamera) => {
				return hitTestLabelNodeIds(localX, localY, liveCamera);
			},
		};
	}, [hitTestLabelNodeIds]);

	useEffect(() => {
		onHitTesterChange?.(labelHitTester);
		return () => {
			onHitTesterChange?.(null);
		};
	}, [labelHitTester, onHitTesterChange]);

	useEffect(() => {
		let disposed = false;
		void fontRegistry
			.getFontProvider()
			.then((provider) => {
				if (disposed) return;
				setFontProvider(provider);
			})
			.catch((error) => {
				console.warn(
					"[CanvasNodeLabelLayer] Failed to initialize font provider:",
					error,
				);
			});
		return () => {
			disposed = true;
		};
	}, []);

	useEffect(() => {
		const unsubscribe = fontRegistry.subscribe(() => {
			setFontRegistryRevision((prev) => prev + 1);
			void fontRegistry
				.getFontProvider()
				.then((provider) => {
					setFontProvider(provider);
				})
				.catch((error) => {
					console.warn(
						"[CanvasNodeLabelLayer] Failed to refresh font provider:",
						error,
					);
				});
		});
		return () => {
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		if (!labelCoverageText) return;
		void fontRegistry
			.ensureCoverage({ text: labelCoverageText })
			.catch((error) => {
				console.warn(
					"[CanvasNodeLabelLayer] Failed to ensure label font coverage:",
					error,
				);
			});
	}, [labelCoverageText]);

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

	const pruneParagraphCache = useEffectEvent((activeNodeIdSet: Set<string>) => {
		for (const [nodeId, entry] of paragraphCacheByNodeIdRef.current.entries()) {
			if (activeNodeIdSet.has(nodeId)) continue;
			disposeParagraph(entry.paragraph);
			paragraphCacheByNodeIdRef.current.delete(nodeId);
		}
	});

	const ensureParagraph = useEffectEvent(
		(nodeId: string, text: string): SkParagraph | null => {
			if (!fontProvider || !text) return null;
			const cachedEntry = paragraphCacheByNodeIdRef.current.get(nodeId);
			if (
				cachedEntry &&
				cachedEntry.text === text &&
				cachedEntry.fontRevision === fontRegistryRevision
			) {
				return cachedEntry.paragraph;
			}
			if (cachedEntry) {
				disposeParagraph(cachedEntry.paragraph);
				paragraphCacheByNodeIdRef.current.delete(nodeId);
			}
			try {
				const paragraph = buildLabelParagraph({
					text,
					runPlan: fontRegistry.getParagraphRunPlan(text),
					fontProvider,
					ellipsisFontFamilies,
				});
				paragraphCacheByNodeIdRef.current.set(nodeId, {
					text,
					fontRevision: fontRegistryRevision,
					paragraph,
				});
				return paragraph;
			} catch (error) {
				console.warn(
					"[CanvasNodeLabelLayer] Failed to build label paragraph:",
					error,
				);
				return null;
			}
		},
	);

	const commitPicture = useEffectEvent((nextPicture: SkPicture) => {
		const previousPicture = picture.value;
		if (previousPicture === nextPicture) {
			return;
		}
		setPictureSharedValue(picture, nextPicture);
		setCameraSnapshotSharedValue(pictureCameraSnapshot, camera.value);
		enqueuePictureDisposal(previousPicture);
	});

	const rebuildPicture = useCallback(() => {
		void fontRegistryRevision;
		const activeNodeIdSet = new Set(
			labelCandidates.map((candidate) => candidate.nodeId),
		);
		pruneParagraphCache(activeNodeIdSet);
		if (
			width <= 0 ||
			height <= 0 ||
			labelCandidates.length === 0 ||
			!fontProvider
		) {
			labelHitEntriesRef.current = [];
			commitPicture(emptyPicture);
			return;
		}

		const recorder = Skia.PictureRecorder();
		let recordingCanvas: ReturnType<typeof recorder.beginRecording> | null = null;
		try {
			recordingCanvas = recorder.beginRecording({
				x: 0,
				y: 0,
				width: Math.max(1, width),
				height: Math.max(1, height),
			});
			const cameraState = camera.value;
			let hasVisibleLabel = false;
			const nextLabelHitEntries: CanvasNodeLabelHitEntry[] = [];

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
				const paragraph = ensureParagraph(candidate.nodeId, candidate.text);
				if (!paragraph) {
					continue;
				}
				let paragraphHeight = LABEL_TEXT_HEIGHT_PX;
				try {
					paragraph.layout(frameWidthPx);
					paragraphHeight = Math.max(1, Math.ceil(paragraph.getHeight()));
				} catch (error) {
					console.warn(
						"[CanvasNodeLabelLayer] Failed to layout label paragraph:",
						error,
					);
					continue;
				}
				const labelContentHeight = Math.max(
					measuredLabelContentHeight,
					paragraphHeight,
				);
				const labelClipHeight =
					labelContentHeight +
					LABEL_TEXT_CLIP_PADDING_TOP_PX +
					LABEL_TEXT_CLIP_PADDING_BOTTOM_PX;
				const labelY = frame.y - LABEL_GAP_PX - labelClipHeight;
				const labelRect = {
					x: frame.x,
					y: labelY,
					width: frameWidthPx,
					height: labelClipHeight,
				};
				// 命中宽度与可见文字宽度对齐，避免右侧空白误命中。
				let labelHitWidth = frameWidthPx;
				try {
					const longestLine = paragraph.getLongestLine();
					if (Number.isFinite(longestLine)) {
						labelHitWidth = Math.min(
							frameWidthPx,
							Math.max(1, Math.ceil(longestLine)),
						);
					}
				} catch (error) {
					console.warn(
						"[CanvasNodeLabelLayer] Failed to resolve label hit width:",
						error,
					);
				}
					nextLabelHitEntries.push({
						nodeId: candidate.nodeId,
						zIndex: candidate.node.zIndex,
						isFrame: candidate.node.type === "frame",
						rect: {
							x: labelRect.x,
							y: labelRect.y,
							width: labelHitWidth,
							// 命中区域向下补齐 gap，避免 label 与 node 顶边之间出现交互空隙。
							height: labelRect.height + LABEL_GAP_PX,
						},
						cameraSnapshot: {
							x: cameraState.x,
						y: cameraState.y,
						zoom: cameraState.zoom,
					},
				});
				const requiresDimLayer = candidate.opacity < 0.999;
				if (requiresDimLayer) {
					alphaPaint.setAlphaf(candidate.opacity);
					recordingCanvas.saveLayer(alphaPaint, labelRect, null);
				}
				try {
					const verticalOffset = Math.max(
						0,
						(labelContentHeight - paragraphHeight) / 2,
					);
					const textY = labelY + LABEL_TEXT_CLIP_PADDING_TOP_PX + verticalOffset;
					recordingCanvas.save();
					recordingCanvas.clipRect(labelRect, ClipOp.Intersect, true);
					paragraph.paint(recordingCanvas, frame.x, textY);
					recordingCanvas.restore();
					hasVisibleLabel = true;
				} catch (error) {
					console.warn(
						"[CanvasNodeLabelLayer] Failed to paint label paragraph:",
						error,
					);
				}
				if (requiresDimLayer) {
					recordingCanvas.restore();
				}
			}
			labelHitEntriesRef.current = nextLabelHitEntries;

			const nextPicture = recorder.finishRecordingAsPicture();
			if (!hasVisibleLabel) {
				labelHitEntriesRef.current = [];
				try {
					nextPicture.dispose();
				} catch {}
				commitPicture(emptyPicture);
				return;
			}
			commitPicture(nextPicture);
		} finally {
			(recordingCanvas as { dispose?: () => void } | null)?.dispose?.();
			recorder.dispose?.();
		}
	}, [
		alphaPaint,
		camera,
		commitPicture,
		emptyPicture,
		ensureParagraph,
		fontRegistryRevision,
		fontProvider,
		height,
		labelCandidates,
		layoutByNodeId,
		measuredLabelContentHeight,
		pruneParagraphCache,
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
				for (const entry of paragraphCacheByNodeIdRef.current.values()) {
					disposeParagraph(entry.paragraph);
				}
				paragraphCacheByNodeIdRef.current.clear();
				labelHitEntriesRef.current = [];
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
					alphaPaint.dispose();
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
	]);

	if (width <= 0 || height <= 0 || labelCandidates.length === 0) {
		return null;
	}

	return (
		<Group zIndex={999_999} pointerEvents="none">
			<Group transform={picturePanCompensationTransform} pointerEvents="none">
				<Picture picture={picture} pointerEvents="none" />
			</Group>
		</Group>
	);
};
