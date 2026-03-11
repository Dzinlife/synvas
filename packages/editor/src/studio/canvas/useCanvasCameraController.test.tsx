// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CameraState } from "./canvasWorkspaceUtils";
import {
	type UseCanvasCameraControllerResult,
	useCanvasCameraController,
} from "./useCanvasCameraController";

interface CameraControllerProbeProps {
	camera: CameraState;
	onChange: (camera: CameraState) => void;
	onAnimationStateChange?: (isAnimating: boolean) => void;
	onReady: (api: UseCanvasCameraControllerResult) => void;
}

const CameraControllerProbe = ({
	camera,
	onChange,
	onAnimationStateChange,
	onReady,
}: CameraControllerProbeProps) => {
	const api = useCanvasCameraController({
		camera,
		onChange,
		onAnimationStateChange,
	});

	useEffect(() => {
		onReady(api);
	}, [api, onReady]);

	return null;
};

describe("useCanvasCameraController", () => {
	it("commits smooth camera transitions once and keeps animation state until timing completion", () => {
		const onChange = vi.fn();
		const onAnimationStateChange = vi.fn();
		let controller: UseCanvasCameraControllerResult | null = null;

		render(
			<CameraControllerProbe
				camera={{ x: 0, y: 0, zoom: 1 }}
				onChange={onChange}
				onAnimationStateChange={onAnimationStateChange}
				onReady={(api) => {
					controller = api;
				}}
			/>,
		);

		act(() => {
			controller?.applyCamera({ x: 120, y: -48, zoom: 1.5 });
		});

		expect(controller).not.toBeNull();
		if (!controller) return;
		const readyController = controller as UseCanvasCameraControllerResult;
		expect(onChange).not.toHaveBeenCalled();
		expect(readyController.renderCamera).toEqual({
			x: 120,
			y: -48,
			zoom: 1.5,
		});
		expect(onAnimationStateChange).toHaveBeenNthCalledWith(1, true);
		expect(onChange).not.toHaveBeenCalled();

		act(() => {
			readyController.finishCameraAnimation(readyController.cameraAnimationKey);
		});

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenLastCalledWith({ x: 120, y: -48, zoom: 1.5 });
		expect(onAnimationStateChange).toHaveBeenNthCalledWith(2, false);
	});

	it("ignores instant camera writes while smooth animation is active", () => {
		const onChange = vi.fn();
		const onAnimationStateChange = vi.fn();
		let controller: UseCanvasCameraControllerResult | null = null;

		render(
			<CameraControllerProbe
				camera={{ x: 0, y: 0, zoom: 1 }}
				onChange={onChange}
				onAnimationStateChange={onAnimationStateChange}
				onReady={(api) => {
					controller = api;
				}}
			/>,
		);

		act(() => {
			controller?.applyCamera({ x: 64, y: 32, zoom: 1.2 });
		});
		act(() => {
			controller?.applyCamera(
				{ x: 10, y: 10, zoom: 0.8 },
				{ transition: "instant" },
			);
		});

		expect(controller).not.toBeNull();
		if (!controller) return;
		const readyController = controller as UseCanvasCameraControllerResult;
		expect(onChange).not.toHaveBeenCalled();
		expect(readyController.renderCamera).toEqual({
			x: 64,
			y: 32,
			zoom: 1.2,
		});

		act(() => {
			readyController.finishCameraAnimation(readyController.cameraAnimationKey);
		});

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenLastCalledWith({ x: 64, y: 32, zoom: 1.2 });
	});

	it("allows smooth camera transitions to reverse from the current render target", () => {
		const initialCamera = { x: 0, y: 0, zoom: 1 };
		const focusedCamera = { x: 120, y: -48, zoom: 1.5 };
		const onChange = vi.fn();
		let controller: UseCanvasCameraControllerResult | null = null;

		render(
			<CameraControllerProbe
				camera={initialCamera}
				onChange={onChange}
				onReady={(api) => {
					controller = api;
				}}
			/>,
		);

		act(() => {
			controller?.applyCamera(focusedCamera);
		});
		expect(controller).not.toBeNull();
		if (!controller) return;
		const readyController = controller as UseCanvasCameraControllerResult;
		expect(readyController.renderCamera).toEqual(focusedCamera);

		act(() => {
			readyController.applyCamera(initialCamera);
		});
		expect(controller).not.toBeNull();
		if (!controller) return;
		const reversedController = controller as UseCanvasCameraControllerResult;
		expect(reversedController.renderCamera).toEqual(initialCamera);

		act(() => {
			reversedController.finishCameraAnimation(
				reversedController.cameraAnimationKey,
			);
		});

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenLastCalledWith(initialCamera);
	});

	it("keeps smooth animation running when the same target is applied again", () => {
		const targetCamera = { x: 120, y: -48, zoom: 1.5 };
		const onChange = vi.fn();
		const onAnimationStateChange = vi.fn();
		let controller: UseCanvasCameraControllerResult | null = null;

		render(
			<CameraControllerProbe
				camera={{ x: 0, y: 0, zoom: 1 }}
				onChange={onChange}
				onAnimationStateChange={onAnimationStateChange}
				onReady={(api) => {
					controller = api;
				}}
			/>,
		);

		act(() => {
			controller?.applyCamera(targetCamera);
		});
		act(() => {
			controller?.applyCamera(targetCamera);
		});

		expect(controller).not.toBeNull();
		if (!controller) return;
		const readyController = controller as UseCanvasCameraControllerResult;
		expect(readyController.renderCamera).toEqual(targetCamera);
		expect(onChange).not.toHaveBeenCalled();
		expect(onAnimationStateChange).toHaveBeenCalledTimes(1);
		expect(onAnimationStateChange).toHaveBeenLastCalledWith(true);

		act(() => {
			readyController.finishCameraAnimation(readyController.cameraAnimationKey);
		});

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenLastCalledWith(targetCamera);
		expect(onAnimationStateChange).toHaveBeenCalledTimes(2);
		expect(onAnimationStateChange).toHaveBeenLastCalledWith(false);
	});

	it("ignores instant pan while smooth animation is active", () => {
		const smoothTarget = { x: 0, y: 0, zoom: 1 };
		const panTarget = { x: 48, y: -32, zoom: 1 };
		const onChange = vi.fn();
		const onAnimationStateChange = vi.fn();
		let controller: UseCanvasCameraControllerResult | null = null;

		render(
			<CameraControllerProbe
				camera={{ x: 120, y: -48, zoom: 1.5 }}
				onChange={onChange}
				onAnimationStateChange={onAnimationStateChange}
				onReady={(api) => {
					controller = api;
				}}
			/>,
		);

		act(() => {
			controller?.applyCamera(smoothTarget);
		});
		act(() => {
			controller?.applyCamera(panTarget, { transition: "instant" });
		});

		expect(controller).not.toBeNull();
		if (!controller) return;
		const readyController = controller as UseCanvasCameraControllerResult;
		expect(readyController.renderCamera).toEqual(smoothTarget);
		expect(onChange).not.toHaveBeenCalled();
		expect(onAnimationStateChange).toHaveBeenCalledTimes(1);
		expect(onAnimationStateChange).toHaveBeenLastCalledWith(true);

		act(() => {
			readyController.finishCameraAnimation(readyController.cameraAnimationKey);
		});

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenLastCalledWith(smoothTarget);
		expect(onAnimationStateChange).toHaveBeenCalledTimes(2);
		expect(onAnimationStateChange).toHaveBeenLastCalledWith(false);
	});

	it("commits settled camera when animation completion reports real-time state", () => {
		const smoothTarget = { x: 120, y: -48, zoom: 1.5 };
		const settledCamera = { x: 96, y: -40, zoom: 1.5 };
		const onChange = vi.fn();
		let controller: UseCanvasCameraControllerResult | null = null;

		render(
			<CameraControllerProbe
				camera={{ x: 0, y: 0, zoom: 1 }}
				onChange={onChange}
				onReady={(api) => {
					controller = api;
				}}
			/>,
		);

		act(() => {
			controller?.applyCamera(smoothTarget);
		});
		act(() => {
			controller?.finishCameraAnimation(
				controller?.cameraAnimationKey ?? 0,
				settledCamera,
			);
		});

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenLastCalledWith(settledCamera);
	});
});
