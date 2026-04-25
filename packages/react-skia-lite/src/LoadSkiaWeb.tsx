import type {
	CanvasKitInitOptions,
	CanvasKit as CanvasKitType,
} from "canvaskit-wasm";
import webglWasmUrl from "canvaskit-wasm/bin/full-webgl/canvaskit.wasm?url";
import webgpuWasmUrl from "canvaskit-wasm/bin/full-webgpu/canvaskit.wasm?url";
import {
	type SkiaBundleKind,
	getSkiaRenderBackend,
	type SkiaRenderBackend,
	type SkiaWebBackendPreference,
	resolveSkiaRenderBackendForBundle,
	setSkiaRenderBackend,
} from "./skia/web/renderBackend";
import { installCanvasKitWebGPU } from "./skia/web/installWebGPU";
export { getSkiaRenderBackend } from "./skia/web/renderBackend";
export type {
	SkiaRenderBackend,
	SkiaWebBackendPreference,
} from "./skia/web/renderBackend";

declare global {
	var CanvasKit: CanvasKitType;
	var global: typeof globalThis;
}

type CanvasKitInitModule = {
	default?: (opts?: CanvasKitInitOptions) => Promise<CanvasKitType>;
	c?: unknown;
	[key: string]: unknown;
};

type CanvasKitInitModuleLoader = () => Promise<CanvasKitInitModule>;

type LoadSkiaWebOptions = CanvasKitInitOptions & {
	backendPreference?: SkiaWebBackendPreference;
};

type GlobalSkiaMetadata = typeof globalThis & {
	__SYNVAS_SKIA_BUNDLE__?: SkiaBundleKind;
};

const DEFAULT_SKIA_WEB_BACKEND_PREFERENCE = "auto" as const;
export const SKIA_WEB_BACKEND_PREFERENCE_STORAGE_KEY =
	"synvas:skia-web-backend";
export const SKIA_WEB_BACKEND_QUERY_PARAM = "skiaBackend";

const validPreferences = new Set<SkiaWebBackendPreference>([
	"auto",
	"webgpu",
	"webgl",
]);

const defaultBundleModuleLoaders: Record<
	SkiaBundleKind,
	CanvasKitInitModuleLoader
> = {
	webgl: () => import("canvaskit-wasm/bin/full-webgl/canvaskit"),
	webgpu: () => import("canvaskit-wasm/bin/full-webgpu/canvaskit"),
};

const optimizedBundleModuleUrls: Record<SkiaBundleKind, string> = {
	webgl: "/node_modules/.vite/deps/canvaskit-wasm_bin_full-webgl_canvaskit.js",
	webgpu:
		"/node_modules/.vite/deps/canvaskit-wasm_bin_full-webgpu_canvaskit.js",
};

const defaultBundleWasmUrls: Record<SkiaBundleKind, string> = {
	webgl: webglWasmUrl,
	webgpu: webgpuWasmUrl,
};

let bundleModuleLoaders = { ...defaultBundleModuleLoaders };
let bundleWasmUrls = { ...defaultBundleWasmUrls };

if (typeof global === "undefined") {
	Object.defineProperty(globalThis, "global", {
		value: globalThis,
		writable: true,
		configurable: true,
	});
}

export let ckSharedPromise: Promise<CanvasKitType>;

const normalizeSkiaWebBackendPreference = (
	value: string | null | undefined,
): SkiaWebBackendPreference | null => {
	if (!value) {
		return null;
	}
	return validPreferences.has(value as SkiaWebBackendPreference)
		? (value as SkiaWebBackendPreference)
		: null;
};

const normalizeCanvasKitWasmUrl = (url: string) => {
	// Vitest 下 CanvasKit 会走 Node 的 fs 加载 wasm，需要真实文件路径。
	const nodeProcess = globalThis as typeof globalThis & {
		process?: {
			versions?: {
				node?: string;
			};
		};
	};
	if (nodeProcess.process?.versions?.node && url.startsWith("/@fs/")) {
		return url.slice("/@fs".length);
	}
	return url;
};

const getLocalStorageItem = (key: string) => {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
};

const setLocalStorageItem = (key: string, value: string) => {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(key, value);
	} catch {}
};

export const getSkiaWebBackendPreference = (): SkiaWebBackendPreference => {
	return (
		normalizeSkiaWebBackendPreference(
			getLocalStorageItem(SKIA_WEB_BACKEND_PREFERENCE_STORAGE_KEY),
		) ?? DEFAULT_SKIA_WEB_BACKEND_PREFERENCE
	);
};

export const setSkiaWebBackendPreference = (
	preference: SkiaWebBackendPreference,
) => {
	setLocalStorageItem(SKIA_WEB_BACKEND_PREFERENCE_STORAGE_KEY, preference);
};

export const resolveSkiaWebBackendPreference = (
	search = typeof window !== "undefined" ? window.location.search : "",
): SkiaWebBackendPreference => {
	const queryPreference = normalizeSkiaWebBackendPreference(
		new URLSearchParams(search).get(SKIA_WEB_BACKEND_QUERY_PARAM),
	);
	return queryPreference ?? getSkiaWebBackendPreference();
};

const getGlobalSkiaMetadata = () => globalThis as GlobalSkiaMetadata;

const isPreferenceCompatibleWithBackend = (
	preference: SkiaWebBackendPreference,
	backend: SkiaRenderBackend,
) => {
	if (preference === "auto") {
		return true;
	}
	return preference === backend.kind;
};

const buildIncompatiblePreferenceError = (
	preference: SkiaWebBackendPreference,
	backend: SkiaRenderBackend,
) => {
	return new Error(
		`CanvasKit is already initialized with ${backend.kind} from the ${backend.bundle} bundle. Refresh the page after changing the Skia backend preference to ${preference}.`,
	);
};

