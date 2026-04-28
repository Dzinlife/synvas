import type {
	AgentArtifact,
	AgentClient,
	AgentEffect,
	AgentEffectApplication,
	AgentModel,
	AgentQuote,
	AgentRun,
	AgentRunEvent,
	AgentRunListener,
	AgentRunRequest,
	AgentStep,
} from "./types";
import { isTerminalAgentRunStatus } from "./types";

const MOCK_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
export const LOCAL_MOCK_AGENT_RUN_DURATION_MS = 10_000;
const LOCAL_MOCK_AGENT_SCHEDULE_STEP_COUNT = 3;

export interface LocalMockAgentClientOptions {
	stepDelayMs?: number;
}

const createId = (prefix: string): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const readString = (
	value: Record<string, unknown>,
	key: string,
	fallback = "",
): string => {
	const raw = value[key];
	return typeof raw === "string" ? raw : fallback;
};

const createStep = (label: string): AgentStep => {
	const now = Date.now();
	return {
		id: createId("step"),
		label,
		status: "queued",
		createdAt: now,
		updatedAt: now,
	};
};

export class LocalMockAgentClient implements AgentClient {
	private readonly stepDelayMs: number;
	private readonly runs = new Map<string, AgentRun>();
	private readonly seqByRunId = new Map<string, number>();
	private readonly listenersByRunId = new Map<string, Set<AgentRunListener>>();
	private readonly timersByRunId = new Map<
		string,
		ReturnType<typeof setTimeout>[]
	>();

	constructor(options: LocalMockAgentClientOptions = {}) {
		this.stepDelayMs =
			options.stepDelayMs ??
			LOCAL_MOCK_AGENT_RUN_DURATION_MS / LOCAL_MOCK_AGENT_SCHEDULE_STEP_COUNT;
	}

	async createRun(request: AgentRunRequest): Promise<AgentRun> {
		const now = Date.now();
		const run: AgentRun = {
			id: createId("run"),
			sessionId: createId("session"),
			scope: request.scope,
			kind: request.kind,
			status: "queued",
			actorId: "agent:local",
			input: request.input,
			params: request.params ?? {},
			context: request.context ?? {},
			steps: this.createInitialSteps(request),
			artifacts: [],
			effects: [],
			effectApplications: [],
			createdAt: now,
			updatedAt: now,
		};
		this.runs.set(run.id, run);
		this.seqByRunId.set(run.id, 0);
		this.emit(run.id);
		this.scheduleRun(run.id);
		return run;
	}

	subscribeRun(runId: string, listener: AgentRunListener): () => void {
		const listeners = this.listenersByRunId.get(runId) ?? new Set();
		listeners.add(listener);
		this.listenersByRunId.set(runId, listeners);
		const run = this.runs.get(runId);
		if (run) {
			listener({
				runId,
				seq: this.seqByRunId.get(runId) ?? 0,
				run,
			});
		}
		return () => {
			const current = this.listenersByRunId.get(runId);
			if (!current) return;
			current.delete(listener);
			if (current.size === 0) {
				this.listenersByRunId.delete(runId);
			}
		};
	}

	async cancelRun(runId: string): Promise<AgentRun | null> {
		const run = this.runs.get(runId);
		if (!run || isTerminalAgentRunStatus(run.status)) return run ?? null;
		this.clearTimers(runId);
		return this.patchRun(runId, {
			status: "cancelled",
			steps: run.steps.map((step) =>
				step.status === "succeeded"
					? step
					: { ...step, status: "cancelled", updatedAt: Date.now() },
			),
		});
	}

	async completeRunApplication(
		runId: string,
		applications: AgentEffectApplication[],
	): Promise<AgentRun | null> {
		const run = this.runs.get(runId);
		if (!run || isTerminalAgentRunStatus(run.status)) return run ?? null;
		return this.patchRun(runId, {
			status: "succeeded",
			effectApplications: applications,
			steps: run.steps.map((step) => ({
				...step,
				status: "succeeded",
				updatedAt: Date.now(),
			})),
		});
	}

	async failRunApplication(
		runId: string,
		applications: AgentEffectApplication[],
		error: string,
	): Promise<AgentRun | null> {
		const run = this.runs.get(runId);
		if (!run || isTerminalAgentRunStatus(run.status)) return run ?? null;
		return this.patchRun(runId, {
			status: "failed",
			error,
			effectApplications: applications,
		});
	}

	async listModels(): Promise<AgentModel[]> {
		return [
			{
				id: "mock-image-standard",
				label: "Mock Image Standard",
				kind: "image.generate",
			},
			{
				id: "mock-image-edit",
				label: "Mock Image Edit",
				kind: "image.edit",
			},
		];
	}

	async quote(request: AgentRunRequest): Promise<AgentQuote> {
		const variants =
			typeof request.params?.variants === "number"
				? Math.max(1, request.params.variants)
				: 1;
		return {
			estimatedCredits: request.kind === "image.edit" ? 4 : 3 * variants,
			currency: "mock-credit",
		};
	}

