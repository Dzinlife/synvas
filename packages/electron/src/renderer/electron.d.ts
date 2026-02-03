import type { AsrModelSize } from "@ai-nle/editor/asr";

export type WhisperWord = {
	text: string;
	start: number;
	end: number;
};

export type WhisperSegment = {
	start: number;
	end: number;
	text: string;
	words?: WhisperWord[];
};

/** whisper.cpp -oj 输出的 JSON 结构（后端原样返回） */
export type WhisperJsonToken = {
	id: number;
	offsets: {
		from: number;
		to: number;
	};
	p: number;
	t_dtw: number;
	text: string;
	timestamps: {
		/** 模板字符串类型，格式为 00:00:00,000 */
		from: `${number}:${number}:${number},${number}`;
		to: `${number}:${number}:${number},${number}`;
	};
};

export type WhisperJsonSegment = {
	offsets: {
		from: number;
		to: number;
	};
	text: string;
	timestamps: {
		/** 模板字符串类型，格式为 00:00:00,000 */
		from: `${number}:${number}:${number},${number}`;
		to: `${number}:${number}:${number},${number}`;
	};
	tokens?: WhisperJsonToken[];
};

export type WhisperJsonOutput = {
	transcription?: WhisperJsonSegment[];
	systeminfo?: string;
};

export type WhisperTranscribeResult = {
	data: WhisperJsonOutput;
	backend?: "gpu" | "cpu";
	durationMs?: number;
};

/** 实时流式：后端只推原始 stdout 行，前端解析 */
export type WhisperSegmentEvent = {
	requestId: string;
	raw: string;
};

export type WhisperReadyResult = {
	ok: boolean;
	message?: string;
	canDownload?: boolean;
	modelPath?: string;
	downloadUrl?: string;
};

export type WhisperDownloadResult = {
	ok: boolean;
	message?: string;
	path?: string;
};

export type WhisperBackend = "gpu" | "cpu" | null;

declare global {
	interface Window {
		aiNleElectron?: {
			platform?: NodeJS.Platform;
			webUtils?: {
				getPathForFile?: (file: File) => string | null | undefined;
			};
			file?: {
				stat?: (filePath: string) => Promise<{ size: number }>;
				read?: (
					filePath: string,
					start: number,
					end: number,
				) => Promise<Uint8Array | ArrayBuffer>;
			};
			asr: {
				whisperCheckReady: (options: {
					model: AsrModelSize;
					language: string;
				}) => Promise<WhisperReadyResult>;
				whisperDownload: (options: {
					model: AsrModelSize;
				}) => Promise<WhisperDownloadResult>;
				whisperTranscribe: (options: {
					requestId: string;
					wavBytes: ArrayBuffer;
					model: AsrModelSize;
					language: string;
					duration?: number;
				}) => Promise<WhisperTranscribeResult>;
				whisperOnSegment: (
					handler: (event: WhisperSegmentEvent) => void,
				) => () => void;
				whisperAbort: (requestId: string) => void;
				/** 指定后端：gpu | cpu，null 自动 */
				whisperSetBackend: (
					backend: WhisperBackend,
				) => Promise<{ ok: boolean; backend: WhisperBackend }>;
				whisperGetBackend: () => Promise<{ backend: WhisperBackend }>;
			};
		};
	}
}
