import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
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
			).includes("texture: GPUTexture, textureFormat: GPUTextureFormat,") &&
			readFileSync(
				path.join(skiaDir, "modules", "canvaskit", "npm_build", "types", "index.d.ts"),
				"utf8",
			).includes("canvas: HTMLCanvasElement | OffscreenCanvas,") &&
			readFileSync(
				path.join(skiaDir, "modules", "canvaskit", "npm_build", "types", "index.d.ts"),
				"utf8",
			).includes('export interface WebGPUDeviceContext extends EmbindObject<"WebGPUDeviceContext">') &&
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
			).includes('texture, "bgra8unorm", 800, 600,') &&
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
			).includes("const submitResult = gpuContext.submit();")
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
			).includes('"_MakeWebGPUDeviceContext"') &&
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
		).includes("var context = this._MakeWebGPUDeviceContext();") &&
			readFileSync(path.join(skiaDir, "modules", "canvaskit", "webgpu.js"), "utf8").includes(
				"texture.usage,",
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
				"CanvasKit.Surface.prototype.assignCurrentSwapChainTexture = function() {\n        return false;",
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

export const syncPackageArtifacts = () => {
	const npmBuildDir = path.join(skiaDir, "modules", "canvaskit", "npm_build");
	const sourceBinDir = path.join(npmBuildDir, "bin");
	const sourceTypesDir = path.join(npmBuildDir, "types");
	if (!existsSync(sourceBinDir) || !existsSync(sourceTypesDir)) {
		throw new Error("CanvasKit npm_build artifacts are missing. Run build:docker first.");
	}
	rmSync(path.join(packageDir, "bin"), { recursive: true, force: true });
	rmSync(path.join(packageDir, "types"), { recursive: true, force: true });
	cpSync(sourceBinDir, path.join(packageDir, "bin"), { recursive: true });
	cpSync(sourceTypesDir, path.join(packageDir, "types"), { recursive: true });
	const packageBinDir = path.join(packageDir, "bin");
	const packageDefaultBinDir = path.join(packageBinDir, "full");
	const packageWebGPUJsFile = path.join(packageBinDir, "full-webgpu", "canvaskit.js");
	const packageRootJsFile = path.join(packageBinDir, "canvaskit.js");
	const packageRootWasmFile = path.join(packageBinDir, "canvaskit.wasm");
	ensureWebGPUJsValStoreInterop(packageWebGPUJsFile);
	if (!existsSync(packageRootJsFile) && existsSync(path.join(packageDefaultBinDir, "canvaskit.js"))) {
		cpSync(path.join(packageDefaultBinDir, "canvaskit.js"), packageRootJsFile);
	}
	if (
		!existsSync(packageRootWasmFile) &&
		existsSync(path.join(packageDefaultBinDir, "canvaskit.wasm"))
	) {
		cpSync(path.join(packageDefaultBinDir, "canvaskit.wasm"), packageRootWasmFile);
	}
	rmSync(
		path.join(
			repoRoot,
			"packages",
			"web",
			"node_modules",
			".vite",
			"deps",
			"canvaskit-wasm_bin_full_canvaskit.js",
		),
		{ force: true },
	);
	rmSync(
		path.join(
			repoRoot,
			"packages",
			"web",
			"node_modules",
			".vite",
			"deps",
			"canvaskit-wasm_bin_full_canvaskit.js.map",
		),
		{ force: true },
	);
	rmSync(
		path.join(
			repoRoot,
			"packages",
			"web",
			"node_modules",
			".vite",
			"deps",
			"canvaskit-wasm_bin_full-webgl_canvaskit.js",
		),
		{ force: true },
	);
	rmSync(
		path.join(
			repoRoot,
			"packages",
			"web",
			"node_modules",
			".vite",
			"deps",
			"canvaskit-wasm_bin_full-webgl_canvaskit.js.map",
		),
		{ force: true },
	);
	rmSync(
		path.join(
			repoRoot,
			"packages",
			"web",
			"node_modules",
			".vite",
			"deps",
			"canvaskit-wasm_bin_full-webgpu_canvaskit.js",
		),
		{ force: true },
	);
	rmSync(
		path.join(
			repoRoot,
			"packages",
			"web",
			"node_modules",
			".vite",
			"deps",
			"canvaskit-wasm_bin_full-webgpu_canvaskit.js.map",
		),
		{ force: true },
	);
};

export const buildCanvasKitInDocker = () => {
	ensureDocker();
	ensureSkiaCheckout();
	applySkiaPatch();
	const npmBuildDir = path.join(skiaDir, "modules", "canvaskit", "npm_build");
	const npmBuildTypesFile = path.join(npmBuildDir, "types", "index.d.ts");
	const npmBuildFullJsFile = path.join(npmBuildDir, "bin", "full", "canvaskit.js");
	const npmBuildFullWasmFile = path.join(npmBuildDir, "bin", "full", "canvaskit.wasm");
	const npmBuildInputs = [
		path.join(skiaDir, "modules", "canvaskit", "BUILD.gn"),
		path.join(skiaDir, "modules", "canvaskit", "canvaskit_bindings.cpp"),
		path.join(skiaDir, "modules", "canvaskit", "externs.js"),
		path.join(skiaDir, "modules", "canvaskit", "font.js"),
		path.join(skiaDir, "modules", "canvaskit", "webgpu.js"),
		path.join(npmBuildDir, "types", "index.d.ts"),
		path.join(npmBuildDir, "types", "canvaskit-wasm-tests.ts"),
	];
	const npmBuildFullJsMTime = existsSync(npmBuildFullJsFile)
		? statSync(npmBuildFullJsFile).mtimeMs
		: 0;
	const shouldRebuildNpmArtifacts =
		!existsSync(npmBuildTypesFile) ||
		!existsSync(npmBuildFullJsFile) ||
		!existsSync(npmBuildFullWasmFile) ||
		npmBuildInputs.some((file) => existsSync(file) && statSync(file).mtimeMs > npmBuildFullJsMTime);
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
			[
				`if ${shouldRebuildNpmArtifacts ? "true" : "false"}; then`,
				'rm -rf "./npm_build/bin";',
				"make npm;",
				"fi",
			].join(" "),
			"rm -rf ./npm_build/bin/full-webgl ./npm_build/bin/full-webgpu",
			"cp -R ./npm_build/bin/full ./npm_build/bin/full-webgl",
			"mkdir -p ./npm_build/bin/full-webgpu",
			"BUILD_DIR=out/canvaskit_wasm_webgpu ./compile.sh release webgpu",
			"cp ../../out/canvaskit_wasm_webgpu/canvaskit.js ./npm_build/bin/full-webgpu",
			"cp ../../out/canvaskit_wasm_webgpu/canvaskit.wasm ./npm_build/bin/full-webgpu",
		].join(" && "),
	]);
	syncPackageArtifacts();
};
