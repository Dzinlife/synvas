import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiImageAgentClient } from "./openAiImageAgentClient";
import type { AgentRun } from "./types";

const MOCK_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const flushAsyncWork = async () => {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
};

const createImageResponse = (body: unknown, status = 200): Response => {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
		},
	});
};

describe("OpenAiImageAgentClient", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("generate 会调用可配置 endpoint 并输出 inline image artifact", async () => {
		const fetchMock = vi.fn(async () =>
			createImageResponse({
				data: [
					{
						b64_json: MOCK_PNG_BASE64,
						output_format: "png",
						size: "1536x1024",
					},
				],
			}),
		) as unknown as typeof fetch;
		const client = new OpenAiImageAgentClient({
			config: {
				endpoint: "openai-proxy.test/v1/",
				apiKey: "sk-test-generate",
			},
			fetch: fetchMock,
		});

		const run = await client.createRun({
			kind: "image.generate",
			scope: { type: "node", projectId: "project-1", nodeId: "node-1" },
			input: { prompt: "blue house" },
			params: {
				model: "gpt-image-2",
				quality: "high",
				size: "1536x1024",
			},
		});
		let latest: AgentRun = run;
		client.subscribeRun(run.id, (event) => {
			latest = event.run;
		});
		await flushAsyncWork();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://openai-proxy.test/v1/images/generations");
		expect(init.headers).toMatchObject({
			Authorization: "Bearer sk-test-generate",
			"Content-Type": "application/json",
		});
		expect(JSON.parse(String(init.body))).toMatchObject({
			model: "gpt-image-2",
			prompt: "blue house",
			quality: "high",
			size: "1536x1024",
			output_format: "png",
		});
		expect(JSON.stringify(latest)).not.toContain("sk-test-generate");
		expect(latest.status).toBe("applying_effects");
		expect(latest.artifacts).toMatchObject([
			{
				kind: "image",
				mimeType: "image/png",
				width: 1536,
				height: 1024,
				source: {
					type: "inline-bytes",
					base64: MOCK_PNG_BASE64,
				},
			},
		]);
		expect(latest.effects).toMatchObject([
			{
				type: "image-node.bind-artifact",
				nodeId: "node-1",
				artifactId: latest.artifacts[0]?.id,
			},
		]);
	});

	it("默认 fetch 会保留 globalThis 绑定", async () => {
		const fetchMock = vi.fn(function (
			this: unknown,
			_input: Parameters<typeof fetch>[0],
			_init?: Parameters<typeof fetch>[1],
		): Promise<Response> {
			expect(this).toBe(globalThis);
			return Promise.resolve(
				createImageResponse({
					data: [
						{
							b64_json: MOCK_PNG_BASE64,
							output_format: "png",
							size: "1024x1024",
						},
					],
				}),
			);
		}) as unknown as typeof fetch;
		vi.stubGlobal("fetch", fetchMock);
		const client = new OpenAiImageAgentClient({
			config: {
				endpoint: "https://api.openai.test/v1",
				apiKey: "sk-test-global-fetch",
			},
		});

		const run = await client.createRun({
			kind: "image.generate",
			scope: { type: "node", projectId: "project-1", nodeId: "node-1" },
			input: { prompt: "blue house" },
		});
		let latest: AgentRun = run;
		client.subscribeRun(run.id, (event) => {
			latest = event.run;
		});
		await flushAsyncWork();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(latest.status).toBe("applying_effects");
		expect(JSON.stringify(latest)).not.toContain("sk-test-global-fetch");
	});

	it("edit 会发送源图 FormData 并绑定到目标节点", async () => {
		const fetchMock = vi.fn(async () =>
			createImageResponse({
				data: [
					{
						b64_json: MOCK_PNG_BASE64,
						output_format: "png",
						size: "1024x1024",
					},
				],
			}),
		) as unknown as typeof fetch;
		const resolveEditSource = vi.fn(async () => ({
			data: new File(["source"], "source.png", { type: "image/png" }),
			name: "source.png",
		}));
		const client = new OpenAiImageAgentClient({
			config: {
				endpoint: "https://api.openai.test/v1",
				apiKey: "sk-test-edit",
			},
			fetch: fetchMock,
			resolveEditSource,
		});

		const run = await client.createRun({
			kind: "image.edit",
			scope: { type: "node", projectId: "project-1", nodeId: "source-node" },
			input: { instruction: "add a sunset" },
			params: {
				model: "gpt-image-1.5",
				quality: "auto",
				size: "auto",
			},
			context: {
				sourceAssetId: "asset-1",
				targetNodeId: "target-node",
			},
		});
		let latest: AgentRun = run;
		client.subscribeRun(run.id, (event) => {
			latest = event.run;
		});
		await flushAsyncWork();

		expect(resolveEditSource).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.openai.test/v1/images/edits");
		expect(init.headers).toMatchObject({
			Authorization: "Bearer sk-test-edit",
		});
		const form = init.body as FormData;
		expect(form.get("model")).toBe("gpt-image-1.5");
		expect(form.get("prompt")).toBe("add a sunset");
		expect(form.get("quality")).toBe("auto");
		expect(form.get("size")).toBe("auto");
		expect(form.get("output_format")).toBe("png");
		expect(form.get("image")).toBeInstanceOf(File);
		expect(JSON.stringify(latest)).not.toContain("sk-test-edit");
		expect(latest.status).toBe("applying_effects");
		expect(latest.effects).toMatchObject([
			{
				type: "image-node.bind-artifact",
				nodeId: "target-node",
			},
		]);
	});

	it("非 2xx 响应会进入 failed 且不泄露 API key", async () => {
		const fetchMock = vi.fn(async () =>
			createImageResponse(
				{
					error: {
						message: "invalid api key",
					},
				},
				401,
			),
		) as unknown as typeof fetch;
		const client = new OpenAiImageAgentClient({
			config: {
				endpoint: "https://api.openai.test/v1",
				apiKey: "sk-secret-failure",
			},
			fetch: fetchMock,
		});

		const run = await client.createRun({
			kind: "image.generate",
			scope: { type: "node", projectId: "project-1", nodeId: "node-1" },
			input: { prompt: "blue house" },
		});
		let latest: AgentRun = run;
		client.subscribeRun(run.id, (event) => {
			latest = event.run;
		});
		await flushAsyncWork();

		expect(latest.status).toBe("failed");
		expect(latest.error).toContain("OpenAI 请求失败 (401)");
		expect(JSON.stringify(latest)).not.toContain("sk-secret-failure");
	});

	it("cancel 会 abort 请求并进入 cancelled", async () => {
		const fetchMock = vi.fn(
			(_url: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(new DOMException("Aborted", "AbortError"));
					});
				}),
		) as unknown as typeof fetch;
		const client = new OpenAiImageAgentClient({
			config: {
				endpoint: "https://api.openai.test/v1",
				apiKey: "sk-test-cancel",
			},
			fetch: fetchMock,
		});

		const run = await client.createRun({
			kind: "image.generate",
			scope: { type: "node", projectId: "project-1", nodeId: "node-1" },
			input: { prompt: "blue house" },
		});
		let latest: AgentRun = run;
		client.subscribeRun(run.id, (event) => {
			latest = event.run;
		});

		await client.cancelRun(run.id);
		await flushAsyncWork();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(latest.status).toBe("cancelled");
		expect(JSON.stringify(latest)).not.toContain("sk-test-cancel");
	});
});
