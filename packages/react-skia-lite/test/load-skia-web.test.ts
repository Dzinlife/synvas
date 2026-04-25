// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createBundleLoader = (canvasKit: unknown) => {
	return vi.fn(async () => ({
		default: vi.fn(async () => canvasKit),
	}));
};

const createInteropBundleLoader = (
	canvasKit: unknown,
	shape: "c-default" | "default-default",
) => {
	const init = vi.fn(async () => canvasKit);
	if (shape === "c-default") {
		return vi.fn(async () => ({
			c: {
				default: init,
			},
		}));
	}
	return vi.fn(async () => ({
		default: {
			default: init,
		},
	}));
};

const createWebGPUCanvasKitStub = (
	overrides: Record<string, unknown> = {},
) => {
	return {
		MakeGPUDeviceContext: vi.fn(() => ({ id: "gpu-context" })),
		MakeGPUCanvasContext: vi.fn(),
		MakeGPUCanvasSurface: vi.fn(),
		SkSurfaces: {
			RenderTarget: vi.fn(),
			WrapBackendTexture: vi.fn(),
			AsImage: vi.fn(),
			AsImageCopy: vi.fn(),
		},
		SkImages: {
			WrapTexture: vi.fn(),
			PromiseTextureFrom: vi.fn(),
			MakeWithFilter: vi.fn(),
		},
		...overrides,
	};
};

