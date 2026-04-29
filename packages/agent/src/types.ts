export type AgentRunStatus =
	| "queued"
	| "running"
	| "materializing_artifacts"
	| "applying_effects"
	| "awaiting_input"
	| "succeeded"
	| "failed"
	| "cancelled";

export type AgentRunKind =
	| "llm.chat"
	| "image.generate"
	| "image.edit"
	| "audio.generate"
	| "video.generate";

export type AgentArtifactKind = "text" | "image" | "audio" | "video" | "file";

export interface AgentModelListFilter {
	kind?: AgentRunKind;
	providerId?: string;
}

export interface AgentScope {
	type: "node" | "project";
	projectId: string;
	nodeId?: string;
}

export interface AgentRunRequest {
	providerId: string;
	modelId: string;
	scope: AgentScope;
	kind: AgentRunKind;
	input: Record<string, unknown>;
	params?: Record<string, unknown>;
	context?: Record<string, unknown>;
}

export interface AgentStep {
	id: string;
	label: string;
	status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
	createdAt: number;
	updatedAt: number;
}

export interface AgentInlineBytesSource {
	type: "inline-bytes";
	mimeType: string;
	base64: string;
}

export interface AgentRemoteUrlSource {
	type: "remote-url";
	url: string;
}

export interface AgentInlineTextSource {
	type: "inline-text";
	text: string;
}

export type AgentArtifactSource =
	| AgentInlineBytesSource
	| AgentRemoteUrlSource
	| AgentInlineTextSource;

export interface AgentArtifact {
	id: string;
	runId: string;
	kind: AgentArtifactKind;
	status: "ready";
	name: string;
	mimeType?: string;
	width?: number;
	height?: number;
	duration?: number;
	source: AgentArtifactSource;
	metadata?: Record<string, unknown>;
	createdAt: number;
}

export interface AgentImageNodeBindArtifactEffect {
	id: string;
	type: "image-node.bind-artifact";
	nodeId: string;
	artifactId: string;
	metadata?: {
		sourceNodeId?: string;
		prompt?: string;
		instruction?: string;
	};
}

export type AgentEffect = AgentImageNodeBindArtifactEffect;

export interface AgentEffectApplication {
	effectId: string;
	status: "applied" | "skipped" | "failed";
	reason?:
		| "target_missing"
		| "artifact_missing"
		| "unsupported_effect"
		| "error";
	message?: string;
}

export interface AgentRun {
	id: string;
	sessionId?: string;
	providerId: string;
	modelId: string;
	scope: AgentScope;
	kind: AgentRunKind;
	status: AgentRunStatus;
	actorId: "agent:local" | string;
	input: Record<string, unknown>;
	params: Record<string, unknown>;
	context: Record<string, unknown>;
	steps: AgentStep[];
	artifacts: AgentArtifact[];
	effects: AgentEffect[];
	effectApplications: AgentEffectApplication[];
	error?: string;
	createdAt: number;
	updatedAt: number;
}

export interface AgentRunEvent {
	runId: string;
	seq: number;
	run: AgentRun;
}

export type AgentRunListener = (event: AgentRunEvent) => void;

export interface AgentModel {
	providerId: string;
	providerLabel: string;
	modelId: string;
	label: string;
	kind: AgentRunKind;
	enabled: boolean;
	capabilities: AgentModelCapabilities;
	defaultParams: Record<string, unknown>;
	paramsSchema?: AgentJsonSchema;
}

export type AgentJsonSchema = Record<string, unknown>;

export interface AgentLlmModelCapabilities {
	type: "llm";
	supportsStreaming?: boolean;
	maxInputTokens?: number;
	maxOutputTokens?: number;
}

export interface AgentImageQualityOption {
	value: string;
	label: string;
}

export interface AgentImageSize {
	width: number;
	height: number;
}

export interface AgentImageAspectRatioOption {
	value: string;
	label: string;
	width: number;
	height: number;
	size?: AgentImageSize;
}

export interface AgentImageFixedSizeConstraint {
	mode: "fixed";
	sizes: AgentImageSize[];
}

export interface AgentImageFlexibleSizeConstraint {
	mode: "flexible";
	minPixels: number;
	maxPixels: number;
	maxEdge: number;
	multiple: number;
	maxLongEdgeRatio: number;
}

export type AgentImageSizeConstraint =
	| AgentImageFixedSizeConstraint
	| AgentImageFlexibleSizeConstraint;

export interface AgentImageModelCapabilities {
	type: "image";
	qualityOptions: AgentImageQualityOption[];
	defaultQuality: string;
	aspectRatios: AgentImageAspectRatioOption[];
	defaultAspectRatio: string;
	defaultSize: AgentImageSize;
	size: AgentImageSizeConstraint;
	maxVariants?: number;
}

export interface AgentAudioModelCapabilities {
	type: "audio";
	inputMimeTypes?: string[];
	outputMimeTypes: string[];
	maxDurationSeconds?: number;
}

export interface AgentVideoModelCapabilities {
	type: "video";
	inputMimeTypes?: string[];
	outputMimeTypes: string[];
	aspectRatios?: AgentImageAspectRatioOption[];
	defaultAspectRatio?: string;
	maxDurationSeconds?: number;
}

export type AgentModelCapabilities =
	| AgentLlmModelCapabilities
	| AgentImageModelCapabilities
	| AgentAudioModelCapabilities
	| AgentVideoModelCapabilities;

export interface AgentQuote {
	estimatedCredits: number | null;
	currency: "mock-credit" | "external";
	label?: string;
}

export interface AgentClient {
	createRun: (request: AgentRunRequest) => Promise<AgentRun>;
	subscribeRun: (runId: string, listener: AgentRunListener) => () => void;
	cancelRun: (runId: string) => Promise<AgentRun | null>;
	completeRunApplication: (
		runId: string,
		applications: AgentEffectApplication[],
	) => Promise<AgentRun | null>;
	failRunApplication: (
		runId: string,
		applications: AgentEffectApplication[],
		error: string,
	) => Promise<AgentRun | null>;
	listModels: (filter?: AgentModelListFilter) => Promise<AgentModel[]>;
	quote: (request: AgentRunRequest) => Promise<AgentQuote>;
}

export const isTerminalAgentRunStatus = (status: AgentRunStatus): boolean =>
	status === "succeeded" || status === "failed" || status === "cancelled";

export const isAgentImageModelCapabilities = (
	capabilities: AgentModelCapabilities | null | undefined,
): capabilities is AgentImageModelCapabilities =>
	capabilities?.type === "image";
