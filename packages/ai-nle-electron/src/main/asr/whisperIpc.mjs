import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { installWhisperCpp } from "@remotion/install-whisper-cpp";
import { app, ipcMain } from "electron";

const DEFAULT_MODEL = "large-v3-turbo";
const WHISPER_CPP_VERSION = "1.8.3";
const KEEP_TMP = process.env.AI_NLE_KEEP_WHISPER_TMP === "1";
const DEBUG = process.env.AI_NLE_WHISPER_DEBUG === "1";

const MODEL_URL_BY_SIZE = {
	"large-v3-turbo":
		"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
};

const jobs = new Map();

// 测试用：指定下次构建使用的 backend（coreml | metal），null 为自动。设置后会清除当前构建标记以触发重建。
let forcedBackend = null;

const toErrorMessage = (error) =>
	error instanceof Error ? error.message : String(error);

const logDebug = (...args) => {
	// if (!DEBUG) return;
	// 调试日志只在显式开启时输出
	console.log("[Whisper]", ...args);
};

const getWhisperCppDir = () =>
	path.join(app.getPath("userData"), "whisper.cpp");
const getAccelMarkerPath = (whisperDir) =>
	path.join(whisperDir, ".ai-nle-accel");
const getWhisperCliInstallPath = (whisperDir) => {
	const binDir = path.join(whisperDir, "build", "bin");
	const fileName =
		process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
	return { binDir, cliPath: path.join(binDir, fileName) };
};

const getDefaultModelPath = (modelSize) => {
	const baseDir = path.join(app.getPath("userData"), "models", "whisper");
	const fileName = `ggml-${modelSize}.bin`;
	return path.join(baseDir, fileName);
};

const getCoreMLModelPath = (modelSize) => {
	const baseDir = path.join(app.getPath("userData"), "models", "whisper");
	// CoreML encoder 模型目录
	const dirName = `ggml-${modelSize}-encoder.mlmodelc`;
	return path.join(baseDir, dirName);
};

const normalizeModel = (modelSize) =>
	modelSize === DEFAULT_MODEL ? modelSize : DEFAULT_MODEL;

const resolveModelPath = (modelSize) => {
	const candidate = process.env.AI_NLE_WHISPER_MODEL;
	if (candidate) return candidate;
	return getDefaultModelPath(normalizeModel(modelSize));
};

const getWhisperCliDownloadFileName = () => {
	if (process.platform === "darwin") {
		if (process.arch === "arm64") return "whisper-cli-darwin-arm64";
		if (process.arch === "x64") return "whisper-cli-darwin-x64";
		return null;
	}
	if (process.platform === "win32") {
		if (process.arch === "x64") return "whisper-cli-win32-x64.exe";
		return null;
	}
	if (process.platform === "linux") {
		if (process.arch === "x64") return "whisper-cli-linux-x64";
		return null;
	}
	return null;
};

const resolveWhisperCliDownloadUrl = () => {
	const direct = process.env.AI_NLE_WHISPER_CLI_DOWNLOAD_URL;
	if (direct) return direct;
	const key = `${process.platform}_${process.arch}`
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "_");
	const perArch = process.env[`AI_NLE_WHISPER_CLI_DOWNLOAD_URL_${key}`];
	if (perArch) return perArch;
	const base = process.env.AI_NLE_WHISPER_CLI_DOWNLOAD_BASE;
	if (!base) return null;
	const fileName = getWhisperCliDownloadFileName();
	if (!fileName) return null;
	return `${base.replace(/\/$/, "")}/${fileName}`;
};

const fileExists = async (filePath) => {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
};

const dirExists = async (dirPath) => {
	try {
		const stat = await fs.stat(dirPath);
		return stat.isDirectory();
	} catch {
		return false;
	}
};

const getWhisperCliCandidates = (baseDir) => {
	const binDir = path.join(baseDir, "build", "bin");
	return [
		path.join(binDir, "whisper-cli"),
		path.join(binDir, "whisper-cli.exe"),
		path.join(binDir, "Release", "whisper-cli.exe"),
		path.join(binDir, "Release", "whisper-cli"),
		path.join(binDir, "main"),
		path.join(binDir, "main.exe"),
		path.join(binDir, "Release", "main.exe"),
	];
};

