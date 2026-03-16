import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
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
export const dockerfileDir = path.join(packageDir, "docker", "canvaskit-emsdk");
export const dockerBaseImage =
	process.env.AI_NLE_CANVASKIT_DOCKER_BASE_IMAGE ?? "emscripten/emsdk:3.1.26";
export const dockerImage =
	process.env.AI_NLE_CANVASKIT_DOCKER_IMAGE ?? "ai-nle-canvaskit-emsdk:3.1.26";

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

export const applySkiaPatch = () => {
	const forwardCheck = spawnSync("git", ["-C", skiaDir, "apply", "--check", patchFile], {
		stdio: "ignore",
	});
	if (forwardCheck.status === 0) {
		run("git", ["-C", skiaDir, "apply", patchFile]);
		return;
	}
	const reverseCheck = spawnSync(
		"git",
		["-C", skiaDir, "apply", "--reverse", "--check", patchFile],
		{ stdio: "ignore" },
	);
	if (reverseCheck.status === 0) {
		console.log("Skia patch already applied.");
		return;
	}
	throw new Error("Failed to apply Skia patch. Please inspect the checkout state.");
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
};

export const buildCanvasKitInDocker = () => {
	ensureDocker();
	ensureSkiaCheckout();
	applySkiaPatch();
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
		"python3 /SRC/tools/git-sync-deps && cd /SRC/modules/canvaskit && make npm",
	]);
	syncPackageArtifacts();
};
