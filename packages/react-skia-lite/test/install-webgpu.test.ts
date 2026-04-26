// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { installCanvasKitWebGPU } from "../src/skia/web/installWebGPU";

const createLowLevelCanvasKitStub = () => {
	const originalMakeGPUCanvasContext = vi.fn(() => ({ id: "original-context" }));
	const deviceContext = {
		_submit: vi.fn(() => true),
		_checkAsyncWorkCompletion: vi.fn(),
		_freeGpuResources: vi.fn(),
		_performDeferredCleanup: vi.fn(),
		_currentBudgetedBytes: vi.fn(() => 0),
		_currentPurgeableBytes: vi.fn(() => 0),
		_maxBudgetedBytes: vi.fn(() => 0),
		_setMaxBudgetedBytes: vi.fn(),
	};
	return {
		canvasKit: {
			webgpu: true,
			WebGPU: {
				TextureFormat: ["rgba16float", "rgba8unorm", "bgra8unorm"],
			},
			ColorSpace: { SRGB: "srgb" },
			ColorType: { RGBA_8888: "rgba8888" },
			AlphaType: { Premul: "premul" },
			Origin: { TopLeft: "top-left" },
			GenerateMipmapsFromBase: { No: "no-mips" },
			RescaleGamma: { Linear: "linear-gamma" },
			RescaleMode: { Linear: "linear-mode" },
			Surface: {
				prototype: {
					flush(
						this: { _flush?: (dirtyRect?: number[]) => void },
						dirtyRect?: number[],
					) {
						this._flush?.(dirtyRect);
					},
				},
			},
			MakeGPUCanvasContext: originalMakeGPUCanvasContext,
			_MakeWebGPUDeviceContext: vi.fn(() => deviceContext),
			_SkSurfaces_RenderTarget: vi.fn(),
			_SkSurfaces_WrapBackendTexture: vi.fn(),
			_SkImages_WrapTexture: vi.fn(),
			_SkImages_PromiseTextureFrom: vi.fn(),
			_SkImages_MakeWithFilter: vi.fn(),
		},
		originalMakeGPUCanvasContext,
	};
};

describe("installCanvasKitWebGPU", () => {
	afterEach(() => {
		delete (globalThis as typeof globalThis & { JsValStore?: unknown }).JsValStore;
		vi.unstubAllGlobals();
	});

	it("真实 WebGPU bundle 使用增强 canvas helper 传递 HDR configure 选项", () => {
		const { canvasKit, originalMakeGPUCanvasContext } =
			createLowLevelCanvasKitStub();
		const device = { queue: {} };
		const configure = vi.fn();
		const gpuCanvasContext = {
			canvas: { width: 640, height: 360 },
			configure,
			getConfiguration: vi.fn(() => ({
				toneMapping: { mode: "extended" },
			})),
			getCurrentTexture: vi.fn(() => ({
				format: "rgba16float",
				usage: 1,
				width: 640,
				height: 360,
			})),
		};
		const canvas = {
			getContext: vi.fn((contextId: string) =>
				contextId === "webgpu" ? gpuCanvasContext : null,
			),
		};

		installCanvasKitWebGPU(canvasKit as never);
		const deviceContext = canvasKit.MakeGPUDeviceContext?.(device as never);
		const canvasContext = canvasKit.MakeGPUCanvasContext?.(
			deviceContext as never,
			canvas as never,
			{
				format: "rgba16float",
				alphaMode: "opaque",
				colorSpace: "display-p3",
				toneMapping: { mode: "extended" },
			},
		);

		expect(originalMakeGPUCanvasContext).not.toHaveBeenCalled();
		expect(configure).toHaveBeenCalledWith({
			device,
			format: "rgba16float",
			alphaMode: "opaque",
			colorSpace: "display-p3",
			toneMapping: { mode: "extended" },
		});
		expect(canvasContext).toMatchObject({
			_textureFormat: "rgba16float",
			_deviceContext: deviceContext,
			_inner: gpuCanvasContext,
		});
	});
});
