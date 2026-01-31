import { createContext, useContext } from "react";
import type { AsrModelSize, TranscriptSegment } from "./types";

export type TranscribeAudioFileOptions = {
	file: File;
	language: string;
	model: AsrModelSize;
	duration?: number;
	onProgress: (progress: number) => void;
	onChunk: (segment: TranscriptSegment) => void;
	onStatus?: (status: string) => void;
	signal: AbortSignal;
};

export type AsrClient = {
	// 通过可选的 ensureReady 让宿主（Web/Electron）按需准备资源（例如下载模型/二进制）。
	ensureReady?: (options: {
		model: AsrModelSize;
		language: string;
		signal: AbortSignal;
	}) => Promise<void>;
	transcribeAudioFile: (options: TranscribeAudioFileOptions) => Promise<{
		segments: TranscriptSegment[];
		backend?: "coreml" | "metal" | "gpu" | "cpu";
		durationMs?: number;
	}>;
};

const defaultClient: AsrClient = {
	transcribeAudioFile: async () => {
		throw new Error("未配置 ASR 引擎");
	},
};

// 通过 Context 注入不同宿主的 ASR 实现，避免 editor 包耦合具体推理后端。
const AsrContext = createContext<AsrClient>(defaultClient);

export const AsrProvider = AsrContext.Provider;

export function useAsrClient(): AsrClient {
	return useContext(AsrContext);
}
