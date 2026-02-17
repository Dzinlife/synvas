import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { app, ipcMain } from "electron";

const DEFAULT_MODEL = "large-v3-turbo";
const KEEP_TMP = process.env.AI_NLE_KEEP_WHISPER_TMP === "1";
const DEBUG = process.env.AI_NLE_WHISPER_DEBUG === "1";

const MODEL_URL_BY_SIZE: Record<string, string> = {
	"large-v3-turbo":
		"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
};

/** 预编译二进制下载地址，按 platform_arch 维护；可用环境变量覆盖 */
const WHISPER_CLI_BINARY_URLS: Record<string, string> = {
	darwin_arm64:
		"https://supabase.scripod.com/storage/v1/object/public/whisper-cpp-prebuild/whisper-cli-darwin-arm64",
	darwin_x64: "",
	win32_x64: "",
	linux_x64: "",
};

/** 单个时间戳片段 */
export interface WhisperSegment {
	start: number;
	end: number;
	text: string;
	words?: { start: number; end: number; text: string }[];
}

interface TranscribeJob {
	child: ChildProcess | null;
	tmpDir: string;
}

const jobs = new Map<string, TranscribeJob>();

// 指定 backend：gpu | cpu，null 为自动（darwin 上 gpu 即 Metal）
let forcedBackend: "gpu" | "cpu" | null = null;

const toErrorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const logDebug = (...args: unknown[]): void => {
	console.log("[Whisper]", ...args);
};

const getWhisperCppDir = (): string =>
	path.join(app.getPath("userData"), "whisper.cpp");

interface InstallPath {
	binDir: string;
	cliPath: string | null;
}

const getWhisperCliInstallPath = (whisperDir: string): InstallPath => {
	const binDir = path.join(whisperDir, "bin");
	const fileName = getWhisperCliDownloadFileName();
	if (!fileName) return { binDir, cliPath: null };
	return { binDir, cliPath: path.join(binDir, fileName) };
};

const getDefaultModelPath = (modelSize: string): string => {
	const baseDir = path.join(app.getPath("userData"), "models", "whisper");
	const fileName = `ggml-${modelSize}.bin`;
	return path.join(baseDir, fileName);
};

const normalizeModel = (modelSize: string): string =>
	modelSize === DEFAULT_MODEL ? modelSize : DEFAULT_MODEL;

const resolveModelPath = (modelSize: string): string => {
	const candidate = process.env.AI_NLE_WHISPER_MODEL;
	if (candidate) return candidate;
	return getDefaultModelPath(normalizeModel(modelSize));
};

