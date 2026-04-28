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

export const OPENAI_IMAGE_DEFAULT_ENDPOINT = "https://api.openai.com/v1";
export const OPENAI_IMAGE_DEFAULT_MODEL = "gpt-image-2";

export interface OpenAiImageConfig {
	endpoint: string;
	apiKey: string;
}

export interface OpenAiImageEditSource {
	data: Blob;
	name: string;
}

export interface OpenAiImageAgentClientOptions {
	config: OpenAiImageConfig | (() => OpenAiImageConfig | null | undefined);
	fetch?: typeof fetch;
	resolveEditSource?: (
		request: AgentRunRequest,
	) => Promise<OpenAiImageEditSource | null>;
}

const OPENAI_IMAGE_MODELS = [
	{ id: "gpt-image-2", label: "GPT Image 2" },
	{ id: "gpt-image-1.5", label: "GPT Image 1.5" },
	{ id: "gpt-image-1", label: "GPT Image 1" },
	{ id: "gpt-image-1-mini", label: "GPT Image 1 Mini" },
] as const;

const OPENAI_IMAGE_QUALITIES = new Set(["auto", "low", "medium", "high"]);
const OPENAI_IMAGE_SIZES = new Set([
	"auto",
	"1024x1024",
	"1536x1024",
	"1024x1536",
]);

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

const readNumber = (
	value: Record<string, unknown>,
	key: string,
	fallback: number,
): number => {
	const raw = value[key];
	return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
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

const normalizeEndpoint = (endpoint: string): string => {
	const trimmed = endpoint.trim().replace(/\/+$/g, "");
	if (!trimmed) return OPENAI_IMAGE_DEFAULT_ENDPOINT;
	if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) return trimmed;
	if (
		trimmed.startsWith("localhost") ||
		trimmed.startsWith("127.0.0.1") ||
		trimmed.startsWith("[::1]")
	) {
		return `http://${trimmed}`;
	}
	return `https://${trimmed}`;
};

const normalizeConfig = (
	config: OpenAiImageConfig | null | undefined,
): OpenAiImageConfig | null => {
	const apiKey = config?.apiKey.trim() ?? "";
	if (!apiKey) return null;
	return {
		endpoint: normalizeEndpoint(
			config?.endpoint ?? OPENAI_IMAGE_DEFAULT_ENDPOINT,
		),
		apiKey,
	};
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isAbortError = (error: unknown): boolean =>
	typeof DOMException !== "undefined" && error instanceof DOMException
		? error.name === "AbortError"
		: isRecord(error) && error.name === "AbortError";

const redactSecrets = (message: string, secrets: string[]): string => {
	let sanitized = message;
	for (const secret of secrets) {
		if (!secret) continue;
		sanitized = sanitized.split(secret).join("[redacted]");
	}
	return sanitized;
};

const resolveModel = (params: Record<string, unknown>): string => {
	const model = readString(params, "model", OPENAI_IMAGE_DEFAULT_MODEL).trim();
	return model || OPENAI_IMAGE_DEFAULT_MODEL;
};

const resolveQuality = (params: Record<string, unknown>): string => {
	const quality = readString(params, "quality", "auto").trim();
	return OPENAI_IMAGE_QUALITIES.has(quality) ? quality : "auto";
};

const resolveSize = (params: Record<string, unknown>): string => {
	const size = readString(params, "size", "").trim();
	if (OPENAI_IMAGE_SIZES.has(size)) return size;
	const aspectRatio = readString(params, "aspectRatio", "").trim();
	if (aspectRatio === "16:9") return "1536x1024";
	if (aspectRatio === "9:16") return "1024x1536";
	if (aspectRatio === "1:1") return "1024x1024";
	return "auto";
};

const resolveVariantCount = (params: Record<string, unknown>): number => {
	const variants = Math.round(readNumber(params, "variants", 1));
	return Math.max(1, Math.min(10, variants));
};

const parseSize = (
	size: unknown,
	fallback: { width: number; height: number },
): { width: number; height: number } => {
	if (typeof size !== "string") return fallback;
	const match = /^(\d+)x(\d+)$/.exec(size.trim());
	if (!match) return fallback;
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height)) return fallback;
	return { width, height };
};

