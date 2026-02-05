import type { AudioBufferSink } from "mediabunny";
import React, {
	useCallback,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
} from "react";
import { framesToSeconds } from "@/utils/timecode";
import { getPixelsPerFrame } from "@/editor/utils/timelineScale";
import { getWaveformThumbnail } from "@/dsl/audioWaveformCache";

type AudioWaveformCanvasProps = {
	uri?: string;
	audioSink: AudioBufferSink | null;
	audioDuration: number;
	start: number;
	end: number;
	fps: number;
	timelineScale: number;
	offsetFrames: number;
	scrollLeft: number;
	color: string;
	className?: string;
};

export const AudioWaveformCanvas: React.FC<AudioWaveformCanvasProps> = ({
	uri,
	audioSink,
	audioDuration,
	start,
	end,
	fps,
	timelineScale,
	offsetFrames,
	scrollLeft,
	color,
	className,
}) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const renderTokenRef = useRef(0);
	const lastRenderKeyRef = useRef("");
	const lastUriRef = useRef<string | null>(null);
	const scheduleIdRef = useRef<number | null>(null);

	const getAudioSink = useEffectEvent(() => audioSink);
	const getAudioDuration = useEffectEvent(() => audioDuration);

	const clipDurationFrames = end - start;
	const clipDurationSeconds = framesToSeconds(clipDurationFrames, fps);
	const clipStartSeconds = framesToSeconds(start, fps);
	const clipEndSeconds = clipStartSeconds + clipDurationSeconds;
	const offsetSeconds = framesToSeconds(offsetFrames, fps);

	const generateWaveform = useCallback(async () => {
		if (!canvasRef.current || !uri || clipDurationSeconds <= 0) return;

		const canvas = canvasRef.current;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let canvasWidth = 0;
		let canvasHeight = 0;
		let pixelRatio = 1;

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
			canvasHeight = rect.height;
			if (clipWidth <= 0 || canvasHeight <= 0) return;

			const visibleStartX = Math.max(0, Math.floor(visibleLeft - rect.left));
			const visibleEndX = Math.min(
				clipWidth,
				Math.ceil(visibleRight - rect.left),
			);
			const viewportWidth = viewportRect.width;
			if (viewportWidth <= 0) return;

			const useViewportWidth = clipWidth > viewportWidth;
			const canvasOffsetX = useViewportWidth ? visibleStartX : 0;
			canvasWidth = Math.max(
				1,
				Math.ceil(useViewportWidth ? viewportWidth : clipWidth),
			);
			if (canvasWidth <= 0 || canvasHeight <= 0) return;

			pixelRatio = Math.max(1, window.devicePixelRatio || 1);
			const targetWidth = Math.max(1, Math.floor(canvasWidth * pixelRatio));
			const targetHeight = Math.max(1, Math.floor(canvasHeight * pixelRatio));

			const nextStyleTransform = `translateX(${canvasOffsetX}px)`;
			const nextStyleWidth = `${canvasWidth}px`;
			const nextStyleHeight = `${canvasHeight}px`;

			// 先更新平移，避免缩放中画面被移出可视区
			canvas.style.transform = nextStyleTransform;

			const currentAudioSink = getAudioSink();
			const currentAudioDuration = getAudioDuration();
			if (!currentAudioSink || currentAudioDuration <= 0) {
				if (ctx) {
					ctx.setTransform(1, 0, 0, 1, 0, 0);
					ctx.clearRect(0, 0, canvas.width, canvas.height);
				}
				lastRenderKeyRef.current = "";
				return;
			}

			const pixelsPerSecond =
				getPixelsPerFrame(fps, timelineScale) * fps;
			const safePixelsPerSecond = Math.max(1e-6, pixelsPerSecond);
			const waveTileWidth = Math.max(24, Math.round(canvasHeight * 2));
			const tileDuration = waveTileWidth / safePixelsPerSecond;

			const overscan = waveTileWidth * 2;
			const renderStartX = Math.max(0, visibleStartX - overscan);
			const renderEndX = Math.min(clipWidth, visibleEndX + overscan);
			const renderStartTime =
				clipStartSeconds + renderStartX / safePixelsPerSecond;
			const renderEndTime = clipStartSeconds + renderEndX / safePixelsPerSecond;
			const clipStartIndex = Math.floor(clipStartSeconds / tileDuration);
			const clipEndIndex = Math.floor(
				(clipEndSeconds - 1e-6) / tileDuration,
			);
			const startIndex = Math.max(
				clipStartIndex,
				Math.floor(renderStartTime / tileDuration),
			);
			const endIndex = Math.min(
				clipEndIndex,
				Math.ceil(renderEndTime / tileDuration) - 1,
			);
			if (endIndex < startIndex) return;

			const renderKey = [
				uri,
				start,
				clipDurationFrames,
				offsetSeconds,
				`${clipWidth}x${canvasHeight}`,
				`${canvasOffsetX}-${canvasWidth}`,
				pixelRatio,
				fps,
				timelineScale,
				color,
				currentAudioDuration,
				`${startIndex}-${endIndex}`,
			].join("|");
			if (renderKey === lastRenderKeyRef.current) return;

			const currentToken = ++renderTokenRef.current;
			const drawCanvas = document.createElement("canvas");
			drawCanvas.width = targetWidth;
			drawCanvas.height = targetHeight;
			const drawCtx = drawCanvas.getContext("2d");
			if (!drawCtx) return;
			drawCtx.setTransform(1, 0, 0, 1, 0, 0);
			drawCtx.scale(pixelRatio, pixelRatio);
			drawCtx.imageSmoothingEnabled = false;
			drawCtx.clearRect(0, 0, canvasWidth, canvasHeight);

			for (let i = startIndex; i <= endIndex; i += 1) {
				if (renderTokenRef.current !== currentToken) return;

				const tileStartTime = i * tileDuration;
				const tileEndTime = tileStartTime + tileDuration;
				const tileStartRelative = tileStartTime - clipStartSeconds;
				const tileEndRelative = tileEndTime - clipStartSeconds;
				if (tileEndRelative <= tileStartRelative) continue;

				const sourceStart = offsetSeconds + tileStartRelative;
				const sourceEnd = offsetSeconds + tileEndRelative;
				const decodeStart = Math.max(0, Math.min(sourceStart, currentAudioDuration));
				const decodeEnd = Math.max(0, Math.min(sourceEnd, currentAudioDuration));

				const tileCanvas = await getWaveformThumbnail({
					uri,
					windowStart: sourceStart,
					windowEnd: sourceEnd,
					decodeStart,
					decodeEnd,
					width: waveTileWidth,
					height: canvasHeight,
					pixelRatio,
					audioSink: currentAudioSink,
					color,
				});
				if (renderTokenRef.current !== currentToken) return;
				if (!tileCanvas) continue;

				const x = tileStartRelative * safePixelsPerSecond - canvasOffsetX;
				drawCtx.drawImage(
					tileCanvas,
					0,
					0,
					tileCanvas.width,
					tileCanvas.height,
					x,
					0,
					waveTileWidth,
					canvasHeight,
				);
			}

			if (renderTokenRef.current !== currentToken) return;
			if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
				canvas.width = targetWidth;
				canvas.height = targetHeight;
			}
			canvas.style.width = nextStyleWidth;
			canvas.style.height = nextStyleHeight;
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.imageSmoothingEnabled = false;
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(drawCanvas, 0, 0);
			lastRenderKeyRef.current = renderKey;
		} catch (error) {
			console.error("Failed to render waveform:", error);
		}
	}, [
		uri,
		start,
		clipDurationSeconds,
		clipDurationFrames,
		clipStartSeconds,
		clipEndSeconds,
		offsetSeconds,
		fps,
		timelineScale,
		color,
		getAudioDuration,
		getAudioSink,
	]);

	const scheduleGenerate = useCallback(() => {
		if (scheduleIdRef.current !== null) {
			cancelAnimationFrame(scheduleIdRef.current);
			scheduleIdRef.current = null;
		}
		scheduleIdRef.current = requestAnimationFrame(() => {
			scheduleIdRef.current = null;
			void generateWaveform();
		});
	}, [generateWaveform]);

	useEffect(() => {
		if (lastUriRef.current !== uri) {
			lastUriRef.current = uri ?? null;
			lastRenderKeyRef.current = "";
		}
		scheduleGenerate();
	}, [
		uri,
		audioDuration,
		audioSink,
		offsetSeconds,
		clipDurationSeconds,
		start,
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
		};
	}, []);

	return (
		<canvas ref={canvasRef} className={className ?? "absolute inset-y-0"} />
	);
};