const buildBundleCandidates = (preference: SkiaWebBackendPreference) => {
	const canAttemptWebGPU =
		typeof navigator !== "undefined" &&
		typeof (navigator as Navigator & {
			gpu?: {
				requestAdapter?: () => Promise<GPUAdapter | null>;
			};
		}).gpu?.requestAdapter === "function";
	switch (preference) {
		case "webgpu":
			return ["webgpu"] as const;
		case "webgl":
			return ["webgl"] as const;
		case "auto":
		default:
			return canAttemptWebGPU
				? (["webgpu", "webgl"] as const)
				: (["webgl"] as const);
	}
};

const resolveCanvasKitInit = (imported: CanvasKitInitModule) => {
	const candidates = [
		imported,
		imported.default,
		typeof imported.default === "object" && imported.default
			? (imported.default as CanvasKitInitModule).default
			: undefined,
		imported.c,
		typeof imported.c === "object" && imported.c
			? (imported.c as CanvasKitInitModule).default
			: undefined,
		...Object.values(imported),
		...Object.values(imported)
			.filter(
				(value): value is CanvasKitInitModule =>
					typeof value === "object" && value !== null,
			)
			.map((value) => value.default),
	];
	return (
		candidates.find(
			(
				value,
			): value is (opts?: CanvasKitInitOptions) => Promise<CanvasKitType> => {
				return typeof value === "function";
			},
		) ?? null
	);
};

const loadOptimizedCanvasKitBundle = async (bundle: SkiaBundleKind) => {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return await import(
			/* @vite-ignore */ optimizedBundleModuleUrls[bundle]
		);
	} catch {
		return null;
	}
};

const loadCanvasKitBundle = async (
	bundle: SkiaBundleKind,
	opts?: LoadSkiaWebOptions,
) => {
	const { backendPreference: _backendPreference, ...initOptions } = opts ?? {};
	const locateFile = (file: string) => {
		if (file === "canvaskit.wasm") {
			return normalizeCanvasKitWasmUrl(
				initOptions.locateFile?.(file) ?? bundleWasmUrls[bundle],
			);
		}
		return initOptions.locateFile ? initOptions.locateFile(file) : file;
	};
	const imported =
		(await loadOptimizedCanvasKitBundle(bundle)) ??
		(await bundleModuleLoaders[bundle]());
	const init = resolveCanvasKitInit(imported);
	if (!init) {
		throw new Error(
			`CanvasKit init module for ${bundle} bundle is invalid (exports: ${Object.keys(imported).join(", ") || "<none>"}).`,
		);
	}
	const CanvasKit = await init({ ...initOptions, locateFile });
	if (bundle === "webgpu") {
		installCanvasKitWebGPU(CanvasKit);
	}
	return CanvasKit;
};

const tryResolveCanvasKit = async (
	preference: SkiaWebBackendPreference,
	opts?: LoadSkiaWebOptions,
) => {
	let lastError: Error | null = null;
	for (const bundle of buildBundleCandidates(preference)) {
		try {
			const CanvasKit = await loadCanvasKitBundle(bundle, opts);
			const backend = await resolveSkiaRenderBackendForBundle(CanvasKit, {
				bundle,
				preference,
			});
			if (!backend) {
				lastError = new Error(
					`Could not initialize ${preference} backend from ${bundle} bundle`,
				);
				continue;
			}
			return { CanvasKit, backend };
		} catch (error) {
			lastError =
				error instanceof Error ? error : new Error("Failed to load CanvasKit");
		}
	}
	throw (
		lastError ??
		new Error(`Failed to resolve CanvasKit bundle for ${preference} backend`)
	);
};

export const LoadSkiaWeb = async (opts?: LoadSkiaWebOptions) => {
	const preference =
		opts?.backendPreference ?? resolveSkiaWebBackendPreference();
	if (global.CanvasKit !== undefined) {
		const backend = getSkiaRenderBackend();
		if (!isPreferenceCompatibleWithBackend(preference, backend)) {
			throw buildIncompatiblePreferenceError(preference, backend);
		}
		return global.CanvasKit;
	}
	ckSharedPromise =
		ckSharedPromise ??
		(async () => {
			const { CanvasKit, backend } = await tryResolveCanvasKit(preference, opts);
			global.CanvasKit = CanvasKit;
			setSkiaRenderBackend(backend);
			getGlobalSkiaMetadata().__SYNVAS_SKIA_BUNDLE__ = backend.bundle;
			return CanvasKit;
		})().catch((error) => {
			ckSharedPromise = undefined as never;
			throw error;
		});
	const CanvasKit = await ckSharedPromise;
	const backend = getSkiaRenderBackend();
	if (!isPreferenceCompatibleWithBackend(preference, backend)) {
		throw buildIncompatiblePreferenceError(preference, backend);
	}
	return CanvasKit;
};

export const __setSkiaBundleLoadersForTests = (
	loaders: Partial<Record<SkiaBundleKind, CanvasKitInitModuleLoader>>,
	wasmUrls?: Partial<Record<SkiaBundleKind, string>>,
) => {
	bundleModuleLoaders = {
		...bundleModuleLoaders,
		...loaders,
	};
	if (wasmUrls) {
		bundleWasmUrls = {
			...bundleWasmUrls,
			...wasmUrls,
		};
	}
};

export const __resetLoadSkiaWebForTests = () => {
	delete getGlobalSkiaMetadata().__SYNVAS_SKIA_BUNDLE__;
	global.CanvasKit = undefined as unknown as CanvasKitType;
	bundleModuleLoaders = { ...defaultBundleModuleLoaders };
	bundleWasmUrls = { ...defaultBundleWasmUrls };
	ckSharedPromise = undefined as never;
};
