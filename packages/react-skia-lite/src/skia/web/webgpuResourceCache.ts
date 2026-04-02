import type { WebGPUDeviceContext } from "canvaskit-wasm";

import { getSkiaRenderBackend } from "./renderBackend";

type InternalWebGPUDeviceContext = WebGPUDeviceContext & {
	__graphiteResourceApiAvailable__?: boolean;
};

export type SkiaWebGPUResourceCacheStats = {
	currentBudgetedBytes: number;
	currentPurgeableBytes: number;
	maxBudgetedBytes: number;
	hasGraphiteResourceApi: boolean;
};

export type FlushSkiaWebGPUResourceCacheOptions = {
	cleanupOlderThanMs?: number;
	freeGpuResources?: boolean;
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

const resolveWebGPUContext = (): InternalWebGPUDeviceContext | null => {
	const backend = getSkiaRenderBackend();
	if (backend.kind !== "webgpu") {
		return null;
	}
	return backend.deviceContext as InternalWebGPUDeviceContext;
};

const resolveResourceCacheStats = (
	context: InternalWebGPUDeviceContext,
): SkiaWebGPUResourceCacheStats => {
	const hasGraphiteResourceApi =
		context.__graphiteResourceApiAvailable__ === true;
	return {
		currentBudgetedBytes: normalizeNonNegativeNumber(
			context.currentBudgetedBytes?.(),
			0,
		),
		currentPurgeableBytes: normalizeNonNegativeNumber(
			context.currentPurgeableBytes?.(),
			0,
		),
		maxBudgetedBytes: normalizeNonNegativeNumber(context.maxBudgetedBytes?.(), 0),
		hasGraphiteResourceApi,
	};
};

export const getSkiaWebGPUResourceCacheStats =
	(): SkiaWebGPUResourceCacheStats | null => {
		const context = resolveWebGPUContext();
		if (!context) {
			return null;
		}
		return resolveResourceCacheStats(context);
	};

export const setSkiaWebGPUMaxBudgetedBytes = (bytes: number): boolean => {
	const context = resolveWebGPUContext();
	if (!context) {
		return false;
	}
	context.setMaxBudgetedBytes?.(normalizeNonNegativeNumber(bytes, 0));
	return true;
};

export const flushSkiaWebGPUResourceCache = (
	options: FlushSkiaWebGPUResourceCacheOptions = {},
): SkiaWebGPUResourceCacheStats | null => {
	const context = resolveWebGPUContext();
	if (!context) {
		return null;
	}
	const cleanupOlderThanMs = normalizeNonNegativeNumber(
		options.cleanupOlderThanMs,
		0,
	);
	const shouldFreeGpuResources = options.freeGpuResources ?? true;

	context.submit?.(false);
	context.checkAsyncWorkCompletion?.();
	context.performDeferredCleanup?.(cleanupOlderThanMs);
	if (shouldFreeGpuResources) {
		context.freeGpuResources?.();
	}
	context.submit?.(false);
	context.checkAsyncWorkCompletion?.();

	return resolveResourceCacheStats(context);
};

type WebGPUResourceCacheWindowApi = {
	getStats: () => SkiaWebGPUResourceCacheStats | null;
	flush: (
		options?: FlushSkiaWebGPUResourceCacheOptions,
	) => SkiaWebGPUResourceCacheStats | null;
	setMaxBudgetedBytes: (bytes: number) => boolean;
};

const installWindowWebGPUResourceCacheApi = () => {
	if (typeof window === "undefined") {
		return;
	}
	const win = window as Window & {
		__GRAPHITE_RESOURCE_CACHE__?: WebGPUResourceCacheWindowApi;
	};
	if (win.__GRAPHITE_RESOURCE_CACHE__) {
		return;
	}
	win.__GRAPHITE_RESOURCE_CACHE__ = {
		getStats: () => getSkiaWebGPUResourceCacheStats(),
		flush: (options) => flushSkiaWebGPUResourceCache(options),
		setMaxBudgetedBytes: (bytes) => setSkiaWebGPUMaxBudgetedBytes(bytes),
	};
};

installWindowWebGPUResourceCacheApi();
