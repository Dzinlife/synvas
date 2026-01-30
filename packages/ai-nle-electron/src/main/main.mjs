import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerWhisperIpc } from "./asr/whisperIpc.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

const createMainWindow = async () => {
	const win = new BrowserWindow({
		width: 1400,
		height: 900,
		webPreferences: {
			preload: path.join(__dirname, "../preload/preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	if (isDev) {
		await win.loadURL(process.env.VITE_DEV_SERVER_URL);
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
