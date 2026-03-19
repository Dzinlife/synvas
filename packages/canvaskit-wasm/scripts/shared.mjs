import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const packageDir = path.resolve(__dirname, "..");
export const repoRoot = path.resolve(packageDir, "..", "..");
export const skiaCommit =
	process.env.AI_NLE_CANVASKIT_SKIA_COMMIT ??
	"a6ccaf95c6e0813f110c7daf884a459161d6de1b";
export const skiaRepoUrl =
	process.env.AI_NLE_CANVASKIT_SKIA_REPO ??
	"https://github.com/google/skia.git";
export const skiaDir = path.join(repoRoot, ".cache", "canvaskit-skia", skiaCommit);
export const patchFile = path.join(
	packageDir,
	"patches",
	"skia-canvaskit-glyph-paths.patch",
);
export const fetchGnPatchFile = path.join(
	packageDir,
	"patches",
	"skia-fetch-gn-local-cache.patch",
);
export const dawnPatchFile = path.join(
	packageDir,
	"patches",
	"skia-dawn-build-ninja-jobs.patch",
);
export const dawnWebGPUPatchFile = path.join(
	packageDir,
	"patches",
	"skia-dawn-webgpu-compat.patch",
);
export const dawnThirdPartyPatchFile = path.join(
	packageDir,
	"patches",
	"skia-dawn-emdawnwebgpu-dir.patch",
);
export const dawnWasmTargetPatchFile = path.join(
	packageDir,
	"patches",
	"skia-dawn-wasm-build-targets.patch",
);
export const dawnWasmHeadersPatchFile = path.join(
	packageDir,
	"patches",
	"skia-dawn-wasm-header-copy.patch",
);
export const canvasKitWebGPUTypesPatchFile = path.join(
	packageDir,
	"patches",
	"skia-canvaskit-webgpu-types.patch",
);
export const canvasKitWebGPUBuildPatchFile = path.join(
	packageDir,
	"patches",
	"skia-canvaskit-webgpu-build.patch",
);
export const canvasKitWebGPUFlagPatchFile = path.join(
	packageDir,
	"patches",
	"skia-canvaskit-webgpu-flag.patch",
);
export const dawnGraphiteWasmCompatPatchFile = path.join(
	packageDir,
	"patches",
	"skia-dawn-graphite-wasm-compat.patch",
);
export const dockerfileDir = path.join(packageDir, "docker", "canvaskit-emsdk");
export const dockerBaseImage =
	process.env.AI_NLE_CANVASKIT_DOCKER_BASE_IMAGE ?? "emscripten/emsdk:4.0.7";
export const dockerImage =
	process.env.AI_NLE_CANVASKIT_DOCKER_IMAGE ?? "ai-nle-canvaskit-emsdk:4.0.7";
export const dawnBuildNinjaJobs =
	process.env.AI_NLE_CANVASKIT_DAWN_BUILD_NINJA_JOBS ?? "1";