const createWebGLCanvasKitStub = (
	overrides: Record<string, unknown> = {},
) => {
	return {
		GetWebGLContext: vi.fn(),
		MakeWebGLContext: vi.fn(),
		MakeOnScreenGLSurface: vi.fn(),
		...overrides,
	};
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
		delete (globalThis as typeof globalThis & { JsValStore?: unknown }).JsValStore;
		vi.unstubAllGlobals();
	});

	it("auto 模式会优先选择 WebGPU bundle", async () => {
		const device = {
			createTexture: vi.fn(),
		};
		const webgpuCanvasKit = createWebGPUCanvasKitStub();
		const webglCanvasKit = createWebGLCanvasKitStub();
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

	it("会兼容 Vite 返回的 CanvasKit interop 模块形状", async () => {
		const webgpuCanvasKit = createWebGPUCanvasKitStub();
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
		__setSkiaBundleLoadersForTests({
			webgpu: createInteropBundleLoader(webgpuCanvasKit, "c-default"),
		});

		const canvasKit = await LoadSkiaWeb({ backendPreference: "webgpu" });

		expect(canvasKit).toBe(webgpuCanvasKit);
		expect(getSkiaRenderBackend()).toMatchObject({
			bundle: "webgpu",
			kind: "webgpu",
		});
	});

	it("auto 模式在 WebGPU 初始化失败时回退到 WebGL bundle", async () => {
		const webgpuCanvasKit = createWebGPUCanvasKitStub({
			MakeGPUDeviceContext: vi.fn(() => null),
		});
		const webglCanvasKit = createWebGLCanvasKitStub();
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

	it("真实 WebGPU bundle 缺少私有导出挂载时仍保留官方 helper", async () => {
		const makeGPUDeviceContext = vi.fn(() => ({ id: "gpu-context" }));
		const webgpuCanvasKit = createWebGPUCanvasKitStub({
			webgpu: true,
			Surface: {
				prototype: {},
			},
			MakeGPUDeviceContext: makeGPUDeviceContext,
		});
		const webglCanvasKit = createWebGLCanvasKitStub();
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
		__setSkiaBundleLoadersForTests({
			webgpu: createBundleLoader(webgpuCanvasKit),
			webgl: createBundleLoader(webglCanvasKit),
		});

		const canvasKit = await LoadSkiaWeb({ backendPreference: "auto" });

		expect(canvasKit).toBe(webgpuCanvasKit);
		expect(getSkiaRenderBackend()).toMatchObject({
			bundle: "webgpu",
			kind: "webgpu",
		});
		expect(makeGPUDeviceContext).toHaveBeenCalledTimes(1);
		expect(
			(globalThis as typeof globalThis & { JsValStore?: { add?: unknown } }).JsValStore
				?.add,
		).toEqual(expect.any(Function));
		expect(
			(
				webgpuCanvasKit as typeof webgpuCanvasKit & {
					JsValStore?: { add?: unknown };
				}
			).JsValStore?.add,
		).toEqual(expect.any(Function));
		expect(webglCanvasKit.GetWebGLContext).not.toHaveBeenCalled();
	});

	it("真实 WebGPU bundle 的 canvas helper 默认使用透明 alphaMode", async () => {
		const makeGPUDeviceContext = vi.fn(() => ({ id: "gpu-context" }));
		const originalMakeGPUCanvasContext = vi.fn(() => ({
			id: "canvas-context",
		}));
		const webgpuCanvasKit = createWebGPUCanvasKitStub({
			webgpu: true,
			Surface: {
				prototype: {},
			},
			MakeGPUDeviceContext: makeGPUDeviceContext,
			MakeGPUCanvasContext: originalMakeGPUCanvasContext,
		});
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
		} = await loadSkiaModules();
		__setSkiaBundleLoadersForTests({
			webgpu: createBundleLoader(webgpuCanvasKit),
		});

		const canvasKit = await LoadSkiaWeb({ backendPreference: "webgpu" });
		const context = { id: "ctx" };
		const canvas = document.createElement("canvas");

		canvasKit.MakeGPUCanvasContext?.(context as never, canvas, {
			format: "rgba8unorm",
		});

		expect(originalMakeGPUCanvasContext).toHaveBeenCalledWith(context, canvas, {
			format: "rgba8unorm",
			alphaMode: "premultiplied",
		});
	});

	it("真实 WebGPU bundle 会保留 flush 的 surface this 绑定", async () => {
		const prototypeFlushFallback = vi.fn();
		const instanceFlush = vi.fn();
		const submit = vi.fn();
		const webgpuCanvasKit = createWebGPUCanvasKitStub({
			webgpu: true,
			Surface: {
				prototype: {
					_flush: prototypeFlushFallback,
					flush(this: { _flush?: (dirtyRect?: number[]) => void }, dirtyRect?: number[]) {
						this._flush?.(dirtyRect);
					},
				},
			},
		});
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
		} = await loadSkiaModules();
		__setSkiaBundleLoadersForTests({
			webgpu: createBundleLoader(webgpuCanvasKit),
		});

		const canvasKit = await LoadSkiaWeb({ backendPreference: "webgpu" });
		const surface = Object.create(canvasKit.Surface.prototype) as {
			_flush?: (dirtyRect?: number[]) => void;
			_deviceContext?: { submit?: () => void };
		};
		surface._flush = instanceFlush;
		surface._deviceContext = { submit };

		canvasKit.Surface.prototype.flush.call(surface, [1, 2, 3, 4]);

		expect(instanceFlush).toHaveBeenCalledTimes(1);
		expect(instanceFlush).toHaveBeenCalledWith([1, 2, 3, 4]);
		expect(prototypeFlushFallback).not.toHaveBeenCalled();
		expect(submit).toHaveBeenCalledTimes(1);
	});

	it("缺少官方 helper 且缺少底层导出时会回退到 WebGL bundle", async () => {
		const webgpuCanvasKit = {
			webgpu: true,
			Surface: {
				prototype: {},
			},
		};
		const webglCanvasKit = createWebGLCanvasKitStub();
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
		__setSkiaBundleLoadersForTests({
			webgpu: createBundleLoader(webgpuCanvasKit),
			webgl: createBundleLoader(webglCanvasKit),
		});

		const canvasKit = await LoadSkiaWeb({ backendPreference: "auto" });

		expect(canvasKit).toBe(webglCanvasKit);
		expect(getSkiaRenderBackend()).toMatchObject({
			bundle: "webgl",
			kind: "webgl",
		});
	});

	it("auto 模式在 WebGL 不可用时直接失败", async () => {
		const webglCanvasKit = {};
		const {
			LoadSkiaWeb,
			__setSkiaBundleLoadersForTests,
		} = await loadSkiaModules();
		const webglLoader = createBundleLoader(webglCanvasKit);
		__setSkiaBundleLoadersForTests({
			webgl: webglLoader,
		});

		await expect(LoadSkiaWeb({ backendPreference: "auto" })).rejects.toThrow(
			/Could not initialize auto backend from webgl bundle/,
		);
		expect(webglLoader).toHaveBeenCalledTimes(1);
	});

	it("已初始化后切换到不兼容后端会提示刷新页面", async () => {
		const webglCanvasKit = createWebGLCanvasKitStub();
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
