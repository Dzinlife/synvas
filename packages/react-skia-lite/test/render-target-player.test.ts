import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/skia/web/renderBackend", () => ({
	getSkiaRenderBackend: vi.fn(),
}));

import { NodeType } from "../src/dom/types";
import { CommandType } from "../src/sksg/Recorder/Core";
import { createDrawingContext } from "../src/sksg/Recorder/DrawingContext";
import {
	clearRenderTargetSurfacePoolForTest,
	replay,
	setRenderTargetReplayMetricsListener,
} from "../src/sksg/Recorder/Player";
import { getSkiaRenderBackend } from "../src/skia/web/renderBackend";

const createMatrix = () => ({
	get: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
	dispose: vi.fn(),
});

const createPaint = () => {
	let alpha = 1;
	return {
		assign: vi.fn(),
		copy: vi.fn(() => createPaint()),
		setShader: vi.fn(),
		setColorFilter: vi.fn(),
		setImageFilter: vi.fn(),
		setMaskFilter: vi.fn(),
		setPathEffect: vi.fn(),
		setBlendMode: vi.fn(),
		setStyle: vi.fn(),
		setStrokeWidth: vi.fn(),
		setStrokeMiter: vi.fn(),
		setStrokeCap: vi.fn(),
		setStrokeJoin: vi.fn(),
		setAlphaf: vi.fn((value: number) => {
			alpha = value;
		}),
		getAlphaf: vi.fn(() => alpha),
		setDither: vi.fn(),
		setAntiAlias: vi.fn(),
		dispose: vi.fn(),
	};
};

const createCanvas = () => ({
	clear: vi.fn(),
	drawImage: vi.fn(),
	drawPaint: vi.fn(),
	saveLayer: vi.fn(),
	restore: vi.fn(),
	getTotalMatrix: vi.fn(() => createMatrix()),
});

const createSnapshotImage = (label: string) => ({
	label,
	makeNonTextureImage: vi.fn(() => ({
		label: `${label}:raster`,
		dispose: vi.fn(),
	})),
	dispose: vi.fn(),
});

const createSurface = (
	canvas: ReturnType<typeof createCanvas>,
	label: string,
	options?: {
		asImageCopy?: boolean;
		asImage?: boolean;
	},
) => ({
	getCanvas: vi.fn(() => canvas),
	makeImageSnapshot: vi.fn(() => createSnapshotImage(label)),
	asImageCopy: vi.fn(() => {
		if (!options?.asImageCopy) return null;
		return createSnapshotImage(`${label}:asImageCopy`);
	}),
	asImage: vi.fn(() => {
		if (!options?.asImage) return null;
		return createSnapshotImage(`${label}:asImage`);
	}),
	flush: vi.fn(),
	dispose: vi.fn(),
});