const findWhisperCliInDir = async (baseDir) => {
	for (const candidate of getWhisperCliCandidates(baseDir)) {
		if (await fileExists(candidate)) {
			return candidate;
		}
	}
	return null;
};

const findWhisperCliInPath = async () => {
	const tool = process.platform === "win32" ? "where" : "which";
	const child = spawn(tool, ["whisper-cli"], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	const stdoutPromise = collectText(child.stdout);
	const exit = await new Promise((resolve) => {
		child.on("exit", (code) => resolve({ code }));
		child.on("error", () => resolve({ code: 1 }));
	});
	if (exit.code !== 0) return null;
	const stdout = (await stdoutPromise).trim();
	if (!stdout) return null;
	const firstLine = stdout.split(/\r?\n/)[0];
	return firstLine || null;
};

const resolveWhisperCli = async () => {
	const envPath = process.env.AI_NLE_WHISPER_CLI;
	if (envPath) {
		if (await fileExists(envPath)) return envPath;
	}
	const localPath = await findWhisperCliInDir(getWhisperCppDir());
	if (localPath) return localPath;
	if (process.platform === "darwin") {
		return null;
	}
	const systemPath = await findWhisperCliInPath();
	if (systemPath) return systemPath;
	return null;
};

const downloadFile = async (url, targetPath, label) => {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`${label}下载失败：${res.status} ${res.statusText}`);
	}
	await fs.mkdir(path.dirname(targetPath), { recursive: true });

	const tmpPath = `${targetPath}.download`;
	try {
		await fs.rm(tmpPath, { force: true });
	} catch {}

	if (!res.body) {
		const buffer = Buffer.from(await res.arrayBuffer());
		await fs.writeFile(tmpPath, buffer);
		await fs.rename(tmpPath, targetPath);
		return;
	}

	const readable = Readable.fromWeb(res.body);
	const writer = createWriteStream(tmpPath);
	await pipeline(readable, writer);
	await fs.rename(tmpPath, targetPath);
};

const downloadWhisperCli = async (whisperDir) => {
	const url = resolveWhisperCliDownloadUrl();
	if (!url) return null;
	const { binDir, cliPath } = getWhisperCliInstallPath(whisperDir);
	if (await fileExists(cliPath)) return cliPath;
	await fs.mkdir(binDir, { recursive: true });
	await downloadFile(url, cliPath, "Whisper 引擎");
	if (process.platform !== "win32") {
		await fs.chmod(cliPath, 0o755);
	}
	if (process.platform === "darwin") {
		const marker = getAccelMarkerPath(whisperDir);
		if (!(await fileExists(marker))) {
			await fs.writeFile(marker, "metal=prebuilt");
		}
	}
	return cliPath;
};

const ensureWhisperCli = async (modelSize = DEFAULT_MODEL) => {
	const existing = await resolveWhisperCli();
	if (existing) {
		const whisperDir = getWhisperCppDir();
		if (existing.startsWith(whisperDir)) {
			await ensureAcceleratedBuild(whisperDir, modelSize);
			const rebuilt = await findWhisperCliInDir(whisperDir);
			return rebuilt || existing;
		}
		return existing;
	}

	const whisperDir = getWhisperCppDir();
	// const downloaded = await downloadWhisperCli(whisperDir);
	// if (downloaded) return downloaded;
	// if (process.platform === "darwin") {
	// 	throw new Error(
	// 		"未配置预编译 Whisper 引擎下载地址，请先设置下载地址后重试。",
	// 	);
	// }

	const existed = await dirExists(whisperDir);
	if (existed) {
		await ensureAcceleratedBuild(whisperDir, modelSize);
		const cli = await findWhisperCliInDir(whisperDir);
		if (cli) return cli;
		// 目录存在但不完整，尝试清理后重新安装
		logDebug("目录存在但未找到可执行文件，尝试清理重装", whisperDir);
		try {
			await fs.rm(whisperDir, { recursive: true, force: true });
		} catch {
			throw new Error(
				`本地引擎目录已存在但未找到可执行文件，且无法清理目录，请手动删除后重试：${whisperDir}`,
			);
		}
	}

	await installWhisperCpp({
		to: whisperDir,
		version: WHISPER_CPP_VERSION,
		printOutput: false,
	});
	await ensureAcceleratedBuild(whisperDir, modelSize);

	const installed = await findWhisperCliInDir(whisperDir);
	if (!installed) {
		throw new Error(
			`安装 Whisper.cpp 后仍未找到可执行文件，请删除后重试：${whisperDir}`,
		);
	}
	return installed;
};

