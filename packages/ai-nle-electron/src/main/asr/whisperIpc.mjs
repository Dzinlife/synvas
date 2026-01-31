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

const toErrorMessage = (error) =>
	error instanceof Error ? error.message : String(error);

const logDebug = (...args) => {
	if (!DEBUG) return;
	// 调试日志只在显式开启时输出
	console.log("[Whisper]", ...args);
};

const getWhisperCppDir = () =>
	path.join(app.getPath("userData"), "whisper.cpp");
const getMetalMarkerPath = (whisperDir) =>
	path.join(whisperDir, ".ai-nle-metal");
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
		const marker = getMetalMarkerPath(whisperDir);
		if (!(await fileExists(marker))) {
			await fs.writeFile(marker, "metal=prebuilt");
		}
	}
	return cliPath;
};

const ensureWhisperCli = async () => {
	const existing = await resolveWhisperCli();
	if (existing) {
		const whisperDir = getWhisperCppDir();
		if (existing.startsWith(whisperDir)) {
			await ensureMetalBuild(whisperDir);
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
		await ensureMetalBuild(whisperDir);
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
	await ensureMetalBuild(whisperDir);

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

const ensureMetalBuild = async (whisperDir) => {
	if (process.platform !== "darwin") return;
	if (!(await fileExists(path.join(whisperDir, "CMakeLists.txt")))) return;
	const marker = getMetalMarkerPath(whisperDir);
	if (await fileExists(marker)) return;

	const buildOnce = async (flag) => {
		logDebug("尝试启用 Metal 构建", flag);
		await runCommand(
			"cmake",
			["-B", "build", flag, "-DCMAKE_BUILD_TYPE=Release"],
			{ cwd: whisperDir },
		);
		await runCommand(
			"cmake",
			["--build", "build", "-j", "--config", "Release"],
			{ cwd: whisperDir },
		);
		await fs.writeFile(marker, `metal=${flag}`);
	};

	let lastError = null;
	for (const flag of ["-DGGML_METAL=1", "-DGGML_USE_METAL=1"]) {
		try {
			await buildOnce(flag);
			return;
		} catch (error) {
			lastError = error;
		}
	}

	throw new Error(
		`启用 Metal 失败，请安装 Xcode 命令行工具与 cmake 后重试：${lastError ? toErrorMessage(lastError) : ""}`,
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

export const registerWhisperIpc = () => {
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
				await ensureMetalBuild(whisperDir);
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
			await ensureWhisperCli();
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

		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-nle-whisper-"));
		logDebug("临时目录", tmpDir);
		const wavPath = path.join(tmpDir, "audio.wav");
		const outPrefix = path.join(tmpDir, "out");

		const job = { child: null, tmpDir };
		jobs.set(requestId, job);

		try {
			const wavBytes = payload?.wavBytes;
			if (!(wavBytes instanceof ArrayBuffer)) {
				throw new Error("wavBytes 必须是 ArrayBuffer");
			}
			await fs.writeFile(wavPath, Buffer.from(wavBytes));

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
			if (process.platform === "darwin") {
				const systeminfo = String(parsed?.systeminfo ?? "");
				if (!/metal/i.test(systeminfo)) {
					throw new Error("未检测到 Metal 加速，请重新安装本地引擎");
				}
			}
			const segments = normalizeSegmentsFromJson(parsed, payload?.duration);
			return { segments };
		} finally {
			jobs.delete(requestId);
			await cleanupJob(job);
		}
	});
};
