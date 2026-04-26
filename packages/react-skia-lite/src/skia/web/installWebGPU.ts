import type {
	AsyncReadResult,
	Canvas,
	CanvasKit,
	ColorInfo,
	Image,
	ImageInfo,
	InputIRect,
	MakeWithFilterResult,
	PartialImageInfo,
	Surface,
	TextureSource,
	WebGPUCanvasContext,
	WebGPUCanvasOptions,
	WebGPUDeviceContext,
} from "canvaskit-wasm";

type SimpleIRect = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

type SimpleISize = {
	width: number;
	height: number;
};

type WebGPUCanvasToneMappingMode = "standard" | "extended";

type WebGPUCanvasToneMapping = {
	mode: WebGPUCanvasToneMappingMode;
};

type WebGPUCanvasOptionsWithToneMapping = WebGPUCanvasOptions & {
	toneMapping?: WebGPUCanvasToneMapping;
};

type GPUCanvasConfigurationWithToneMapping = GPUCanvasConfiguration & {
	toneMapping?: WebGPUCanvasToneMapping;
};

type GPUCanvasContextWithConfiguration = GPUCanvasContext & {
	getConfiguration?: () => {
		toneMapping?: {
			mode?: string;
		};
	};
};

const DEFAULT_WEBGPU_TEXTURE_FORMATS: readonly (string | undefined)[] = [
	undefined,
	"r8unorm",
	"r8snorm",
	"r8uint",
	"r8sint",
	"r16unorm",
	"r16snorm",
	"r16uint",
	"r16sint",
	"r16float",
	"rg8unorm",
	"rg8snorm",
	"rg8uint",
	"rg8sint",
	"r32float",
	"r32uint",
	"r32sint",
	"rg16unorm",
	"rg16snorm",
	"rg16uint",
	"rg16sint",
	"rg16float",
	"rgba8unorm",
	"rgba8unorm-srgb",
	"rgba8snorm",
	"rgba8uint",
	"rgba8sint",
	"bgra8unorm",
	"bgra8unorm-srgb",
	"rgb10a2uint",
	"rgb10a2unorm",
	"rg11b10ufloat",
	"rgb9e5ufloat",
	"rg32float",
	"rg32uint",
	"rg32sint",
	"rgba16unorm",
	"rgba16snorm",
	"rgba16uint",
	"rgba16sint",
	"rgba16float",
	"rgba32float",
	"rgba32uint",
	"rgba32sint",
];

type WebGPUExternalImageCopy = Parameters<
	GPUQueue["copyExternalImageToTexture"]
>[0];

type IRectLike = {
	left?: number;
	top?: number;
	right?: number;
	bottom?: number;
	fLeft?: number;
	fTop?: number;
	fRight?: number;
	fBottom?: number;
};

type ReleaseCallback = {
	callRelease: () => void;
};

type PromiseTextureCallback = {
	makeTexture: () => number;
	releaseTexture: (textureHandle: number) => void;
	freeSrc: () => void;
};

type InternalSurfacePrototype = Omit<
	InternalWebGPUSurface,
	"drawOnce" | "flush" | "requestAnimationFrame"
