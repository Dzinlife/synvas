import type {
	Canvas,
	CanvasKit,
	Image,
	ImageInfo,
	PartialImageInfo,
	Surface,
	TextureSource,
	WebGPUCanvasContext,
	WebGPUCanvasOptions,
	WebGPUDeviceContext,
} from "canvaskit-wasm";

type InternalSurfacePrototype = Omit<
	InternalWebGPUSurface,
	"drawOnce" | "flush" | "requestAnimationFrame"
> & {
	__aiNLEWebGPUPatched?: boolean;
	drawOnce: (
		callback: (_: Canvas) => void,
		dirtyRect?: number[],
	) => void;
	flush: (dirtyRect?: number[]) => void;
	requestAnimationFrame: (
		callback: (_: Canvas) => void,
		dirtyRect?: number[],
	) => number;
};

type InternalWebGPUCanvasContext = WebGPUCanvasContext & {
	_inner: GPUCanvasContext;
	_deviceContext: InternalWebGPUDeviceContext;
	_textureFormat: GPUTextureFormat;
};

type InternalWebGPUDeviceContext = WebGPUDeviceContext & {
	_device?: GPUDevice;
	_submit?: () => boolean;
};

type WebGPUExternalTextureSource =
	| HTMLImageElement
	| HTMLVideoElement
	| ImageBitmap
	| VideoFrame;

type InternalWebGPUSurface = Surface & {
	_canvasContext?: InternalWebGPUCanvasContext;
	_deviceContext?: InternalWebGPUDeviceContext;
	reportBackendTypeIsGPU?: () => boolean;
	_requestAnimationFrameInternal?: (
		callback: (_: Canvas) => void,
		dirtyRect?: number[],
	) => number;
	_drawOnceInternal?: (callback: (_: Canvas) => void, dirtyRect?: number[]) => void;
	assignCurrentSwapChainTexture?: () => boolean;
	makeImageFromTextureSource?: (
		source: TextureSource | VideoFrame,
		info?: ImageInfo | PartialImageInfo,
		srcIsPremul?: boolean,
	) => Image;
	updateTextureFromSource?: (
		image: Image,
		source: TextureSource | VideoFrame,
		srcIsPremul?: boolean,
		info?: ImageInfo | PartialImageInfo,
	) => Image;
	requestAnimationFrame: (
		callback: (_: Canvas) => void,
		dirtyRect?: number[],
	) => number;
	drawOnce: (callback: (_: Canvas) => void, dirtyRect?: number[]) => void;
	flush: (dirtyRect?: number[]) => void;
	delete?: () => void;
	dispose?: () => void;
};

type InternalCanvasKitWebGPU = Omit<
	CanvasKit,
	| "MakeGPUCanvasContext"
	| "MakeGPUCanvasSurface"
	| "MakeGPUDeviceContext"
	| "MakeGPUTextureSurface"
	| "Surface"
> & {
	webgpu?: boolean;
	preinitializedWebGPUDevice?: GPUDevice;
	_MakeWebGPUDeviceContext?: () => InternalWebGPUDeviceContext | null;
	_MakeGPUTextureSurface?: (
		context: InternalWebGPUDeviceContext,
		textureHandle: number,
		textureFormatIndex: number,
		textureUsage: number,
		width: number,
		height: number,
		colorSpace: unknown,
	) => Surface | null;
	_MakeGPUTextureImage?: (
		context: InternalWebGPUDeviceContext,
		textureHandle: number,
		textureFormatIndex: number,
		textureUsage: number,
		width: number,
		height: number,
		colorSpace: unknown,
		srcIsPremul: boolean,
	) => Image | null;
	_MakeGPUTexturePromiseImage?: (
		context: InternalWebGPUDeviceContext,
		textureFormatIndex: number,
		textureUsage: number,
		width: number,
		height: number,
		colorSpace: unknown,
		srcIsPremul: boolean,
		callback: {
			makeTexture: () => number;
			releaseTexture: (textureHandle: number) => void;
			freeSrc: () => void;
		},
	) => Image | null;
	_defaultWebGPUDeviceContext?: InternalWebGPUDeviceContext;
	JsValStore?: {
		add: (value: unknown) => number;
		get: (handle: number) => unknown;
		remove: (handle: number) => void;
	};
	WebGPU?: {
		TextureFormat?: GPUTextureFormat[];
	};
	MakeGPUDeviceContext?: (device: GPUDevice) => InternalWebGPUDeviceContext | null;
	MakeGPUCanvasContext?: (
		context: InternalWebGPUDeviceContext,
		canvas: HTMLCanvasElement | OffscreenCanvas,
		opts?: WebGPUCanvasOptions,
	) => InternalWebGPUCanvasContext | null;
	MakeGPUCanvasSurface?: (
		canvasContext: InternalWebGPUCanvasContext,
		colorSpace?: unknown,
		width?: number,
		height?: number,
	) => Surface | null;
	MakeGPUTextureSurface?: (
		context: InternalWebGPUDeviceContext,
		texture: GPUTexture,
		textureFormat: GPUTextureFormat,
		width: number,
		height: number,
		colorSpace?: unknown,
	) => Surface | null;
	MakeLazyImageFromTextureSource?: (
		source: TextureSource | VideoFrame,
		info?: ImageInfo | PartialImageInfo,
		srcIsPremul?: boolean,
	) => Image;
	Surface?: {
		prototype?: InternalWebGPUSurface & {
			__aiNLEWebGPUPatched?: boolean;
		};
	};
};

