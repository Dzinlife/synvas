import type {
	AsyncReadResult,
	CanvasKit as CanvasKitType,
	Surface as CanvasKitSurface,
	WebGPUDeviceContext,
} from "canvaskit-wasm";

import { JsiSkSurface } from "./JsiSkSurface";
import type { SkiaRenderBackend } from "./renderBackend";
import {
	getPreferredWebGPUTextureFormat,
	getSkiaRenderBackend,
} from "./renderBackend";

const WEBGPU_TEXTURE_USAGE_FALLBACK = 0x01 | 0x02 | 0x04 | 0x10;
const WEBGPU_ASYNC_READ_TIMEOUT_MS = 5_000;

type WebGPUBackend = Extract<SkiaRenderBackend, { kind: "webgpu" }>;
type CanvasKitWithRescale = CanvasKitType & {
	RescaleGamma?: {
		Linear?: unknown;
	};
	RescaleMode?: {
		Linear?: unknown;
	};
};
type WebGPUDeviceContextWithAsyncRead = WebGPUDeviceContext & {
	ReadSurfacePixelsAsync?: (
		surface: CanvasKitSurface,
		dstImageInfo: {
			width: number;
			height: number;
			colorType: unknown;
			alphaType: unknown;
			colorSpace?: unknown;
		},
		srcRect?: [number, number, number, number],
		rescaleGamma?: unknown,
		rescaleMode?: unknown,
	) => Promise<AsyncReadResult | null>;
	checkAsyncWorkCompletion?: () => void;
};

export type SkiaWebGPUReadbackFormat = "BGRA" | "RGBA";

export type SkiaWebGPUReadbackResult = {
	pixels: Uint8Array;
	width: number;
	height: number;
	bytesPerRow: number;
	format: SkiaWebGPUReadbackFormat;
};

export type SkiaWebGPUReadbackSurface = {
	surface: JsiSkSurface;
	readbackPixels: () => Promise<SkiaWebGPUReadbackResult>;
	flushPendingReadbacks: () => Promise<void>;
	dispose: () => void;
};

