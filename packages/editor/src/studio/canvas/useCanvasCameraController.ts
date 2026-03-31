import { useEffect, useEffectEvent, useRef } from "react";
import type { SharedValue } from "react-skia-lite";
import { useSharedValue } from "react-skia-lite";
import {
	CAMERA_SMOOTH_DURATION_MS,
	type ApplyCameraOptions,
	type CameraStoreSyncMode,
	type CameraState,
	easeOutCubic,
	isCameraAlmostEqual,
	lerpCamera,
} from "./canvasWorkspaceUtils";

interface UseCanvasCameraControllerOptions {
	camera: CameraState;
	onChange: (camera: CameraState) => void;
	onAnimationStateChange?: (isAnimating: boolean) => void;
}

export interface UseCanvasCameraControllerResult {
	cameraSharedValue: SharedValue<CameraState>;
	getCamera: () => CameraState;
	applyCamera: (camera: CameraState, options?: ApplyCameraOptions) => void;
	stopCameraAnimation: () => void;
}

interface CameraAnimationState {
	from: CameraState;
	to: CameraState;
	startTime: number | null;
	storeSync: CameraStoreSyncMode;
}

export const useCanvasCameraController = ({
	camera,
	onChange,
	onAnimationStateChange,
}: UseCanvasCameraControllerOptions): UseCanvasCameraControllerResult => {
	const cameraRef = useRef(camera);
	const cameraSharedValue = useSharedValue(camera);
	const animationFrameRef = useRef<number | null>(null);
	const animationStateRef = useRef<CameraAnimationState | null>(null);
	const isAnimatingRef = useRef(false);
	const setCameraAnimating = useEffectEvent((isAnimating: boolean) => {
		if (isAnimatingRef.current === isAnimating) return;
		isAnimatingRef.current = isAnimating;
		onAnimationStateChange?.(isAnimating);
	});
	const writeCamera = useEffectEvent(
		(nextCamera: CameraState, options?: { emitStore?: boolean }) => {
			cameraRef.current = nextCamera;
			cameraSharedValue.value = nextCamera;
			if (options?.emitStore ?? true) {
				onChange(nextCamera);
			}
		},
	);
	const stopAnimationFrame = useEffectEvent(() => {
		const frameId = animationFrameRef.current;
		if (frameId === null) return;
		if (typeof window !== "undefined") {
			window.cancelAnimationFrame(frameId);
		}
		animationFrameRef.current = null;
	});
	const stopCameraAnimation = useEffectEvent(() => {
		const hadAnimation = animationStateRef.current !== null;
		stopAnimationFrame();
		animationStateRef.current = null;
		if (hadAnimation) {
			setCameraAnimating(false);
		}
	});

	const runAnimationFrame = useEffectEvent((timestamp: number) => {
		const animationState = animationStateRef.current;
		if (!animationState) return;
		const startTime = animationState.startTime ?? timestamp;
		if (animationState.startTime === null) {
			animationState.startTime = startTime;
		}
		const elapsed = Math.max(0, timestamp - startTime);
		const rawProgress = Math.min(
			1,
			elapsed / Math.max(1, CAMERA_SMOOTH_DURATION_MS),
		);
		const easedProgress = easeOutCubic(rawProgress);
		const nextCamera = lerpCamera(
			animationState.from,
			animationState.to,
			easedProgress,
		);
		writeCamera(nextCamera, {
			emitStore: animationState.storeSync === "frame",
		});
		if (rawProgress >= 1) {
			if (animationState.storeSync === "settle") {
				onChange(animationState.to);
			}
			animationStateRef.current = null;
			animationFrameRef.current = null;
			setCameraAnimating(false);
			return;
		}
		if (typeof window === "undefined") {
			return;
		}
		animationFrameRef.current = window.requestAnimationFrame(runAnimationFrame);
	});

	const getCamera = useEffectEvent((): CameraState => {
		return cameraRef.current;
	});

	const applyCamera = useEffectEvent(
		(nextCamera: CameraState, options?: ApplyCameraOptions) => {
			const transition = options?.transition ?? "smooth";
			const currentCamera = getCamera();
			const compareCamera = animationStateRef.current?.to ?? currentCamera;
			if (isCameraAlmostEqual(compareCamera, nextCamera)) {
				return;
			}
			const canAnimate =
				typeof window !== "undefined" &&
				typeof window.requestAnimationFrame === "function";
			if (transition === "instant") {
				// smooth 动画期间保持输入门控，避免显式 pan 与过渡混算。
				if (animationStateRef.current) {
					return;
				}
				stopCameraAnimation();
				writeCamera(nextCamera);
				return;
			}
			if (!canAnimate) {
				stopCameraAnimation();
				writeCamera(nextCamera);
				return;
			}
			const fromCamera = currentCamera;
			stopAnimationFrame();
			animationStateRef.current = {
				from: fromCamera,
				to: nextCamera,
				startTime: null,
				storeSync: options?.storeSync ?? "frame",
			};
			setCameraAnimating(true);
			animationFrameRef.current = window.requestAnimationFrame(runAnimationFrame);
		},
	);

	useEffect(() => {
		if (animationStateRef.current) {
			return;
		}
		if (isCameraAlmostEqual(cameraRef.current, camera)) {
			return;
		}
		cameraRef.current = camera;
		cameraSharedValue.value = camera;
	}, [camera, cameraSharedValue]);

	useEffect(() => {
		return () => {
			const frameId = animationFrameRef.current;
			if (frameId !== null && typeof window !== "undefined") {
				window.cancelAnimationFrame(frameId);
			}
			animationFrameRef.current = null;
			animationStateRef.current = null;
			isAnimatingRef.current = false;
		};
	}, []);

	return {
		cameraSharedValue,
		getCamera,
		applyCamera,
		stopCameraAnimation,
	};
};
