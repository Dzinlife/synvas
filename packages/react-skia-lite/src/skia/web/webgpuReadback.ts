import type { CanvasKit as CanvasKitType } from "canvaskit-wasm";

import { JsiSkSurface } from "./JsiSkSurface";
import type { SkiaRenderBackend } from "./renderBackend";
import {
	getPreferredWebGPUTextureFormat,
	getSkiaRenderBackend,
} from "./renderBackend";

const WEBGPU_TEXTURE_USAGE_FALLBACK = 0x01 | 0x02 | 0x04 | 0x10;
const WEBGPU_BUFFER_USAGE_FALLBACK = 0x0001 | 0x0008;
const WEBGPU_MAP_MODE_READ_FALLBACK = 0x0001;
const WEBGPU_READBACK_ALIGNMENT = 256;
const WEBGPU_BYTES_PER_PIXEL = 4;
const DEFAULT_WEBGPU_READBACK_RING_SIZE = 2;

type WebGPUBackend = Extract<SkiaRenderBackend, { kind: "webgpu" }>;

type WebGPUReadbackSlot = {
	buffer: GPUBuffer;
	pending: Promise<SkiaWebGPUReadbackResult> | null;
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
	ringSize?: number;
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

const getWebGPUBufferUsage = () => {
	if (typeof GPUBufferUsage === "undefined") {
		return WEBGPU_BUFFER_USAGE_FALLBACK;
	}
	return GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
};

const getWebGPUMapModeRead = () => {
	if (typeof GPUMapMode === "undefined") {
		return WEBGPU_MAP_MODE_READ_FALLBACK;
	}
	return GPUMapMode.READ;
};

const alignTo = (value: number, alignment: number) => {
	return Math.ceil(value / alignment) * alignment;
};

const resolveReadbackFormat = (
	textureFormat: GPUTextureFormat,
): SkiaWebGPUReadbackFormat => {
	return `${textureFormat}`.startsWith("bgra") ? "BGRA" : "RGBA";
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
	// 等待已提交命令完成后再销毁纹理，避免 WebGPU validation error。
	void onSubmittedWorkDone
		.call(device.queue)
		.catch(() => undefined)
		.finally(() => {
			texture.destroy();
		});
};

class WebGPUReadbackSession {
	private readonly bytesPerRow: number;
	private readonly readbackSize: number;
	private readonly format: SkiaWebGPUReadbackFormat;
	private readonly slots: WebGPUReadbackSlot[] = [];
	private nextSlotIndex = 0;
	private disposed = false;

	constructor(
		private readonly device: GPUDevice,
		private readonly texture: GPUTexture,
		private readonly width: number,
		private readonly height: number,
		private readonly ringSize: number,
		textureFormat: GPUTextureFormat,
	) {
		this.bytesPerRow = alignTo(
			width * WEBGPU_BYTES_PER_PIXEL,
			WEBGPU_READBACK_ALIGNMENT,
		);
		this.readbackSize = this.bytesPerRow * height;
		this.format = resolveReadbackFormat(textureFormat);
	}

	private createSlot(): WebGPUReadbackSlot {
		return {
			buffer: this.device.createBuffer({
				size: this.readbackSize,
				usage: getWebGPUBufferUsage(),
			}),
			pending: null,
		};
	}

	private getNextSlot(): WebGPUReadbackSlot {
		if (this.slots.length < this.ringSize) {
			const slot = this.createSlot();
			this.slots.push(slot);
			return slot;
		}
		const slot = this.slots[this.nextSlotIndex];
		this.nextSlotIndex = (this.nextSlotIndex + 1) % this.slots.length;
		return slot;
	}

	private async copyTextureToPixels(
		buffer: GPUBuffer,
	): Promise<SkiaWebGPUReadbackResult> {
		const encoder = this.device.createCommandEncoder();
		encoder.copyTextureToBuffer(
			{
				texture: this.texture,
			},
			{
				buffer,
				bytesPerRow: this.bytesPerRow,
				rowsPerImage: this.height,
			},
			{
				width: this.width,
				height: this.height,
				depthOrArrayLayers: 1,
			},
		);
		this.device.queue.submit([encoder.finish()]);
		await buffer.mapAsync(getWebGPUMapModeRead(), 0, this.readbackSize);
		try {
			const mappedRange = buffer.getMappedRange(0, this.readbackSize);
			return {
				pixels: new Uint8Array(mappedRange.slice(0)),
				width: this.width,
				height: this.height,
				bytesPerRow: this.bytesPerRow,
				format: this.format,
			};
		} finally {
			buffer.unmap();
		}
	}

	async readbackPixels(): Promise<SkiaWebGPUReadbackResult> {
		if (this.disposed) {
			throw new Error("WebGPU readback surface 已释放");
		}
		const slot = this.getNextSlot();
		await slot.pending;
		const pending = this.copyTextureToPixels(slot.buffer).finally(() => {
			slot.pending = null;
		});
		slot.pending = pending;
		return pending;
	}

	async flushPendingReadbacks() {
		await Promise.all(
			this.slots
				.map((slot) => slot.pending)
				.filter((pending): pending is Promise<SkiaWebGPUReadbackResult> =>
					Boolean(pending),
				),
		);
	}

	dispose() {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		for (const slot of this.slots) {
			try {
				slot.buffer.destroy?.();
			} catch {}
			slot.pending = null;
		}
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
			backend.device,
			texture,
			targetWidth,
			targetHeight,
			Math.max(1, options.ringSize ?? DEFAULT_WEBGPU_READBACK_RING_SIZE),
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