const resolveFallbackSize = (
	params: Record<string, unknown>,
): { width: number; height: number } => {
	const size = resolveSize(params);
	if (size === "1536x1024") return { width: 1536, height: 1024 };
	if (size === "1024x1536") return { width: 1024, height: 1536 };
	return { width: 1024, height: 1024 };
};

const normalizeOutputFormat = (format: unknown): "png" | "jpeg" | "webp" => {
	if (format === "jpeg" || format === "webp") return format;
	return "png";
};

const outputFormatToMimeType = (format: "png" | "jpeg" | "webp"): string => {
	if (format === "jpeg") return "image/jpeg";
	if (format === "webp") return "image/webp";
	return "image/png";
};

const outputFormatToExtension = (format: "png" | "jpeg" | "webp"): string => {
	if (format === "jpeg") return "jpg";
	return format;
};

const normalizeFileName = (
	prompt: string,
	format: "png" | "jpeg" | "webp",
	index: number,
): string => {
	const stem =
		prompt
			.slice(0, 42)
			.trim()
			.replace(/[\\/:*?"<>|]/g, "-") || "openai-image";
	const suffix = index > 0 ? `-${index + 1}` : "";
	return `${stem}${suffix}.${outputFormatToExtension(format)}`;
};

class OpenAiImageHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "OpenAiImageHttpError";
	}
}

export class OpenAiImageAgentClient implements AgentClient {
	private readonly config:
		| OpenAiImageConfig
		| (() => OpenAiImageConfig | null | undefined);
	private readonly fetchImpl: typeof fetch;
	private readonly resolveEditSource?: (
		request: AgentRunRequest,
	) => Promise<OpenAiImageEditSource | null>;
	private readonly runs = new Map<string, AgentRun>();
	private readonly seqByRunId = new Map<string, number>();
	private readonly listenersByRunId = new Map<string, Set<AgentRunListener>>();
	private readonly abortControllersByRunId = new Map<string, AbortController>();

	constructor(options: OpenAiImageAgentClientOptions) {
		this.config = options.config;
		this.fetchImpl =
			options.fetch ?? ((input, init) => globalThis.fetch(input, init));
		this.resolveEditSource = options.resolveEditSource;
	}

