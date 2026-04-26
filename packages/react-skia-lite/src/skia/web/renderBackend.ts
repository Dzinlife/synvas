import type {
	CanvasKit,
	SkImagesFactory,
	SkSurfacesFactory,
	Surface,
	WebGPUCanvasContext,
	WebGPUCanvasOptions,
	WebGPUDeviceContext,
} from "canvaskit-wasm";

export type SkiaWebGPUCanvasToneMappingMode = "standard" | "extended";

export type SkiaWebGPUCanvasOptions = WebGPUCanvasOptions & {
	toneMapping?: {
		mode: SkiaWebGPUCanvasToneMappingMode;
	};
};

type WebGPUNavigator = Navigator & {
	gpu?: {
		requestAdapter?: () => Promise<GPUAdapter | null>;
		getPreferredCanvasFormat?: () => GPUTextureFormat;
	};
};

export type SkiaWebBackendPreference = "auto" | "webgpu" | "webgl";

export type SkiaBundleKind = "webgpu" | "webgl";

export type SkiaRenderBackend =
	| {
			bundle: "webgpu";
			kind: "webgpu";
			device: GPUDevice;
			deviceContext: WebGPUDeviceContext;
	  }
	| {
			bundle: "webgl";
			kind: "webgl";
	  };

export type CanvasKitWebGPU = CanvasKit & {
	MakeGPUDeviceContext?: (device: GPUDevice) => WebGPUDeviceContext | null;
	MakeGPUCanvasContext?: (
		context: WebGPUDeviceContext,
		canvas: HTMLCanvasElement | OffscreenCanvas,
		opts?: SkiaWebGPUCanvasOptions,
	) => WebGPUCanvasContext | null;
	MakeGPUCanvasSurface?: (
		canvasContext: WebGPUCanvasContext,
		colorSpace?: unknown,
		width?: number,
		height?: number,
	) => Surface | null;
	SkSurfaces?: SkSurfacesFactory;
	SkImages?: SkImagesFactory;
};

let renderBackend: SkiaRenderBackend = { bundle: "webgl", kind: "webgl" };

const hasWebGLSurfaceFactory = (CanvasKit: CanvasKit) => {
	return (
		typeof CanvasKit.GetWebGLContext === "function" &&
		typeof CanvasKit.MakeWebGLContext === "function" &&
		typeof CanvasKit.MakeOnScreenGLSurface === "function"
	);
};

const hasWebGPUSurfaceFactory = (CanvasKit: CanvasKit) => {
	const canvasKit = toCanvasKitWebGPU(CanvasKit);
	return (
		typeof canvasKit.MakeGPUDeviceContext === "function" &&
		typeof canvasKit.MakeGPUCanvasContext === "function" &&
		typeof canvasKit.MakeGPUCanvasSurface === "function" &&
		typeof canvasKit.SkSurfaces?.RenderTarget === "function" &&
		typeof canvasKit.SkSurfaces?.WrapBackendTexture === "function" &&
		typeof canvasKit.SkSurfaces?.AsImage === "function" &&
		typeof canvasKit.SkSurfaces?.AsImageCopy === "function" &&
		typeof canvasKit.SkImages?.WrapTexture === "function" &&
		typeof canvasKit.SkImages?.PromiseTextureFrom === "function" &&
		typeof canvasKit.SkImages?.MakeWithFilter === "function"
	);
};

const getWebGPUNavigator = (): WebGPUNavigator | null => {
	if (typeof navigator === "undefined") {
		return null;
	}
	return navigator as WebGPUNavigator;
};

const canUseNavigatorWebGPU = () => {
	const gpuNavigator = getWebGPUNavigator();
	return typeof gpuNavigator?.gpu?.requestAdapter === "function";
};

const resolveWebGPURenderBackend = async (
	CanvasKit: CanvasKit,
): Promise<SkiaRenderBackend | null> => {
	if (!canUseNavigatorWebGPU() || !hasWebGPUSurfaceFactory(CanvasKit)) {
		return null;
	}
	try {
		const gpuNavigator = getWebGPUNavigator();
		const adapter = await gpuNavigator?.gpu?.requestAdapter?.();
		if (!adapter) {
			return null;
		}
		const device = await adapter.requestDevice();
		const deviceContext =
			toCanvasKitWebGPU(CanvasKit).MakeGPUDeviceContext?.(device);
		if (!deviceContext) {
			return null;
		}
		return { bundle: "webgpu", kind: "webgpu", device, deviceContext };
	} catch (error) {
		console.warn("Failed to initialize WebGPU backend", error);
		return null;
	}
};

export const resolveSkiaRenderBackendForBundle = async (
	CanvasKit: CanvasKit,
	options: {
		bundle: SkiaBundleKind;
		preference: SkiaWebBackendPreference;
	},
): Promise<SkiaRenderBackend | null> => {
	if (options.bundle === "webgpu") {
		if (options.preference === "webgl") {
			return null;
		}
		return resolveWebGPURenderBackend(CanvasKit);
	}
	if (options.preference === "webgpu") {
		return null;
	}
	if (hasWebGLSurfaceFactory(CanvasKit)) {
		return { bundle: "webgl", kind: "webgl" };
	}
	return null;
};

export const setSkiaRenderBackend = (backend: SkiaRenderBackend) => {
	renderBackend = backend;
	return renderBackend;
};

export const initializeSkiaRenderBackend = async (
	CanvasKit: CanvasKit,
	options: {
		bundle: SkiaBundleKind;
		preference: SkiaWebBackendPreference;
	},
) => {
	const backend = await resolveSkiaRenderBackendForBundle(CanvasKit, options);
	if (!backend) {
		throw new Error(
			`Could not initialize ${options.preference} backend from ${options.bundle} bundle`,
		);
	}
	return setSkiaRenderBackend(backend);
};

export const getSkiaRenderBackend = () => renderBackend;

export const getPreferredWebGPUTextureFormat = (): GPUTextureFormat => {
	const gpuNavigator = getWebGPUNavigator();
	return gpuNavigator?.gpu?.getPreferredCanvasFormat?.() ?? "bgra8unorm";
};

export const toCanvasKitWebGPU = (CanvasKit: CanvasKit) =>
	CanvasKit as CanvasKitWebGPU;

export const __resetSkiaRenderBackendForTests = () => {
	renderBackend = { bundle: "webgl", kind: "webgl" };
};
