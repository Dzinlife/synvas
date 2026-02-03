const { contextBridge, ipcRenderer, webUtils } = require("electron");

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
		whisperDownload: (options) =>
			ipcRenderer.invoke("asr:whisper:download", options),
		whisperTranscribe: (options) =>
			ipcRenderer.invoke("asr:whisper:transcribe", options),
		whisperOnSegment: (handler) => {
			const listener = (_event, payload) => handler(payload);
			ipcRenderer.on("asr:whisper:segment", listener);
			return () => ipcRenderer.removeListener("asr:whisper:segment", listener);
		},
		whisperAbort: (requestId) =>
			ipcRenderer.send("asr:whisper:abort", requestId),
		whisperSetBackend: (backend) =>
			ipcRenderer.invoke("asr:whisper:setBackend", backend),
		whisperGetBackend: () => ipcRenderer.invoke("asr:whisper:getBackend"),
	},
});