	private createInitialSteps(request: AgentRunRequest): AgentStep[] {
		if (request.kind === "image.edit") {
			return [
				createStep("理解编辑意图"),
				createStep("生成编辑提示词"),
				createStep("生成图片结果"),
			];
		}
		return [createStep("生成图片结果")];
	}

	private scheduleRun(runId: string): void {
		this.addTimer(
			runId,
			setTimeout(() => {
				this.markStepRunning(runId, 0);
				this.patchRun(runId, { status: "running" });
			}, this.stepDelayMs),
		);
		this.addTimer(
			runId,
			setTimeout(() => {
				const run = this.runs.get(runId);
				if (!run || isTerminalAgentRunStatus(run.status)) return;
				const artifacts = this.createArtifacts(run);
				this.patchRun(runId, {
					status: "materializing_artifacts",
					artifacts,
					steps: run.steps.map((step) => ({
						...step,
						status: "succeeded",
						updatedAt: Date.now(),
					})),
				});
			}, this.stepDelayMs * 2),
		);
		this.addTimer(
			runId,
			setTimeout(() => {
				const run = this.runs.get(runId);
				if (!run || isTerminalAgentRunStatus(run.status)) return;
				const effects = this.createEffects(run);
				this.patchRun(runId, {
					status: "applying_effects",
					effects,
				});
			}, this.stepDelayMs * 3),
		);
	}

	private createArtifacts(run: AgentRun): AgentArtifact[] {
		const prompt =
			run.kind === "image.edit"
				? readString(run.input, "instruction", "image edit")
				: readString(run.input, "prompt", "image");
		const now = Date.now();
		return [
			{
				id: createId("artifact"),
				runId: run.id,
				kind: "image",
				status: "ready",
				name: `${prompt.slice(0, 42).trim() || "mock-image"}.png`,
				mimeType: "image/png",
				width: this.resolveArtifactWidth(run),
				height: this.resolveArtifactHeight(run),
				source: {
					type: "inline-bytes",
					mimeType: "image/png",
					base64: MOCK_PNG_BASE64,
				},
				createdAt: now,
			},
		];
	}

	private createEffects(run: AgentRun): AgentEffect[] {
		const artifact = run.artifacts[0];
		if (!artifact) return [];
		const nodeId =
			typeof run.context.targetNodeId === "string"
				? run.context.targetNodeId
				: run.scope.nodeId;
		if (!nodeId) return [];
		return [
			{
				id: createId("effect"),
				type: "image-node.bind-artifact",
				nodeId,
				artifactId: artifact.id,
				metadata: {
					sourceNodeId: run.scope.nodeId,
					prompt: readString(run.input, "prompt"),
					instruction: readString(run.input, "instruction"),
				},
			},
		];
	}

	private resolveArtifactWidth(run: AgentRun): number {
		const aspectRatio = readString(run.params, "aspectRatio", "1:1");
		if (aspectRatio === "16:9") return 1024;
		if (aspectRatio === "9:16") return 768;
		return 1024;
	}

	private resolveArtifactHeight(run: AgentRun): number {
		const aspectRatio = readString(run.params, "aspectRatio", "1:1");
		if (aspectRatio === "16:9") return 576;
		if (aspectRatio === "9:16") return 1365;
		return 1024;
	}

	private markStepRunning(runId: string, index: number): void {
		const run = this.runs.get(runId);
		if (!run) return;
		this.patchRun(runId, {
			steps: run.steps.map((step, stepIndex) =>
				stepIndex === index
					? { ...step, status: "running", updatedAt: Date.now() }
					: step,
			),
		});
	}

	private patchRun(
		runId: string,
		patch: Partial<Omit<AgentRun, "id" | "createdAt">>,
	): AgentRun | null {
		const run = this.runs.get(runId);
		if (!run) return null;
		const nextRun = {
			...run,
			...patch,
			updatedAt: Date.now(),
		};
		this.runs.set(runId, nextRun);
		this.emit(runId);
		return nextRun;
	}

	private addTimer(runId: string, timer: ReturnType<typeof setTimeout>): void {
		const timers = this.timersByRunId.get(runId) ?? [];
		timers.push(timer);
		this.timersByRunId.set(runId, timers);
	}

	private clearTimers(runId: string): void {
		const timers = this.timersByRunId.get(runId) ?? [];
		for (const timer of timers) {
			clearTimeout(timer);
		}
		this.timersByRunId.delete(runId);
	}

	private emit(runId: string): void {
		const run = this.runs.get(runId);
		if (!run) return;
		const seq = (this.seqByRunId.get(runId) ?? 0) + 1;
		this.seqByRunId.set(runId, seq);
		const event: AgentRunEvent = { runId, seq, run };
		const listeners = this.listenersByRunId.get(runId);
		if (!listeners) return;
		for (const listener of listeners) {
			listener(event);
		}
	}
}
