import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("aiNleElectron", {
	asr: {
		whisperCheckReady: (options) =>
			ipcRenderer.invoke("asr:whisper:checkReady", options),
		whisperTranscribe: (options) =>
			ipcRenderer.invoke("asr:whisper:transcribe", options),
		whisperAbort: (requestId) =>
			ipcRenderer.send("asr:whisper:abort", requestId),
	},
});

