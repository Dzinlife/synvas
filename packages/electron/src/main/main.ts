import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { app, BrowserWindow, ipcMain } from "electron";
import { registerWhisperIpc } from "./asr/whisperIpc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 主进程编译后在 dist/main，preload 在源码 src/preload，需回退到包根再找 preload
const preloadPath = path.join(__dirname, "../../src/preload/preload.cjs");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

const createMainWindow = async (): Promise<BrowserWindow> => {
	const win = new BrowserWindow({
		width: 1400,
		height: 900,
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	if (isDev) {
		await win.loadURL(process.env.VITE_DEV_SERVER_URL!);
		win.webContents.openDevTools({ mode: "detach" });
	} else {
		await win.loadFile(path.join(app.getAppPath(), "dist/renderer/index.html"));
	}

	return win;
};

app.whenReady().then(async () => {
	registerWhisperIpc();
	ipcMain.handle("file:stat", async (_event, filePath: string) => {
		const stat = await fs.promises.stat(filePath);
		return { size: stat.size };
	});
	ipcMain.handle(
		"file:read",
		async (_event, filePath: string, start: number, end: number) => {
			const handle = await fs.promises.open(filePath, "r");
			try {
				const length = Math.max(0, end - start);
				const buffer = Buffer.alloc(length);
				const { bytesRead } = await handle.read(
					buffer,
					0,
					length,
					start,
				);
				return buffer.subarray(0, bytesRead);
			} finally {
				await handle.close();
			}
		},
	);
	await createMainWindow();

	app.on("activate", async () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			await createMainWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
