// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
	let rafClock = 0;
	let rafSeed = 1;
	let nativeRequestAnimationFrame: typeof window.requestAnimationFrame;
	let nativeCancelAnimationFrame: typeof window.cancelAnimationFrame;
	const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();

	beforeEach(() => {
		vi.useFakeTimers();
		rafClock = 0;
		rafSeed = 1;
		nativeRequestAnimationFrame = window.requestAnimationFrame;
		nativeCancelAnimationFrame = window.cancelAnimationFrame;
		window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			const rafId = rafSeed;
			rafSeed += 1;
			const timer = window.setTimeout(() => {
				rafClock += 16;
				rafTimers.delete(rafId);
				callback(rafClock);
			}, 16);
			rafTimers.set(rafId, timer);
			return rafId;
		}) as typeof window.requestAnimationFrame;
		window.cancelAnimationFrame = ((id: number) => {
			const timer = rafTimers.get(id);
			if (timer === undefined) return;
			window.clearTimeout(timer);
			rafTimers.delete(id);
		}) as typeof window.cancelAnimationFrame;
	});

	afterEach(() => {
		for (const timer of rafTimers.values()) {
			window.clearTimeout(timer);
		}
		rafTimers.clear();
		window.requestAnimationFrame = nativeRequestAnimationFrame;
		window.cancelAnimationFrame = nativeCancelAnimationFrame;
		vi.useRealTimers();
	});

	it("instant camera 更新会立刻写入 sharedValue 与 store", () => {
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
			controller?.applyCamera(
				{ x: 120, y: -48, zoom: 1.5 },
				{ transition: "instant" },
			);
		});

		expect(controller).not.toBeNull();
		if (!controller) return;
		expect(controller.getCamera()).toEqual({ x: 120, y: -48, zoom: 1.5 });
		expect(controller.cameraSharedValue.value).toEqual({
			x: 120,
			y: -48,
			zoom: 1.5,
		});
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenLastCalledWith({ x: 120, y: -48, zoom: 1.5 });
		expect(onAnimationStateChange).not.toHaveBeenCalled();
	});

	it("smooth camera 会按显式插值逐帧写回并在结束时关闭动画状态", () => {
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
		expect(onAnimationStateChange).toHaveBeenCalledTimes(1);
		expect(onAnimationStateChange).toHaveBeenLastCalledWith(true);
		expect(onChange).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(260);
		});

		expect(onChange.mock.calls.length).toBeGreaterThan(1);
		expect(onChange).toHaveBeenLastCalledWith({ x: 120, y: -48, zoom: 1.5 });
		expect(controller.getCamera()).toEqual({ x: 120, y: -48, zoom: 1.5 });
		expect(controller.cameraSharedValue.value).toEqual({
			x: 120,
			y: -48,
			zoom: 1.5,
		});
		expect(onAnimationStateChange).toHaveBeenCalledTimes(2);
		expect(onAnimationStateChange).toHaveBeenLastCalledWith(false);
	});

	it("smooth 动画期间会忽略 instant 输入", () => {
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
			controller?.applyCamera({ x: 64, y: 32, zoom: 1.2 });
		});
		act(() => {
			controller?.applyCamera(
				{ x: 10, y: 10, zoom: 0.8 },
				{ transition: "instant" },
			);
		});
		act(() => {
			vi.advanceTimersByTime(260);
		});

		expect(onChange).toHaveBeenCalled();
		expect(onChange).toHaveBeenLastCalledWith({ x: 64, y: 32, zoom: 1.2 });
	});

	it("未完成 smooth 动画可被新的 smooth 目标覆盖", () => {
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
		act(() => {
			vi.advanceTimersByTime(80);
		});
		act(() => {
			controller?.applyCamera({ x: 0, y: 0, zoom: 1 });
		});
		act(() => {
			vi.advanceTimersByTime(260);
		});

		expect(onChange).toHaveBeenCalled();
		expect(onChange).toHaveBeenLastCalledWith({ x: 0, y: 0, zoom: 1 });
		expect(onAnimationStateChange).toHaveBeenNthCalledWith(1, true);
		expect(onAnimationStateChange).toHaveBeenLastCalledWith(false);
	});
});
