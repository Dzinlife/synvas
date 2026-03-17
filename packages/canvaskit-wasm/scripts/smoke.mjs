import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { packageDir } from "./shared.mjs";

const loadCanvasKit = async (entryPath, wasmDir) => {
	const moduleUrl = pathToFileURL(entryPath).href;
	const imported = await import(moduleUrl);
	const init = imported.default ?? imported;
	return init({
		locateFile: (file) => path.join(wasmDir, file),
	});
};

const assertPathFactory = (canvasKit) => {
	for (const method of ["MakeFromGlyphs", "MakeFromRSXformGlyphs", "MakeFromText"]) {
		if (typeof canvasKit.Path?.[method] !== "function") {
			throw new Error(`CanvasKit.Path.${method} is not available.`);
		}
	}
};

const assertGlyphPathBindings = (canvasKit) => {
	const typeface = canvasKit.Typeface?.GetDefault?.() ?? null;
	const font = new canvasKit.Font(typeface, 24);
	const glyphs = Array.from(font.getGlyphIDs("Hi"));
	const pathFromGlyphs = canvasKit.Path.MakeFromGlyphs(
		glyphs,
		[10, 20, 30, 20],
		font,
	);
	const pathFromRSXformGlyphs = canvasKit.Path.MakeFromRSXformGlyphs(
		glyphs,
		[1, 0, 10, 20, 1, 0, 30, 20],
		font,
	);
	if (pathFromGlyphs === null) {
		throw new Error("CanvasKit.Path.MakeFromGlyphs() returned null.");
	}
	if (pathFromRSXformGlyphs === null) {
		throw new Error("CanvasKit.Path.MakeFromRSXformGlyphs() returned null.");
	}
	pathFromGlyphs.delete();
	pathFromRSXformGlyphs.delete();
	font.delete();
	typeface?.delete?.();
};

const assertWebGLBundle = (canvasKit) => {
	if (canvasKit.webgpu === true) {
		throw new Error("Expected WebGL bundle, received WebGPU bundle.");
	}
	if (typeof canvasKit.MakeWebGLCanvasSurface !== "function") {
		throw new Error("CanvasKit.MakeWebGLCanvasSurface is not available.");
	}
};

const assertWebGPUBundle = (canvasKit) => {
	if (canvasKit.webgpu !== true) {
		throw new Error("Expected CanvasKit.webgpu to be true.");
	}
	if (canvasKit.gpu !== true) {
		throw new Error("Expected CanvasKit.gpu to be true.");
	}
	for (const method of [
		"MakeGPUDeviceContext",
		"MakeGPUCanvasContext",
		"MakeGPUCanvasSurface",
		"MakeGPUTextureSurface",
	]) {
		if (typeof canvasKit[method] !== "function") {
			throw new Error(`CanvasKit.${method} is not available.`);
		}
	}
	for (const method of [
		"_MakeWebGPUDeviceContext",
		"_MakeGPUTextureSurface",
		"_MakeGPUTexturePromiseImage",
	]) {
		if (typeof canvasKit[method] !== "function") {
			throw new Error(`CanvasKit.${method} is not available.`);
		}
	}
};

const assertWebGPUHelperInterop = (entryPath) => {
	const source = readFileSync(entryPath, "utf8");
	if (!source.includes("var JsValStore=globalThis.JsValStore")) {
		throw new Error("Expected WebGPU bundle to inject a module-scoped JsValStore.");
	}
	if (source.includes("this.JsValStore.add(texture)")) {
		throw new Error("Expected WebGPU helper to use module-scoped JsValStore.");
	}
	if (source.includes("this.WebGPU.TextureFormat.indexOf(textureFormat)")) {
		throw new Error("Expected WebGPU helper to use module-scoped WebGPU enum table.");
	}
	if (!source.includes("JsValStore.add(texture)")) {
		throw new Error("Expected WebGPU helper to reference JsValStore.add(texture).");
	}
	if (!source.includes("WebGPU.TextureFormat.indexOf(textureFormat)")) {
		throw new Error(
			"Expected WebGPU helper to reference WebGPU.TextureFormat.indexOf(textureFormat).",
		);
	}
};

const rootEntry = path.join(packageDir, "bin", "canvaskit.js");
const fullEntry = path.join(packageDir, "bin", "full", "canvaskit.js");
const fullWebGLEntry = path.join(
	packageDir,
	"bin",
	"full-webgl",
	"canvaskit.js",
);
const fullWebGPUEntry = path.join(
	packageDir,
	"bin",
	"full-webgpu",
	"canvaskit.js",
);

const rootCanvasKit = await loadCanvasKit(rootEntry, path.join(packageDir, "bin"));
assertPathFactory(rootCanvasKit);
assertGlyphPathBindings(rootCanvasKit);

const fullCanvasKit = await loadCanvasKit(
	fullEntry,
	path.join(packageDir, "bin", "full"),
);
assertPathFactory(fullCanvasKit);
assertGlyphPathBindings(fullCanvasKit);
assertWebGLBundle(fullCanvasKit);

const fullWebGLCanvasKit = await loadCanvasKit(
	fullWebGLEntry,
	path.join(packageDir, "bin", "full-webgl"),
);
assertPathFactory(fullWebGLCanvasKit);
assertGlyphPathBindings(fullWebGLCanvasKit);
assertWebGLBundle(fullWebGLCanvasKit);

const fullWebGPUCanvasKit = await loadCanvasKit(
	fullWebGPUEntry,
	path.join(packageDir, "bin", "full-webgpu"),
);
assertPathFactory(fullWebGPUCanvasKit);
assertGlyphPathBindings(fullWebGPUCanvasKit);
assertWebGPUBundle(fullWebGPUCanvasKit);
assertWebGPUHelperInterop(fullWebGPUEntry);
