import type React from "react";
import {
	useCallback,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
} from "react";
import type {
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import { getPixelsPerFrame } from "@/scene-editor/utils/timelineScale";
import { getSceneWaveformThumbnail } from "./sceneWaveformCache";

type LoadedWaveformWindow = {
	identityKey: string;
	windowStart: number;
	windowEnd: number;
	waveform: HTMLCanvasElement;
};

type SceneWaveformCanvasProps = {
	sceneRuntime: TimelineRuntime | null;
	runtimeManager: StudioRuntimeManager | null;
	sceneRevision: number;
	sourceFps: number;
	gainDb?: number;
	start: number;
	end: number;
	fps: number;
	timelineScale: number;
	offsetFrames: number;
	scrollLeft: number;
	color: string;
	className?: string;
};

const roundGainDbForWaveform = (gainDb: number): number => {
	if (!Number.isFinite(gainDb)) return 0;
	return Math.round(gainDb * 10) / 10;
};

export const SceneWaveformCanvas: React.FC<SceneWaveformCanvasProps> = ({
	sceneRuntime,
	runtimeManager,
	sceneRevision,
	sourceFps,
	gainDb = 0,
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
	const scheduleIdRef = useRef<number | null>(null);
	const loadedWindowRef = useRef<LoadedWaveformWindow | null>(null);
	const inflightRequestKeyRef = useRef<string | null>(null);
	const sceneKeyRef = useRef<string | null>(null);

	const getSceneRuntime = useEffectEvent(() => sceneRuntime);
	const getRuntimeManager = useEffectEvent(() => runtimeManager);
	const getSceneRevision = useEffectEvent(() => sceneRevision);
	const getSourceFps = useEffectEvent(() => sourceFps);
	const getGainDb = useEffectEvent(() => gainDb);

	const clipDurationFrames = end - start;
	const clipDurationSeconds =
		clipDurationFrames > 0 && fps > 0 ? clipDurationFrames / fps : 0;
	const offsetSeconds = fps > 0 ? offsetFrames / fps : 0;

	const generateWaveform = useCallback(() => {
		if (!canvasRef.current || clipDurationSeconds <= 0) return;

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
			const visibleWidth = Math.max(0, visibleEndX - visibleStartX);
			const viewportWidth = viewportRect.width;
			if (viewportWidth <= 0 || visibleWidth <= 0) return;

			const canvasOffsetX = visibleStartX;
			canvasWidth = Math.max(1, Math.ceil(visibleWidth));
			if (canvasWidth <= 0 || canvasHeight <= 0) return;

			pixelRatio = Math.max(1, window.devicePixelRatio || 1);
			const targetWidth = Math.max(1, Math.floor(canvasWidth * pixelRatio));
			const targetHeight = Math.max(1, Math.floor(canvasHeight * pixelRatio));

			const nextStyleTransform = `translateX(${canvasOffsetX}px)`;
			const nextStyleWidth = `${canvasWidth}px`;
			const nextStyleHeight = `${canvasHeight}px`;
			canvas.style.transform = nextStyleTransform;

			const currentSceneRuntime = getSceneRuntime();
			const currentRuntimeManager = getRuntimeManager();
			const currentSourceFps = Math.max(1, Math.round(getSourceFps() || 30));
			if (!currentSceneRuntime || !currentRuntimeManager) {
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				loadedWindowRef.current = null;
				inflightRequestKeyRef.current = null;
				return;
			}

			const pixelsPerSecond = getPixelsPerFrame(fps, timelineScale) * fps;
			const safePixelsPerSecond = Math.max(1e-6, pixelsPerSecond);
			const requestStepPx = Math.max(24, Math.round(canvasHeight * 2));
			const requestOverscanPx = requestStepPx;
			const requestStartX = Math.max(
				0,
				Math.floor(canvasOffsetX / requestStepPx) * requestStepPx -
					requestOverscanPx,
			);
			const requestEndX = Math.min(
				clipWidth,
				Math.ceil((canvasOffsetX + canvasWidth) / requestStepPx) *
					requestStepPx +
					requestOverscanPx,
			);
			const requestWidth = Math.max(1e-6, requestEndX - requestStartX);
			const viewportSourceStart =
				offsetSeconds + canvasOffsetX / safePixelsPerSecond;
			const viewportSourceEnd =
				offsetSeconds + (canvasOffsetX + canvasWidth) / safePixelsPerSecond;
			const sourceStart = offsetSeconds + requestStartX / safePixelsPerSecond;
			const sourceEnd = offsetSeconds + requestEndX / safePixelsPerSecond;
			if (
				!Number.isFinite(sourceStart) ||
				!Number.isFinite(sourceEnd) ||
				sourceEnd <= sourceStart
			) {
				return;
			}
			const requestStartFrame = Math.max(
				0,
				Math.floor(sourceStart * currentSourceFps),
			);
			const requestEndFrame = Math.max(
				requestStartFrame + 1,
				Math.ceil(sourceEnd * currentSourceFps),
			);
			const requestSourceStart = requestStartFrame / currentSourceFps;
			const requestSourceEnd = requestEndFrame / currentSourceFps;
			const currentGainDb = roundGainDbForWaveform(getGainDb());
			const identityKey = [
				currentSceneRuntime.ref.sceneId,
				getSceneRevision(),
				currentSourceFps,
				color,
				currentGainDb.toFixed(3),
			].join("|");
			const requestKey = [
				identityKey,
				`${requestSourceStart.toFixed(6)}-${requestSourceEnd.toFixed(6)}`,
				`${requestStartX.toFixed(3)}-${requestEndX.toFixed(3)}`,
				requestWidth.toFixed(3),
				canvasHeight,
				pixelRatio,
				timelineScale.toFixed(4),
			].join("|");

			if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
				canvas.width = targetWidth;
				canvas.height = targetHeight;
			}
			canvas.style.width = nextStyleWidth;
			canvas.style.height = nextStyleHeight;
			ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
			ctx.imageSmoothingEnabled = false;
			ctx.clearRect(0, 0, canvasWidth, canvasHeight);

			const loaded = loadedWindowRef.current;
			let hasFullCoverage = false;
			let hasEnoughResolution = false;
			if (loaded) {
				const loadedDuration = loaded.windowEnd - loaded.windowStart;
				const viewportDuration = viewportSourceEnd - viewportSourceStart;
				const overlapStart = Math.max(viewportSourceStart, loaded.windowStart);
				const overlapEnd = Math.min(viewportSourceEnd, loaded.windowEnd);
				if (overlapEnd > overlapStart) {
					const sourceScaleX =
						loaded.waveform.width / Math.max(1e-6, loadedDuration);
					const sourceCropX =
						(overlapStart - loaded.windowStart) * sourceScaleX;
					const sourceCropWidth = Math.max(
						1,
						(overlapEnd - overlapStart) * sourceScaleX,
					);
					const drawScaleX = canvasWidth / Math.max(1e-6, viewportDuration);
					const drawX = (overlapStart - viewportSourceStart) * drawScaleX;
					const drawWidth = (overlapEnd - overlapStart) * drawScaleX;
					ctx.drawImage(
						loaded.waveform,
						sourceCropX,
						0,
						sourceCropWidth,
						loaded.waveform.height,
						drawX,
						0,
						drawWidth,
						canvasHeight,
					);
				}

				if (loaded.identityKey === identityKey) {
					hasFullCoverage =
						loaded.windowStart <= viewportSourceStart &&
						loaded.windowEnd >= viewportSourceEnd;
					const loadedPixelsPerFrame =
						loaded.waveform.width / Math.max(1e-6, loadedDuration);
					const targetPixelsPerFrame =
						(requestWidth * pixelRatio) /
						Math.max(1e-6, requestSourceEnd - requestSourceStart);
					const resolutionRatio =
						targetPixelsPerFrame / Math.max(1e-6, loadedPixelsPerFrame);
					hasEnoughResolution =
						resolutionRatio >= 0.72 && resolutionRatio <= 1.4;
				}
			}

			const hasMatchingLoaded = loaded?.identityKey === identityKey;
			const needRefresh =
				!hasMatchingLoaded || !hasFullCoverage || !hasEnoughResolution;
			if (needRefresh && inflightRequestKeyRef.current !== requestKey) {
				inflightRequestKeyRef.current = requestKey;
				const requestToken = ++renderTokenRef.current;
				void getSceneWaveformThumbnail({
					sceneRuntime: currentSceneRuntime,
					runtimeManager: currentRuntimeManager,
					sceneRevision: getSceneRevision(),
					windowStartFrame: requestStartFrame,
					windowEndFrame: requestEndFrame,
					width: requestWidth,
					height: canvasHeight,
					pixelRatio,
					color,
					gainDb: currentGainDb,
				})
					.then((waveformCanvas) => {
						if (!waveformCanvas) return;
						if (renderTokenRef.current !== requestToken) return;
						if (inflightRequestKeyRef.current !== requestKey) return;
						loadedWindowRef.current = {
							identityKey,
							windowStart: requestSourceStart,
							windowEnd: requestSourceEnd,
							waveform: waveformCanvas,
						};
						inflightRequestKeyRef.current = null;
						if (scheduleIdRef.current !== null) {
							cancelAnimationFrame(scheduleIdRef.current);
							scheduleIdRef.current = null;
						}
						scheduleIdRef.current = requestAnimationFrame(() => {
							scheduleIdRef.current = null;
							generateWaveform();
						});
					})
					.catch((error) => {
						console.error("Failed to request scene waveform:", error);
					})
					.finally(() => {
						if (inflightRequestKeyRef.current === requestKey) {
							inflightRequestKeyRef.current = null;
						}
					});
			}
		} catch (error) {
			console.error("Failed to render scene waveform:", error);
		}
	}, [
		clipDurationSeconds,
		color,
		fps,
		getGainDb,
		getRuntimeManager,
		getSceneRevision,
		getSceneRuntime,
		getSourceFps,
		offsetSeconds,
		timelineScale,
	]);

	const scheduleGenerate = useCallback(() => {
		if (scheduleIdRef.current !== null) {
			cancelAnimationFrame(scheduleIdRef.current);
			scheduleIdRef.current = null;
		}
		scheduleIdRef.current = requestAnimationFrame(() => {
			scheduleIdRef.current = null;
			generateWaveform();
		});
	}, [generateWaveform]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: 这里需要显式依赖滚动和时间参数来触发重绘调度
	useEffect(() => {
		const nextSceneKey = sceneRuntime
			? `${sceneRuntime.ref.sceneId}:${sceneRevision}`
			: null;
		if (sceneKeyRef.current !== nextSceneKey) {
			sceneKeyRef.current = nextSceneKey;
			loadedWindowRef.current = null;
			inflightRequestKeyRef.current = null;
			renderTokenRef.current += 1;
		}
		scheduleGenerate();
	}, [
		sceneRuntime,
		sceneRevision,
		sourceFps,
		gainDb,
		offsetFrames,
		clipDurationFrames,
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
