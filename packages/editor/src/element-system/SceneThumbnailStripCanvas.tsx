import type React from "react";
import {
	useCallback,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	getCompositionThumbnail,
	peekCompositionThumbnail,
} from "@/element-system/Composition/thumbnailCache";
import type {
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import { getPixelsPerFrame } from "@/scene-editor/utils/timelineScale";

const framesToSeconds = (frames: number, fps: number): number => {
	const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
	return frames / safeFps;
};

const yieldToMainThread = () =>
	new Promise<void>((resolve) => {
		window.setTimeout(resolve, 0);
	});

type SceneThumbnailStripCanvasProps = {
	sceneRuntime: TimelineRuntime | null;
	runtimeManager: StudioRuntimeManager | null;
	sceneRevision: number;
	sourceFps: number;
	sourceDurationFrames: number;
	sourceCanvasSize: {
		width: number;
		height: number;
	};
	start: number;
	end: number;
	fps: number;
	timelineScale: number;
	offsetFrames: number;
	scrollLeft: number;
	isOffsetPreviewing?: boolean;
	className?: string;
};

export const SceneThumbnailStripCanvas: React.FC<
	SceneThumbnailStripCanvasProps
> = ({
	sceneRuntime,
	runtimeManager,
	sceneRevision,
	sourceFps,
	sourceDurationFrames,
	sourceCanvasSize,
	start,
	end,
	fps,
	timelineScale,
	offsetFrames,
	scrollLeft,
	isOffsetPreviewing = false,
	className,
}) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const renderTokenRef = useRef(0);
	const lastRenderKeyRef = useRef("");
	const scheduleIdRef = useRef<number | null>(null);
	const retryTimeoutRef = useRef<number | null>(null);
	const sceneKeyRef = useRef<string | null>(null);
	const [renderedOffsetFrames, setRenderedOffsetFrames] =
		useState(offsetFrames);

	const getSceneRuntime = useEffectEvent(() => sceneRuntime);
	const getRuntimeManager = useEffectEvent(() => runtimeManager);
	const getSceneRevision = useEffectEvent(() => sceneRevision);
	const getSourceFps = useEffectEvent(() => sourceFps);
	const getSourceDurationFrames = useEffectEvent(() => sourceDurationFrames);
	const getSourceCanvasSize = useEffectEvent(() => sourceCanvasSize);

	const clipDurationFrames = end - start;
	const clipDurationSeconds = framesToSeconds(clipDurationFrames, fps);
	const offsetSeconds = framesToSeconds(offsetFrames, fps);
	const pixelsPerFrame = getPixelsPerFrame(fps, timelineScale);
	const pendingOffsetShiftPx =
		(renderedOffsetFrames - offsetFrames) * pixelsPerFrame;

	const generateThumbnails = useCallback(async () => {
		if (!canvasRef.current || clipDurationSeconds <= 0) {
			return;
		}

		const canvas = canvasRef.current;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		try {
			const rect =
				canvas.parentElement?.getBoundingClientRect() ??
				canvas.getBoundingClientRect();
			const viewport = canvas.closest(
				"[data-timeline-scroll-area]",
			) as HTMLElement | null;
			const viewportRect = viewport ? viewport.getBoundingClientRect() : rect;
			const visibleLeft = Math.max(rect.left, viewportRect.left);
			const visibleRight = Math.min(rect.right, viewportRect.right);
			const visibleTop = Math.max(rect.top, viewportRect.top);
			const visibleBottom = Math.min(rect.bottom, viewportRect.bottom);
			if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
				return;
			}

			const clipWidth = rect.width;
			const canvasHeight = rect.height;
			if (clipWidth <= 0 || canvasHeight <= 0) {
				return;
			}

			const visibleStartX = Math.max(0, Math.floor(visibleLeft - rect.left));
			const visibleEndX = Math.min(
				clipWidth,
				Math.ceil(visibleRight - rect.left),
			);
			const viewportWidth = viewportRect.width;
			if (viewportWidth <= 0) {
				return;
			}

			const useViewportWidth = clipWidth > viewportWidth;
			const canvasOffsetX = useViewportWidth ? visibleStartX : 0;
			const canvasWidth = Math.max(
				1,
				Math.ceil(useViewportWidth ? viewportWidth : clipWidth),
			);
			const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
			const targetWidth = Math.max(1, Math.floor(canvasWidth * pixelRatio));
			const targetHeight = Math.max(1, Math.floor(canvasHeight * pixelRatio));
			let snapshotCanvas: HTMLCanvasElement | null = null;
			if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
				if (canvas.width > 0 && canvas.height > 0) {
					snapshotCanvas = document.createElement("canvas");
					snapshotCanvas.width = canvas.width;
					snapshotCanvas.height = canvas.height;
					const snapshotCtx = snapshotCanvas.getContext("2d");
					if (snapshotCtx) {
						snapshotCtx.drawImage(canvas, 0, 0);
					}
				}
				canvas.width = targetWidth;
				canvas.height = targetHeight;
			}
			// 和 VideoClip 一样，滚动重绘时保留已有像素，只覆盖新请求到的缩略图，
			// 这样不会因为先 clearRect 再逐张补绘而闪烁。
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.scale(pixelRatio, pixelRatio);
			canvas.style.transform = `translateX(${canvasOffsetX}px)`;
			canvas.style.width = `${canvasWidth}px`;
			canvas.style.height = `${canvasHeight}px`;
			if (snapshotCanvas) {
				ctx.drawImage(
					snapshotCanvas,
					0,
					0,
					snapshotCanvas.width,
					snapshotCanvas.height,
					0,
					0,
					canvasWidth,
					canvasHeight,
				);
			}

			const currentSceneRuntime = getSceneRuntime();
			const currentRuntimeManager = getRuntimeManager();
			if (!currentSceneRuntime || !currentRuntimeManager) {
				lastRenderKeyRef.current = "";
				return;
			}

			const currentSourceFps = Math.max(1, Math.round(getSourceFps() || 30));
			const currentSourceDurationFrames = Math.max(
				0,
				Math.round(getSourceDurationFrames() || 0),
			);
			const currentCanvasSize = getSourceCanvasSize();
			const sourceAspectRatio =
				currentCanvasSize.width > 0 && currentCanvasSize.height > 0
					? currentCanvasSize.width / currentCanvasSize.height
					: 16 / 9;
			const thumbnailHeight = canvasHeight;
			const thumbnailWidth = Math.max(1, thumbnailHeight * sourceAspectRatio);
			const numThumbnails = Math.max(1, Math.ceil(clipWidth / thumbnailWidth));
			const pixelsPerSecond = getPixelsPerFrame(fps, timelineScale) * fps;
			const safePixelsPerSecond = Math.max(1e-6, pixelsPerSecond);
			const previewIntervalSeconds = thumbnailWidth / safePixelsPerSecond;
			const overscan = thumbnailWidth * 2;
			const renderStartX = Math.max(0, visibleStartX - overscan);
			const renderEndX = Math.min(clipWidth, visibleEndX + overscan);
			const startIndex = Math.max(0, Math.floor(renderStartX / thumbnailWidth));
			const endIndex = Math.min(
				numThumbnails - 1,
				Math.ceil(renderEndX / thumbnailWidth) - 1,
			);
			const renderKey = [
				currentSceneRuntime.ref.sceneId,
				getSceneRevision(),
				clipDurationFrames,
				offsetFrames,
				currentSourceFps,
				currentSourceDurationFrames,
				`${currentCanvasSize.width}x${currentCanvasSize.height}`,
				`${clipWidth}x${canvasHeight}`,
				`${canvasOffsetX}-${canvasWidth}`,
				pixelRatio,
				timelineScale,
				`${startIndex}-${endIndex}`,
			].join("|");
			if (renderKey === lastRenderKeyRef.current) {
				return;
			}

			const currentToken = ++renderTokenRef.current;
			let didDraw = false;
			let hasPendingThumbnail = false;
			let asyncThumbnailCount = 0;
			for (let i = startIndex; i <= endIndex; i += 1) {
				if (renderTokenRef.current !== currentToken) return;
				const displaySeconds = Math.max(
					0,
					offsetSeconds + i * previewIntervalSeconds,
				);
				const displayFrame = Math.max(
					0,
					Math.round(displaySeconds * currentSourceFps),
				);
				const clampedDisplayFrame =
					currentSourceDurationFrames > 0
						? Math.min(
								Math.max(0, currentSourceDurationFrames - 1),
								displayFrame,
							)
						: displayFrame;
				const thumbnailParams = {
					sceneRuntime: currentSceneRuntime,
					runtimeManager: currentRuntimeManager,
					sceneRevision: getSceneRevision(),
					displayFrame: clampedDisplayFrame,
					width: thumbnailWidth,
					height: thumbnailHeight,
					pixelRatio,
				};
				const cachedThumbnail = peekCompositionThumbnail(thumbnailParams);
				let thumbnail = cachedThumbnail;
				if (!thumbnail) {
					if (asyncThumbnailCount > 0) {
						await yieldToMainThread();
						if (renderTokenRef.current !== currentToken) return;
					}
					asyncThumbnailCount += 1;
					thumbnail = await getCompositionThumbnail(thumbnailParams);
				}
				if (renderTokenRef.current !== currentToken) return;
				if (!thumbnail) {
					hasPendingThumbnail = true;
					continue;
				}
				const x = i * thumbnailWidth - canvasOffsetX;
				ctx.drawImage(
					thumbnail,
					0,
					0,
					thumbnail.width,
					thumbnail.height,
					x,
					0,
					thumbnailWidth,
					thumbnailHeight,
				);
				didDraw = true;
			}

			if (didDraw && !hasPendingThumbnail) {
				lastRenderKeyRef.current = renderKey;
				setRenderedOffsetFrames(offsetFrames);
				if (retryTimeoutRef.current !== null) {
					window.clearTimeout(retryTimeoutRef.current);
					retryTimeoutRef.current = null;
				}
				return;
			}

			if (hasPendingThumbnail) {
				lastRenderKeyRef.current = "";
				if (retryTimeoutRef.current !== null) {
					window.clearTimeout(retryTimeoutRef.current);
				}
				retryTimeoutRef.current = window.setTimeout(() => {
					retryTimeoutRef.current = null;
					scheduleGenerate();
				}, 80);
			}
		} catch (error) {
			console.error("Failed to generate composition thumbnails:", error);
		}
	}, [
		clipDurationFrames,
		clipDurationSeconds,
		fps,
		getRuntimeManager,
		getSceneRevision,
		getSceneRuntime,
		getSourceCanvasSize,
		getSourceDurationFrames,
		getSourceFps,
		offsetFrames,
		offsetSeconds,
		timelineScale,
	]);

	const scheduleGenerate = useCallback(() => {
		if (isOffsetPreviewing) {
			return;
		}
		if (scheduleIdRef.current !== null) {
			cancelAnimationFrame(scheduleIdRef.current);
			scheduleIdRef.current = null;
		}
		scheduleIdRef.current = requestAnimationFrame(() => {
			scheduleIdRef.current = null;
			void generateThumbnails();
		});
	}, [generateThumbnails, isOffsetPreviewing]);

	useEffect(() => {
		const nextSceneKey = sceneRuntime
			? `${sceneRuntime.ref.sceneId}:${sceneRevision}`
			: null;
		if (sceneKeyRef.current !== nextSceneKey) {
			sceneKeyRef.current = nextSceneKey;
			lastRenderKeyRef.current = "";
			renderTokenRef.current += 1;
			setRenderedOffsetFrames(offsetFrames);
			if (retryTimeoutRef.current !== null) {
				window.clearTimeout(retryTimeoutRef.current);
				retryTimeoutRef.current = null;
			}
		}
		scheduleGenerate();
	}, [
		sceneRuntime,
		sceneRevision,
		sourceFps,
		sourceDurationFrames,
		sourceCanvasSize,
		clipDurationFrames,
		offsetFrames,
		scrollLeft,
		scheduleGenerate,
	]);

	useLayoutEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const target = canvas.parentElement ?? canvas;
		const observer = new ResizeObserver(() => {
			scheduleGenerate();
		});
		observer.observe(target);
		return () => observer.disconnect();
	}, [scheduleGenerate]);

	useEffect(() => {
		const handleResize = () => scheduleGenerate();
		window.addEventListener("resize", handleResize, { passive: true });
		return () => window.removeEventListener("resize", handleResize);
	}, [scheduleGenerate]);

	useEffect(() => {
		const scrollArea = document.querySelector<HTMLElement>(
			"[data-vertical-scroll-area]",
		);
		if (!scrollArea) return;
		const handleScroll = () => scheduleGenerate();
		scrollArea.addEventListener("scroll", handleScroll, { passive: true });
		return () => scrollArea.removeEventListener("scroll", handleScroll);
	}, [scheduleGenerate]);

	useEffect(() => {
		return () => {
			if (scheduleIdRef.current !== null) {
				cancelAnimationFrame(scheduleIdRef.current);
				scheduleIdRef.current = null;
			}
			if (retryTimeoutRef.current !== null) {
				window.clearTimeout(retryTimeoutRef.current);
				retryTimeoutRef.current = null;
			}
		};
	}, []);

	return (
		<div
			className={className}
			style={{
				transform:
					pendingOffsetShiftPx === 0
						? undefined
						: `translateX(${pendingOffsetShiftPx}px)`,
			}}
		>
			<canvas ref={canvasRef} className="absolute inset-y-0" />
		</div>
	);
};
