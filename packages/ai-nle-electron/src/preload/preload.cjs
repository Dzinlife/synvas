const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiNleElectron", {
	platform: process.platform,
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