const canvaskitModuleDir = path.join(skiaDir, "modules", "canvaskit");
const npmBuildDir = path.join(canvaskitModuleDir, "npm_build");
const npmBuildBinDir = path.join(npmBuildDir, "bin");
const npmBuildTypesDir = path.join(npmBuildDir, "types");
const releaseBuildDir = path.join(skiaDir, "out", "canvaskit_wasm");
const webGPUBuildDir = path.join(skiaDir, "out", "canvaskit_wasm_webgpu");
const packageBinDir = path.join(packageDir, "bin");
const packageTypesDir = path.join(packageDir, "types");
const bundleArtifactFiles = ["canvaskit.js", "canvaskit.wasm"];
const releaseBuildInputs = [
	path.join(canvaskitModuleDir, "BUILD.gn"),
	path.join(canvaskitModuleDir, "canvaskit_bindings.cpp"),
	path.join(canvaskitModuleDir, "externs.js"),
	path.join(canvaskitModuleDir, "font.js"),
];
const webGPUBuildInputs = [
	...releaseBuildInputs,
	path.join(canvaskitModuleDir, "webgpu.js"),
	path.join(skiaDir, "third_party", "dawn", "BUILD.gn"),
	path.join(skiaDir, "third_party", "dawn", "build_dawn.py"),
	path.join(skiaDir, "third_party", "dawn", "cmake_utils.py"),
	path.join(
		skiaDir,
		"third_party",
		"externals",
		"dawn",
		"include",
		"tint",
		"tint.h",
	),
	path.join(skiaDir, "src", "gpu", "graphite", "dawn", "DawnBuffer.cpp"),
	path.join(skiaDir, "src", "gpu", "graphite", "dawn", "DawnCaps.cpp"),
	path.join(skiaDir, "src", "gpu", "graphite", "dawn", "DawnCommandBuffer.cpp"),
	path.join(skiaDir, "src", "gpu", "graphite", "dawn", "DawnErrorChecker.cpp"),
	path.join(skiaDir, "src", "gpu", "graphite", "dawn", "DawnGraphiteUtils.cpp"),
];
const typeBuildInputs = [
	path.join(npmBuildTypesDir, "index.d.ts"),
	path.join(npmBuildTypesDir, "canvaskit-wasm-tests.ts"),
];
const viteDepArtifacts = [
	"canvaskit-wasm_bin_full_canvaskit.js",
	"canvaskit-wasm_bin_full_canvaskit.js.map",
	"canvaskit-wasm_bin_full-webgl_canvaskit.js",
	"canvaskit-wasm_bin_full-webgl_canvaskit.js.map",
	"canvaskit-wasm_bin_full-webgpu_canvaskit.js",
	"canvaskit-wasm_bin_full-webgpu_canvaskit.js.map",
].map((file) =>
	path.join(repoRoot, "packages", "web", "node_modules", ".vite", "deps", file),
);

const webGPUJsValStorePrelude =
	'var JsValStore=globalThis.JsValStore&&typeof globalThis.JsValStore.add==="function"&&typeof globalThis.JsValStore.get==="function"&&typeof globalThis.JsValStore.remove==="function"?globalThis.JsValStore:(function(){var nextHandle=1;var values=new Map;var store={add:function(value){var handle=nextHandle++;values.set(handle,value);return handle},get:function(handle){return values.get(handle)},remove:function(handle){values.delete(handle)}};globalThis.JsValStore=store;return store})();';

const formatCommand = (command, args) =>
	[command, ...args].map((part) => JSON.stringify(part)).join(" ");

const ensureWebGPUJsValStoreInterop = (entryPath) => {
	if (!existsSync(entryPath)) {
		return;
	}
	const source = readFileSync(entryPath, "utf8");
	if (source.includes("var JsValStore=globalThis.JsValStore")) {
		return;
	}
	const runtimePrelude = "var IsDebug=false;";
	if (!source.includes(runtimePrelude)) {
		throw new Error(`Could not find WebGPU runtime prelude in ${entryPath}`);
	}
	writeFileSync(
		entryPath,
		source.replace(runtimePrelude, `${runtimePrelude}${webGPUJsValStorePrelude}`),
	);
};

export const run = (command, args, options = {}) => {
	console.log(`$ ${formatCommand(command, args)}`);
	const result = spawnSync(command, args, {
		stdio: "inherit",
		cwd: options.cwd ?? repoRoot,
		env: {
			...process.env,
			...options.env,
		},
	});
	if (result.status !== 0) {
		throw new Error(`${command} exited with code ${result.status ?? "unknown"}`);
	}
};

export const capture = (command, args, options = {}) => {
	const result = spawnSync(command, args, {
		stdio: ["ignore", "pipe", "pipe"],
		encoding: "utf8",
		cwd: options.cwd ?? repoRoot,
		env: {
			...process.env,
			...options.env,
		},
	});
	if (result.status !== 0) {
		const stderr = result.stderr?.trim();
		throw new Error(stderr || `${command} exited with code ${result.status ?? "unknown"}`);
	}
	return result.stdout.trim();
};

export const ensureSkiaCheckout = () => {
	mkdirSync(path.dirname(skiaDir), { recursive: true });
	if (!existsSync(path.join(skiaDir, ".git"))) {
		run("git", ["clone", "--depth", "1", skiaRepoUrl, skiaDir]);
	}
	const currentHead = capture("git", ["-C", skiaDir, "rev-parse", "HEAD"]);
	if (currentHead !== skiaCommit) {
		run("git", ["-C", skiaDir, "fetch", "--depth", "1", "origin", skiaCommit]);
		run("git", ["-C", skiaDir, "checkout", skiaCommit]);
	}
};