const getWhisperCliDownloadFileName = (): string | null => {
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

const getWhisperCliUrlKey = (): string =>
	`${process.platform}_${process.arch}`.toLowerCase();

const resolveWhisperCliDownloadUrl = (): string | null => {
	const direct = process.env.AI_NLE_WHISPER_CLI_DOWNLOAD_URL;
	if (direct) return direct;
	const key = getWhisperCliUrlKey();
	const envKey = key.toUpperCase().replace(/[^A-Z0-9]/g, "_");
	const perArch = process.env[`AI_NLE_WHISPER_CLI_DOWNLOAD_URL_${envKey}`];
	if (perArch) return perArch;
	const fromList = WHISPER_CLI_BINARY_URLS[key];
	if (fromList) return fromList;
	const base = process.env.AI_NLE_WHISPER_CLI_DOWNLOAD_BASE;
	if (!base) return null;
	const fileName = getWhisperCliDownloadFileName();
	if (!fileName) return null;
	return `${base.replace(/\/$/, "")}/${fileName}`;
};

const fileExists = async (filePath: string): Promise<boolean> => {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
};

/** 当前架构下已安装的 cli 路径（userData/whisper.cpp/bin/<fileName>） */
const getInstalledCliPath = (whisperDir: string): string | null => {
	const fileName = getWhisperCliDownloadFileName();
	if (!fileName) return null;
	return path.join(whisperDir, "bin", fileName);
};

const resolveWhisperCli = async (): Promise<string | null> => {
	const envPath = process.env.AI_NLE_WHISPER_CLI;
	if (envPath && (await fileExists(envPath))) return envPath;
	const whisperDir = getWhisperCppDir();
	const installed = getInstalledCliPath(whisperDir);
	if (installed && (await fileExists(installed))) return installed;
	return null;
};

const downloadFile = async (
	url: string,
	targetPath: string,
	label: string,
): Promise<void> => {
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

	const readable = Readable.fromWeb(res.body as ReadableStream<Uint8Array>);
	const writer = createWriteStream(tmpPath);
	await pipeline(readable, writer);
	await fs.rename(tmpPath, targetPath);
};

const downloadWhisperCli = async (
	whisperDir: string,
): Promise<string | null> => {
	const url = resolveWhisperCliDownloadUrl();
	if (!url) return null;
	const { binDir, cliPath } = getWhisperCliInstallPath(whisperDir);
	if (!cliPath || (await fileExists(cliPath))) return cliPath;
	await fs.mkdir(binDir, { recursive: true });
	await downloadFile(url, cliPath, "Whisper 引擎");
	if (process.platform !== "win32") {
		await fs.chmod(cliPath, 0o755);
	}
	return cliPath;
};

const ensureWhisperCli = async (): Promise<string> => {
	const existing = await resolveWhisperCli();
	if (existing) return existing;

	const whisperDir = getWhisperCppDir();
	const downloaded = await downloadWhisperCli(whisperDir);
	if (downloaded) return downloaded;

	const url = resolveWhisperCliDownloadUrl();
	throw new Error(
		url
			? `下载 Whisper 引擎失败，请检查网络或手动放置二进制到：${getInstalledCliPath(whisperDir)}`
			: "未配置预编译 Whisper 引擎下载地址，请在 WHISPER_CLI_BINARY_URLS 或环境变量中配置后重试。",
	);
};

async function collectText(
	stream: NodeJS.ReadableStream | null,
): Promise<string> {
	if (!stream) return "";
	let text = "";
	for await (const chunk of stream) {
		text += (chunk as Buffer).toString();
	}
	return text;
}

const attachLineListener = (
	stream: NodeJS.ReadableStream | null,
	onLine: (line: string) => void,
): void => {
	if (!stream) return;
	let buffer = "";
	stream.on("data", (chunk: Buffer | string) => {
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

const findJsonOutput = async (
	tmpDir: string,
	outPrefix: string,
): Promise<string | null> => {
	const direct = `${outPrefix}.json`;
	if (await fileExists(direct)) return direct;

	const files = await fs.readdir(tmpDir);
	const candidate = files.find((name) => name.toLowerCase().endsWith(".json"));
	return candidate ? path.join(tmpDir, candidate) : null;
};

const detectBackend = (systeminfo: string | undefined): "gpu" | "cpu" => {
	const info = String(systeminfo ?? "").toLowerCase();
	if (/metal|cuda|vulkan|gpu/.test(info)) return "gpu";
	return "cpu";
};

const cleanupJob = async (job: TranscribeJob): Promise<void> => {
	if (!job?.tmpDir) return;
	if (KEEP_TMP) {
		logDebug("保留临时目录", job.tmpDir);
		return;
	}
	try {
		await fs.rm(job.tmpDir, { recursive: true, force: true });
	} catch {}
};

const downloadModel = async (
	url: string,
	targetPath: string,
): Promise<void> => {
	await downloadFile(url, targetPath, "模型");
};

export const registerWhisperIpc = (): void => {
	ipcMain.handle("asr:whisper:setBackend", (_event, backend: unknown) => {
		const valid = ["gpu", "cpu"].includes(backend as string);
		const next = valid ? (backend as "gpu" | "cpu") : null;
		forcedBackend = next;
		logDebug("已指定 backend:", next);
		return { ok: true, backend: forcedBackend };
	});

	ipcMain.handle("asr:whisper:getBackend", () => ({
		backend: forcedBackend,
	}));

	ipcMain.on("asr:whisper:abort", (_event, requestId: string) => {
		const job = jobs.get(requestId);
		if (!job) return;
		try {
			job.child?.kill();
		} catch {}
	});

	ipcMain.handle("asr:whisper:checkReady", async (_event, payload: unknown) => {
		try {
			const modelSize = normalizeModel(
				(payload as { model?: string })?.model ?? DEFAULT_MODEL,
			);
			const modelPath = resolveModelPath(modelSize);
			const cliPath = await resolveWhisperCli();
			const hasModel = await fileExists(modelPath);
			if (!cliPath || !hasModel) {
				const issues: string[] = [];
				if (!cliPath) {
					if (!resolveWhisperCliDownloadUrl()) {
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

	ipcMain.handle("asr:whisper:download", async (_event, payload: unknown) => {
		try {
			const modelSize = normalizeModel(
				(payload as { model?: string })?.model ?? DEFAULT_MODEL,
			);
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

	ipcMain.handle(
		"asr:whisper:transcribe",
		async (
			_event: Electron.IpcMainInvokeEvent,
			payload: {
				requestId?: string;
				model?: string;
				language?: string;
				wavBytes?: ArrayBuffer;
				duration?: number;
			},
		) => {
			const requestId = payload?.requestId;
			if (!requestId) {
				throw new Error("缺少 requestId");
			}

			const cli = await resolveWhisperCli();
			if (!cli) {
				throw new Error("未安装本地 Whisper 引擎，请先确认下载");
			}
			const modelPath = resolveModelPath(payload?.model ?? DEFAULT_MODEL);
			const language = payload?.language;

			const tmpDir = await fs.mkdtemp(
				path.join(os.tmpdir(), "ai-nle-whisper-"),
			);
			logDebug("临时目录", tmpDir);
			const wavPath = path.join(tmpDir, "audio.wav");
			const outPrefix = path.join(tmpDir, "out");

			const job: TranscribeJob = { child: null, tmpDir };
			jobs.set(requestId, job);

			try {
				const wavBytes = payload?.wavBytes;
				if (!(wavBytes instanceof ArrayBuffer)) {
					throw new Error("wavBytes 必须是 ArrayBuffer");
				}
				await fs.writeFile(wavPath, Buffer.from(wavBytes));

				const transcribeStartMs = Date.now();
				const args = [
					"-m",
					modelPath,
					"-f",
					wavPath,
					"-oj",
					"-ojf",
					"-of",
					outPrefix,
					"-ml",
					"1",
					"--split-on-word",
				];
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
				const seen = new Set<string>();
				attachLineListener(child.stdout, (line) => {
					const trimmed = line?.trim();
					if (!trimmed) return;
					if (seen.has(trimmed)) return;
					seen.add(trimmed);
					try {
						sender.send("asr:whisper:segment", {
							requestId,
							raw: line,
						});
					} catch {}
				});

				const stderrPromise = collectText(child.stderr);

				const exit = await new Promise<{
					code: number | null;
					signal: NodeJS.Signals | null;
				}>((resolve, reject) => {
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
				const parsed = JSON.parse(content) as Record<string, unknown>;
				const systeminfo = String(parsed?.systeminfo ?? "");
				if (forcedBackend !== "cpu") {
					if (!/metal|cuda|vulkan|gpu/i.test(systeminfo)) {
						throw new Error("未检测到 GPU 加速，请重新安装本地引擎");
					}
				}
				const backend =
					forcedBackend === "cpu" ? "cpu" : detectBackend(systeminfo);
				const durationMs = Date.now() - transcribeStartMs;
				console.log(
					"[Whisper] 后端:",
					backend,
					"| 处理耗时:",
					(durationMs / 1000).toFixed(2),
					"s",
				);
				return { data: parsed, backend, durationMs };
			} finally {
				jobs.delete(requestId);
				await cleanupJob(job);
			}
		},
	);
};
