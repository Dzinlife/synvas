import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
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

const formatCommand = (command, args) =>
	[command, ...args].map((part) => JSON.stringify(part)).join(" ");

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
				path.join(
					skiaDir,
					"modules",
					"canvaskit",
					"npm_build",
					"types",
					"canvaskit-wasm-tests.ts",
				),
				"utf8",
			).includes('texture, "bgra8unorm", 800, 600,')
		);
	});
	applyGitPatch("CanvasKit WebGPU flag", canvasKitWebGPUFlagPatchFile, () => {
		return readFileSync(
			path.join(skiaDir, "modules", "canvaskit", "webgpu.js"),
			"utf8",
		).includes("CanvasKit.webgpu = true;");
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
			).includes("bool isDebugLog = false;") &&
			readFileSync(
				path.join(skiaDir, "src", "gpu", "graphite", "dawn", "DawnCaps.cpp"),
				"utf8",
			).includes("#if defined(__EMSCRIPTEN__)\n        info->fFlags &= ~FormatInfo::kStorage_Flag;")
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