const applyGitPatch = (name, targetPatchFile, isAlreadyApplied) => {
	if (isAlreadyApplied()) {
		console.log(`${name} patch already applied.`);
		return;
	}
	const forwardCheck = spawnSync("git", ["-C", skiaDir, "apply", "--check", targetPatchFile], {
		stdio: "ignore",
	});
	if (forwardCheck.status === 0) {
		run("git", ["-C", skiaDir, "apply", targetPatchFile]);
		return;
	}
	const reverseCheck = spawnSync(
		"git",
		["-C", skiaDir, "apply", "--reverse", "--check", targetPatchFile],
		{ stdio: "ignore" },
	);
	if (reverseCheck.status === 0) {
		console.log(`${name} patch already applied.`);
		return;
	}
	throw new Error(`Failed to apply ${name} patch. Please inspect the checkout state.`);
};

export const applySkiaPatch = () => {
	applyGitPatch("Skia fetch-gn local cache", fetchGnPatchFile, () => {
		return readFileSync(path.join(skiaDir, "bin", "fetch-gn"), "utf8").includes(
			"os.path.isfile(gn_path) and os.access(gn_path, os.X_OK)",
		);
	});
	applyGitPatch("Skia glyph path", patchFile, () => {
		return (
			readFileSync(path.join(skiaDir, "modules", "canvaskit", "font.js"), "utf8").includes(
				"CanvasKit.Path._MakeFromGlyphs(font, glyphPtr, glyphs.length * 2, posPtr, positions.length)",
			) &&
			readFileSync(
				path.join(skiaDir, "modules", "canvaskit", "canvaskit_bindings.cpp"),
				"utf8",
			).includes('"_MakeFromGlyphs"') &&
			readFileSync(
				path.join(skiaDir, "modules", "canvaskit", "externs.js"),
				"utf8",
			).includes("_MakeFromGlyphs") &&
			readFileSync(path.join(skiaDir, "modules", "canvaskit", "BUILD.gn"), "utf8").includes(
				'deps += [ "../..:pathops" ]',
			)
		);
	});
	applyGitPatch("CanvasKit WebGPU types", canvasKitWebGPUTypesPatchFile, () => {
		return (
			readFileSync(
				path.join(skiaDir, "modules", "canvaskit", "npm_build", "types", "index.d.ts"),
				"utf8",
			).includes("readonly SkSurfaces: SkSurfacesFactory;") &&
			readFileSync(
				path.join(skiaDir, "modules", "canvaskit", "npm_build", "types", "index.d.ts"),
				"utf8",
			).includes("readonly SkImages: SkImagesFactory;") &&
			readFileSync(
				path.join(skiaDir, "modules", "canvaskit", "npm_build", "types", "index.d.ts"),
				"utf8",
			).includes("ReadSurfacePixelsYUV420Async") &&
			readFileSync(
				path.join(
					skiaDir,
					"modules",
					"canvaskit",
					"npm_build",
					"types",
					"canvaskit-wasm-tests.ts",
				),
				"utf8",
			).includes("CK.SkSurfaces.WrapBackendTexture(gpuContext, texture,") &&
			readFileSync(
				path.join(
					skiaDir,
					"modules",
					"canvaskit",
					"npm_build",
					"types",
					"canvaskit-wasm-tests.ts",
				),
				"utf8",
			).includes("ReadSurfacePixelsAsync(")
		);
	});
	applyGitPatch("CanvasKit WebGPU build", canvasKitWebGPUBuildPatchFile, () => {
		return (
			readFileSync(path.join(skiaDir, "modules", "canvaskit", "BUILD.gn"), "utf8").includes(
				'"CK_ENABLE_WEBGPU"',
			) &&
			readFileSync(path.join(skiaDir, "modules", "canvaskit", "BUILD.gn"), "utf8").includes(
				'public_configs = [ "../../third_party/dawn:dawn_api_config" ]',
			) &&
			!readFileSync(path.join(skiaDir, "modules", "canvaskit", "BUILD.gn"), "utf8").includes(
				'"-sUSE_WEBGPU=1"',
			) &&
			readFileSync(path.join(skiaDir, "modules", "canvaskit", "compile.sh"), "utf8").includes(
				'ENABLE_GANESH="true"\n  ENABLE_WEBGPU="true"\n  ENABLE_GRAPHITE="true"',
			) &&
			readFileSync(
				path.join(skiaDir, "modules", "canvaskit", "canvaskit_bindings.cpp"),
				"utf8",
			).includes('class WebGPUDeviceContext {') &&
			readFileSync(
				path.join(skiaDir, "modules", "canvaskit", "canvaskit_bindings.cpp"),
				"utf8",
			).includes('"_SkSurfaces_RenderTarget"') &&
			readFileSync(
				path.join(skiaDir, "modules", "canvaskit", "canvaskit_bindings.cpp"),
				"utf8",
			).includes('"_SkImages_PromiseTextureFrom"') &&
			readFileSync(
				path.join(skiaDir, "modules", "canvaskit", "canvaskit_bindings.cpp"),
				"utf8",
			).includes("canvaskit_import_webgpu_texture") &&
			readFileSync(
				path.join(skiaDir, "third_party", "dawn", "BUILD.gn"),
				"utf8",
			).includes('libs += [ "$root_out_dir/cmake_dawn/src/emdawnwebgpu/libemdawnwebgpu_c.a" ]') &&
			readFileSync(path.join(skiaDir, "third_party", "dawn", "BUILD.gn"), "utf8").includes(
				'$root_out_dir/cmake_dawn/gen/src/emdawnwebgpu/include',
			)
		);
	});
	applyGitPatch("CanvasKit WebGPU flag", canvasKitWebGPUFlagPatchFile, () => {
		return readFileSync(
			path.join(skiaDir, "modules", "canvaskit", "webgpu.js"),
			"utf8",
		).includes("CanvasKit.SkSurfaces = {") &&
			readFileSync(path.join(skiaDir, "modules", "canvaskit", "webgpu.js"), "utf8").includes(
				"CanvasKit.SkImages = {",
			) &&
			readFileSync(path.join(skiaDir, "modules", "canvaskit", "webgpu.js"), "utf8").includes(
				"JsValStore.add(texture)",
			) &&
			!readFileSync(path.join(skiaDir, "modules", "canvaskit", "webgpu.js"), "utf8").includes(
				"this.JsValStore.add(texture)",
			) &&
			readFileSync(path.join(skiaDir, "modules", "canvaskit", "webgpu.js"), "utf8").includes(
				"WebGPU.TextureFormat.indexOf(textureFormat)",
			) &&
			!readFileSync(path.join(skiaDir, "modules", "canvaskit", "webgpu.js"), "utf8").includes(
				"this.WebGPU.TextureFormat.indexOf(textureFormat)",
			) &&
			readFileSync(path.join(skiaDir, "modules", "canvaskit", "webgpu.js"), "utf8").includes(
				"context.ReadSurfacePixelsAsync = function(",
			);
	});
	applyGitPatch("Skia Dawn build jobs", dawnPatchFile, () => {
		return readFileSync(path.join(skiaDir, "third_party", "dawn", "build_dawn.py"), "utf8")
			.includes('os.environ.get("DAWN_BUILD_NINJA_JOBS")');
	});
	applyGitPatch("Skia Dawn WebGPU compat", dawnWebGPUPatchFile, () => {
		return (
			readFileSync(path.join(skiaDir, "third_party", "dawn", "build_dawn.py"), "utf8").includes(
				"Emscripten.cmake",
			) &&
			readFileSync(
				path.join(skiaDir, "third_party", "externals", "dawn", "include", "tint", "tint.h"),
				"utf8",
			).includes('#include "src/tint/api/common/bindings.h"')
		);
	});
	applyGitPatch("Skia Dawn emdawnwebgpu dir", dawnThirdPartyPatchFile, () => {
		return readFileSync(path.join(skiaDir, "third_party", "dawn", "cmake_utils.py"), "utf8")
			.includes("dawn/third_party/emdawnwebgpu");
	});
	applyGitPatch("Skia Dawn wasm build targets", dawnWasmTargetPatchFile, () => {
		return readFileSync(path.join(skiaDir, "third_party", "dawn", "build_dawn.py"), "utf8")
			.includes('build_targets = ["webgpu_headers_gen", "emdawnwebgpu_c"]');
	});
	applyGitPatch("Skia Dawn wasm header copy", dawnWasmHeadersPatchFile, () => {
		return readFileSync(path.join(skiaDir, "third_party", "dawn", "build_dawn.py"), "utf8")
			.includes('"gen", "src", "emdawnwebgpu", "include"');
	});
	applyGitPatch("Skia Dawn Graphite wasm compat", dawnGraphiteWasmCompatPatchFile, () => {
		return (
			readFileSync(
				path.join(skiaDir, "src", "gpu", "graphite", "dawn", "DawnBuffer.cpp"),
				"utf8",
			).includes("bool is_map_succeeded(wgpu::MapAsyncStatus status)") &&
			readFileSync(
				path.join(skiaDir, "src", "gpu", "graphite", "dawn", "DawnCaps.cpp"),
				"utf8",
			).includes("wgpu::Limits limits = {};") &&
			readFileSync(
				path.join(skiaDir, "src", "gpu", "graphite", "dawn", "DawnCommandBuffer.cpp"),
				"utf8",
			).includes("wgpu::PassTimestampWrites wgpuTimestampWrites;") &&
			readFileSync(
				path.join(skiaDir, "src", "gpu", "graphite", "dawn", "DawnErrorChecker.cpp"),
				"utf8",
			).includes("wgpu::CallbackMode::AllowSpontaneous") &&
			readFileSync(
				path.join(skiaDir, "src", "gpu", "graphite", "dawn", "DawnGraphiteUtils.cpp"),
				"utf8",
			).includes("wgpu::ShaderSourceWGSL wgslDesc;")
		);
	});
};