type MutableCanvasKitWebGPU = InternalCanvasKitWebGPU & Record<string, unknown>;

type GlobalJsValStore = {
	add: (value: unknown) => number;
	get: (handle: number) => unknown;
	remove: (handle: number) => void;
};

type GlobalThisWithJsValStore = typeof globalThis & {
	JsValStore?: GlobalJsValStore;
};

const WEBGPU_TEXTURE_USAGE_FALLBACK = 0x01 | 0x02 | 0x04 | 0x10;
const WEBGPU_TEXTURE_SOURCE_FORMAT = "rgba8unorm";
const DEFAULT_WEBGPU_CANVAS_ALPHA_MODE = "premultiplied" as const;

const getRequestAnimationFrame = () => {
	if (typeof globalThis.requestAnimationFrame === "function") {
		return globalThis.requestAnimationFrame.bind(globalThis);
	}
	return (callback: FrameRequestCallback) =>
		globalThis.setTimeout(() => callback(performance.now()), 0);
};

const ensureGlobalJsValStore = (): GlobalJsValStore => {
	const globalObject = globalThis as GlobalThisWithJsValStore;
	const existingStore = globalObject.JsValStore;
	if (
		existingStore &&
		typeof existingStore.add === "function" &&
		typeof existingStore.get === "function" &&
		typeof existingStore.remove === "function"
	) {
		return existingStore;
	}
	let nextHandle = 1;
	const values = new Map<number, unknown>();
	const store: GlobalJsValStore = {
		add(value) {
			const handle = nextHandle++;
			values.set(handle, value);
			return handle;
		},
		get(handle) {
			return values.get(handle);
		},
		remove(handle) {
			values.delete(handle);
		},
	};
	Object.defineProperty(globalObject, "JsValStore", {
		value: store,
		writable: true,
		configurable: true,
	});
	return store;
};

const getWebGPUTextureUsage = () => {
	if (typeof GPUTextureUsage === "undefined") {
		return WEBGPU_TEXTURE_USAGE_FALLBACK;
	}
	return (
		GPUTextureUsage.RENDER_ATTACHMENT |
		GPUTextureUsage.TEXTURE_BINDING |
		GPUTextureUsage.COPY_SRC |
		GPUTextureUsage.COPY_DST
	);
};

const getJsValStore = (canvasKit: InternalCanvasKitWebGPU) => {
	return canvasKit.JsValStore ?? ensureGlobalJsValStore();
};

const looksLikeActualCanvasKitBundle = (canvasKit: InternalCanvasKitWebGPU) => {
	return (
		typeof canvasKit.Surface?.prototype === "object" ||
		typeof canvasKit.JsValStore?.add === "function" ||
		Array.isArray(canvasKit.WebGPU?.TextureFormat) ||
		canvasKit.webgpu === true
	);
};

