import {
	useCallback,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { AudioGainBaselineControl } from "@/element/AudioGainBaselineControl";
import { AudioWaveformCanvas } from "@/element/AudioWaveformCanvas";
import {
	useFps,
	useTimelineScale,
	useTimelineStore,
} from "@/scene-editor/contexts/TimelineContext";
import { getPixelsPerFrame } from "@/scene-editor/utils/timelineScale";
import { isTimelineTrackMuted } from "@/scene-editor/utils/trackAudibility";
import { isVideoSourceAudioMuted } from "@/scene-editor/utils/videoClipAudioSeparation";
import { cn } from "@/lib/utils";
import { framesToSeconds } from "@/utils/timecode";
import { createModelSelector } from "../model/registry";
import type { TimelineProps } from "../model/types";
import {
	calculateVideoTime,
	type VideoClipInternal,
	type VideoClipProps,
} from "./model";
import { getThumbnail, getVideoSize } from "./thumbnailCache";

interface VideoClipTimelineProps extends TimelineProps {
	id: string;
}

const useVideoClipSelector = createModelSelector<
	VideoClipProps,
	VideoClipInternal
>();

export const VideoClipTimeline: React.FC<VideoClipTimelineProps> = ({
	id,
	start,
	end,
	offsetFrames,
}) => {
	const { fps } = useFps();
	const { timelineScale } = useTimelineScale();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const renderTokenRef = useRef(0);
	const lastRenderKeyRef = useRef("");
	const lastUriRef = useRef<string | null>(null);
	const scheduleIdRef = useRef<number | null>(null);

	// 订阅 model 状态
	const uri = useVideoClipSelector(id, (state) => state.props.uri);
	const reversed = useVideoClipSelector(id, (state) => state.props.reversed);
	const element = useTimelineStore((state) => state.getElementById(id));
	const isSourceAudioMuted = isVideoSourceAudioMuted(element);
	const clipGainDb = element?.clip?.gainDb ?? 0;

	const isLoading = useVideoClipSelector(
		id,
		(state) => state.constraints.isLoading ?? false,
	);

	// 从 Model 获取视频 sample sink 和 duration
	const videoSampleSink = useVideoClipSelector(
		id,
		(state) => state.internal.videoSampleSink,
	);
	const input = useVideoClipSelector(id, (state) => state.internal.input);
	const videoDuration = useVideoClipSelector(
		id,
		(state) => state.internal.videoDuration,
	);
	const audioSink = useVideoClipSelector(
		id,
		(state) => state.internal.audioSink,
	);
	const audioDuration = useVideoClipSelector(
		id,
		(state) => state.internal.audioDuration,
	);
	const hasSourceAudioTrack = useVideoClipSelector(
		id,
		(state) => state.internal.hasSourceAudioTrack,
	);
	const shouldShowWaveform =
		!isSourceAudioMuted && hasSourceAudioTrack !== false;

	const getVideoSampleSink = useEffectEvent(() => videoSampleSink);
	const getInput = useEffectEvent(() => input);

	const clipDurationFrames = end - start;
	const clipDurationSeconds = framesToSeconds(clipDurationFrames, fps);
	const storeOffsetFrames = useTimelineStore(
		(state) => state.getElementById(id)?.timeline?.offset ?? 0,
	);
	const timelineOffsetFrames = offsetFrames ?? storeOffsetFrames;
	const isOffsetPreviewing = offsetFrames !== undefined;
	const [renderedOffsetFrames, setRenderedOffsetFrames] =
		useState(timelineOffsetFrames);
	const pixelsPerFrame = getPixelsPerFrame(fps, timelineScale);
	const pendingOffsetShiftPx =
		(renderedOffsetFrames - timelineOffsetFrames) * pixelsPerFrame;
	const isTrackMuted = useTimelineStore((state) =>
		isTimelineTrackMuted(
			state.getElementById(id)?.timeline,
			state.tracks,
			state.audioTrackStates,
		),
	);
	const offsetSeconds = framesToSeconds(timelineOffsetFrames, fps);
	const scrollLeft = useTimelineStore((state) => state.scrollLeft);

	// 生成预览图（使用全局缓存）
	const generateThumbnails = useCallback(async () => {
		if (
			!canvasRef.current ||
			!uri ||
			videoDuration <= 0 ||
			clipDurationSeconds <= 0
		) {
			return;
		}

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
			// 兼容高 DPI，绘制仍使用 CSS 像素
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.scale(pixelRatio, pixelRatio);
			canvas.style.transform = `translateX(${canvasOffsetX}px)`;
			canvas.style.width = `${canvasWidth}px`;
			if (snapshotCanvas) {
				// 尺寸变化时先铺一层旧画面，避免缩放闪白
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

			const currentVideoSampleSink = getVideoSampleSink();
			const currentInput = getInput();
			// 使用素材实际比例计算预览图尺寸
			const videoSize = await getVideoSize(uri, currentVideoSampleSink);
			const sourceAspectRatio =
				videoSize && videoSize.height > 0
					? videoSize.width / videoSize.height
					: 16 / 9;

			const thumbnailHeight = canvasHeight;
			const thumbnailWidth = Math.max(1, thumbnailHeight * sourceAspectRatio);
			const numThumbnails = Math.max(1, Math.ceil(clipWidth / thumbnailWidth));
			// 预览间隔跟时间线缩放相关，避免随 clip 时长变化抖动
			const pixelsPerSecond = getPixelsPerFrame(fps, timelineScale) * fps;
			const previewInterval = thumbnailWidth / Math.max(1e-6, pixelsPerSecond);

			const overscan = thumbnailWidth * 2;
			const renderStartX = Math.max(0, visibleStartX - overscan);
			const renderEndX = Math.min(clipWidth, visibleEndX + overscan);
			const startIndex = Math.max(0, Math.floor(renderStartX / thumbnailWidth));
			const endIndex = Math.min(
				numThumbnails - 1,
				Math.ceil(renderEndX / thumbnailWidth) - 1,
			);

			const hasSink = Boolean(currentVideoSampleSink);
			const hasInput = Boolean(currentInput);
			const renderKey = [
				uri,
				clipDurationFrames,
				offsetSeconds,
				reversed ? 1 : 0,
				`${clipWidth}x${canvasHeight}`,
				`${canvasOffsetX}-${canvasWidth}`,
				pixelRatio,
				timelineScale,
				hasSink ? 1 : 0,
				hasInput ? 1 : 0,
				`${startIndex}-${endIndex}`,
			].join("|");
			if (renderKey === lastRenderKeyRef.current) {
				return;
			}

			const currentToken = ++renderTokenRef.current;
			let didDraw = false;

			// 按间隔提取帧并绘制（仅渲染可见区域）
			for (let i = startIndex; i <= endIndex; i++) {
				if (renderTokenRef.current !== currentToken) return;
				const relativeTime = i * previewInterval;

				const absoluteTime = calculateVideoTime({
					start: 0,
					timelineTime: relativeTime,
					videoDuration: videoDuration,
					reversed,
					offset: offsetSeconds,
					clipDuration: clipDurationSeconds,
				});

				try {
					const clampedTime = Math.min(
						Math.max(0, absoluteTime),
						Math.max(0, videoDuration - 0.001),
					);
					const timeKey = Math.max(0, Math.round(clampedTime * 1000));
					const thumbnail = await getThumbnail({
						uri,
						time: clampedTime,
						timeKey,
						width: thumbnailWidth,
						height: thumbnailHeight,
						pixelRatio,
						videoSampleSink: currentVideoSampleSink,
						input: currentInput,
						preferKeyframes: true,
					});
					if (renderTokenRef.current !== currentToken) return;
					if (!thumbnail) continue;
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
				} catch (err) {
					console.warn(`Failed to extract frame at ${absoluteTime}:`, err);
				}
			}
			if (didDraw) {
				lastRenderKeyRef.current = renderKey;
				setRenderedOffsetFrames(timelineOffsetFrames);
			}
		} catch (err) {
			console.error("Failed to generate thumbnails:", err);
			if (ctx) {
				const errorWidth = canvasWidth || canvas.width / pixelRatio;
				const errorHeight = canvasHeight || canvas.height / pixelRatio;
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.scale(pixelRatio, pixelRatio);
				ctx.fillStyle = "#fee2e2";
				ctx.fillRect(0, 0, errorWidth, errorHeight);
				ctx.fillStyle = "#dc2626";
				ctx.font = "12px sans-serif";
				ctx.textAlign = "center";
				ctx.fillText(
					"Video Thumbnails Generation Failed",
					errorWidth / 2,
					errorHeight / 2,
				);
			}
		}
	}, [
		videoDuration,
		uri,
		reversed,
		clipDurationSeconds,
		clipDurationFrames,
		offsetSeconds,
		fps,
		timelineScale,
		getVideoSampleSink,
		getInput,
		timelineOffsetFrames,
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: 这里需要显式依赖滚动和时间参数来触发缩略图重绘
	useEffect(() => {
		if (lastUriRef.current !== uri) {
			lastUriRef.current = uri ?? null;
			lastRenderKeyRef.current = "";
			setRenderedOffsetFrames(timelineOffsetFrames);
		}
		scheduleGenerate();
	}, [
		uri,
		reversed,
		clipDurationSeconds,
		offsetSeconds,
		videoDuration,
		input,
		scrollLeft,
		scheduleGenerate,
		timelineOffsetFrames,
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
		<div className="absolute inset-0 overflow-hidden bg-zinc-700">
			<div className="bg-black/20 absolute z-10 top-1 left-1 rounded-xs px-1 flex items-center h-4.5 leading-none backdrop-blur-2xl w-fit max-w-[calc(100%-8px)] min-w-0">
				<span className="truncate">{element?.name}</span>
			</div>

			{/* 最大时长指示器 */}
			{/* {maxDuration !== undefined && clipDurationFrames > maxDuration && (
				<div
					className="absolute top-0 bottom-0 bg-red-500/30 border-l-2 border-red-500 z-10"
					style={{
						left: `${(maxDuration / clipDurationFrames) * 100}%`,
						right: 0,
					}}
				>
					<div className="absolute top-1 right-1 px-1 rounded bg-red-500 text-white text-xs">
						Exceeds max
					</div>
				</div>
			)} */}

			{/* Loading 指示器 */}
			{isLoading && (
				<div className="absolute inset-0 flex items-center justify-center bg-gray-200/50 z-10">
					<div className="text-xs text-gray-500">Loading...</div>
				</div>
			)}

			{/* 缩略图 canvas */}
			<div
				className={cn(
					"absolute top-0 w-full",
					shouldShowWaveform ? "bottom-5.5" : "bottom-0",
				)}
				style={{
					transform:
						pendingOffsetShiftPx === 0
							? undefined
							: `translateX(${pendingOffsetShiftPx}px)`,
				}}
			>
				<canvas ref={canvasRef} className="absolute inset-y-0" />
			</div>
			{shouldShowWaveform && (
				<div
					className={cn(
						"absolute inset-x-0 bottom-0 h-5.5 overflow-hidden",
						isTrackMuted ? "bg-neutral-500/20" : "bg-blue-500/20",
					)}
				>
					{audioSink && uri && (
						<AudioWaveformCanvas
							uri={uri}
							audioSink={audioSink}
							audioDuration={audioDuration}
							start={start}
							end={end}
								fps={fps}
								timelineScale={timelineScale}
								offsetFrames={timelineOffsetFrames}
								scrollLeft={scrollLeft}
								reversed={Boolean(reversed)}
								gainDb={clipGainDb}
								color={
									isTrackMuted
									? "rgba(163, 163, 163, 0.85)"
									: "rgba(59, 130, 246, 0.9)"
							}
							className="absolute inset-0"
						/>
					)}
					<AudioGainBaselineControl
						elementId={id}
						lineClassName={isTrackMuted ? "bg-zinc-100/70" : "bg-blue-100/80"}
					/>
				</div>
			)}
		</div>
	);
};