export const ensureDocker = () => {
	run("docker", ["info", "--format", "{{.ServerVersion}}"]);
	const imageCheck = spawnSync("docker", ["image", "inspect", dockerImage], {
		stdio: "ignore",
		cwd: repoRoot,
		env: process.env,
	});
	if (imageCheck.status === 0) {
		return;
	}
	if (process.env.AI_NLE_CANVASKIT_DOCKER_IMAGE) {
		throw new Error(
			`Docker image ${dockerImage} is missing. Pull or build it before running build:docker.`,
		);
	}
	run("docker", [
		"build",
		"--tag",
		dockerImage,
		"--build-arg",
		`EMSDK_BASE_IMAGE=${dockerBaseImage}`,
		dockerfileDir,
	]);
};

const getMTimeMs = (file) => (existsSync(file) ? statSync(file).mtimeMs : 0);

const getFileSize = (file) => (existsSync(file) ? statSync(file).size : 0);

const getBundleArtifactPaths = (dir) =>
	bundleArtifactFiles.map((file) => path.join(dir, file));

const createFileEntries = (sourceDir, targetDir, files) =>
	files.map((file) => ({
		source: path.join(sourceDir, file),
		target: path.join(targetDir, file),
	}));

const createTypeEntries = (sourceDir, targetDir) => {
	if (!existsSync(sourceDir)) {
		throw new Error("CanvasKit type artifacts are missing. Run build:docker first.");
	}
	return readdirSync(sourceDir, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => ({
			source: path.join(sourceDir, entry.name),
			target: path.join(targetDir, entry.name),
		}));
};