const hasLowLevelWebGPUExports = (canvasKit: InternalCanvasKitWebGPU) => {
	return (
		typeof canvasKit._MakeWebGPUDeviceContext === "function" &&
		typeof canvasKit._MakeGPUTextureSurface === "function" &&
		typeof canvasKit.JsValStore?.add === "function" &&
		Array.isArray(canvasKit.WebGPU?.TextureFormat)
	);
};

const hasPublicWebGPUHelpers = (canvasKit: InternalCanvasKitWebGPU) => {
	return (
		typeof canvasKit.MakeGPUDeviceContext === "function" &&
		typeof canvasKit.MakeGPUCanvasContext === "function" &&
		typeof canvasKit.MakeGPUCanvasSurface === "function" &&
		typeof canvasKit.MakeGPUTextureSurface === "function"
	);
};

const disableBrokenWebGPUHelpers = (canvasKit: InternalCanvasKitWebGPU) => {
	const mutableCanvasKit = canvasKit as MutableCanvasKitWebGPU;
	delete mutableCanvasKit.MakeGPUDeviceContext;
	delete mutableCanvasKit.MakeGPUCanvasContext;
	delete mutableCanvasKit.MakeGPUCanvasSurface;
	delete mutableCanvasKit.MakeGPUTextureSurface;
	canvasKit.webgpu = false;
};

const getTextureFormatIndex = (
	canvasKit: InternalCanvasKitWebGPU,
	textureFormat: GPUTextureFormat,
) => {
	const formats = canvasKit.WebGPU?.TextureFormat;
	if (!formats) {
		return -1;
	}
	return formats.indexOf(textureFormat);
};

const getPreferredCanvasFormat = (): GPUTextureFormat => {
	const gpuNavigator = globalThis.navigator as Navigator & {
		gpu?: {
			getPreferredCanvasFormat?: () => GPUTextureFormat;
		};
	};
	return gpuNavigator.gpu?.getPreferredCanvasFormat?.() ?? "bgra8unorm";
};

const normalizeWebGPUCanvasOptions = (
	opts?: WebGPUCanvasOptions,
): WebGPUCanvasOptions => {
	return {
		...(opts ?? {}),
		alphaMode: opts?.alphaMode ?? DEFAULT_WEBGPU_CANVAS_ALPHA_MODE,
	};
};

const disposeSurface = (surface: InternalWebGPUSurface) => {
	if (typeof surface.dispose === "function") {
		surface.dispose();
		return;
	}
	surface.delete?.();
};

