import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("aiNleElectron", {
	platform: process.platform,
	webUtils: {
		getPathForFile: (file) => webUtils.getPathForFile(file),
	},
	file: {
		stat: (filePath) => ipcRenderer.invoke("file:stat", filePath),
		read: (filePath, start, end) =>
			ipcRenderer.invoke("file:read", filePath, start, end),
	},
	asr: {
		whisperCheckReady: (options) =>
			ipcRenderer.invoke("asr:whisper:checkReady", options),
		whisperTranscribe: (options) =>
			ipcRenderer.invoke("asr:whisper:transcribe", options),
		whisperAbort: (requestId) =>
			ipcRenderer.send("asr:whisper:abort", requestId),
		// 指定后端：gpu | cpu，null 自动
		whisperSetBackend: (backend) =>
			ipcRenderer.invoke("asr:whisper:setBackend", backend),
		whisperGetBackend: () => ipcRenderer.invoke("asr:whisper:getBackend"),
	},
});