describe("RenderTarget player", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearRenderTargetSurfacePoolForTest();
		setRenderTargetReplayMetricsListener(null);
	});

	it("WebGPU 下在 RenderTarget 内执行 BackdropFilter 时不会走 saveLayer", () => {
		vi.mocked(getSkiaRenderBackend).mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});

		const rootCanvas = createCanvas();
		const targetCanvas = createCanvas();
		const scratchCanvas = createCanvas();
		const targetSurface = createSurface(targetCanvas, "target");
		const scratchSurface = createSurface(scratchCanvas, "scratch");
		const makeOffscreenMock = vi
			.fn()
			.mockReturnValueOnce(targetSurface)
			.mockReturnValueOnce(scratchSurface);
		const imageFilter = { id: "filter" };
		const skia = {
			Paint: vi.fn(() => createPaint()),
			Color: vi.fn((color: string) => color),
			Surface: {
				MakeOffscreen: makeOffscreenMock,
			},
			ImageFilter: {
				MakeColorFilter: vi.fn(),
			},
		} as never;
		const commands = [
			{
				type: CommandType.RenderTarget,
				props: { width: 64, height: 32, debugLabel: "scene-preview" },
				children: [
					{
						type: CommandType.SavePaint,
						props: { opacity: 0.25 },
						standalone: false,
					},
					{
						type: CommandType.PushImageFilter,
						imageFilterType: NodeType.ImageFilter,
						props: { filter: imageFilter },
					},
					{ type: CommandType.SaveBackdropFilter },
					{ type: CommandType.RestoreBackdropFilter },
					{ type: CommandType.RestorePaint },
				],
			},
		];

		replay(createDrawingContext(skia, [], rootCanvas as never), commands as never);

		expect(makeOffscreenMock).toHaveBeenCalledTimes(2);
		expect(targetCanvas.saveLayer).not.toHaveBeenCalled();
		expect(targetCanvas.clear).toHaveBeenCalledTimes(1);
		expect(scratchCanvas.drawImage).toHaveBeenCalledTimes(1);
		expect(rootCanvas.drawImage).toHaveBeenCalledTimes(1);
		const finalPaint = targetCanvas.drawImage.mock.calls[0]?.[3] as
			| { getAlphaf?: () => number }
			| undefined;
		expect(finalPaint?.getAlphaf?.()).toBe(0.25);
	});

	it("WebGPU 下 RenderTarget 分配失败会直接抛错", () => {
		vi.mocked(getSkiaRenderBackend).mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});

		const rootCanvas = createCanvas();
		const skia = {
			Paint: vi.fn(() => createPaint()),
			Color: vi.fn((color: string) => color),
			Surface: {
				MakeOffscreen: vi.fn(() => null),
			},
			ImageFilter: {
				MakeColorFilter: vi.fn(),
			},
		} as never;
		const commands = [
			{
				type: CommandType.RenderTarget,
				props: { width: 64, height: 32, debugLabel: "scene-preview" },
				children: [
					{ type: CommandType.SaveBackdropFilter },
					{ type: CommandType.RestoreBackdropFilter },
				],
			},
		];

		expect(() => {
			replay(createDrawingContext(skia, [], rootCanvas as never), commands as never);
		}).toThrow("failed to allocate offscreen surface on webgpu");
	});

	it("WebGPU 下无 BackdropFilter 时分配失败会回退到 direct replay", () => {
		vi.mocked(getSkiaRenderBackend).mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});

		const rootCanvas = createCanvas();
		const skia = {
			Paint: vi.fn(() => createPaint()),
			Color: vi.fn((color: string) => color),
			Surface: {
				MakeOffscreen: vi.fn(() => null),
			},
			ImageFilter: {
				MakeColorFilter: vi.fn(),
			},
		} as never;
		const commands = [
			{
				type: CommandType.RenderTarget,
				props: { width: 64, height: 32, debugLabel: "scene-preview" },
				children: [{ type: CommandType.DrawPaint }],
			},
		];

		replay(createDrawingContext(skia, [], rootCanvas as never), commands as never);
		expect(rootCanvas.drawPaint).toHaveBeenCalledTimes(1);
	});

	it("WebGL 下在 RenderTarget 内执行 BackdropFilter 时继续复用 saveLayer", () => {
		vi.mocked(getSkiaRenderBackend).mockReturnValue({
			bundle: "webgl",
			kind: "webgl",
		});

		const rootCanvas = createCanvas();
		const targetCanvas = createCanvas();
		const targetSurface = createSurface(targetCanvas, "target");
		const makeOffscreenMock = vi.fn().mockReturnValue(targetSurface);
		const imageFilter = { id: "filter" };
		const skia = {
			Paint: vi.fn(() => createPaint()),
			Color: vi.fn((color: string) => color),
			Surface: {
				MakeOffscreen: makeOffscreenMock,
			},
			ImageFilter: {
				MakeColorFilter: vi.fn(),
			},
		} as never;
		const commands = [
			{
				type: CommandType.RenderTarget,
				props: { width: 64, height: 32 },
				children: [
					{
						type: CommandType.SavePaint,
						props: {},
						standalone: false,
					},
					{
						type: CommandType.PushImageFilter,
						imageFilterType: NodeType.ImageFilter,
						props: { filter: imageFilter },
					},
					{ type: CommandType.SaveBackdropFilter },
					{ type: CommandType.RestoreBackdropFilter },
					{ type: CommandType.RestorePaint },
				],
			},
		];

		replay(createDrawingContext(skia, [], rootCanvas as never), commands as never);

		expect(makeOffscreenMock).toHaveBeenCalledTimes(1);
		expect(targetCanvas.saveLayer).toHaveBeenCalledTimes(1);
		expect(rootCanvas.drawImage).toHaveBeenCalledTimes(1);
	});

	it("RenderTarget surface 在回放之间会复用", () => {
		vi.mocked(getSkiaRenderBackend).mockReturnValue({
			bundle: "webgl",
			kind: "webgl",
		});

		const rootCanvas = createCanvas();
		const targetCanvas = createCanvas();
		const targetSurface = createSurface(targetCanvas, "pooled");
		const makeOffscreenMock = vi.fn(() => targetSurface);
		const skia = {
			Paint: vi.fn(() => createPaint()),
			Color: vi.fn((color: string) => color),
			Surface: {
				MakeOffscreen: makeOffscreenMock,
			},
			ImageFilter: {
				MakeColorFilter: vi.fn(),
			},
		} as never;
		const commands = [
			{
				type: CommandType.RenderTarget,
				props: { width: 64, height: 32 },
				children: [{ type: CommandType.DrawPaint }],
			},
		];

		replay(createDrawingContext(skia, [], rootCanvas as never), commands as never);
		replay(createDrawingContext(skia, [], rootCanvas as never), commands as never);

		expect(makeOffscreenMock).toHaveBeenCalledTimes(1);
		expect(rootCanvas.drawImage).toHaveBeenCalledTimes(2);
	});

	it("asImageCopy 快照下 retainResources 也可立即复用 surface", () => {
		vi.mocked(getSkiaRenderBackend).mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});

		const rootCanvas = createCanvas();
		const targetCanvas = createCanvas();
		const targetSurface = createSurface(targetCanvas, "copy", {
			asImageCopy: true,
		});
		const makeOffscreenMock = vi.fn(() => targetSurface);
		const skia = {
			Paint: vi.fn(() => createPaint()),
			Color: vi.fn((color: string) => color),
			Surface: {
				MakeOffscreen: makeOffscreenMock,
			},
			ImageFilter: {
				MakeColorFilter: vi.fn(),
			},
		} as never;
		const commands = [
			{
				type: CommandType.RenderTarget,
				props: { width: 64, height: 32 },
				children: [{ type: CommandType.DrawPaint }],
			},
		];

		replay(
			createDrawingContext(skia, [], rootCanvas as never, {
				retainResources: true,
			}),
			commands as never,
		);
		replay(
			createDrawingContext(skia, [], rootCanvas as never, {
				retainResources: true,
			}),
			commands as never,
		);

		expect(makeOffscreenMock).toHaveBeenCalledTimes(1);
		expect(targetSurface.asImageCopy).toHaveBeenCalledTimes(2);
	});

	it("支持上报 RenderTarget replay 指标", () => {
		vi.mocked(getSkiaRenderBackend).mockReturnValue({
			bundle: "webgl",
			kind: "webgl",
		});

		const listener = vi.fn();
		setRenderTargetReplayMetricsListener(listener);

		const rootCanvas = createCanvas();
		const targetCanvas = createCanvas();
		const targetSurface = createSurface(targetCanvas, "metrics");
		const skia = {
			Paint: vi.fn(() => createPaint()),
			Color: vi.fn((color: string) => color),
			Surface: {
				MakeOffscreen: vi.fn(() => targetSurface),
			},
			ImageFilter: {
				MakeColorFilter: vi.fn(),
			},
		} as never;
		const commands = [
			{
				type: CommandType.RenderTarget,
				props: { width: 64, height: 32 },
				children: [{ type: CommandType.DrawPaint }],
			},
		];

		replay(createDrawingContext(skia, [], rootCanvas as never), commands as never);

		expect(listener).toHaveBeenCalledTimes(1);
		const metrics = listener.mock.calls[0]?.[0] as {
			commandCount: number;
			renderTargetCount: number;
			offscreenPixelCount: number;
			offscreenAllocCount: number;
			offscreenReuseCount: number;
			offscreenFlushCount: number;
			snapshotCount: number;
			snapshotBySource: {
				asImageCopy: number;
				asImage: number;
				makeImageSnapshot: number;
			};
			compositeDrawImageCount: number;
			durationMs: number;
		};
		expect(metrics.commandCount).toBe(1);
		expect(metrics.renderTargetCount).toBe(1);
		expect(metrics.offscreenPixelCount).toBe(64 * 32);
		expect(metrics.offscreenAllocCount).toBe(1);
		expect(metrics.offscreenReuseCount).toBe(0);
		expect(metrics.offscreenFlushCount).toBe(1);
		expect(metrics.snapshotCount).toBe(1);
		expect(metrics.snapshotBySource.makeImageSnapshot).toBe(1);
		expect(metrics.compositeDrawImageCount).toBe(1);
		expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
	});
});