const patchSurfacePrototype = (canvasKit: InternalCanvasKitWebGPU) => {
	const surfacePrototype = canvasKit.Surface?.prototype as
		| InternalSurfacePrototype
		| undefined;
	if (!surfacePrototype || surfacePrototype.__aiNLEWebGPUPatched) {
		return;
	}

	const originalFlush = surfacePrototype.flush.bind(surfacePrototype) as (
		dirtyRect?: number[],
	) => void;
	surfacePrototype.__aiNLEWebGPUPatched = true;
	surfacePrototype.assignCurrentSwapChainTexture = () => false;
	surfacePrototype.makeImageFromTextureSource = function (
		_source: TextureSource | VideoFrame,
		info?: ImageInfo | PartialImageInfo,
		srcIsPremul?: boolean,
	) {
		return canvasKit.MakeLazyImageFromTextureSource?.(_source, info, srcIsPremul);
	};
	surfacePrototype.updateTextureFromSource = function (
		image: Image,
		source: TextureSource | VideoFrame,
		srcIsPremul?: boolean,
		info?: ImageInfo | PartialImageInfo,
	) {
		const nextImage = canvasKit.MakeLazyImageFromTextureSource?.(
			source,
			info,
			srcIsPremul,
		);
		if (!nextImage) {
			return image;
		}
		return nextImage;
	};
	const requestAnimationFrameInternal = (
		surface: InternalWebGPUSurface,
		callback: (_: Canvas) => void,
		dirtyRect?: number[],
	) => {
		if (surface._requestAnimationFrameInternal) {
			return surface._requestAnimationFrameInternal(callback, dirtyRect);
		}
		return getRequestAnimationFrame()(() => {
			callback(surface.getCanvas());
			surface.flush(dirtyRect);
		});
	};
	surfacePrototype.flush = function (
		this: InternalWebGPUSurface,
		dirtyRect?: number[],
	) {
		originalFlush.call(this, dirtyRect);
		this._deviceContext?.submit?.();
	};
	surfacePrototype.requestAnimationFrame = function (
		this: InternalWebGPUSurface,
		callback: (_: Canvas) => void,
		dirtyRect?: number[],
	) {
		if (!this.reportBackendTypeIsGPU?.()) {
			return requestAnimationFrameInternal(this, callback, dirtyRect);
		}
		return getRequestAnimationFrame()(() => {
			if (this._canvasContext) {
				const surface = canvasKit.MakeGPUCanvasSurface?.(this._canvasContext);
				if (!surface) {
					console.error("Failed to initialize Surface for current canvas swapchain texture");
					return;
				}
				callback(surface.getCanvas());
				(surface as InternalWebGPUSurface).flush(dirtyRect);
				disposeSurface(surface as InternalWebGPUSurface);
				return;
			}
			callback(this.getCanvas());
			this.flush(dirtyRect);
		});
	};
	surfacePrototype.drawOnce = function (
		this: InternalWebGPUSurface,
		callback: (_: Canvas) => void,
		dirtyRect?: number[],
	) {
		if (!this.reportBackendTypeIsGPU?.()) {
			this._drawOnceInternal?.(callback, dirtyRect);
			return;
		}
		getRequestAnimationFrame()(() => {
			if (this._canvasContext) {
				const surface = canvasKit.MakeGPUCanvasSurface?.(this._canvasContext);
					if (!surface) {
						console.error("Failed to initialize Surface for current canvas swapchain texture");
						return;
					}
					callback(surface.getCanvas());
					(surface as InternalWebGPUSurface).flush(dirtyRect);
					disposeSurface(surface as InternalWebGPUSurface);
					return;
				}
			callback(this.getCanvas());
			this.flush(dirtyRect);
			disposeSurface(this);
		});
	};
};

const installPublicWebGPUHelpers = (canvasKit: InternalCanvasKitWebGPU) => {
	const makeGPUDeviceContext: NonNullable<
		InternalCanvasKitWebGPU["MakeGPUDeviceContext"]
	> = (device) => {
		if (!device) {
			return null;
		}
		canvasKit.preinitializedWebGPUDevice = device;
		const context = canvasKit._MakeWebGPUDeviceContext?.();
		if (!context) {
			return null;
		}
		context._device = device;
		context.submit = () => context._submit?.() ?? false;
		canvasKit._defaultWebGPUDeviceContext = context;
		return context;
	};
	canvasKit.MakeGPUDeviceContext = makeGPUDeviceContext;

	const makeGPUTextureSurface: NonNullable<
		InternalCanvasKitWebGPU["MakeGPUTextureSurface"]
	> = (
		deviceContext,
		texture,
		textureFormat,
		width,
		height,
		colorSpace,
	) => {
		const textureHandle = canvasKit.JsValStore?.add(texture);
		const textureFormatIndex = getTextureFormatIndex(canvasKit, textureFormat);
		if (
			typeof textureHandle !== "number" ||
			textureFormatIndex < 0 ||
			typeof canvasKit._MakeGPUTextureSurface !== "function"
		) {
			return null;
		}
		const surface = canvasKit._MakeGPUTextureSurface(
			deviceContext,
			textureHandle,
			textureFormatIndex,
			texture.usage,
			width,
			height,
			colorSpace ?? null,
		) as InternalWebGPUSurface | null;
		if (!surface) {
			return null;
		}
		surface._deviceContext = deviceContext;
		return surface;
	};
	canvasKit.MakeGPUTextureSurface = makeGPUTextureSurface;

	const makeGPUCanvasContext: NonNullable<
		InternalCanvasKitWebGPU["MakeGPUCanvasContext"]
	> = (deviceContext, canvas, opts) => {
		const canvasContext = canvas.getContext("webgpu");
		if (!canvasContext || !deviceContext._device) {
			return null;
		}
		const resolvedOptions = normalizeWebGPUCanvasOptions(opts);
		const textureFormat = resolvedOptions.format ?? getPreferredCanvasFormat();
		canvasContext.configure({
			device: deviceContext._device,
			format: textureFormat,
			alphaMode: resolvedOptions.alphaMode,
		});
		const webgpuCanvasContext = {
			_inner: canvasContext,
			_deviceContext: deviceContext,
			_textureFormat: textureFormat,
			requestAnimationFrame(callback: (_: Canvas) => void) {
				getRequestAnimationFrame()(() => {
					const surface =
						canvasKit.MakeGPUCanvasSurface?.(webgpuCanvasContext);
					if (!surface) {
						console.error("Failed to initialize Surface for current canvas swapchain texture");
						return;
					}
					callback(surface.getCanvas());
					surface.flush();
					disposeSurface(surface as InternalWebGPUSurface);
				});
			},
		} satisfies InternalWebGPUCanvasContext;
		return webgpuCanvasContext;
	};
	canvasKit.MakeGPUCanvasContext = makeGPUCanvasContext;

	const makeGPUCanvasSurface: NonNullable<
		InternalCanvasKitWebGPU["MakeGPUCanvasSurface"]
	> = (canvasContext, colorSpace, width, height) => {
		const currentTexture = canvasContext._inner.getCurrentTexture();
		const surface = canvasKit.MakeGPUTextureSurface?.(
			canvasContext._deviceContext,
			currentTexture,
			canvasContext._textureFormat,
			width ?? canvasContext._inner.canvas.width,
			height ?? canvasContext._inner.canvas.height,
			colorSpace,
		) as InternalWebGPUSurface | null;
		if (!surface) {
			return null;
		}
		surface._canvasContext = canvasContext;
		return surface;
	};
	canvasKit.MakeGPUCanvasSurface = makeGPUCanvasSurface;
};

