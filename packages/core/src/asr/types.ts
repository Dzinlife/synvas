export type AsrModelSize = "tiny" | "large-v3-turbo";

export type TranscriptWord = {
	text: string;
	start: number;
	end: number;
	confidence?: number;
};

export type TranscriptSegment = {
	id: string;
	start: number;
	end: number;
	text: string;
	words: TranscriptWord[];
};

export type TranscriptSource = {
	type: "asset";
	assetId: string;
	kind: "video" | "audio";
	uri: string;
	fileName: string;
	duration: number;
};

export type TranscriptRecord = {
	id: string;
	source: TranscriptSource;
	language: string;
	model: AsrModelSize;
	createdAt: number;
	updatedAt: number;
	segments: TranscriptSegment[];
};

export type AsrJobStatus =
	| "idle"
	| "loading"
	| "running"
	| "done"
	| "error"
	| "canceled";

export type WhisperWorkerInitMessage = {
	type: "init";
	model: AsrModelSize;
	language: string;
};

export type WhisperWorkerTranscribeMessage = {
	type: "transcribe";
	audio: Float32Array;
	startTime: number;
	sampleRate: number;
};

export type WhisperWorkerWord = {
	text: string;
	start: number;
	end: number;
	confidence?: number;
};

export type WhisperWorkerResultMessage = {
	type: "result";
	startTime: number;
	words: WhisperWorkerWord[];
};

export type WhisperWorkerReadyMessage = {
	type: "ready";
};

export type WhisperWorkerErrorMessage = {
	type: "error";
	message: string;
};

export type WhisperWorkerMessage =
	| WhisperWorkerInitMessage
	| WhisperWorkerTranscribeMessage;

export type WhisperWorkerResponse =
	| WhisperWorkerResultMessage
	| WhisperWorkerReadyMessage
	| WhisperWorkerErrorMessage;