export type CreateSkiaWebGPUReadbackSurfaceOptions = {
	CanvasKit?: CanvasKitType;
	backend?: WebGPUBackend;
	label?: string;
	textureFormat?: GPUTextureFormat;
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

const resolveReadbackFormat = (
	textureFormat: GPUTextureFormat,
): SkiaWebGPUReadbackFormat => {
	return `${textureFormat}`.startsWith("bgra") ? "BGRA" : "RGBA";
};

const waitForAsyncReadTick = () =>
	new Promise<void>((resolve) => {
		const requestAnimationFrameRef = globalThis.requestAnimationFrame;
		if (typeof requestAnimationFrameRef === "function") {
			requestAnimationFrameRef(() => resolve());
			return;
		}
		globalThis.setTimeout(resolve, 0);
	});

const destroyWebGPUTextureWhenQueueIdle = (
	device: GPUDevice,
	texture: GPUTexture,
) => {
	const onSubmittedWorkDone = device.queue?.onSubmittedWorkDone;
	if (typeof onSubmittedWorkDone !== "function") {
		texture.destroy();
		return;
	}
	// 等待已提交命令完成后再销毁纹理，避免 WebGPU validation error。
	void onSubmittedWorkDone
		.call(device.queue)
		.catch(() => undefined)
		.finally(() => {
			texture.destroy();
		});
};

const resolveCanvasKitReadbackConfig = (
	canvasKit: CanvasKitType,
	readbackFormat: SkiaWebGPUReadbackFormat,
) => {
	const colorType = canvasKit.ColorType as
		| {
				BGRA_8888?: unknown;
				RGBA_8888?: unknown;
		  }
		| undefined;
	if (readbackFormat === "BGRA" && colorType?.BGRA_8888 !== undefined) {
		return {
			colorType: colorType.BGRA_8888,
			format: "BGRA" as const,
		};
	}
	return {
		colorType: colorType?.RGBA_8888 ?? canvasKit.ColorType.RGBA_8888,
		format: "RGBA" as const,
	};
};

class WebGPUReadbackSession {
	private readonly format: SkiaWebGPUReadbackFormat;
	private readonly readbackInfo: {
		width: number;
		height: number;
		colorType: unknown;
		alphaType: unknown;
		colorSpace?: unknown;
	};
	private readonly readbackRect: [number, number, number, number];
	private readonly readbackRescaleGamma: unknown;
	private readonly readbackRescaleMode: unknown;
	private readonly pendingReads = new Set<Promise<SkiaWebGPUReadbackResult>>();
	private disposed = false;

	constructor(
		private readonly canvasKit: CanvasKitType,
		private readonly deviceContext: WebGPUDeviceContextWithAsyncRead,
		private readonly surfaceRef: CanvasKitSurface,
		private readonly width: number,
		private readonly height: number,
		textureFormat: GPUTextureFormat,
	) {
		const readbackConfig = resolveCanvasKitReadbackConfig(
			canvasKit,
			resolveReadbackFormat(textureFormat),
		);
		this.format = readbackConfig.format;
		this.readbackInfo = {
			width,
			height,
			colorType: readbackConfig.colorType,
			alphaType: canvasKit.AlphaType.Premul,
			colorSpace: canvasKit.ColorSpace?.SRGB,
		};
		this.readbackRect = [0, 0, width, height];
		const canvasKitWithRescale = canvasKit as CanvasKitWithRescale;
		this.readbackRescaleGamma = canvasKitWithRescale.RescaleGamma?.Linear;
		this.readbackRescaleMode = canvasKitWithRescale.RescaleMode?.Linear;
	}

	private async waitForCanvasKitAsyncReadResult(
		pendingRead: Promise<AsyncReadResult | null>,
	): Promise<AsyncReadResult | null> {
		let settled = false;
		let readResult: AsyncReadResult | null = null;
		let readError: unknown = null;
		void pendingRead.then(
			(result) => {
				settled = true;
				readResult = result;
			},
			(error) => {
				settled = true;
				readError = error;
			},
		);

		const startAt = Date.now();
		while (!settled) {
			this.deviceContext.checkAsyncWorkCompletion?.();
			if (Date.now() - startAt > WEBGPU_ASYNC_READ_TIMEOUT_MS) {
				throw new Error("CanvasKit 异步读回超时");
			}
			await waitForAsyncReadTick();
		}

		if (readError) {
			throw readError;
		}
		return readResult;
	}

	private async readWithCanvasKitAsyncApi(): Promise<SkiaWebGPUReadbackResult> {
		const readAsync = this.deviceContext.ReadSurfacePixelsAsync;
		if (typeof readAsync !== "function") {
			throw new Error("CanvasKit 异步读回 API 不可用");
		}
		const result = await this.waitForCanvasKitAsyncReadResult(
			readAsync(
				this.surfaceRef,
				this.readbackInfo,
				this.readbackRect,
				this.readbackRescaleGamma,
				this.readbackRescaleMode,
			),
		);
		if (!result || result.count < 1 || result.planes.length < 1) {
			throw new Error("CanvasKit 异步读回结果为空");
		}
		const plane0 = result.planes[0];
		if (!plane0) {
			throw new Error("CanvasKit 异步读回缺失主平面");
		}
		const bytesPerRow = result.rowBytes[0] ?? this.width * 4;
		return {
			pixels: new Uint8Array(plane0),
			width: result.width || this.width,
			height: result.height || this.height,
			bytesPerRow,
			format: this.format,
		};
	}

	readbackPixels(): Promise<SkiaWebGPUReadbackResult> {
		if (this.disposed) {
			throw new Error("WebGPU readback surface 已释放");
		}
		const pending = this.readWithCanvasKitAsyncApi().finally(() => {
			this.pendingReads.delete(pending);
		});
		this.pendingReads.add(pending);
		return pending;
	}

	async flushPendingReadbacks() {
		await Promise.all(Array.from(this.pendingReads));
	}

	dispose() {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.pendingReads.clear();
	}
}

const resolveWebGPUBackend = (
	backend?: SkiaRenderBackend,
): WebGPUBackend | null => {
	const activeBackend = backend ?? getSkiaRenderBackend();
	return activeBackend.kind === "webgpu" ? activeBackend : null;
};

const resolveCanvasKit = (
	canvasKit?: CanvasKitType,
): CanvasKitType | null => {
	if (canvasKit) {
		return canvasKit;
	}
	return ((globalThis as typeof globalThis & { CanvasKit?: CanvasKitType })
		.CanvasKit ?? null);
};

export const createSkiaWebGPUReadbackSurface = (
	width: number,
	height: number,
	options: CreateSkiaWebGPUReadbackSurfaceOptions = {},
): SkiaWebGPUReadbackSurface | null => {
	const backend = resolveWebGPUBackend(options.backend);
	if (!backend) {
		return null;
	}
	const canvasKit = resolveCanvasKit(options.CanvasKit);
	if (!canvasKit) {
		throw new Error("CanvasKit 未初始化");
	}
	const targetWidth = Math.max(1, Math.ceil(width));
	const targetHeight = Math.max(1, Math.ceil(height));
	const textureFormat =
		options.textureFormat ?? getPreferredWebGPUTextureFormat();
	const texture = backend.device.createTexture({
		size: {
			width: targetWidth,
			height: targetHeight,
		},
		format: textureFormat,
		usage: getWebGPUTextureUsage(),
	});
	try {
		const surfaceRef = canvasKit.SkSurfaces?.WrapBackendTexture?.(
			backend.deviceContext,
			texture,
			canvasKit.ColorSpace?.SRGB,
			undefined,
			undefined,
			undefined,
			options.label ?? "",
		);
		if (!surfaceRef) {
			throw new Error("无法创建 WebGPU readback Surface");
		}
		const session = new WebGPUReadbackSession(
			canvasKit,
			backend.deviceContext as WebGPUDeviceContextWithAsyncRead,
			surfaceRef,
			targetWidth,
			targetHeight,
			textureFormat,
		);
		const surface = new JsiSkSurface(canvasKit, surfaceRef, () => {
			destroyWebGPUTextureWhenQueueIdle(backend.device, texture);
		});
		return {
			surface,
			readbackPixels: () => session.readbackPixels(),
			flushPendingReadbacks: () => session.flushPendingReadbacks(),
			dispose: () => {
				session.dispose();
				surface.dispose();
			},
		};
	} catch (error) {
		destroyWebGPUTextureWhenQueueIdle(backend.device, texture);
		console.warn("Failed to create WebGPU readback surface", error);
		return null;
	}
};
