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

const resolveWasmUrl = () => {
	// Electron 使用打包后的 wasm 资源；Web 保持走 /public/canvaskit.wasm
	if (typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent)) {
		return wasmUrl;
	}
	if (typeof window !== "undefined" && "aiNleElectron" in window) {
		return wasmUrl;
	}
	return "/canvaskit.wasm";
};

export const LoadSkiaWeb = async (opts?: CanvasKitInitOptions) => {
	if (global.CanvasKit !== undefined) {
		return;
	}
	const locateFile = (file: string) => {
		if (file === "canvaskit.wasm") {
			return resolveWasmUrl();
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
