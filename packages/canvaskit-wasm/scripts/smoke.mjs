import path from "node:path";
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

const assertPathFactoryRuntime = (canvasKit) => {
	const font = new canvasKit.Font(null, 16);
	const glyphs = Array.from(font.getGlyphIDs("Hi"));
	if (glyphs.length !== 2) {
		throw new Error(`Expected 2 glyph ids, received ${glyphs.length}.`);
	}
	const glyphPath = canvasKit.Path.MakeFromGlyphs(glyphs, [0, 0, 12, 0], font);
	const rsxPath = canvasKit.Path.MakeFromRSXformGlyphs(
		glyphs,
		[1, 0, 0, 0, 1, 0, 12, 0],
		font,
	);
	const textPath = canvasKit.Path.MakeFromText("Hi", 0, 0, font);
	if (!glyphPath || !rsxPath || !textPath) {
		throw new Error("CanvasKit.Path.MakeFrom* returned null.");
	}
	glyphPath.delete();
	rsxPath.delete();
	textPath.delete();
	font.delete();
};

const rootEntry = path.join(packageDir, "bin", "canvaskit.js");
const fullEntry = path.join(packageDir, "bin", "full", "canvaskit.js");

const rootCanvasKit = await loadCanvasKit(rootEntry, path.join(packageDir, "bin"));
assertPathFactory(rootCanvasKit);
assertPathFactoryRuntime(rootCanvasKit);

const fullCanvasKit = await loadCanvasKit(
	fullEntry,
	path.join(packageDir, "bin", "full"),
);
assertPathFactory(fullCanvasKit);
assertPathFactoryRuntime(fullCanvasKit);
