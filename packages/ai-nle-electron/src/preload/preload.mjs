import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("aiNleElectron", {
	platform: process.platform,
	asr: {
		whisperCheckReady: (options) =>
			ipcRenderer.invoke("asr:whisper:checkReady", options),
		whisperTranscribe: (options) =>
			ipcRenderer.invoke("asr:whisper:transcribe", options),
		whisperAbort: (requestId) =>
			ipcRenderer.send("asr:whisper:abort", requestId),
		// 测试用：指定下次构建的 backend（coreml | metal），null 恢复自动
		whisperSetBackend: (backend) =>
			ipcRenderer.invoke("asr:whisper:setBackend", backend),
		whisperGetBackend: () => ipcRenderer.invoke("asr:whisper:getBackend"),
	},
});
