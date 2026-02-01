import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { registerWhisperIpc } from "./asr/whisperIpc.js";

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