const areArtifactsStale = (inputs, outputs) => {
	if (outputs.some((file) => !existsSync(file))) {
		return true;
	}
	const newestInput = inputs.reduce((latest, file) => Math.max(latest, getMTimeMs(file)), 0);
	const oldestOutput = outputs.reduce(
		(oldest, file) => Math.min(oldest, getMTimeMs(file)),
		Number.POSITIVE_INFINITY,
	);
	return newestInput > oldestOutput;
};

const syncEntriesIfNeeded = (entries, prepareTargets) => {
	const missingSources = entries
		.filter(({ source }) => !existsSync(source))
		.map(({ source }) => source);
	if (missingSources.length > 0) {
		throw new Error(`Missing source artifacts: ${missingSources.join(", ")}`);
	}
	const shouldSync =
		entries.some(({ target }) => !existsSync(target)) ||
		entries.some(
			({ source, target }) =>
				getMTimeMs(source) !== getMTimeMs(target) || getFileSize(source) !== getFileSize(target),
		);
	if (!shouldSync) {
		return false;
	}
	prepareTargets?.();
	for (const { source, target } of entries) {
		mkdirSync(path.dirname(target), { recursive: true });
		cpSync(source, target, { preserveTimestamps: true });
	}
	return true;
};

const syncBundleArtifacts = (sourceDir, targetDir) => {
	const entries = createFileEntries(sourceDir, targetDir, bundleArtifactFiles);
	return syncEntriesIfNeeded(entries, () => {
		rmSync(targetDir, { recursive: true, force: true });
		mkdirSync(targetDir, { recursive: true });
	});
};