> & {
	__synvasWebGPUPatched?: boolean;
	drawOnce: (callback: (_: Canvas) => void, dirtyRect?: number[]) => void;
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

type InternalWebGPUSurface = Surface & {
	_canvasContext?: InternalWebGPUCanvasContext;
	_deviceContext?: InternalWebGPUDeviceContext;
	reportBackendTypeIsGPU?: () => boolean;
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
	_requestAnimationFrameInternal?: (
		callback: (_: Canvas) => void,
		dirtyRect?: number[],
	) => number;
	_drawOnceInternal?: (
		callback: (_: Canvas) => void,
		dirtyRect?: number[],
	) => void;
	requestAnimationFrame: (
		callback: (_: Canvas) => void,
		dirtyRect?: number[],
	) => number;
	drawOnce: (callback: (_: Canvas) => void, dirtyRect?: number[]) => void;
	flush: (dirtyRect?: number[]) => void;
	assignCurrentSwapChainTexture?: () => boolean;
	delete?: () => void;
	dispose?: () => void;
};

type InternalWebGPUDeviceContext = WebGPUDeviceContext & {
	_device?: GPUDevice;
	__graphiteResourceApiAvailable__?: boolean;
	_submit?: (syncToCpu?: boolean) => boolean;
	_checkAsyncWorkCompletion?: () => void;
	_freeGpuResources?: () => void;
	_performDeferredCleanup?: (msNotUsed?: number) => void;
	_currentBudgetedBytes?: () => number;
	_currentPurgeableBytes?: () => number;
	_maxBudgetedBytes?: () => number;
	_setMaxBudgetedBytes?: (bytes: number) => void;
	_readSurfacePixelsAsync?: (
		surface: Surface,
		dstImageInfo: ImageInfo,
		srcRect: SimpleIRect,
		rescaleGamma: unknown,
		rescaleMode: unknown,
		callback: { resolve: (result: AsyncReadResult | null) => void },
	) => boolean;
	_readSurfacePixelsYUV420Async?: (
		surface: Surface,
		yuvColorSpace: unknown,
		dstColorSpace: unknown,
		srcRect: SimpleIRect,
		dstSize: SimpleISize,
		rescaleGamma: unknown,
		rescaleMode: unknown,
		callback: { resolve: (result: AsyncReadResult | null) => void },
	) => boolean;
};

type InternalSkSurfacesFactory = {
	RenderTarget?: (
		context: InternalWebGPUDeviceContext,
		imageInfo: ImageInfo,
		mipmapped?: boolean,
		surfaceProps?: unknown,
		label?: string,
	) => Surface | null;
	WrapBackendTexture?: (
		context: InternalWebGPUDeviceContext,
		texture: GPUTexture,
		colorSpace?: unknown,
		surfaceProps?: unknown,
		releaseProc?: ((releaseContext: unknown) => void) | null,
		releaseContext?: unknown,
		label?: string,
	) => Surface | null;
	AsImage?: (surface: Surface) => Image | null;
	AsImageCopy?: (
		surface: Surface,
		subset?: InputIRect,
		mipmapped?: boolean,
	) => Image | null;
};

type InternalSkImagesFactory = {
	WrapTexture?: (
		context: InternalWebGPUDeviceContext,
		texture: GPUTexture,
		colorType: unknown,
		alphaType: unknown,
		colorSpace?: unknown,
		origin?: unknown,
		generateMipmapsFromBase?: unknown,
		releaseProc?: ((releaseContext: unknown) => void) | null,
		releaseContext?: unknown,
		label?: string,
	) => Image | null;
	PromiseTextureFrom?: (
		context: InternalWebGPUDeviceContext,
		options: {
			dimensions: SimpleISize;
			textureInfo: {
				textureFormat: GPUTextureFormat;
				usage: number;
			};
			colorInfo: ColorInfo;
			origin?: unknown;
			isVolatile?: boolean;
			fulfill: (
				imageContext: unknown,
			) =>
				| { texture: GPUTexture; releaseContext?: unknown }
				| GPUTexture
				| null;
			imageRelease?: (imageContext: unknown) => void;
			textureRelease?: (releaseContext: unknown) => void;
			imageContext?: unknown;
			label?: string;
		},
	) => Image | null;
	MakeWithFilter?: (
		context: InternalWebGPUDeviceContext,
		src: Image,
		filter: unknown,
		subset: InputIRect,
		clipBounds: InputIRect,
	) => MakeWithFilterResult | null;
};

type InternalCanvasKitWebGPU = Omit<
	CanvasKit,
	| "MakeGPUCanvasContext"
	| "MakeGPUCanvasSurface"
	| "MakeGPUDeviceContext"
	| "SkSurfaces"
	| "SkImages"
	| "Surface"
> & {
	webgpu?: boolean;
	preinitializedWebGPUDevice?: GPUDevice;
	_MakeWebGPUDeviceContext?: () => InternalWebGPUDeviceContext | null;
	_SkSurfaces_RenderTarget?: (
		context: InternalWebGPUDeviceContext,
		imageInfo: ImageInfo,
		mipmapped: boolean,
		label: string,
	) => Surface | null;
	_SkSurfaces_WrapBackendTexture?: (
		context: InternalWebGPUDeviceContext,
		textureHandle: number,
		textureFormatIndex: number,
		textureUsage: number,
		width: number,
		height: number,
		colorType: unknown,
		colorSpace: unknown,
		releaseCallback: ReleaseCallback | null,
		label: string,
	) => Surface | null;
	_SkSurfaces_AsImage?: (surface: Surface) => Image | null;
	_SkSurfaces_AsImageCopy?: (
		surface: Surface,
		hasSubset: boolean,
		subset: SimpleIRect,
		mipmapped: boolean,
	) => Image | null;
	_SkImages_WrapTexture?: (
		context: InternalWebGPUDeviceContext,
		textureHandle: number,
		textureFormatIndex: number,
		textureUsage: number,
		width: number,
		height: number,
		colorType: unknown,
		alphaType: unknown,
		colorSpace: unknown,
		origin: unknown,
		generateMipmapsFromBase: unknown,
		releaseCallback: ReleaseCallback | null,
		label: string,
	) => Image | null;
	_SkImages_PromiseTextureFrom?: (
		context: InternalWebGPUDeviceContext,
		textureFormatIndex: number,
		textureUsage: number,
		width: number,
		height: number,
		colorInfo: ColorInfo,
		origin: unknown,
		isVolatile: boolean,
		callback: PromiseTextureCallback,
		label: string,
	) => Image | null;
	_SkImages_MakeWithFilter?: (
		context: InternalWebGPUDeviceContext,
		src: Image,
		filter: unknown,
		subset: SimpleIRect,
		clipBounds: SimpleIRect,
	) => {
		image: Image;
		outSubset: SimpleIRect;
		offset: { x: number; y: number };
	} | null;
	_defaultWebGPUDeviceContext?: InternalWebGPUDeviceContext;
	_SkSurfaces_WrapBackendTextureSupportsColorType?: boolean;
	JsValStore?: {
		add: (value: unknown) => number;
		get: (handle: number) => unknown;
		remove: (handle: number) => void;
	};
	WebGPU?: {
		TextureFormat?: GPUTextureFormat[];
	};
	Origin?: {
		TopLeft: unknown;
	};
	GenerateMipmapsFromBase?: {
		No: unknown;
	};
	RescaleGamma?: {
		Linear: unknown;
	};
	RescaleMode?: {
		Linear: unknown;
	};
	MakeGPUDeviceContext?: (
		device: GPUDevice,
	) => InternalWebGPUDeviceContext | null;
	MakeGPUCanvasContext?: (
		context: InternalWebGPUDeviceContext,
		canvas: HTMLCanvasElement | OffscreenCanvas,
		opts?: WebGPUCanvasOptionsWithToneMapping,
	) => InternalWebGPUCanvasContext | null;
	MakeGPUCanvasSurface?: (
		canvasContext: InternalWebGPUCanvasContext,
		colorSpace?: unknown,
		width?: number,
		height?: number,
	) => Surface | null;
	SkSurfaces?: InternalSkSurfacesFactory;
	SkImages?: InternalSkImagesFactory;
	Surface?: {
		prototype?: InternalWebGPUSurface & {
			__synvasWebGPUPatched?: boolean;
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

const DEFAULT_WEBGPU_CANVAS_ALPHA_MODE = "premultiplied" as const;
const WEBGPU_TEXTURE_USAGE_FALLBACK = 0x01 | 0x02 | 0x04 | 0x10;
const WEBGPU_TEXTURE_SOURCE_FORMAT = "rgba8unorm";

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

const getJsValStore = (canvasKit: InternalCanvasKitWebGPU) => {
	return canvasKit.JsValStore ?? ensureGlobalJsValStore();
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

const destroyWebGPUTextureWhenQueueIdle = (
	device: GPUDevice,
	texture: GPUTexture,
) => {
	const onSubmittedWorkDone = device.queue?.onSubmittedWorkDone;
	if (typeof onSubmittedWorkDone !== "function") {
		texture.destroy();
		return;
	}
	// 等待已提交命令完成后再销毁外部纹理，避免 validation error。
	void onSubmittedWorkDone
		.call(device.queue)
		.catch(() => undefined)
		.finally(() => {
			texture.destroy();
		});
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
		typeof canvasKit._SkSurfaces_RenderTarget === "function" &&
		typeof canvasKit._SkSurfaces_WrapBackendTexture === "function" &&
		typeof canvasKit._SkImages_WrapTexture === "function" &&
		typeof canvasKit._SkImages_PromiseTextureFrom === "function" &&
		typeof canvasKit._SkImages_MakeWithFilter === "function" &&
		typeof canvasKit.JsValStore?.add === "function"
	);
};

const hasPublicWebGPUHelpers = (canvasKit: InternalCanvasKitWebGPU) => {
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

const normalizeWebGPUCanvasOptions = (
	opts?: WebGPUCanvasOptionsWithToneMapping,
) => {
	return {
		...opts,
		alphaMode: opts?.alphaMode ?? DEFAULT_WEBGPU_CANVAS_ALPHA_MODE,
	};
};

const normalizeNonNegativeNumber = (
	value: number | undefined,
	fallback = 0,
) => {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return fallback;
	}
	return value;
};

const patchWebGPUDeviceContextApi = (context: InternalWebGPUDeviceContext) => {
	const originalSubmit =
		typeof context.submit === "function" ? context.submit.bind(context) : null;
	const internalSubmit =
		typeof context._submit === "function"
			? context._submit.bind(context)
			: null;
	context.submit = (syncToCpu?: boolean) =>
		internalSubmit?.(syncToCpu) ?? originalSubmit?.(syncToCpu) ?? false;

	const originalCheck =
		typeof context.checkAsyncWorkCompletion === "function"
			? context.checkAsyncWorkCompletion.bind(context)
			: null;
	const internalCheck =
		typeof context._checkAsyncWorkCompletion === "function"
			? context._checkAsyncWorkCompletion.bind(context)
			: null;
	context.checkAsyncWorkCompletion = () => {
		if (internalCheck) {
			internalCheck();
			return;
		}
		originalCheck?.();
	};

	const originalFree =
		typeof context.freeGpuResources === "function"
			? context.freeGpuResources.bind(context)
			: null;
	const internalFree =
		typeof context._freeGpuResources === "function"
			? context._freeGpuResources.bind(context)
			: null;
	context.freeGpuResources = () => {
		if (internalFree) {
			internalFree();
			return;
		}
		originalFree?.();
	};

	const originalDeferredCleanup =
		typeof context.performDeferredCleanup === "function"
			? context.performDeferredCleanup.bind(context)
			: null;
	const internalDeferredCleanup =
		typeof context._performDeferredCleanup === "function"
			? context._performDeferredCleanup.bind(context)
			: null;
	context.performDeferredCleanup = (msNotUsed?: number) => {
		const safeMs = normalizeNonNegativeNumber(msNotUsed, 0);
		if (internalDeferredCleanup) {
			internalDeferredCleanup(safeMs);
			return;
		}
		originalDeferredCleanup?.(safeMs);
	};

	const originalCurrentBudgetedBytes =
		typeof context.currentBudgetedBytes === "function"
			? context.currentBudgetedBytes.bind(context)
			: null;
	const internalCurrentBudgetedBytes =
		typeof context._currentBudgetedBytes === "function"
			? context._currentBudgetedBytes.bind(context)
			: null;
	context.currentBudgetedBytes = () =>
		normalizeNonNegativeNumber(
			internalCurrentBudgetedBytes?.() ?? originalCurrentBudgetedBytes?.(),
			0,
		);

	const originalCurrentPurgeableBytes =
		typeof context.currentPurgeableBytes === "function"
			? context.currentPurgeableBytes.bind(context)
			: null;
	const internalCurrentPurgeableBytes =
		typeof context._currentPurgeableBytes === "function"
			? context._currentPurgeableBytes.bind(context)
			: null;
	context.currentPurgeableBytes = () =>
		normalizeNonNegativeNumber(
			internalCurrentPurgeableBytes?.() ?? originalCurrentPurgeableBytes?.(),
			0,
		);

	const originalMaxBudgetedBytes =
		typeof context.maxBudgetedBytes === "function"
			? context.maxBudgetedBytes.bind(context)
			: null;
	const internalMaxBudgetedBytes =
		typeof context._maxBudgetedBytes === "function"
			? context._maxBudgetedBytes.bind(context)
			: null;
	context.maxBudgetedBytes = () =>
		normalizeNonNegativeNumber(
			internalMaxBudgetedBytes?.() ?? originalMaxBudgetedBytes?.(),
			0,
		);

	const originalSetMaxBudgetedBytes =
		typeof context.setMaxBudgetedBytes === "function"
			? context.setMaxBudgetedBytes.bind(context)
			: null;
	const internalSetMaxBudgetedBytes =
		typeof context._setMaxBudgetedBytes === "function"
			? context._setMaxBudgetedBytes.bind(context)
			: null;
	context.setMaxBudgetedBytes = (bytes: number) => {
		const safeBytes = normalizeNonNegativeNumber(bytes, 0);
		if (internalSetMaxBudgetedBytes) {
			internalSetMaxBudgetedBytes(safeBytes);
			return;
		}
		originalSetMaxBudgetedBytes?.(safeBytes);
	};

	context.__graphiteResourceApiAvailable__ = Boolean(
		internalFree ||
			internalDeferredCleanup ||
			internalCurrentBudgetedBytes ||
			internalCurrentPurgeableBytes ||
			internalMaxBudgetedBytes ||
			internalSetMaxBudgetedBytes ||
			(originalFree &&
				originalDeferredCleanup &&
				originalCurrentBudgetedBytes &&
				originalCurrentPurgeableBytes &&
				originalMaxBudgetedBytes &&
				originalSetMaxBudgetedBytes),
	);
};

const getPreferredCanvasFormat = () => {
	if (typeof navigator?.gpu?.getPreferredCanvasFormat === "function") {
		return navigator.gpu.getPreferredCanvasFormat();
	}
	return "bgra8unorm" as GPUTextureFormat;
};

const getTextureFormatIndex = (
	canvasKit: InternalCanvasKitWebGPU,
	textureFormat: GPUTextureFormat,
) => {
	const textureFormats: readonly (string | undefined)[] =
		canvasKit.WebGPU?.TextureFormat ?? DEFAULT_WEBGPU_TEXTURE_FORMATS;
	return textureFormats.indexOf(textureFormat);
};

const resolveWebGPUTextureColorType = (
	canvasKit: InternalCanvasKitWebGPU,
	textureFormat: GPUTextureFormat,
) => {
	const colorTypes = canvasKit.ColorType as CanvasKit["ColorType"] & {
		RGBA_F16?: unknown;
		RGBA_F32?: unknown;
	};
	switch (textureFormat) {
		case "bgra8unorm":
		case "bgra8unorm-srgb":
			return colorTypes.BGRA_8888;
		case "rgba16float":
			return colorTypes.RGBA_F16 ?? colorTypes.RGBA_8888;
		case "rgba32float":
			return colorTypes.RGBA_F32 ?? colorTypes.RGBA_8888;
		case "rgba8unorm":
		case "rgba8unorm-srgb":
		default:
			return colorTypes.RGBA_8888;
	}
};

const wrapBackendTextureSurface = (
	canvasKit: InternalCanvasKitWebGPU,
	context: InternalWebGPUDeviceContext,
	textureHandle: number,
	textureFormatIndex: number,
	textureFormat: GPUTextureFormat,
	textureUsage: number,
	width: number,
	height: number,
	colorSpace: unknown,
	releaseCallback: ReleaseCallback | null,
	label: string,
) => {
	return (
		canvasKit._SkSurfaces_WrapBackendTexture?.(
			context,
			textureHandle,
			textureFormatIndex,
			textureUsage,
			width,
			height,
			resolveWebGPUTextureColorType(canvasKit, textureFormat),
			colorSpace,
			releaseCallback,
			label,
		) ?? null
	);
};

const toSimpleIRect = (
	rect: InputIRect | undefined,
	fallbackWidth = 0,
	fallbackHeight = 0,
): SimpleIRect => {
	if (!rect) {
		return {
			left: 0,
			top: 0,
			right: fallbackWidth,
			bottom: fallbackHeight,
		};
	}
	const rectArrayLike = rect as ArrayLike<number>;
	if (typeof rectArrayLike.length === "number" && rectArrayLike.length >= 4) {
		return {
			left: rectArrayLike[0] ?? 0,
			top: rectArrayLike[1] ?? 0,
			right: rectArrayLike[2] ?? fallbackWidth,
			bottom: rectArrayLike[3] ?? fallbackHeight,
		};
	}
	const rectObject = rect as IRectLike;
	return {
		left: rectObject.left ?? rectObject.fLeft ?? 0,
		top: rectObject.top ?? rectObject.fTop ?? 0,
		right: rectObject.right ?? rectObject.fRight ?? fallbackWidth,
		bottom: rectObject.bottom ?? rectObject.fBottom ?? fallbackHeight,
	};
};

const resolveImageInfoColorSpace = (
	canvasKit: InternalCanvasKitWebGPU,
	info?: ImageInfo | PartialImageInfo,
) => {
	if (info && "colorSpace" in info) {
		return info.colorSpace;
	}
	return canvasKit.ColorSpace.SRGB;
};

const makeReleaseCallback = (
	releaseProc?: ((releaseContext: unknown) => void) | null,
	releaseContext?: unknown,
): ReleaseCallback | null => {
	if (typeof releaseProc !== "function") {
		return null;
	}
	return {
		callRelease() {
			releaseProc(releaseContext);
		},
	};
};

const getTextureSourceWidth = (
	source: TextureSource | VideoFrame,
	info?: ImageInfo | PartialImageInfo,
) => {
	return (
		info?.width ??
		(source as { naturalWidth?: number }).naturalWidth ??
		(source as { videoWidth?: number }).videoWidth ??
		(source as { displayWidth?: number }).displayWidth ??
		(source as { width?: number }).width ??
		0
	);
};

const getTextureSourceHeight = (
	source: TextureSource | VideoFrame,
	info?: ImageInfo | PartialImageInfo,
) => {
	return (
		info?.height ??
		(source as { naturalHeight?: number }).naturalHeight ??
		(source as { videoHeight?: number }).videoHeight ??
		(source as { displayHeight?: number }).displayHeight ??
		(source as { height?: number }).height ??
		0
	);
};

const makePromiseTextureSourceImage = (
	canvasKit: InternalCanvasKitWebGPU,
	deviceContext: InternalWebGPUDeviceContext,
	source: TextureSource | VideoFrame,
	info?: ImageInfo | PartialImageInfo,
	srcIsPremul?: boolean,
) => {
	const device = deviceContext._device;
	if (!device) {
		return null;
	}
	const width = Math.max(1, Math.ceil(getTextureSourceWidth(source, info)));
	const height = Math.max(1, Math.ceil(getTextureSourceHeight(source, info)));
	return canvasKit.SkImages?.PromiseTextureFrom?.(deviceContext, {
		dimensions: {
			width,
			height,
		},
		textureInfo: {
			textureFormat: WEBGPU_TEXTURE_SOURCE_FORMAT,
			usage: getWebGPUTextureUsage(),
		},
		colorInfo: {
			colorType: canvasKit.ColorType.RGBA_8888,
			alphaType: srcIsPremul
				? canvasKit.AlphaType.Premul
				: canvasKit.AlphaType.Unpremul,
			colorSpace: resolveImageInfoColorSpace(canvasKit, info),
		},
		fulfill: () => {
			const texture = device.createTexture({
				size: {
					width,
					height,
				},
				format: WEBGPU_TEXTURE_SOURCE_FORMAT,
				usage: getWebGPUTextureUsage(),
			});
			device.queue.copyExternalImageToTexture(
				{
					source: source as never,
				} as WebGPUExternalImageCopy,
				{ texture },
				{
					width,
					height,
				},
			);
			return {
				texture,
				releaseContext: texture,
			};
		},
		imageRelease: () => {
			if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
				source.close();
			}
		},
		textureRelease: (releaseContext) => {
			const texture = releaseContext as GPUTexture | undefined;
			if (!texture) {
				return;
			}
			destroyWebGPUTextureWhenQueueIdle(device, texture);
		},
	});
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
	if (!surfacePrototype || surfacePrototype.__synvasWebGPUPatched) {
		return;
	}
	if (typeof surfacePrototype.flush !== "function") {
		surfacePrototype.__synvasWebGPUPatched = true;
		return;
	}

	const originalFlush = surfacePrototype.flush as (
		this: InternalWebGPUSurface,
		dirtyRect?: number[],
	) => void;
	surfacePrototype.__synvasWebGPUPatched = true;
	surfacePrototype.assignCurrentSwapChainTexture = () => false;
	surfacePrototype.makeImageFromTextureSource = function (
		this: InternalWebGPUSurface,
		source: TextureSource | VideoFrame,
		info?: ImageInfo | PartialImageInfo,
		srcIsPremul?: boolean,
	) {
		if (!this._deviceContext) {
			return canvasKit.MakeImageFromCanvasImageSource(
				source as CanvasImageSource,
			);
		}
		return (
			makePromiseTextureSourceImage(
				canvasKit,
				this._deviceContext,
				source,
				info,
				srcIsPremul,
			) ?? canvasKit.MakeImageFromCanvasImageSource(source as CanvasImageSource)
		);
	};
	surfacePrototype.updateTextureFromSource = function (
		this: InternalWebGPUSurface,
		image: Image,
		source: TextureSource | VideoFrame,
		srcIsPremul?: boolean,
		info?: ImageInfo | PartialImageInfo,
	) {
		const nextImage = this.makeImageFromTextureSource?.(
			source,
			info,
			srcIsPremul,
		);
		return nextImage ?? image;
	};
	surfacePrototype.flush = function (
		this: InternalWebGPUSurface,
		dirtyRect?: number[],
	) {
		// 必须把真实 surface 实例透传给原始 flush，不能把 prototype 当成 embind Surface。
		originalFlush.call(this, dirtyRect);
		this._deviceContext?.submit?.();
	};
	surfacePrototype.requestAnimationFrame = function (
		this: InternalWebGPUSurface,
		callback: (_: Canvas) => void,
		dirtyRect?: number[],
	) {
		if (!this.reportBackendTypeIsGPU?.()) {
			return this._requestAnimationFrameInternal?.(callback, dirtyRect) ?? 0;
		}
		const rafId = getRequestAnimationFrame()(() => {
			if (this._canvasContext) {
				const surface = canvasKit.MakeGPUCanvasSurface?.(this._canvasContext);
				if (!surface) {
					console.error(
						"Failed to initialize Surface for current canvas swapchain texture",
					);
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
		return Number(rafId);
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
					console.error(
						"Failed to initialize Surface for current canvas swapchain texture",
					);
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
	const jsValStore = getJsValStore(canvasKit);
	const resolveOrigin = () => canvasKit.Origin?.TopLeft;
	const resolveGenerateMipmaps = () => canvasKit.GenerateMipmapsFromBase?.No;
	const resolveRescaleGamma = () => canvasKit.RescaleGamma?.Linear;
	const resolveRescaleMode = () => canvasKit.RescaleMode?.Linear;

	canvasKit.MakeGPUDeviceContext = (device) => {
		if (!device) {
			return null;
		}
		canvasKit.preinitializedWebGPUDevice = device;
		const context = canvasKit._MakeWebGPUDeviceContext?.();
		if (!context) {
			return null;
		}
		context._device = device;
		patchWebGPUDeviceContextApi(context);
		context.ReadSurfacePixelsAsync = (
			surface,
			dstImageInfo,
			srcRect,
			rescaleGamma,
			rescaleMode,
		) => {
			const resolvedRect = toSimpleIRect(
				srcRect,
				dstImageInfo.width,
				dstImageInfo.height,
			);
			return new Promise((resolve) => {
				const ok = context._readSurfacePixelsAsync?.(
					surface,
					dstImageInfo,
					resolvedRect,
					rescaleGamma ?? resolveRescaleGamma(),
					rescaleMode ?? resolveRescaleMode(),
					{ resolve },
				);
				if (!ok) {
					resolve(null);
				}
			});
		};
		context.ReadSurfacePixelsYUV420Async = (
			surface,
			yuvColorSpace,
			dstColorSpace,
			srcRect,
			dstSize,
			rescaleGamma,
			rescaleMode,
		) => {
			const resolvedSize = dstSize ?? {
				width: surface.width(),
				height: surface.height(),
			};
			const resolvedRect = toSimpleIRect(
				srcRect,
				resolvedSize.width,
				resolvedSize.height,
			);
			return new Promise((resolve) => {
				const ok = context._readSurfacePixelsYUV420Async?.(
					surface,
					yuvColorSpace,
					dstColorSpace ?? canvasKit.ColorSpace.SRGB,
					resolvedRect,
					resolvedSize,
					rescaleGamma ?? resolveRescaleGamma(),
					rescaleMode ?? resolveRescaleMode(),
					{ resolve },
				);
				if (!ok) {
					resolve(null);
				}
			});
		};
		canvasKit._defaultWebGPUDeviceContext = context;
		return context;
	};

	canvasKit.SkSurfaces = {
		RenderTarget: (context, imageInfo, mipmapped, _surfaceProps, label) =>
			canvasKit._SkSurfaces_RenderTarget?.(
				context,
				imageInfo,
				Boolean(mipmapped),
				label ?? "",
			) ?? null,
		WrapBackendTexture: (
			context,
			texture,
			colorSpace,
			_surfaceProps,
			releaseProc,
			releaseContext,
			label,
		) => {
			const textureFormatIndex = getTextureFormatIndex(
				canvasKit,
				texture.format,
			);
			if (textureFormatIndex < 0) {
				return null;
			}
			const surface = wrapBackendTextureSurface(
				canvasKit,
				context,
				jsValStore.add(texture),
				textureFormatIndex,
				texture.format,
				texture.usage,
				texture.width,
				texture.height,
				colorSpace ?? null,
				makeReleaseCallback(releaseProc, releaseContext),
				label ?? "",
			) as InternalWebGPUSurface | null;
			if (!surface) {
				return null;
			}
			surface._deviceContext = context;
			return surface;
		},
		AsImage: (surface) => canvasKit._SkSurfaces_AsImage?.(surface) ?? null,
		AsImageCopy: (surface, subset, mipmapped) =>
			canvasKit._SkSurfaces_AsImageCopy?.(
				surface,
				Boolean(subset),
				toSimpleIRect(subset, surface.width(), surface.height()),
				Boolean(mipmapped),
			) ?? null,
	};

	canvasKit.SkImages = {
		WrapTexture: (
			context,
			texture,
			colorType,
			alphaType,
			colorSpace,
			origin,
			generateMipmapsFromBase,
			releaseProc,
			releaseContext,
			label,
		) => {
			const textureFormatIndex = getTextureFormatIndex(
				canvasKit,
				texture.format,
			);
			if (textureFormatIndex < 0) {
				return null;
			}
			return (
				canvasKit._SkImages_WrapTexture?.(
					context,
					jsValStore.add(texture),
					textureFormatIndex,
					texture.usage,
					texture.width,
					texture.height,
					colorType,
					alphaType,
					colorSpace ?? null,
					origin ?? resolveOrigin(),
					generateMipmapsFromBase ?? resolveGenerateMipmaps(),
					makeReleaseCallback(releaseProc, releaseContext),
					label ?? "",
				) ?? null
			);
		},
		PromiseTextureFrom: (context, options) => {
			const releaseContexts = new Map<number, unknown>();
			const textureFormatIndex = getTextureFormatIndex(
				canvasKit,
				options.textureInfo.textureFormat,
			);
			if (textureFormatIndex < 0) {
				return null;
			}
			const callbacks: PromiseTextureCallback = {
				makeTexture() {
					const fulfilled = options.fulfill(options.imageContext);
					if (!fulfilled) {
						return 0;
					}
					const texture =
						"texture" in fulfilled ? fulfilled.texture : fulfilled;
					const releaseContext =
						"texture" in fulfilled ? fulfilled.releaseContext : fulfilled;
					const handle = jsValStore.add(texture);
					releaseContexts.set(handle, releaseContext);
					return handle;
				},
				releaseTexture(textureHandle) {
					const releaseContext = releaseContexts.get(textureHandle);
					releaseContexts.delete(textureHandle);
					jsValStore.remove(textureHandle);
					options.textureRelease?.(releaseContext);
				},
				freeSrc() {
					options.imageRelease?.(options.imageContext);
				},
			};
			return (
				canvasKit._SkImages_PromiseTextureFrom?.(
					context,
					textureFormatIndex,
					options.textureInfo.usage,
					options.dimensions.width,
					options.dimensions.height,
					options.colorInfo,
					options.origin ?? resolveOrigin(),
					Boolean(options.isVolatile),
					callbacks,
					options.label ?? "",
				) ?? null
			);
		},
		MakeWithFilter: (context, src, filter, subset, clipBounds) => {
			const result = canvasKit._SkImages_MakeWithFilter?.(
				context,
				src,
				filter,
				toSimpleIRect(subset, src.width(), src.height()),
				toSimpleIRect(clipBounds, src.width(), src.height()),
			);
			if (!result) {
				return null;
			}
			return {
				image: result.image,
				outSubset: canvasKit.LTRBiRect(
					result.outSubset.left,
					result.outSubset.top,
					result.outSubset.right,
					result.outSubset.bottom,
				),
				offset: Int32Array.of(result.offset.x, result.offset.y),
			};
		},
	};

	canvasKit.MakeGPUCanvasContext = (context, canvas, opts) => {
		const canvasContext = canvas.getContext(
			"webgpu",
		) as GPUCanvasContextWithConfiguration | null;
		if (!canvasContext || !context._device) {
			return null;
		}
		const resolvedOptions = normalizeWebGPUCanvasOptions(opts);
		const textureFormat = resolvedOptions.format ?? getPreferredCanvasFormat();
		const configuration = {
			device: context._device,
			format: textureFormat,
			alphaMode: resolvedOptions.alphaMode,
			...(resolvedOptions.colorSpace
				? { colorSpace: resolvedOptions.colorSpace }
				: {}),
			...(resolvedOptions.toneMapping
				? { toneMapping: resolvedOptions.toneMapping }
				: {}),
		} as GPUCanvasConfigurationWithToneMapping;
		try {
			canvasContext.configure(configuration);
		} catch {
			return null;
		}
		if (
			resolvedOptions.toneMapping?.mode === "extended" &&
			typeof canvasContext.getConfiguration === "function"
		) {
			const configuredToneMapping =
				canvasContext.getConfiguration().toneMapping?.mode;
			if (configuredToneMapping && configuredToneMapping !== "extended") {
				return null;
			}
		}
		const webgpuCanvasContext = {
			_inner: canvasContext,
			_deviceContext: context,
			_textureFormat: textureFormat,
			requestAnimationFrame(callback: (_: Canvas) => void) {
				getRequestAnimationFrame()(() => {
					const surface = canvasKit.MakeGPUCanvasSurface?.(webgpuCanvasContext);
					if (!surface) {
						console.error(
							"Failed to initialize Surface for current canvas swapchain texture",
						);
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

	canvasKit.MakeGPUCanvasSurface = (
		canvasContext,
		colorSpace,
		width,
		height,
	) => {
		const currentTexture = canvasContext._inner.getCurrentTexture();
		const textureFormatIndex = getTextureFormatIndex(
			canvasKit,
			canvasContext._textureFormat,
		);
		if (textureFormatIndex < 0) {
			return null;
		}
		const surface = wrapBackendTextureSurface(
			canvasKit,
			canvasContext._deviceContext,
			jsValStore.add(currentTexture),
			textureFormatIndex,
			canvasContext._textureFormat,
			currentTexture.usage,
			width ?? canvasContext._inner.canvas.width,
			height ?? canvasContext._inner.canvas.height,
			colorSpace ?? null,
			null,
			"",
		) as InternalWebGPUSurface | null;
		if (!surface) {
			return null;
		}
		surface._deviceContext = canvasContext._deviceContext;
		surface._canvasContext = canvasContext;
		return surface;
	};
};

export const installCanvasKitWebGPU = (canvasKit: CanvasKit) => {
	const internalCanvasKit = canvasKit as InternalCanvasKitWebGPU;
	if (!looksLikeActualCanvasKitBundle(internalCanvasKit)) {
		return;
	}

	if (!internalCanvasKit.JsValStore) {
		(internalCanvasKit as MutableCanvasKitWebGPU).JsValStore =
			ensureGlobalJsValStore();
	}

	patchSurfacePrototype(internalCanvasKit);

	if (hasLowLevelWebGPUExports(internalCanvasKit)) {
		installPublicWebGPUHelpers(internalCanvasKit);
		return;
	}
	if (!hasPublicWebGPUHelpers(internalCanvasKit)) {
		return;
	}

	const originalMakeGPUDeviceContext =
		internalCanvasKit.MakeGPUDeviceContext?.bind(internalCanvasKit);
	const originalMakeGPUCanvasContext =
		internalCanvasKit.MakeGPUCanvasContext?.bind(internalCanvasKit);
	if (originalMakeGPUDeviceContext) {
		internalCanvasKit.MakeGPUDeviceContext = (device) => {
			const context = originalMakeGPUDeviceContext(device);
			if (context) {
				patchWebGPUDeviceContextApi(context as InternalWebGPUDeviceContext);
				internalCanvasKit._defaultWebGPUDeviceContext = context;
			}
			return context;
		};
	}
	if (originalMakeGPUCanvasContext) {
		internalCanvasKit.MakeGPUCanvasContext = (context, canvas, opts) => {
			try {
				return originalMakeGPUCanvasContext(
					context,
					canvas,
					normalizeWebGPUCanvasOptions(opts),
				);
			} catch {
				return null;
			}
		};
	}
};
