import type {
	CanvasKitInitOptions,
	CanvasKit as CanvasKitType,
} from "canvaskit-wasm";
import CanvasKitInit from "canvaskit-wasm/bin/full/canvaskit";
import wasmUrl from "canvaskit-wasm/bin/full/canvaskit.wasm?url";

declare global {
	var CanvasKit: CanvasKitType;
	var global: typeof globalThis;
}

if (typeof global === "undefined") {
	Object.defineProperty(globalThis, "global", {
		value: globalThis,
		writable: true,
		configurable: true,
	});
}

export let ckSharedPromise: Promise<CanvasKitType>;

const normalizeCanvasKitWasmUrl = (url: string) => {
	// Vitest 下 CanvasKit 会走 Node 的 fs 加载 wasm，需要真实文件路径。
	if (
		typeof process !== "undefined" &&
		process.versions?.node &&
		url.startsWith("/@fs/")
	) {
		return url.slice("/@fs".length);
	}
	return url;
};

export const LoadSkiaWeb = async (opts?: CanvasKitInitOptions) => {
	if (global.CanvasKit !== undefined) {
		return;
	}
	const locateFile = (file: string) => {
		if (file === "canvaskit.wasm") {
			return normalizeCanvasKitWasmUrl(opts?.locateFile?.(file) ?? wasmUrl);
		}
		return opts?.locateFile ? opts.locateFile(file) : file;
	};

	ckSharedPromise = ckSharedPromise ?? CanvasKitInit({ ...opts, locateFile });
	const CanvasKit = await ckSharedPromise;
	// The CanvasKit API is stored on the global object and used
	// to create the JsiSKApi in the Skia.web.ts file.
	global.CanvasKit = CanvasKit;

	return CanvasKit;
};
