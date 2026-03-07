import { useEffect, useEffectEvent, useRef } from "react";
import {
	type ApplyCameraOptions,
	type CameraState,
	CAMERA_SMOOTH_DURATION_MS,
	easeOutCubic,
	isCameraAlmostEqual,
	lerpCamera,
} from "./canvasWorkspaceUtils";

interface UseCanvasCameraControllerOptions {
	camera: CameraState;
	onChange: (camera: CameraState) => void;
}

interface UseCanvasCameraControllerResult {
	getCamera: () => CameraState;
	applyCamera: (camera: CameraState, options?: ApplyCameraOptions) => void;
	stopCameraAnimation: () => void;
}

export const useCanvasCameraController = ({
	camera,
	onChange,
}: UseCanvasCameraControllerOptions): UseCanvasCameraControllerResult => {
	const cameraAnimationFrameRef = useRef<number | null>(null);
	const cameraAnimationTokenRef = useRef(0);

	const getCamera = useEffectEvent((): CameraState => {
		return camera;
	});

	const stopCameraAnimation = useEffectEvent(() => {
		if (
			typeof window !== "undefined" &&
			typeof window.cancelAnimationFrame === "function" &&
			cameraAnimationFrameRef.current !== null
		) {
			window.cancelAnimationFrame(cameraAnimationFrameRef.current);
		}
		cameraAnimationFrameRef.current = null;
		cameraAnimationTokenRef.current += 1;
	});

	const applyCamera = useEffectEvent(
		(nextCamera: CameraState, options?: ApplyCameraOptions) => {
			const transition = options?.transition ?? "smooth";
			const isCameraAnimationRunning = cameraAnimationFrameRef.current !== null;
			if (transition === "instant" && isCameraAnimationRunning) {
				return;
			}
			const currentCamera = getCamera();
			if (isCameraAlmostEqual(currentCamera, nextCamera)) {
				stopCameraAnimation();
				return;
			}
			if (
				transition === "instant" ||
				typeof window === "undefined" ||
				typeof window.requestAnimationFrame !== "function"
			) {
				stopCameraAnimation();
				onChange(nextCamera);
				return;
			}
			stopCameraAnimation();
			const fromCamera = currentCamera;
			const token = cameraAnimationTokenRef.current;
			const startedAt =
				typeof performance !== "undefined" ? performance.now() : Date.now();
			const animate = (timestamp: number) => {
				if (cameraAnimationTokenRef.current !== token) return;
				const elapsed = timestamp - startedAt;
				const progress = Math.max(
					0,
					Math.min(1, elapsed / CAMERA_SMOOTH_DURATION_MS),
				);
				const easedProgress = easeOutCubic(progress);
				onChange(lerpCamera(fromCamera, nextCamera, easedProgress));
				if (progress >= 1) {
					cameraAnimationFrameRef.current = null;
					onChange(nextCamera);
					return;
				}
				cameraAnimationFrameRef.current = window.requestAnimationFrame(animate);
			};
			cameraAnimationFrameRef.current = window.requestAnimationFrame(animate);
		},
	);

	useEffect(() => {
		return () => {
			if (
				typeof window !== "undefined" &&
				typeof window.cancelAnimationFrame === "function" &&
				cameraAnimationFrameRef.current !== null
			) {
				window.cancelAnimationFrame(cameraAnimationFrameRef.current);
			}
			cameraAnimationFrameRef.current = null;
			cameraAnimationTokenRef.current += 1;
		};
	}, []);

	return {
		getCamera,
		applyCamera,
		stopCameraAnimation,
	};
};
