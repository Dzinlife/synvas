// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createBundleLoader = (canvasKit: unknown) => {
	return vi.fn(async () => ({
		default: vi.fn(async () => canvasKit),
	}));
};

const loadSkiaModules = async () => {
	const loadModule = await import("../src/LoadSkiaWeb");
	const renderBackendModule = await import("../src/skia/web/renderBackend");
	loadModule.__resetLoadSkiaWebForTests();
	renderBackendModule.__resetSkiaRenderBackendForTests();
	window.localStorage.clear();
	return {
		...loadModule,
		...renderBackendModule,
	};
};

describe("LoadSkiaWeb", () => {
	beforeEach(() => {
		vi.resetModules();
		window.localStorage.clear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("auto 模式会优先选择 WebGPU bundle", async () => {
		const device = {
			createTexture: vi.fn(),
		};
		const webgpuCanvasKit = {
			MakeGPUDeviceContext: vi.fn(() => ({ id: "gpu-context" })),
			MakeGPUCanvasContext: vi.fn(),
			MakeGPUCanvasSurface: vi.fn(),
			MakeGPUTextureSurface: vi.fn(),
		};
		const webglCanvasKit = {
			MakeWebGLCanvasSurface: vi.fn(),
		};
		vi.stubGlobal("navigator", {
			gpu: {
				requestAdapter: vi.fn(async () => ({
					requestDevice: vi.fn(async () => device),
				})),
			},
		});
		const {
			LoadSkiaWeb,
			__setSkiaBundleLoadersForTests,
			getSkiaRenderBackend,
		} = await loadSkiaModules();
		const webgpuLoader = createBundleLoader(webgpuCanvasKit);
		const webglLoader = createBundleLoader(webglCanvasKit);
		__setSkiaBundleLoadersForTests({
			webgpu: webgpuLoader,
			webgl: webglLoader,
		});

		const canvasKit = await LoadSkiaWeb({ backendPreference: "auto" });

		expect(canvasKit).toBe(webgpuCanvasKit);
		expect(getSkiaRenderBackend()).toMatchObject({
			bundle: "webgpu",
			kind: "webgpu",
		});
		expect(webgpuLoader).toHaveBeenCalledTimes(1);
		expect(webglLoader).not.toHaveBeenCalled();
	});

	it("auto 模式在 WebGPU 初始化失败时回退到 WebGL bundle", async () => {
		const webgpuCanvasKit = {
			MakeGPUDeviceContext: vi.fn(() => null),
			MakeGPUCanvasContext: vi.fn(),
			MakeGPUCanvasSurface: vi.fn(),
			MakeGPUTextureSurface: vi.fn(),
		};
		const webglCanvasKit = {
			MakeWebGLCanvasSurface: vi.fn(),
		};
		vi.stubGlobal("navigator", {
			gpu: {
				requestAdapter: vi.fn(async () => ({
					requestDevice: vi.fn(async () => ({ createTexture: vi.fn() })),
				})),
			},
		});
		const {
			LoadSkiaWeb,
			__setSkiaBundleLoadersForTests,
			getSkiaRenderBackend,
		} = await loadSkiaModules();
		const webgpuLoader = createBundleLoader(webgpuCanvasKit);
		const webglLoader = createBundleLoader(webglCanvasKit);
		__setSkiaBundleLoadersForTests({
			webgpu: webgpuLoader,
			webgl: webglLoader,
		});

		const canvasKit = await LoadSkiaWeb({ backendPreference: "auto" });

		expect(canvasKit).toBe(webglCanvasKit);
		expect(getSkiaRenderBackend()).toMatchObject({
			bundle: "webgl",
			kind: "webgl",
		});
		expect(webgpuLoader).toHaveBeenCalledTimes(1);
		expect(webglLoader).toHaveBeenCalledTimes(1);
	});

	it("auto 模式在 WebGL 不可用时回退到 software", async () => {
		const webglCanvasKit = {
			MakeSWCanvasSurface: vi.fn(),
		};
		const {
			LoadSkiaWeb,
			__setSkiaBundleLoadersForTests,
			getSkiaRenderBackend,
		} = await loadSkiaModules();
		const webglLoader = createBundleLoader(webglCanvasKit);
		__setSkiaBundleLoadersForTests({
			webgl: webglLoader,
		});

		const canvasKit = await LoadSkiaWeb({ backendPreference: "auto" });

		expect(canvasKit).toBe(webglCanvasKit);
		expect(getSkiaRenderBackend()).toMatchObject({
			bundle: "webgl",
			kind: "software",
		});
		expect(webglLoader).toHaveBeenCalledTimes(1);
	});

	it("已初始化后切换到不兼容后端会提示刷新页面", async () => {
		const webglCanvasKit = {
			MakeWebGLCanvasSurface: vi.fn(),
		};
		const {
			LoadSkiaWeb,
			__setSkiaBundleLoadersForTests,
		} = await loadSkiaModules();
		__setSkiaBundleLoadersForTests({
			webgl: createBundleLoader(webglCanvasKit),
		});

		await LoadSkiaWeb({ backendPreference: "webgl" });

		await expect(
			LoadSkiaWeb({ backendPreference: "webgpu" }),
		).rejects.toThrow(/Refresh the page/);
	});
});
