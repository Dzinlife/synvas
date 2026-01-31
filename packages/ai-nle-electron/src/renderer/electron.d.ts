import type { AsrModelSize } from "ai-nle-editor/asr";

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

export type WhisperTranscribeResult = {
	segments: WhisperSegment[];
	backend?: "coreml" | "metal" | "gpu" | "cpu";
	durationMs?: number;
};

export type WhisperSegmentEvent = {
	requestId: string;
	segment: WhisperSegment;
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

export type WhisperBackend = "coreml" | "metal" | "gpu" | "cpu" | null;

declare global {
	interface Window {
		aiNleElectron?: {
			platform?: NodeJS.Platform;
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
				/** 指定后端：darwin 可选 coreml | metal | cpu，windows/linux 可选 gpu | cpu，null 自动 */
				whisperSetBackend: (
					backend: WhisperBackend,
				) => Promise<{ ok: boolean; backend: WhisperBackend }>;
				whisperGetBackend: () => Promise<{ backend: WhisperBackend }>;
			};
		};
	}
}