async function collectText(stream) {
	if (!stream) return "";
	let text = "";
	for await (const chunk of stream) {
		text += chunk.toString();
	}
	return text;
}

const runCommand = async (command, args, options) => {
	const child = spawn(command, args, {
		cwd: options?.cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const stdoutPromise = collectText(child.stdout);
	const stderrPromise = collectText(child.stderr);
	const exit = await new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("exit", (code, signal) => resolve({ code, signal }));
	});
	if (exit.signal) {
		throw new Error(`${command} 被中断`);
	}
	if (exit.code !== 0) {
		const stderr = await stderrPromise;
		const stdout = await stdoutPromise;
		const message = (stderr || stdout || "").trim();
		throw new Error(message || `${command} 执行失败`);
	}
};

// 检查 Python 命令是否可用
const findPython = async () => {
	for (const cmd of ["python3", "python"]) {
		try {
			const child = spawn(cmd, ["--version"], {
				stdio: ["ignore", "pipe", "pipe"],
			});
			const exit = await new Promise((resolve) => {
				child.on("exit", (code) => resolve({ code }));
				child.on("error", () => resolve({ code: 1 }));
			});
			if (exit.code === 0) return cmd;
		} catch {}
	}
	return null;
};

// 检查 Python 包是否已安装
const checkPythonPackage = async (python, packageName) => {
	try {
		const child = spawn(python, ["-c", `import ${packageName}`], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const exit = await new Promise((resolve) => {
			child.on("exit", (code) => resolve({ code }));
			child.on("error", () => resolve({ code: 1 }));
		});
		return exit.code === 0;
	} catch {
		return false;
	}
};

// 安装 Python 包
const installPythonPackages = async (python, packages) => {
	logDebug("安装 Python 包", packages);
	await runCommand(python, ["-m", "pip", "install", "--upgrade", ...packages]);
};

// 将 Whisper 模型名转换为 openai-whisper 格式
const toWhisperModelName = (modelSize) => {
	// large-v3-turbo -> turbo, large-v3 -> large-v3
	if (modelSize === "large-v3-turbo") return "turbo";
	return modelSize.replace("ggml-", "").replace(".bin", "");
};

// 编译 CoreML 模型
const compileCoreMLModel = async (whisperDir, modelSize) => {
	if (process.platform !== "darwin") return null;

	const coremlPath = getCoreMLModelPath(modelSize);
	// 检查是否已存在
	if (await dirExists(coremlPath)) {
		logDebug("CoreML 模型已存在", coremlPath);
		return coremlPath;
	}

	logDebug("开始编译 CoreML 模型", modelSize);

	const python = await findPython();
	if (!python) {
		logDebug("未找到 Python，跳过 CoreML 编译");
		return null;
	}

	// 检查必要的 Python 包
	const requiredPackages = [
		"coremltools",
		"ane_transformers",
		"openai_whisper",
	];
	const missingPackages = [];
	for (const pkg of requiredPackages) {
		if (!(await checkPythonPackage(python, pkg))) {
			// pip 包名和 import 名可能不同
			const pipName = pkg === "openai_whisper" ? "openai-whisper" : pkg;
			missingPackages.push(pipName);
		}
	}

	if (missingPackages.length > 0) {
		try {
			await installPythonPackages(python, missingPackages);
		} catch (error) {
			logDebug("安装 Python 包失败", toErrorMessage(error));
			return null;
		}
	}

	// 使用 whisper.cpp 的 generate-coreml-model.sh 脚本
	const scriptPath = path.join(
		whisperDir,
		"models",
		"generate-coreml-model.sh",
	);
	if (!(await fileExists(scriptPath))) {
		logDebug("未找到 CoreML 生成脚本", scriptPath);
		return null;
	}

	const whisperModelName = toWhisperModelName(modelSize);
	const modelsDir = path.join(whisperDir, "models");

	try {
		// 运行生成脚本
		logDebug("运行 CoreML 生成脚本", whisperModelName);
		await runCommand("bash", [scriptPath, whisperModelName], {
			cwd: modelsDir,
		});

		// 脚本会在 models 目录生成文件，移动到目标位置
		const generatedPath = path.join(
			modelsDir,
			`ggml-${modelSize}-encoder.mlmodelc`,
		);
		// 也可能是用原始名称
		const altGeneratedPath = path.join(
			modelsDir,
			`ggml-${whisperModelName}-encoder.mlmodelc`,
		);

		let sourcePath = null;
		if (await dirExists(generatedPath)) {
			sourcePath = generatedPath;
		} else if (await dirExists(altGeneratedPath)) {
			sourcePath = altGeneratedPath;
		}

		if (sourcePath) {
			await fs.mkdir(path.dirname(coremlPath), { recursive: true });
			await fs.rename(sourcePath, coremlPath);
			logDebug("CoreML 模型编译完成", coremlPath);
			return coremlPath;
		}

		logDebug("CoreML 模型生成后未找到输出文件");
		return null;
	} catch (error) {
		logDebug("CoreML 模型编译失败", toErrorMessage(error));
		return null;
	}
};

// GPU 加速选项，按优先级排序：CoreML > Metal
const ACCEL_OPTIONS = [
	{
		name: "coreml",
		flags: ["-DWHISPER_COREML=1", "-DGGML_METAL=1"],
		requiresCoreML: true,
	},
	{ name: "metal", flags: ["-DGGML_METAL=1"], requiresCoreML: false },
	{ name: "metal-alt", flags: ["-DGGML_USE_METAL=1"], requiresCoreML: false },
];

const ensureAcceleratedBuild = async (
	whisperDir,
	modelSize = DEFAULT_MODEL,
) => {
	if (process.platform !== "darwin") return;
	if (!(await fileExists(path.join(whisperDir, "CMakeLists.txt")))) return;
	const marker = getAccelMarkerPath(whisperDir);
	if (await fileExists(marker)) return;

	// 始终构建一份支持 CoreML+Metal 的二进制，Metal/CoreML 在运行时通过是否加载 .mlmodelc 切换
	const options = ACCEL_OPTIONS;

	// 尝试编译 CoreML 模型（即使失败也继续，会回退到 Metal）
	const coremlPath = await compileCoreMLModel(whisperDir, modelSize);
	const hasCoreML = coremlPath && (await dirExists(coremlPath));
	logDebug("CoreML 模型状态", hasCoreML ? "可用" : "不可用");

	const buildOnce = async (option) => {
		// 如果选项需要 CoreML 但没有 CoreML 模型，跳过
		if (option.requiresCoreML && !hasCoreML) {
			throw new Error("CoreML 模型不可用");
		}
		logDebug(`尝试启用 ${option.name} 构建`, option.flags);
		// 清理之前的构建目录，避免 cmake 缓存问题
		const buildDir = path.join(whisperDir, "build");
		try {
			await fs.rm(buildDir, { recursive: true, force: true });
		} catch {}
		await runCommand(
			"cmake",
			["-B", "build", ...option.flags, "-DCMAKE_BUILD_TYPE=Release"],
			{ cwd: whisperDir },
		);
		await runCommand(
			"cmake",
			["--build", "build", "-j", "--config", "Release"],
			{ cwd: whisperDir },
		);
		await fs.writeFile(marker, `accel=${option.name}`);
	};

	let lastError = null;
	for (const option of options) {
		try {
			await buildOnce(option);
			return;
		} catch (error) {
			logDebug(`${option.name} 构建失败`, toErrorMessage(error));
			lastError = error;
		}
	}

	throw new Error(
		`启用 GPU 加速失败，请安装 Xcode 命令行工具与 cmake 后重试：${lastError ? toErrorMessage(lastError) : ""}`,
	);
};

const normalizeSegmentsFromJson = (json, durationSeconds) => {
	const asArray = (value) => (Array.isArray(value) ? value : null);
	const asObject = (value) =>
		value && typeof value === "object" && !Array.isArray(value) ? value : null;

	const roots = [
		json,
		asObject(json?.result),
		asObject(json?.transcription),
		asObject(json?.data),
		asObject(json?.output),
	].filter(Boolean);

	const candidates = [];
	for (const root of roots) {
		const found = [
			asArray(root?.segments),
			asArray(root?.transcription),
			asArray(root?.results),
			asArray(root?.data),
		].filter(Boolean);
		candidates.push(...found);
	}
	const fallbackArray = asArray(json);
	if (fallbackArray) candidates.push(fallbackArray);

	const rawSegments = candidates[0] || [];

	const toNumber = (v) => {
		if (typeof v === "number" && Number.isFinite(v)) return v;
		if (typeof v === "string") {
			const trimmed = v.trim();
			if (!trimmed) return null;
			const cleaned = trimmed.replace(",", ".");
			const asNumber = Number(cleaned);
			if (Number.isFinite(asNumber)) return asNumber;
			const parts = cleaned.split(":");
			if (parts.length >= 2 && parts.length <= 3) {
				const nums = parts.map((part) => Number(part));
				if (nums.some((n) => !Number.isFinite(n))) return null;
				const [a, b, c] = nums.length === 3 ? nums : [0, nums[0], nums[1]];
				return a * 3600 + b * 60 + c;
			}
		}
		return null;
	};
	const toText = (v) => (v === null || v === undefined ? "" : String(v));

	const readTime = (seg, keys) => {
		for (const key of keys) {
			const direct = toNumber(seg?.[key]);
			if (direct !== null) return direct;
		}
		const timestamps = seg?.timestamps;
		if (timestamps && typeof timestamps === "object") {
			const from = toNumber(timestamps.from ?? timestamps.start);
			const to = toNumber(timestamps.to ?? timestamps.end);
			if (from !== null && keys.includes("start")) return from;
			if (to !== null && keys.includes("end")) return to;
		}
		const offsets = seg?.offsets;
		if (offsets && typeof offsets === "object") {
			// offsets 通常是毫秒
			const from = toNumber(offsets.from ?? offsets.start);
			const to = toNumber(offsets.to ?? offsets.end);
			if (from !== null && keys.includes("start")) return from / 1000;
			if (to !== null && keys.includes("end")) return to / 1000;
		}
		return null;
	};

	const segments = rawSegments
		.map((seg) => {
			const start = readTime(seg, ["start", "t0"]);
			const end = readTime(seg, ["end", "t1"]);
			const text = toText(seg?.text ?? seg?.transcript ?? seg?.sentence ?? "");
			if (start === null || end === null) return null;
			return {
				start,
				end,
				text,
				words: Array.isArray(seg?.words)
					? seg.words
							.map((w) => {
								const wStart = toNumber(w?.start ?? w?.t0);
								const wEnd = toNumber(w?.end ?? w?.t1);
								const wText = toText(w?.word ?? w?.text ?? "");
								if (wStart === null || wEnd === null) return null;
								return { start: wStart, end: wEnd, text: wText };
							})
							.filter(Boolean)
					: undefined,
			};
		})
		.filter(Boolean);

	if (segments.length > 0) return segments;

	const readText = (value) =>
		typeof value === "string" && value.trim() ? value.trim() : null;

	const text =
		readText(json?.text) ||
		readText(json?.transcription) ||
		readText(json?.result) ||
		readText(json?.results) ||
		readText(json?.result?.text) ||
		readText(json?.result?.transcription) ||
		readText(json?.output?.text) ||
		null;

	if (!text) return [];

	const end =
		typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
			? durationSeconds
			: 0;
	return [
		{
			start: 0,
			end,
			text,
		},
	];
};

const parseTimestampToSeconds = (value) => {
	if (value === null || value === undefined) return null;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return null;
	const cleaned = value.trim().replace(",", ".");
	if (!cleaned) return null;
	const asNumber = Number(cleaned);
	if (Number.isFinite(asNumber)) return asNumber;
	const parts = cleaned.split(":");
	if (parts.length >= 2 && parts.length <= 3) {
		const nums = parts.map((part) => Number(part));
		if (nums.some((n) => !Number.isFinite(n))) return null;
		const [a, b, c] = nums.length === 3 ? nums : [0, nums[0], nums[1]];
		return a * 3600 + b * 60 + c;
	}
	return null;
};

const parseSegmentFromConsoleLine = (line) => {
	if (!line) return null;
	const match = line.match(/^\s*\[(.+?)\s*-->\s*(.+?)\]\s*(.*)$/);
	if (!match) return null;
	const start = parseTimestampToSeconds(match[1]);
	const end = parseTimestampToSeconds(match[2]);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	const text = match[3]?.trim() ?? "";
	if (!text) return null;
	return { start, end, text };
};

const attachLineListener = (stream, onLine) => {
	if (!stream) return;
	let buffer = "";
	stream.on("data", (chunk) => {
		buffer += chunk.toString();
		const parts = buffer.split(/\r?\n/);
		buffer = parts.pop() ?? "";
		for (const part of parts) {
			onLine(part);
		}
	});
	stream.on("end", () => {
		const tail = buffer.trim();
		if (tail) onLine(tail);
	});
};

const findJsonOutput = async (tmpDir, outPrefix) => {
	const direct = `${outPrefix}.json`;
	if (await fileExists(direct)) return direct;

	const files = await fs.readdir(tmpDir);
	const candidate = files.find((name) => name.toLowerCase().endsWith(".json"));
	return candidate ? path.join(tmpDir, candidate) : null;
};

const findTextOutput = async (tmpDir, outPrefix) => {
	const direct = `${outPrefix}.txt`;
	if (await fileExists(direct)) return direct;

	const files = await fs.readdir(tmpDir);
	const candidate = files.find((name) => name.toLowerCase().endsWith(".txt"));
	return candidate ? path.join(tmpDir, candidate) : null;
};

// 从 whisper 输出的 systeminfo 推断当前实际使用的后端
// 注意：无 .mlmodelc 时实际为 Metal，但 systeminfo 可能只含编译期 "Core ML"，需严格按“实际在用”判断
const detectBackend = (systeminfo) => {
	const info = String(systeminfo ?? "").toLowerCase();
	// 1. CoreML 加载失败 → 实际必为 Metal 回退
	if (/failed\s+to\s+load\s+core\s*ml/.test(info)) return "metal";
	// 2. 出现 Metal → 以 Metal 为准（含 "using Metal backend" 或编译信息里的 Metal）
	if (/metal/.test(info)) return "metal";
	// 3. 仅在有“CoreML 实际在用”的证据时才判为 coreml（如 loaded、.mlmodelc、encoder），否则视为 Metal
	const hasCoreMl = /core\s*ml|coreml/.test(info);
	const coreMlInUse =
		/loaded.*core\s*ml|core\s*ml.*loaded|\.mlmodelc|encoder.*core\s*ml|core\s*ml.*encoder/i.test(
			info,
		);
	if (hasCoreMl && coreMlInUse) return "coreml";
	if (hasCoreMl) return "metal";
	if (/cuda|vulkan|gpu/.test(info)) return "gpu";
	return "cpu";
};

const cleanupJob = async (job) => {
	if (!job?.tmpDir) return;
	if (KEEP_TMP) {
		logDebug("保留临时目录", job.tmpDir);
		return;
	}
	try {
		await fs.rm(job.tmpDir, { recursive: true, force: true });
	} catch {}
};

const downloadModel = async (url, targetPath) => {
	await downloadFile(url, targetPath, "模型");
};

// 启动时恢复可能因中途退出而未恢复的 CoreML 模型（.mlmodelc.bak → .mlmodelc）
const restoreCoreMLModelsIfNeeded = async () => {
	if (process.platform !== "darwin") return;
	const baseDir = path.join(app.getPath("userData"), "models", "whisper");
	try {
		const entries = await fs.readdir(baseDir, { withFileTypes: true });
		for (const ent of entries) {
			if (!ent.isDirectory() || !ent.name.endsWith(".mlmodelc.bak")) continue;
			const bakPath = path.join(baseDir, ent.name);
			const restorePath = bakPath.replace(/\.bak$/, "");
			try {
				await fs.rename(bakPath, restorePath);
				logDebug("启动时已恢复 CoreML 模型", restorePath);
			} catch {}
		}
	} catch {
		// 目录不存在或不可读则忽略
	}
};

export const registerWhisperIpc = () => {
	restoreCoreMLModelsIfNeeded();

	// 指定 backend：darwin 可选 coreml | metal | cpu，windows/linux 可选 gpu | cpu，null 自动。Metal/CoreML 在运行时切换，无需重建。
	ipcMain.handle("asr:whisper:setBackend", (_event, backend) => {
		const valid = ["coreml", "metal", "gpu", "cpu"].includes(backend);
		const next = valid ? backend : null;
		forcedBackend = next;
		logDebug("已指定 backend:", next);
		return { ok: true, backend: forcedBackend };
	});

	ipcMain.handle("asr:whisper:getBackend", () => ({
		backend: forcedBackend,
	}));

	ipcMain.on("asr:whisper:abort", (_event, requestId) => {
		const job = jobs.get(requestId);
		if (!job) return;
		try {
			job.child?.kill();
		} catch {}
	});

	ipcMain.handle("asr:whisper:checkReady", async (_event, payload) => {
		try {
			const modelSize = normalizeModel(payload?.model);
			const modelPath = resolveModelPath(modelSize);
			let cliPath = await resolveWhisperCli();
			const whisperDir = getWhisperCppDir();
			if (cliPath && cliPath.startsWith(whisperDir)) {
				await ensureAcceleratedBuild(whisperDir, modelSize);
				cliPath = await findWhisperCliInDir(whisperDir);
			}
			const hasModel = await fileExists(modelPath);
			if (!cliPath || !hasModel) {
				const issues = [];
				if (!cliPath) {
					if (
						process.platform === "darwin" &&
						!resolveWhisperCliDownloadUrl()
					) {
						issues.push("未配置预编译 Whisper 引擎下载地址");
					} else {
						issues.push("未安装本地 Whisper 引擎");
					}
				}
				if (!hasModel) {
					issues.push(`未找到模型文件：${modelPath}`);
				}
				const downloadUrl = MODEL_URL_BY_SIZE[modelSize];
				const cliDownloadUrl = resolveWhisperCliDownloadUrl();
				return {
					ok: false,
					message: issues.join("；"),
					canDownload: Boolean(downloadUrl || cliDownloadUrl),
					modelPath,
					downloadUrl,
				};
			}
			return { ok: true };
		} catch (error) {
			return { ok: false, message: toErrorMessage(error) };
		}
	});

	ipcMain.handle("asr:whisper:download", async (_event, payload) => {
		try {
			const modelSize = normalizeModel(payload?.model);
			const downloadUrl = MODEL_URL_BY_SIZE[modelSize];
			if (!downloadUrl) {
				return { ok: false, message: "未知模型类型，无法下载" };
			}
			await ensureWhisperCli(modelSize);
			const targetPath = resolveModelPath(modelSize);
			if (!(await fileExists(targetPath))) {
				await downloadModel(downloadUrl, targetPath);
			}
			return { ok: true, path: targetPath };
		} catch (error) {
			return { ok: false, message: toErrorMessage(error) };
		}
	});

	ipcMain.handle("asr:whisper:transcribe", async (_event, payload) => {
		const requestId = payload?.requestId;
		if (!requestId) {
			throw new Error("缺少 requestId");
		}

		const cli = await resolveWhisperCli();
		if (!cli) {
			throw new Error("未安装本地 Whisper 引擎，请先确认下载");
		}
		const modelPath = resolveModelPath(payload?.model);
		const language = payload?.language;

		// 指定 CoreML 时，开始前检查 .mlmodelc 是否存在，不存在则直接报错
		if (process.platform === "darwin" && forcedBackend === "coreml") {
			const modelSize = normalizeModel(payload?.model);
			const coremlPath = getCoreMLModelPath(modelSize);
			if (!(await dirExists(coremlPath))) {
				throw new Error(
					`已指定 CoreML 但未找到 CoreML 模型，请先编译：${coremlPath}`,
				);
			}
		}

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-nle-whisper-"));
		logDebug("临时目录", tmpDir);
		const wavPath = path.join(tmpDir, "audio.wav");
		const outPrefix = path.join(tmpDir, "out");

		const job = { child: null, tmpDir, coremlRestorePath: null };
		jobs.set(requestId, job);

		try {
			const wavBytes = payload?.wavBytes;
			if (!(wavBytes instanceof ArrayBuffer)) {
				throw new Error("wavBytes 必须是 ArrayBuffer");
			}
			await fs.writeFile(wavPath, Buffer.from(wavBytes));

			// 运行时强制 Metal：临时重命名 .mlmodelc，whisper 找不到则回退到 Metal，转写结束后恢复
			if (process.platform === "darwin" && forcedBackend === "metal") {
				const modelSize = normalizeModel(payload?.model);
				const coremlPath = getCoreMLModelPath(modelSize);
				if (await dirExists(coremlPath)) {
					const bakPath = `${coremlPath}.bak`;
					try {
						await fs.rename(coremlPath, bakPath);
						job.coremlRestorePath = coremlPath;
						logDebug("已临时隐藏 CoreML 模型以强制 Metal", coremlPath);
					} catch {}
				}
			}

			const transcribeStartMs = Date.now();
			const args = [
				"-m",
				modelPath,
				"-f",
				wavPath,
				"-oj",
				"-of",
				outPrefix,
				"-ml",
				"1",
				"-sow",
			];
			// 指定 CPU 时禁用 GPU（darwin 上即禁用 Metal/CoreML）
			if (forcedBackend === "cpu") {
				args.push("--no-gpu");
			}
			if (language && language !== "auto") {
				args.push("-l", language);
			}

			const child = spawn(cli, args, {
				stdio: ["ignore", "pipe", "pipe"],
			});
			job.child = child;

			const sender = _event.sender;
			const seen = new Set();
			attachLineListener(child.stdout, (line) => {
				const segment = parseSegmentFromConsoleLine(line);
				if (!segment) return;
				const key = `${segment.start}-${segment.end}-${segment.text}`;
				if (seen.has(key)) return;
				seen.add(key);
				try {
					sender.send("asr:whisper:segment", {
						requestId,
						segment,
					});
				} catch {}
			});

			const stderrPromise = collectText(child.stderr);

			const exit = await new Promise((resolve, reject) => {
				child.on("error", reject);
				child.on("exit", (code, signal) => resolve({ code, signal }));
			});

			const stderr = await stderrPromise;

			if (exit.signal) {
				throw new Error("已取消");
			}
			if (exit.code !== 0) {
				throw new Error(stderr || `whisper-cli 退出码：${exit.code}`);
			}

			const jsonPath = await findJsonOutput(tmpDir, outPrefix);
			logDebug("JSON 输出路径", jsonPath);
			if (!jsonPath) {
				if (DEBUG) {
					const files = await fs.readdir(tmpDir);
					logDebug("输出文件", files);
				}
				throw new Error("未找到 whisper 输出 JSON");
			}

			const content = await fs.readFile(jsonPath, "utf8");
			const parsed = JSON.parse(content);
			const systeminfo = String(parsed?.systeminfo ?? "");
			if (process.platform === "darwin" && forcedBackend !== "cpu") {
				// 未指定 CPU 时，检查 CoreML 或 Metal 加速是否启用
				if (!/coreml|metal/i.test(systeminfo)) {
					throw new Error("未检测到 GPU 加速，请重新安装本地引擎");
				}
			}
			// 指定了 CPU（传了 --no-gpu）则显示 cpu；否则按输出推断
			const backend =
				forcedBackend === "cpu" ? "cpu" : detectBackend(systeminfo);
			const durationMs = Date.now() - transcribeStartMs;
			// 始终打印当前使用的后端和处理时间，便于确认
			console.log(
				"[Whisper] 后端:",
				backend,
				"| 处理耗时:",
				(durationMs / 1000).toFixed(2),
				"s",
			);
			const segments = normalizeSegmentsFromJson(parsed, payload?.duration);
			return { segments, backend, durationMs };
		} finally {
			// 恢复临时重命名的 CoreML 模型
			if (job.coremlRestorePath) {
				const bakPath = `${job.coremlRestorePath}.bak`;
				try {
					await fs.rename(bakPath, job.coremlRestorePath);
					logDebug("已恢复 CoreML 模型", job.coremlRestorePath);
				} catch {}
			}
			jobs.delete(requestId);
			await cleanupJob(job);
		}
	});
};
