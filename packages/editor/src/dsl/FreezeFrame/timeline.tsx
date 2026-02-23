import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AssetHandle } from "@/assets/AssetStore";
import { acquireVideoAsset, type VideoAsset } from "@/assets/videoAsset";
import { useFps, useTimelineScale, useTimelineStore } from "@/editor/contexts/TimelineContext";
import { framesToSeconds } from "@/utils/timecode";
import { getThumbnail, getVideoSize } from "../VideoClip/thumbnailCache";
import { createModelSelector } from "../model/registry";
import type { TimelineProps } from "../model/types";
import { alignSourceTime, type FreezeFrameProps } from "./model";

interface FreezeFrameTimelineProps extends TimelineProps {
	id: string;
}

const useFreezeFrameSelector = createModelSelector<FreezeFrameProps>();

const resolveSourceTime = (props: FreezeFrameProps, fps: number): number => {
	if (Number.isFinite(props.sourceTime)) {
		return Math.max(0, props.sourceTime as number);
	}
	if (Number.isFinite(props.sourceFrame)) {
		return framesToSeconds(Math.max(0, Math.round(props.sourceFrame as number)), fps);
	}
	return 0;
};

export const FreezeFrameTimeline: React.FC<FreezeFrameTimelineProps> = ({
	id,
}) => {
	const name = useTimelineStore((state) => state.getElementById(id)?.name);
	const { fps } = useFps();
	const { timelineScale } = useTimelineScale();
	const uri = useFreezeFrameSelector(id, (state) => state.props.uri);
	const sourceFrame = useFreezeFrameSelector(id, (state) => state.props.sourceFrame);
	const sourceTime = useFreezeFrameSelector(id, (state) => state.props.sourceTime);
	const isLoading = useFreezeFrameSelector(
		id,
		(state) => state.constraints.isLoading ?? false,
	);
	const hasError = useFreezeFrameSelector(
		id,
		(state) => state.constraints.hasError ?? false,
	);
	const scrollLeft = useTimelineStore((state) => state.scrollLeft);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const renderTokenRef = useRef(0);
	const lastRenderKeyRef = useRef("");
	const scheduleIdRef = useRef<number | null>(null);
	const lastUriRef = useRef<string | null>(null);
	const assetHandleRef = useRef<AssetHandle<VideoAsset> | null>(null);
	const [videoSink, setVideoSink] = useState<VideoAsset["videoSink"] | null>(null);
	const [input, setInput] = useState<VideoAsset["input"] | null>(null);
	const [videoDuration, setVideoDuration] = useState(0);

	useEffect(() => {
		let cancelled = false;
		const previousHandle = assetHandleRef.current;
		assetHandleRef.current = null;
		previousHandle?.release();
		setVideoSink(null);
		setInput(null);
		setVideoDuration(0);
		lastRenderKeyRef.current = "";
		if (!uri) return;
		void (async () => {
			try {
				const handle = await acquireVideoAsset(uri);
				if (cancelled) {
					handle.release();
					return;
				}
				assetHandleRef.current = handle;
				setVideoSink(handle.asset.videoSink);
				setInput(handle.asset.input);
				setVideoDuration(handle.asset.duration ?? 0);
			} catch (error) {
				console.warn("FreezeFrame timeline acquire asset failed:", error);
			}
		})();
		return () => {
			cancelled = true;
			const handle = assetHandleRef.current;
			assetHandleRef.current = null;
			handle?.release();
			setVideoSink(null);
			setInput(null);
			setVideoDuration(0);
		};
	}, [uri]);

	const drawThumbnail = useCallback(async () => {
		if (!canvasRef.current || !uri || !videoSink) return;
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
			canvasWidth = Math.max(
				1,
				Math.ceil(useViewportWidth ? viewportWidth : clipWidth),
			);
			if (canvasWidth <= 0 || canvasHeight <= 0) {
				return;
			}

			pixelRatio = Math.max(1, window.devicePixelRatio || 1);
			const targetWidth = Math.max(1, Math.floor(canvasWidth * pixelRatio));
			const targetHeight = Math.max(1, Math.floor(canvasHeight * pixelRatio));
			if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
				canvas.width = targetWidth;
				canvas.height = targetHeight;
			}

			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.scale(pixelRatio, pixelRatio);
			canvas.style.transform = `translateX(${canvasOffsetX}px)`;
			canvas.style.width = `${canvasWidth}px`;

			const alignedTime = alignSourceTime(
				resolveSourceTime({ uri, sourceFrame, sourceTime }, fps),
				fps,
			);
			const clampedTime =
				videoDuration > 0
					? Math.min(alignedTime, Math.max(0, videoDuration - 0.001))
					: alignedTime;
			const timeKey = Math.max(0, Math.round(clampedTime * 1000));

			const videoSize = await getVideoSize(uri, videoSink);
			const sourceAspectRatio =
				videoSize && videoSize.height > 0
					? videoSize.width / videoSize.height
					: 16 / 9;

			const thumbnailHeight = canvasHeight;
			const thumbnailWidth = Math.max(1, thumbnailHeight * sourceAspectRatio);
			const numThumbnails = Math.max(1, Math.ceil(clipWidth / thumbnailWidth));

			const overscan = thumbnailWidth * 2;
			const renderStartX = Math.max(0, visibleStartX - overscan);
			const renderEndX = Math.min(clipWidth, visibleEndX + overscan);
			const startIndex = Math.max(0, Math.floor(renderStartX / thumbnailWidth));
			const endIndex = Math.min(
				numThumbnails - 1,
				Math.ceil(renderEndX / thumbnailWidth) - 1,
			);

			const renderKey = [
				uri,
				timeKey,
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
			const thumbnail = await getThumbnail({
				uri,
				time: clampedTime,
				timeKey,
				width: thumbnailWidth,
				height: thumbnailHeight,
				pixelRatio,
				videoSink,
				input,
				preferKeyframes: false,
			});
			if (currentToken !== renderTokenRef.current) return;

			ctx.clearRect(0, 0, canvasWidth, canvasHeight);
			if (thumbnail) {
				for (let i = startIndex; i <= endIndex; i++) {
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
				}
			} else {
				ctx.fillStyle = "#0e7490";
				ctx.fillRect(0, 0, canvasWidth, canvasHeight);
			}
			lastRenderKeyRef.current = renderKey;
		} catch (error) {
			console.warn("FreezeFrame timeline draw thumbnail failed:", error);
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.scale(pixelRatio, pixelRatio);
			ctx.fillStyle = "#0e7490";
			ctx.fillRect(0, 0, canvasWidth || 1, canvasHeight || 1);
		}
	}, [
		fps,
		input,
		sourceFrame,
		sourceTime,
		timelineScale,
		uri,
		videoDuration,
		videoSink,
	]);

	const scheduleDraw = useCallback(() => {
		if (scheduleIdRef.current !== null) {
			cancelAnimationFrame(scheduleIdRef.current);
			scheduleIdRef.current = null;
		}
		scheduleIdRef.current = requestAnimationFrame(() => {
			scheduleIdRef.current = null;
			void drawThumbnail();
		});
	}, [drawThumbnail]);

	useEffect(() => {
		if (lastUriRef.current !== uri) {
			lastUriRef.current = uri ?? null;
			lastRenderKeyRef.current = "";
		}
		scheduleDraw();
	}, [uri, sourceFrame, sourceTime, videoDuration, input, scrollLeft, scheduleDraw]);

	useLayoutEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const target = canvas.parentElement ?? canvas;
		const observer = new ResizeObserver(() => {
			scheduleDraw();
		});
		observer.observe(target);
		return () => observer.disconnect();
	}, [scheduleDraw]);

	useEffect(() => {
		const handleResize = () => scheduleDraw();
		window.addEventListener("resize", handleResize, { passive: true });
		return () => window.removeEventListener("resize", handleResize);
	}, [scheduleDraw]);

	useEffect(() => {
		const scrollArea = document.querySelector<HTMLElement>(
			"[data-vertical-scroll-area]",
		);
		if (!scrollArea) return;
		const handleScroll = () => scheduleDraw();
		scrollArea.addEventListener("scroll", handleScroll, { passive: true });
		return () => scrollArea.removeEventListener("scroll", handleScroll);
	}, [scheduleDraw]);

	useEffect(() => {
		return () => {
			if (scheduleIdRef.current !== null) {
				cancelAnimationFrame(scheduleIdRef.current);
				scheduleIdRef.current = null;
			}
		};
	}, []);

	return (
		<div className="absolute inset-0 overflow-hidden bg-cyan-900">
			<div className="bg-black/25 absolute z-10 top-1 left-1 rounded-xs px-1 flex items-center gap-1 h-4.5 leading-none backdrop-blur-2xl max-w-[calc(100%-8px)] min-w-0 text-xs text-cyan-50">
				<span className="size-1.5 rounded-full bg-cyan-200 shrink-0" />
				<span className="truncate">{name || "定格"}</span>
			</div>
			<canvas ref={canvasRef} className="absolute inset-y-0" />
			{isLoading && (
				<div className="absolute inset-0 flex items-center justify-center bg-cyan-200/30 z-20">
					<div className="text-xs text-cyan-900">Loading...</div>
				</div>
			)}
			{hasError && (
				<div className="absolute inset-0 flex items-center justify-center bg-red-500/20 z-20">
					<div className="text-xs text-red-100">Load Failed</div>
				</div>
			)}
		</div>
	);
};