const syncRootBundleArtifacts = (sourceDir) => {
	const entries = createFileEntries(sourceDir, packageBinDir, bundleArtifactFiles);
	return syncEntriesIfNeeded(entries);
};

const syncTypeArtifacts = () => {
	const entries = createTypeEntries(npmBuildTypesDir, packageTypesDir);
	return syncEntriesIfNeeded(entries, () => {
		rmSync(packageTypesDir, { recursive: true, force: true });
		mkdirSync(packageTypesDir, { recursive: true });
	});
};

const clearViteDepsCache = () => {
	for (const artifact of viteDepArtifacts) {
		rmSync(artifact, { force: true });
	}
};

const syncFullPackageArtifacts = () => {
	if (!existsSync(npmBuildBinDir) || !existsSync(npmBuildTypesDir)) {
		throw new Error("CanvasKit npm_build artifacts are missing. Run build:docker first.");
	}
	syncRootBundleArtifacts(npmBuildBinDir);
	syncBundleArtifacts(path.join(npmBuildBinDir, "full"), path.join(packageBinDir, "full"));
	syncBundleArtifacts(
		path.join(npmBuildBinDir, "full-webgl"),
		path.join(packageBinDir, "full-webgl"),
	);
	syncBundleArtifacts(
		path.join(npmBuildBinDir, "full-webgpu"),
		path.join(packageBinDir, "full-webgpu"),
	);
	ensureWebGPUJsValStoreInterop(path.join(packageBinDir, "full-webgpu", "canvaskit.js"));
	syncBundleArtifacts(
		path.join(npmBuildBinDir, "profiling"),
		path.join(packageBinDir, "profiling"),
	);
	syncTypeArtifacts();
	clearViteDepsCache();
};

const syncFastPackageArtifacts = () => {
	syncRootBundleArtifacts(releaseBuildDir);
	syncBundleArtifacts(releaseBuildDir, path.join(packageBinDir, "full"));
	syncBundleArtifacts(releaseBuildDir, path.join(packageBinDir, "full-webgl"));
	syncBundleArtifacts(webGPUBuildDir, path.join(packageBinDir, "full-webgpu"));
	ensureWebGPUJsValStoreInterop(path.join(packageBinDir, "full-webgpu", "canvaskit.js"));
	syncTypeArtifacts();
	clearViteDepsCache();
};

const formatConditionalShell = (condition, commands) =>
	`if ${condition ? "true" : "false"}; then ${commands.join(" ")} fi`;

const runCanvasKitDockerSteps = (steps) => {
	if (steps.length === 0) {
		return;
	}
	run("docker", [
		"run",
		"--rm",
		"--volume",
		`${skiaDir}:/SRC`,
		"--workdir",
		"/SRC",
		dockerImage,
		"bash",
		"-lc",
		[
			"python3 /SRC/tools/git-sync-deps",
			"cd /SRC/modules/canvaskit",
			'export PATH="/SRC/third_party/ninja:$PATH"',
			`export DAWN_BUILD_NINJA_JOBS=${JSON.stringify(dawnBuildNinjaJobs)}`,
			...steps,
		].join(" && "),
	]);
};

