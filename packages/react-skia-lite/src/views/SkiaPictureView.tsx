/* global HTMLCanvasElement */
import { useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { Platform } from "../Platform";
import type { LayoutChangeEvent } from "../react-native-types";
import { CanvasKit } from "../skia/Skia";
import type { SkImage, SkPicture, SkRect } from "../skia/types";
import { JsiSkSurface } from "../skia/web/JsiSkSurface";
import {
	getSkiaRenderBackend,
	type SkiaRenderBackend,
} from "../skia/web/renderBackend";
import {
	assignCurrentSkiaSwapChainTexture,
	createSkiaCanvasSurface,
	invalidateSkiaWebGPUCanvasContext,
} from "../skia/web/surfaceFactory";
import { createSkiaResourceScope } from "../skia/web/resourceLifecycle";
import { SkiaViewApi } from "./api";
import { SkiaViewNativeId } from "./SkiaViewNativeId";
import type { SkiaPictureViewNativeProps } from "./types";

const dp2Pixel = (pd: number, rect?: SkRect) => {
	if (!rect) {
		return undefined;
	}
	return {
		x: rect.x * pd,
		y: rect.y * pd,
		width: rect.width * pd,
		height: rect.height * pd,
	};
};

const CLEAR_COLOR = Float32Array.of(0, 0, 0, 0);

const resizeCanvasElement = (canvas: HTMLCanvasElement, pd: number) => {
	canvas.width = Math.max(1, Math.ceil(canvas.clientWidth * pd));
	canvas.height = Math.max(1, Math.ceil(canvas.clientHeight * pd));
};

const drawPictureOnSurface = (
	surface: JsiSkSurface,
	pd: number,
	picture: SkPicture,
) => {
	const canvas = surface.getCanvas();
	canvas.clear(CLEAR_COLOR);
	canvas.save();
	canvas.scale(pd, pd);
	canvas.drawPicture(picture);
	canvas.restore();
};

const makeRasterSnapshot = (
	canvas: HTMLCanvasElement,
	pd: number,
	picture: SkPicture,
	rect?: SkRect,
) => {
	const width = Math.max(1, Math.ceil(canvas.clientWidth * pd));
	const height = Math.max(1, Math.ceil(canvas.clientHeight * pd));
	const surface = CanvasKit.MakeSurface(width, height);
	if (!surface) {
		return null;
	}
	const skSurface = new JsiSkSurface(CanvasKit, surface);
	try {
		drawPictureOnSurface(skSurface, pd, picture);
		skSurface.ref.flush();
		return skSurface.makeImageSnapshot(dp2Pixel(pd, rect));
	} finally {
		surface.delete();
	}
};

interface Renderer {
	onResize(): void;
	draw(picture: SkPicture): void;
	makeImageSnapshot(picture: SkPicture, rect?: SkRect): SkImage | null;
	dispose(): void;
}

class CanvasSurfaceRenderer implements Renderer {
	private surface: JsiSkSurface | null = null;

	constructor(
		private canvas: HTMLCanvasElement,
		private pd: number,
		private backend: SkiaRenderBackend,
	) {
		this.onResize();
	}

	private disposeSurface() {
		if (!this.surface) {
			return;
		}
		this.surface.dispose();
		this.surface = null;
	}

	makeImageSnapshot(picture: SkPicture, rect?: SkRect): SkImage | null {
		return makeRasterSnapshot(this.canvas, this.pd, picture, rect);
	}

	onResize() {
		resizeCanvasElement(this.canvas, this.pd);
		if (this.backend.kind === "webgpu") {
			invalidateSkiaWebGPUCanvasContext(this.canvas);
			return;
		}
		this.disposeSurface();
		const surface = createSkiaCanvasSurface(
			CanvasKit,
			this.canvas,
			this.backend,
		);
		if (!surface) {
			throw new Error("Could not create surface");
		}
		this.surface = surface;
	}

	private ensureCurrentSwapChainTexture() {
		if (this.backend.kind !== "webgpu") {
			if (!this.surface || assignCurrentSkiaSwapChainTexture(this.surface)) {
				return;
			}
			this.onResize();
			return;
		}
		this.disposeSurface();
		const surface = createSkiaCanvasSurface(
			CanvasKit,
			this.canvas,
			this.backend,
		);
		if (!surface) {
			throw new Error("Could not create WebGPU surface");
		}
		this.surface = surface;
	}

	draw(picture: SkPicture) {
		if (this.backend.kind === "webgpu") {
			const surface = createSkiaCanvasSurface(
				CanvasKit,
				this.canvas,
				this.backend,
			);
			if (!surface) {
				return;
			}
			try {
				drawPictureOnSurface(surface, this.pd, picture);
				surface.ref.flush();
			} finally {
				surface.dispose();
			}
			return;
		}
		if (!this.surface) {
			return;
		}
		this.ensureCurrentSwapChainTexture();
		if (!this.surface) {
			return;
		}
		drawPictureOnSurface(this.surface, this.pd, picture);
		this.surface.ref.flush();
	}

	dispose(): void {
		if (this.backend.kind === "webgpu") {
			invalidateSkiaWebGPUCanvasContext(this.canvas);
		}
		this.disposeSurface();
	}
}

const createRenderer = (
	canvas: HTMLCanvasElement,
	pd: number,
	forceSoftware: boolean,
): Renderer => {
	const backend: SkiaRenderBackend = forceSoftware
		? { bundle: "webgl", kind: "software" }
		: getSkiaRenderBackend();
	return new CanvasSurfaceRenderer(canvas, pd, backend);
};

export interface SkiaPictureViewHandle {
	setPicture(picture: SkPicture): void;
	getSize(): { width: number; height: number };
	redraw(): void;
	makeImageSnapshot(rect?: SkRect): SkImage | null;
	measure(
		callback: (
			x: number,
			y: number,
			width: number,
			height: number,
			pageX: number,
			pageY: number,
		) => void,
	): void;
	measureInWindow(
		callback: (x: number, y: number, width: number, height: number) => void,
	): void;
}

export interface SkiaPictureViewProps extends SkiaPictureViewNativeProps {
	ref?: React.Ref<SkiaPictureViewHandle>;
	pd?: number;
}

export const SkiaPictureView = (props: SkiaPictureViewProps) => {
	const { ref, pd = Platform.PixelRatio } = props;
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const renderer = useRef<Renderer | null>(null);
	const redrawRequestsRef = useRef(0);
	const requestIdRef = useRef<number | null>(null);
	const pictureRef = useRef<SkPicture | null>(null);
	const pictureResourceScopeRef = useRef(createSkiaResourceScope());

	const { picture, onLayout } = props;

	const tick = useCallback(() => {
		requestIdRef.current = null;
		if (redrawRequestsRef.current === 0) {
			return;
		}
		redrawRequestsRef.current = 0;
		if (renderer.current && pictureRef.current) {
			renderer.current.draw(pictureRef.current);
		}
		if (redrawRequestsRef.current > 0 && requestIdRef.current === null) {
			requestIdRef.current = requestAnimationFrame(tick);
		}
	}, []);

	const redraw = useCallback(() => {
		redrawRequestsRef.current++;
		if (requestIdRef.current !== null) {
			return;
		}
		requestIdRef.current = requestAnimationFrame(tick);
	}, [tick]);

	const getSize = useCallback(() => {
		return {
			width: canvasRef.current?.clientWidth || 0,
			height: canvasRef.current?.clientHeight || 0,
		};
	}, []);

	const setPicture = useCallback(
		(newPicture: SkPicture) => {
			const previousPicture = pictureRef.current;
			pictureResourceScopeRef.current.track(newPicture);
			pictureRef.current = newPicture;
			redraw();
			if (previousPicture && previousPicture !== newPicture) {
				pictureResourceScopeRef.current.release(previousPicture, {
					timing: "animationFrame",
				});
			}
		},
		[redraw],
	);

	const makeImageSnapshot = useCallback((rect?: SkRect) => {
		if (renderer.current && pictureRef.current) {
			return renderer.current.makeImageSnapshot(pictureRef.current, rect);
		}
		return null;
	}, []);

	const measure = useCallback(
		(
			callback: (
				x: number,
				y: number,
				width: number,
				height: number,
				pageX: number,
				pageY: number,
			) => void,
		) => {
			if (canvasRef.current) {
				const rect = canvasRef.current.getBoundingClientRect();
				const parentElement = canvasRef.current.offsetParent as HTMLElement;
				const parentRect = parentElement?.getBoundingClientRect() || {
					left: 0,
					top: 0,
				};

				// x, y are relative to the parent
				const x = rect.left - parentRect.left;
				const y = rect.top - parentRect.top;

				// pageX, pageY are absolute screen coordinates
				const pageX = rect.left + window.scrollX;
				const pageY = rect.top + window.scrollY;

				callback(x, y, rect.width, rect.height, pageX, pageY);
			}
		},
		[],
	);

	const measureInWindow = useCallback(
		(
			callback: (x: number, y: number, width: number, height: number) => void,
		) => {
			if (canvasRef.current) {
				const rect = canvasRef.current.getBoundingClientRect();

				// x, y are the absolute coordinates in the window
				const x = rect.left;
				const y = rect.top;

				callback(x, y, rect.width, rect.height);
			}
		},
		[],
	);

	const onLayoutEvent = useCallback(
		(evt: LayoutChangeEvent) => {
			const canvas = canvasRef.current;
			if (canvas) {
				renderer.current?.dispose();
				renderer.current = createRenderer(
					canvas,
					pd,
					props.__destroyWebGLContextAfterRender === true,
				);
				if (pictureRef.current) {
					renderer.current.draw(pictureRef.current);
				}
			}
			if (onLayout) {
				onLayout(evt);
			}
		},
		[onLayout, pd, props.__destroyWebGLContextAfterRender],
	);

	useImperativeHandle(
		ref,
		() => ({
			setPicture,
			getSize,
			redraw,
			makeImageSnapshot,
			measure,
			measureInWindow,
			get canvasRef() {
				return () => canvasRef.current;
			},
		}),
		[setPicture, getSize, redraw, makeImageSnapshot, measure, measureInWindow],
	);

	useEffect(() => {
		const nativeID = props.nativeID ?? `${SkiaViewNativeId.current++}`;
		SkiaViewApi.registerView(nativeID, {
			setPicture,
			getSize,
			redraw,
			makeImageSnapshot,
			measure,
			measureInWindow,
		} as SkiaPictureViewHandle);
		return () => {
			SkiaViewApi.unregisterView?.(nativeID);
		};
	}, [
		setPicture,
		getSize,
		redraw,
		makeImageSnapshot,
		measure,
		measureInWindow,
		props.nativeID,
	]);

	useEffect(() => {
		if (props.picture) {
			setPicture(props.picture);
		}
	}, [setPicture, props.picture]);

	useEffect(() => {
		return () => {
			if (requestIdRef.current !== null) {
				cancelAnimationFrame(requestIdRef.current);
				requestIdRef.current = null;
			}
			pictureRef.current = null;
			pictureResourceScopeRef.current.disposeAll({
				timing: "immediate",
			});
			if (renderer.current) {
				renderer.current.dispose();
				renderer.current = null;
			}
		};
	}, []);

	useEffect(() => {
		if (renderer.current && pictureRef.current) {
			renderer.current.draw(pictureRef.current);
		}
	}, [picture, redraw]);

	const { debug: _debug, ref: _ref, ...viewProps } = props;
	return (
		<Platform.View {...viewProps} onLayout={onLayoutEvent}>
			<canvas ref={canvasRef} style={{ display: "flex", flex: 1 }} />
		</Platform.View>
	);
};
