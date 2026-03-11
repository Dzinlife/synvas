import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
	type ApplyCameraOptions,
	type CameraState,
	isCameraAlmostEqual,
} from "./canvasWorkspaceUtils";

interface UseCanvasCameraControllerOptions {
	camera: CameraState;
	onChange: (camera: CameraState) => void;
	onAnimationStateChange?: (isAnimating: boolean) => void;
}

export interface UseCanvasCameraControllerResult {
	renderCamera: CameraState;
	cameraAnimationKey: number;
	getCamera: () => CameraState;
	applyCamera: (camera: CameraState, options?: ApplyCameraOptions) => void;
	stopCameraAnimation: () => void;
	finishCameraAnimation: (
		animationKey: number,
		settledCamera?: CameraState,
	) => void;
}

export const useCanvasCameraController = ({
	camera,
	onChange,
	onAnimationStateChange,
}: UseCanvasCameraControllerOptions): UseCanvasCameraControllerResult => {
	const cameraAnimationKeyRef = useRef(0);
	const activeCameraAnimationKeyRef = useRef<number | null>(null);
	const pendingCameraRef = useRef<CameraState | null>(null);
	const [renderCamera, setRenderCamera] = useState(camera);
	const [cameraAnimationKey, setCameraAnimationKey] = useState(0);
	const setCameraAnimating = useEffectEvent((isAnimating: boolean) => {
		onAnimationStateChange?.(isAnimating);
	});
	const setNextRenderCamera = useEffectEvent((nextCamera: CameraState) => {
		setRenderCamera((prev) => {
			if (isCameraAlmostEqual(prev, nextCamera)) {
				return prev;
			}
			return nextCamera;
		});
	});

	const getCamera = useEffectEvent((): CameraState => {
		return renderCamera;
	});

	const stopCameraAnimation = useEffectEvent(() => {
		const hadAnimation = activeCameraAnimationKeyRef.current !== null;
		activeCameraAnimationKeyRef.current = null;
		pendingCameraRef.current = null;
		cameraAnimationKeyRef.current += 1;
		setCameraAnimationKey(cameraAnimationKeyRef.current);
		if (hadAnimation) {
			setCameraAnimating(false);
		}
	});

	const finishCameraAnimation = useEffectEvent(
		(animationKey: number, settledCamera?: CameraState) => {
			if (activeCameraAnimationKeyRef.current !== animationKey) {
				return;
			}
			const nextCamera = settledCamera ?? pendingCameraRef.current ?? renderCamera;
			activeCameraAnimationKeyRef.current = null;
			pendingCameraRef.current = null;
			setNextRenderCamera(nextCamera);
			onChange(nextCamera);
			setCameraAnimating(false);
		},
	);

	const applyCamera = useEffectEvent(
		(nextCamera: CameraState, options?: ApplyCameraOptions) => {
			const transition = options?.transition ?? "smooth";
			const isCameraAnimationRunning =
				activeCameraAnimationKeyRef.current !== null;
			if (transition === "instant" && isCameraAnimationRunning) {
				return;
			}
			const currentCamera = getCamera();
			const compareCamera = pendingCameraRef.current ?? currentCamera;
			if (isCameraAlmostEqual(compareCamera, nextCamera)) {
				return;
			}
			if (
				transition === "instant" ||
				typeof window === "undefined" ||
				typeof window.requestAnimationFrame !== "function"
			) {
				stopCameraAnimation();
				setNextRenderCamera(nextCamera);
				onChange(nextCamera);
				return;
			}
			const wasAnimating = activeCameraAnimationKeyRef.current !== null;
			cameraAnimationKeyRef.current += 1;
			const nextAnimationKey = cameraAnimationKeyRef.current;
			activeCameraAnimationKeyRef.current = nextAnimationKey;
			pendingCameraRef.current = nextCamera;
			setCameraAnimationKey(nextAnimationKey);
			setNextRenderCamera(nextCamera);
			if (!wasAnimating) {
				setCameraAnimating(true);
			}
		},
	);

	useEffect(() => {
		if (activeCameraAnimationKeyRef.current !== null) {
			return;
		}
		setNextRenderCamera(camera);
	}, [camera, setNextRenderCamera]);

	useEffect(() => {
		return () => {
			activeCameraAnimationKeyRef.current = null;
			pendingCameraRef.current = null;
			cameraAnimationKeyRef.current += 1;
		};
	}, []);

	return {
		renderCamera,
		cameraAnimationKey,
		getCamera,
		applyCamera,
		stopCameraAnimation,
		finishCameraAnimation,
	};
};