export const syncPackageArtifacts = () => {
	syncFullPackageArtifacts();
};

export const buildCanvasKitInDocker = () => {
	ensureDocker();
	ensureSkiaCheckout();
	applySkiaPatch();
	const shouldRebuildNpmArtifacts = areArtifactsStale(
		[...releaseBuildInputs, ...typeBuildInputs],
		[
		path.join(npmBuildBinDir, "canvaskit.js"),
		path.join(npmBuildBinDir, "canvaskit.wasm"),
		path.join(npmBuildBinDir, "full", "canvaskit.js"),
		path.join(npmBuildBinDir, "full", "canvaskit.wasm"),
		path.join(npmBuildBinDir, "profiling", "canvaskit.js"),
		path.join(npmBuildBinDir, "profiling", "canvaskit.wasm"),
		],
	);
	const shouldRebuildWebGPUArtifacts = areArtifactsStale(
		webGPUBuildInputs,
		getBundleArtifactPaths(webGPUBuildDir),
	);
	const shouldRefreshNpmBuildFullWebGLArtifacts =
		shouldRebuildNpmArtifacts ||
		areArtifactsStale(
			getBundleArtifactPaths(path.join(npmBuildBinDir, "full")),
			getBundleArtifactPaths(path.join(npmBuildBinDir, "full-webgl")),
		);
	const shouldRefreshNpmBuildWebGPUArtifacts =
		shouldRebuildNpmArtifacts ||
		shouldRebuildWebGPUArtifacts ||
		areArtifactsStale(
			getBundleArtifactPaths(webGPUBuildDir),
			getBundleArtifactPaths(path.join(npmBuildBinDir, "full-webgpu")),
		);
	const dockerSteps = [
		formatConditionalShell(shouldRebuildNpmArtifacts, [
			'rm -rf "./npm_build/bin";',
			"make npm;",
		]),
		formatConditionalShell(shouldRefreshNpmBuildFullWebGLArtifacts, [
			'rm -rf "./npm_build/bin/full-webgl";',
			'mkdir -p "./npm_build/bin/full-webgl";',
			'cp "./npm_build/bin/full/canvaskit.js" "./npm_build/bin/full-webgl/canvaskit.js";',
			'cp "./npm_build/bin/full/canvaskit.wasm" "./npm_build/bin/full-webgl/canvaskit.wasm";',
		]),
		formatConditionalShell(shouldRebuildWebGPUArtifacts, [
			"BUILD_DIR=out/canvaskit_wasm_webgpu ./compile.sh release webgpu;",
		]),
		formatConditionalShell(shouldRefreshNpmBuildWebGPUArtifacts, [
			'rm -rf "./npm_build/bin/full-webgpu";',
			'mkdir -p "./npm_build/bin/full-webgpu";',
			'cp "../../out/canvaskit_wasm_webgpu/canvaskit.js" "./npm_build/bin/full-webgpu/canvaskit.js";',
			'cp "../../out/canvaskit_wasm_webgpu/canvaskit.wasm" "./npm_build/bin/full-webgpu/canvaskit.wasm";',
		]),
	].filter((step) => step.includes("true"));
	runCanvasKitDockerSteps(dockerSteps);
	syncFullPackageArtifacts();
};

export const buildCanvasKitFastInDocker = () => {
	ensureDocker();
	ensureSkiaCheckout();
	applySkiaPatch();
	const shouldRebuildReleaseArtifacts = areArtifactsStale(
		releaseBuildInputs,
		getBundleArtifactPaths(releaseBuildDir),
	);
	const shouldRebuildWebGPUArtifacts = areArtifactsStale(
		webGPUBuildInputs,
		getBundleArtifactPaths(webGPUBuildDir),
	);
	const dockerSteps = [
		formatConditionalShell(shouldRebuildReleaseArtifacts, ["./compile.sh release;"]),
		formatConditionalShell(shouldRebuildWebGPUArtifacts, [
			"BUILD_DIR=out/canvaskit_wasm_webgpu ./compile.sh release webgpu;",
		]),
	].filter((step) => step.includes("true"));
	runCanvasKitDockerSteps(dockerSteps);
	syncFastPackageArtifacts();
};
