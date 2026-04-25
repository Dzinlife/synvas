import {
	startTransition,
	useCallback,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import type { TrackedSkiaHostObjectSnapshot } from "react-skia-lite";
import {
	captureTrackedSkiaHostObjectsSnapshot,
	diffTrackedSkiaHostObjectSnapshots,
	flushSkiaDisposals,
	flushSkiaWebGPUResourceCache,
	getSkiaDisposalStats,
	getSkiaResourceTrackerConfig,
} from "react-skia-lite";
import {
	getCanvasCamera,
	useCanvasCameraStore,
} from "@/studio/canvas/cameraStore";
import type { TileLodTransition } from "./tile";
import { type CameraState, isCameraAlmostEqual } from "./canvasWorkspaceUtils";
import {
	CANVAS_RENDER_CULL_OVERSCAN_SCREEN_PX,
	type CanvasRenderCullState,
	type CanvasViewportWorldRect,
	PAN_CULL_IDLE_FLUSH_MS,
	type PendingCameraCullUpdateKind,
	type SmoothCameraApplyOptions,
	SKIA_RESOURCE_TRACKER_LOG_TAG,
	isCameraStateEqual,
	isTileLodTransitionEqual,
	isViewportWorldRectEqual,
	resolveCameraViewportWorldRect,
	resolveViewportUnionRect,
} from "./canvasWorkspaceModel";
import { useCanvasCameraController } from "./useCanvasCameraController";

interface CanvasStageSize {
	width: number;
	height: number;
}

interface UseCanvasRenderCullControllerInput {
	currentProjectId: string | null;
	stageSize: CanvasStageSize;
	onCameraChange: (camera: CameraState) => void;
}

export const useCanvasRenderCullController = ({
	currentProjectId,
	stageSize,
	onCameraChange,
}: UseCanvasRenderCullControllerInput) => {
	const initialCameraRef = useRef(getCanvasCamera());
	const previousProjectIdRef = useRef<string | null>(currentProjectId);
	const previousSkiaResourceSnapshotRef =
		useRef<TrackedSkiaHostObjectSnapshot | null>(null);
	const [isCameraAnimating, setIsCameraAnimating] = useState(false);
	const [renderCullState, setRenderCullState] = useState<CanvasRenderCullState>(
		() => ({
			mode: "live",
			camera: initialCameraRef.current,
			lockedViewportRect: null,
			version: 0,
		}),
	);
	const renderCullModeRef = useRef<CanvasRenderCullState["mode"]>(
		renderCullState.mode,
	);
	const observedCameraStateRef = useRef<CameraState>(initialCameraRef.current);
	const observedStageSizeRef = useRef(stageSize);
	const wasCameraAnimatingRef = useRef(false);
	const pendingCameraCullUpdateKindRef =
		useRef<PendingCameraCullUpdateKind | null>(null);
	const panCullPendingCameraRef = useRef<CameraState | null>(null);
	const panCullBurstActiveRef = useRef(false);
	const panCullIdleTimerRef = useRef<number | null>(null);
	const [tileLodTransition, setTileLodTransition] =
		useState<TileLodTransition | null>(null);
	const updateTileLodTransition = useCallback(
		(nextTransition: TileLodTransition | null) => {
			setTileLodTransition((previous) => {
				if (isTileLodTransitionEqual(previous, nextTransition)) {
					return previous;
				}
				return nextTransition;
			});
		},
		[],
	);
	const { cameraSharedValue, getCamera, applyCamera, stopCameraAnimation } =
		useCanvasCameraController({
			camera: initialCameraRef.current,
			onChange: onCameraChange,
			onAnimationStateChange: (isAnimating) => {
				setIsCameraAnimating(isAnimating);
				if (!isAnimating) {
					pendingCameraCullUpdateKindRef.current = null;
					updateTileLodTransition(null);
				}
			},
		});
	const clearPanCullIdleTimer = useEffectEvent(() => {
		const timerId = panCullIdleTimerRef.current;
		if (timerId === null) return;
		panCullIdleTimerRef.current = null;
		if (typeof window !== "undefined") {
			window.clearTimeout(timerId);
		}
	});
	const setRenderCullStateWithTransition = useEffectEvent(
		(updater: (prev: CanvasRenderCullState) => CanvasRenderCullState) => {
			startTransition(() => {
				setRenderCullState(updater);
			});
		},
	);
	const commitLiveCullCamera = useEffectEvent((camera: CameraState) => {
		clearPanCullIdleTimer();
		panCullPendingCameraRef.current = null;
		panCullBurstActiveRef.current = false;
		setRenderCullStateWithTransition((prev) => {
			if (
				prev.mode === "live" &&
				prev.lockedViewportRect === null &&
				isCameraStateEqual(prev.camera, camera)
			) {
				return prev;
			}
			return {
				mode: "live",
				camera,
				lockedViewportRect: null,
				version: prev.version + 1,
			};
		});
	});
	const flushPendingPanCullCommit = useEffectEvent(() => {
		const pendingCamera = panCullPendingCameraRef.current;
		if (!pendingCamera) return;
		panCullPendingCameraRef.current = null;
		setRenderCullStateWithTransition((prev) => {
			if (
				prev.mode === "live" &&
				prev.lockedViewportRect === null &&
				isCameraStateEqual(prev.camera, pendingCamera)
			) {
				return prev;
			}
			return {
				mode: "live",
				camera: pendingCamera,
				lockedViewportRect: null,
				version: prev.version + 1,
			};
		});
	});
	const schedulePanCullCommit = useEffectEvent((camera: CameraState) => {
		panCullPendingCameraRef.current = camera;
		if (!panCullBurstActiveRef.current) {
			panCullBurstActiveRef.current = true;
			flushPendingPanCullCommit();
		}
		clearPanCullIdleTimer();
		if (typeof window === "undefined") return;
		panCullIdleTimerRef.current = window.setTimeout(() => {
			panCullIdleTimerRef.current = null;
			panCullBurstActiveRef.current = false;
			flushPendingPanCullCommit();
		}, PAN_CULL_IDLE_FLUSH_MS);
	});
	const lockRenderCullToViewportRect = useEffectEvent(
		(viewportRect: CanvasViewportWorldRect | null, camera: CameraState) => {
			clearPanCullIdleTimer();
			panCullPendingCameraRef.current = null;
			panCullBurstActiveRef.current = false;
			setRenderCullStateWithTransition((prev) => {
				if (
					prev.mode === "locked" &&
					isCameraStateEqual(prev.camera, camera) &&
					isViewportWorldRectEqual(prev.lockedViewportRect, viewportRect)
				) {
					return prev;
				}
				return {
					mode: "locked",
					camera,
					lockedViewportRect: viewportRect,
					version: prev.version + 1,
				};
			});
		},
	);
	const applyInstantCameraWithCullIntent = useEffectEvent(
		(
			nextCamera: CameraState,
			kind: Exclude<PendingCameraCullUpdateKind, "smooth">,
		) => {
			const currentCamera = getCamera();
			if (isCameraAlmostEqual(currentCamera, nextCamera)) return;
			updateTileLodTransition(null);
			pendingCameraCullUpdateKindRef.current = kind;
			applyCamera(nextCamera, {
				transition: "instant",
			});
		},
	);
	const applySmoothCameraWithCullLock = useEffectEvent(
		(nextCamera: CameraState, options?: SmoothCameraApplyOptions) => {
			const currentCamera = getCamera();
			if (isCameraAlmostEqual(currentCamera, nextCamera)) return;
			const startRect = resolveCameraViewportWorldRect(
				currentCamera,
				stageSize.width,
				stageSize.height,
				CANVAS_RENDER_CULL_OVERSCAN_SCREEN_PX,
			);
			const endRect = resolveCameraViewportWorldRect(
				nextCamera,
				stageSize.width,
				stageSize.height,
				CANVAS_RENDER_CULL_OVERSCAN_SCREEN_PX,
			);
			lockRenderCullToViewportRect(
				resolveViewportUnionRect(startRect, endRect),
				nextCamera,
			);
			updateTileLodTransition(options?.tileLodTransition ?? null);
			pendingCameraCullUpdateKindRef.current = "smooth";
			applyCamera(nextCamera, {
				storeSync: options?.cameraStoreSync ?? "frame",
			});
		},
	);
	const handleCameraStoreCameraChange = useEffectEvent(
		(nextCamera: CameraState, previousCamera: CameraState) => {
			const pendingKind = pendingCameraCullUpdateKindRef.current;
			pendingCameraCullUpdateKindRef.current = null;
			if (isCameraAnimating || pendingKind === "smooth") return;
			const shouldThrottleCullUpdate =
				pendingKind === "pan" &&
				!isCameraStateEqual(previousCamera, nextCamera);
			if (shouldThrottleCullUpdate) {
				schedulePanCullCommit(nextCamera);
				return;
			}
			commitLiveCullCamera(nextCamera);
		},
	);
	const syncCameraFromStore = useEffectEvent(() => {
		stopCameraAnimation();
		applyInstantCameraWithCullIntent(getCanvasCamera(), "immediate");
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: syncCameraFromStore 是 Effect Event，这里只需要项目切换触发同步。
	useEffect(() => {
		syncCameraFromStore();
	}, [currentProjectId]);
	useEffect(() => {
		const previousProjectId = previousProjectIdRef.current;
		previousProjectIdRef.current = currentProjectId;
		const didProjectSwitch =
			Boolean(previousProjectId) &&
			Boolean(currentProjectId) &&
			previousProjectId !== currentProjectId;
		if (didProjectSwitch) {
			// 切项目允许做重清理，先把全局回收队列冲刷干净。
			flushSkiaDisposals();
			// WebGPU 侧的 Graphite 资源缓存也在切项目时同步执行一次重清理。
			flushSkiaWebGPUResourceCache({
				cleanupOlderThanMs: 0,
				freeGpuResources: true,
			});
		}
		const trackerConfig = getSkiaResourceTrackerConfig();
		const isAutoSnapshotEnabled =
			trackerConfig.enabled && trackerConfig.autoProjectSwitchSnapshot;
		if (!currentProjectId || !isAutoSnapshotEnabled) {
			previousSkiaResourceSnapshotRef.current = null;
			return;
		}
		const sampleLimitPerType = Math.max(1, trackerConfig.sampleLimitPerType);
		if (!previousProjectId || previousProjectId === currentProjectId) {
			previousSkiaResourceSnapshotRef.current =
				captureTrackedSkiaHostObjectsSnapshot({
					includeSamples: true,
					sampleLimitPerType,
				});
			return;
		}
		let cancelled = false;
		let firstFrameId: number | null = null;
		let secondFrameId: number | null = null;
		const beforeSnapshot =
			previousSkiaResourceSnapshotRef.current ??
			captureTrackedSkiaHostObjectsSnapshot({
				includeSamples: true,
				sampleLimitPerType,
			});
		const captureAndReportResourceDiff = () => {
			if (cancelled) return;
			// 自动采样前再冲刷一次，避免把“已入队未执行”的对象误判成泄漏。
			flushSkiaDisposals();
			const afterSnapshot = captureTrackedSkiaHostObjectsSnapshot({
				includeSamples: true,
				sampleLimitPerType,
			});
			const snapshotDiff = diffTrackedSkiaHostObjectSnapshots(
				beforeSnapshot,
				afterSnapshot,
			);
			previousSkiaResourceSnapshotRef.current = afterSnapshot;
			if (snapshotDiff.totalDelta <= 0) {
				return;
			}
			const increasedTypeSamples = Object.fromEntries(
				snapshotDiff.increasedTypes.map((item) => [
					item.type,
					afterSnapshot.samplesByType?.[item.type] ?? [],
				]),
			);
			console.warn(
				`${SKIA_RESOURCE_TRACKER_LOG_TAG} project switch resource delta`,
				{
					fromProjectId: previousProjectId,
					toProjectId: currentProjectId,
					beforeTotal: beforeSnapshot.total,
					afterTotal: afterSnapshot.total,
					totalDelta: snapshotDiff.totalDelta,
					byTypeDelta: snapshotDiff.byTypeDelta,
					increasedTypeSamples,
					disposalQueueStats: getSkiaDisposalStats(),
				},
			);
		};
		if (typeof window === "undefined") {
			captureAndReportResourceDiff();
			return () => {
				cancelled = true;
			};
		}
		firstFrameId = window.requestAnimationFrame(() => {
			secondFrameId = window.requestAnimationFrame(() => {
				captureAndReportResourceDiff();
			});
		});
		return () => {
			cancelled = true;
			if (firstFrameId !== null) {
				window.cancelAnimationFrame(firstFrameId);
			}
			if (secondFrameId !== null) {
				window.cancelAnimationFrame(secondFrameId);
			}
		};
	}, [currentProjectId]);
	useEffect(() => {
		renderCullModeRef.current = renderCullState.mode;
	}, [renderCullState.mode]);
	useEffect(() => {
		const wasAnimating = wasCameraAnimatingRef.current;
		wasCameraAnimatingRef.current = isCameraAnimating;
		if (isCameraAnimating) return;
		if (!wasAnimating) return;
		if (renderCullModeRef.current !== "locked") return;
		commitLiveCullCamera(getCamera());
	}, [commitLiveCullCamera, getCamera, isCameraAnimating]);
	useEffect(() => {
		observedCameraStateRef.current = getCanvasCamera();
		return useCanvasCameraStore.subscribe((state) => {
			const nextCamera = state.camera;
			const previousCamera = observedCameraStateRef.current;
			if (isCameraStateEqual(previousCamera, nextCamera)) return;
			observedCameraStateRef.current = nextCamera;
			handleCameraStoreCameraChange(nextCamera, previousCamera);
		});
	}, [handleCameraStoreCameraChange]);
	useEffect(() => {
		const nextStageSize = {
			width: stageSize.width,
			height: stageSize.height,
		};
		const previousStageSize = observedStageSizeRef.current;
		if (
			previousStageSize.width === nextStageSize.width &&
			previousStageSize.height === nextStageSize.height
		) {
			return;
		}
		observedStageSizeRef.current = nextStageSize;
		if (renderCullModeRef.current !== "locked") return;
		commitLiveCullCamera(getCamera());
	}, [commitLiveCullCamera, getCamera, stageSize.height, stageSize.width]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: clearPanCullIdleTimer 是 Effect Event，这里只在卸载时清理 burst 状态。
	useEffect(() => {
		return () => {
			clearPanCullIdleTimer();
			panCullPendingCameraRef.current = null;
			panCullBurstActiveRef.current = false;
			pendingCameraCullUpdateKindRef.current = null;
		};
	}, []);

	return {
		cameraSharedValue,
		getCamera,
		applyInstantCameraWithCullIntent,
		applySmoothCameraWithCullLock,
		isCameraAnimating,
		renderCullState,
		tileLodTransition,
	};
};
