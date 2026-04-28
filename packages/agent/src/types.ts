export type AgentRunStatus =
	| "queued"
	| "running"
	| "materializing_artifacts"
	| "applying_effects"
	| "awaiting_input"
	| "succeeded"
	| "failed"
	| "cancelled";

export type AgentRunKind = "image.generate" | "image.edit";

export interface AgentScope {
	type: "node" | "project";
	projectId: string;
	nodeId?: string;
}

export interface AgentRunRequest {
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

export type AgentArtifactSource = AgentInlineBytesSource | AgentRemoteUrlSource;

export interface AgentArtifact {
	id: string;
	runId: string;
	kind: "image";
	status: "ready";
	name: string;
	mimeType: string;
	width: number;
	height: number;
	source: AgentArtifactSource;
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
	id: string;
	label: string;
	kind: AgentRunKind;
}

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
	listModels: () => Promise<AgentModel[]>;
	quote: (request: AgentRunRequest) => Promise<AgentQuote>;
}

export const isTerminalAgentRunStatus = (status: AgentRunStatus): boolean =>
	status === "succeeded" || status === "failed" || status === "cancelled";