	async createRun(request: AgentRunRequest): Promise<AgentRun> {
		const now = Date.now();
		const run: AgentRun = {
			id: createId("run"),
			sessionId: createId("session"),
			scope: request.scope,
			kind: request.kind,
			status: "queued",
			actorId: "agent:openai",
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
		void this.executeRun(run.id, request);
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
		this.abortControllersByRunId.get(runId)?.abort();
		this.abortControllersByRunId.delete(runId);
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
		return OPENAI_IMAGE_MODELS.flatMap((model) => [
			{
				id: model.id,
				label: model.label,
				kind: "image.generate" as const,
			},
			{
				id: model.id,
				label: model.label,
				kind: "image.edit" as const,
			},
		]);
	}

	async quote(): Promise<AgentQuote> {
		return {
			estimatedCredits: null,
			currency: "external",
			label: "OpenAI BYOK",
		};
	}

	private createInitialSteps(request: AgentRunRequest): AgentStep[] {
		if (request.kind === "image.edit") {
			return [createStep("调用 OpenAI 图片编辑")];
		}
		return [createStep("调用 OpenAI 图片生成")];
	}

	private async executeRun(
		runId: string,
		request: AgentRunRequest,
	): Promise<void> {
		const controller = new AbortController();
		this.abortControllersByRunId.set(runId, controller);
		const config = this.resolveConfig();
		try {
			if (!config) {
				throw new Error("OpenAI API Key 未配置。");
			}
			this.markStepRunning(runId, 0);
			this.patchRun(runId, { status: "running" });
			const images =
				request.kind === "image.edit"
					? await this.createImageEdit(request, config, controller.signal)
					: await this.createImageGeneration(
							request,
							config,
							controller.signal,
						);
			if (this.isRunTerminal(runId)) return;
			const run = this.runs.get(runId);
			if (!run) return;
			const artifacts = this.createArtifacts(run, images);
			this.patchRun(runId, {
				status: "materializing_artifacts",
				artifacts,
				steps: run.steps.map((step) => ({
					...step,
					status: "succeeded",
					updatedAt: Date.now(),
				})),
			});
			const materializedRun = this.runs.get(runId);
			if (
				!materializedRun ||
				isTerminalAgentRunStatus(materializedRun.status)
			) {
				return;
			}
			const effects = this.createEffects(materializedRun);
			this.patchRun(runId, {
				status: "applying_effects",
				effects,
			});
		} catch (error) {
			if (isAbortError(error) && this.isRunTerminal(runId)) return;
			const message = redactSecrets(
				error instanceof Error ? error.message : String(error),
				[config?.apiKey ?? ""],
			);
			this.failRun(runId, message);
		} finally {
			this.abortControllersByRunId.delete(runId);
		}
	}

	private resolveConfig(): OpenAiImageConfig | null {
		const value =
			typeof this.config === "function" ? this.config() : this.config;
		return normalizeConfig(value);
	}

	private async createImageGeneration(
		request: AgentRunRequest,
		config: OpenAiImageConfig,
		signal: AbortSignal,
	): Promise<OpenAiImageResult[]> {
		const prompt = readString(request.input, "prompt").trim();
		if (!prompt) throw new Error("Prompt 不能为空。");
		const params = request.params ?? {};
		const body: Record<string, unknown> = {
			model: resolveModel(params),
			prompt,
			quality: resolveQuality(params),
			size: resolveSize(params),
			output_format: "png",
		};
		const variants = resolveVariantCount(params);
		if (variants > 1) {
			body.n = variants;
		}
		return this.requestImages({
			config,
			path: "/images/generations",
			init: {
				method: "POST",
				headers: {
					Authorization: `Bearer ${config.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
				signal,
			},
		});
	}

	private async createImageEdit(
		request: AgentRunRequest,
		config: OpenAiImageConfig,
		signal: AbortSignal,
	): Promise<OpenAiImageResult[]> {
		const instruction = readString(request.input, "instruction").trim();
		if (!instruction) throw new Error("编辑指令不能为空。");
		if (!this.resolveEditSource) {
			throw new Error("OpenAI 图片编辑缺少源图 resolver。");
		}
		const source = await this.resolveEditSource(request);
		if (!source) {
			throw new Error("无法读取待编辑图片。");
		}
		const params = request.params ?? {};
		const form = new FormData();
		form.append("model", resolveModel(params));
		form.append("prompt", instruction);
		form.append("image", source.data, source.name);
		form.append("quality", resolveQuality(params));
		form.append("size", resolveSize(params));
		form.append("output_format", "png");
		return this.requestImages({
			config,
			path: "/images/edits",
			init: {
				method: "POST",
				headers: {
					Authorization: `Bearer ${config.apiKey}`,
				},
				body: form,
				signal,
			},
		});
	}

	private async requestImages({
		config,
		path,
		init,
	}: {
		config: OpenAiImageConfig;
		path: string;
		init: RequestInit;
	}): Promise<OpenAiImageResult[]> {
		const response = await this.fetchImpl(`${config.endpoint}${path}`, init);
		const payload = await readJsonPayload(response);
		if (!response.ok) {
			throw new OpenAiImageHttpError(
				response.status,
				resolveOpenAiErrorMessage(response.status, payload),
			);
		}
		const images = parseOpenAiImageResults(payload);
		if (images.length === 0) {
			throw new Error("OpenAI 响应中没有可用图片。");
		}
		return images;
	}

	private createArtifacts(
		run: AgentRun,
		images: OpenAiImageResult[],
	): AgentArtifact[] {
		const prompt =
			run.kind === "image.edit"
				? readString(run.input, "instruction", "image edit")
				: readString(run.input, "prompt", "image");
		const fallbackSize = resolveFallbackSize(run.params);
		const now = Date.now();
		return images.map((image, index): AgentArtifact => {
			const outputFormat = normalizeOutputFormat(image.outputFormat);
			const mimeType = outputFormatToMimeType(outputFormat);
			const size = parseSize(image.size, fallbackSize);
			return {
				id: createId("artifact"),
				runId: run.id,
				kind: "image",
				status: "ready",
				name: normalizeFileName(prompt, outputFormat, index),
				mimeType,
				width: size.width,
				height: size.height,
				source:
					typeof image.b64Json === "string"
						? {
								type: "inline-bytes",
								mimeType,
								base64: image.b64Json,
							}
						: {
								type: "remote-url",
								url: image.url ?? "",
							},
				createdAt: now,
			};
		});
	}

	private createEffects(run: AgentRun): AgentEffect[] {
		const nodeId =
			typeof run.context.targetNodeId === "string"
				? run.context.targetNodeId
				: run.scope.nodeId;
		if (!nodeId) return [];
		return run.artifacts.map((artifact) => ({
			id: createId("effect"),
			type: "image-node.bind-artifact",
			nodeId,
			artifactId: artifact.id,
			metadata: {
				sourceNodeId: run.scope.nodeId,
				prompt: readString(run.input, "prompt"),
				instruction: readString(run.input, "instruction"),
			},
		}));
	}

	private markStepRunning(runId: string, index: number): void {
		const run = this.runs.get(runId);
		if (!run || isTerminalAgentRunStatus(run.status)) return;
		this.patchRun(runId, {
			steps: run.steps.map((step, stepIndex) =>
				stepIndex === index
					? { ...step, status: "running", updatedAt: Date.now() }
					: step,
			),
		});
	}

	private failRun(runId: string, error: string): AgentRun | null {
		const run = this.runs.get(runId);
		if (!run || isTerminalAgentRunStatus(run.status)) return run ?? null;
		return this.patchRun(runId, {
			status: "failed",
			error,
			steps: run.steps.map((step) =>
				step.status === "succeeded"
					? step
					: { ...step, status: "failed", updatedAt: Date.now() },
			),
		});
	}

	private isRunTerminal(runId: string): boolean {
		const run = this.runs.get(runId);
		return !run || isTerminalAgentRunStatus(run.status);
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

interface OpenAiImageResult {
	b64Json?: string;
	url?: string;
	outputFormat?: string;
	size?: string;
}

const readJsonPayload = async (response: Response): Promise<unknown> => {
	const text = await response.text();
	if (!text.trim()) return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
};

const resolveOpenAiErrorMessage = (
	status: number,
	payload: unknown,
): string => {
	if (isRecord(payload)) {
		const error = payload.error;
		if (isRecord(error) && typeof error.message === "string") {
			return `OpenAI 请求失败 (${status}): ${error.message}`;
		}
		if (typeof payload.message === "string") {
			return `OpenAI 请求失败 (${status}): ${payload.message}`;
		}
	}
	if (typeof payload === "string" && payload.trim()) {
		return `OpenAI 请求失败 (${status}): ${payload.trim().slice(0, 300)}`;
	}
	return `OpenAI 请求失败 (${status})。`;
};

const parseOpenAiImageResults = (payload: unknown): OpenAiImageResult[] => {
	if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
	return payload.data
		.map((item): OpenAiImageResult | null => {
			if (!isRecord(item)) return null;
			const b64Json = item.b64_json;
			const url = item.url;
			if (typeof b64Json !== "string" && typeof url !== "string") return null;
			return {
				b64Json: typeof b64Json === "string" ? b64Json : undefined,
				url: typeof url === "string" ? url : undefined,
				outputFormat:
					typeof item.output_format === "string"
						? item.output_format
						: undefined,
				size: typeof item.size === "string" ? item.size : undefined,
			};
		})
		.filter((item): item is OpenAiImageResult => Boolean(item));
};