export const installCanvasKitWebGPU = (canvasKit: CanvasKit) => {
	const internalCanvasKit = canvasKit as InternalCanvasKitWebGPU;
	if (!looksLikeActualCanvasKitBundle(internalCanvasKit)) {
		return;
	}
	const mutableCanvasKit = internalCanvasKit as MutableCanvasKitWebGPU;
	if (!internalCanvasKit.JsValStore) {
		// 旧的 CanvasKit WebGPU helper 直接依赖自由变量 JsValStore。
		// 在 Vite 预构建后的模块环境里，这个内部对象不会自动挂到实例上，
		// 需要显式补一个全局句柄仓库，供 helper 和 wasm import 共用。
		mutableCanvasKit.JsValStore = ensureGlobalJsValStore();
	}
	if (hasPublicWebGPUHelpers(internalCanvasKit)) {
		const originalMakeGPUDeviceContext =
			internalCanvasKit.MakeGPUDeviceContext?.bind(internalCanvasKit);
		const originalMakeGPUCanvasContext =
			internalCanvasKit.MakeGPUCanvasContext?.bind(internalCanvasKit);
		if (originalMakeGPUDeviceContext) {
			internalCanvasKit.MakeGPUDeviceContext = (device) => {
				const context = originalMakeGPUDeviceContext(device);
				if (context) {
					internalCanvasKit._defaultWebGPUDeviceContext = context;
				}
				return context;
			};
		}
		if (originalMakeGPUCanvasContext) {
			internalCanvasKit.MakeGPUCanvasContext = (context, canvas, opts) => {
				return originalMakeGPUCanvasContext(
					context,
					canvas,
					normalizeWebGPUCanvasOptions(opts),
				);
			};
		}
			// 官方 bundle 已经提供可用 helper 时，直接保留原始实现。
			// emdawnwebgpu 的内部对象不一定会挂到 CanvasKit 实例上，
			// 此时不能再按私有导出缺失来误判并删除 public helper。
			internalCanvasKit.webgpu = true;
		return;
	}
	if (!hasLowLevelWebGPUExports(internalCanvasKit)) {
		disableBrokenWebGPUHelpers(internalCanvasKit);
		return;
	}

	internalCanvasKit.webgpu = true;
	installPublicWebGPUHelpers(internalCanvasKit);
	patchSurfacePrototype(internalCanvasKit);
	if (!hasPublicWebGPUHelpers(internalCanvasKit)) {
		disableBrokenWebGPUHelpers(internalCanvasKit);
		return;
	}
};
