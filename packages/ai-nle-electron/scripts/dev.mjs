import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const devServerUrl = "http://localhost:3001";

const waitForServer = async (url, options) => {
	const timeoutMs = options?.timeoutMs ?? 30_000;
	const intervalMs = options?.intervalMs ?? 250;
	const start = Date.now();

	while (true) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`Vite dev server 未就绪：${url}`);
		}

		try {
			const res = await fetch(url, { method: "GET" });
			if (res.ok) return;
		} catch {}

		await new Promise((r) => setTimeout(r, intervalMs));
	}
};

const spawnInherited = (cmd, args, extra) => {
	return spawn(cmd, args, {
		stdio: "inherit",
		env: extra?.env ?? process.env,
		cwd: extra?.cwd ?? process.cwd(),
	});
};

const ensureElectronInstalled = async () => {
	const require = createRequire(import.meta.url);

	try {
		// electron 包会在内部返回可执行文件路径；未下载时会直接 throw。
		require("electron");
		return;
	} catch (error) {
		if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
			throw new Error(
				"检测到 ELECTRON_SKIP_BINARY_DOWNLOAD=1，但本地没有 Electron 二进制文件，无法启动。",
			);
		}

		const pkgJsonPath = require.resolve("electron/package.json");
		const installScript = path.join(path.dirname(pkgJsonPath), "install.js");

		console.log("[ai-nle-electron] Electron 二进制未安装，开始执行下载脚本...");

		await new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [installScript], {
				stdio: "inherit",
				env: process.env,
			});
			child.on("error", reject);
			child.on("exit", (code) => {
				if (code === 0) {
					resolve();
					return;
				}
				reject(error);
			});
		});
	}
};

const vite = spawnInherited(pnpmCmd, ["exec", "vite", "--strictPort"]);

let electron = null;

const shutdown = () => {
	try {
		vite.kill();
	} catch {}
	try {
		electron?.kill();
	} catch {}
};

process.on("SIGINT", () => {
	shutdown();
	process.exit(0);
});
process.on("SIGTERM", () => {
	shutdown();
	process.exit(0);
});

vite.on("exit", (code) => {
	if (code && code !== 0) {
		process.exit(code);
	}
});

try {
	await waitForServer(devServerUrl, { timeoutMs: 60_000 });
	await ensureElectronInstalled();
	// 主进程已由 pnpm dev 的 build:main 编译到 dist/main
	electron = spawnInherited(pnpmCmd, ["exec", "electron", "."], {
		env: {
			...process.env,
			VITE_DEV_SERVER_URL: devServerUrl,
		},
	});
	electron.on("exit", (code) => {
		shutdown();
		process.exit(code ?? 0);
	});
} catch (error) {
	console.error(error);
	shutdown();
	process.exit(1);
}
