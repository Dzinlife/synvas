// @vitest-environment jsdom

import type { AgentClient, AgentRun, AgentRunRequest } from "@synvas/agent";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProvider, useAiProviderConfigStore } from "@/agent-system";
import { useAgentRuntimeStore } from "@/agent-system/agentRuntimeStore";
import { useProjectStore } from "@/projects/projectStore";
import type { ImageCanvasNode, StudioProject } from "@/studio/project/types";
import { ImageNodeAgentPanel } from "./agent";

const createNode = (patch: Partial<ImageCanvasNode> = {}): ImageCanvasNode => ({
	id: "node-image-1",
	type: "image",
	name: "Image",
	assetId: null,
	x: 0,
	y: 0,
	width: 512,
	height: 512,
	siblingOrder: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	...patch,
});

const createRun = (request: AgentRunRequest): AgentRun => {
	const now = Date.now();
	return {
		id: "run-1",
		sessionId: "session-1",
		scope: request.scope,
		kind: request.kind,
		status: "queued",
		actorId: "agent:test",
		input: request.input,
		params: request.params ?? {},
		context: request.context ?? {},
		steps: [],
		artifacts: [],
		effects: [],
		effectApplications: [],
		createdAt: now,
		updatedAt: now,
	};
};

const createProject = (node: ImageCanvasNode): StudioProject => ({
	id: "project-1",
	revision: 0,
	assets: [
		{
			id: "asset-image-1",
			kind: "image",
			name: "source.png",
			locator: {
				type: "managed",
				fileName: "source.png",
			},
		},
	],
	canvas: {
		nodes: [node],
	},
	scenes: {},
	ui: {
		activeSceneId: null,
		focusedNodeId: null,
		activeNodeId: node.id,
		canvasSnapEnabled: true,
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

const createClient = (): AgentClient => ({
	createRun: vi.fn(async (request) => createRun(request)),
	subscribeRun: vi.fn(() => () => {}),
	cancelRun: vi.fn(async () => null),
	completeRunApplication: vi.fn(async () => null),
	failRunApplication: vi.fn(async () => null),
	listModels: vi.fn(async () => []),
	quote: vi.fn(async () => ({
		estimatedCredits: null,
		currency: "external" as const,
		label: "OpenAI BYOK",
	})),
});

const renderPanel = (node: ImageCanvasNode, client = createClient()) => {
	render(
		<AgentProvider client={client}>
			<ImageNodeAgentPanel node={node} asset={null} scene={null} />
		</AgentProvider>,
	);
	return client;
};

describe("ImageNodeAgentPanel", () => {
	beforeEach(() => {
		useProjectStore.setState({
			status: "ready",
			currentProjectId: "project-1",
			currentProject: null,
			projects: [],
			focusedSceneDrafts: {},
			error: null,
		});
		useAgentRuntimeStore.getState().clear();
		useAiProviderConfigStore.setState({
			config: {
				openai: {
					endpoint: "https://api.openai.com/v1",
					apiKey: "",
				},
			},
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("缺少 OpenAI key 时禁用 generate 提交并显示 GPT Image 选项", () => {
		renderPanel(createNode());

		fireEvent.change(
			screen.getByPlaceholderText("Describe the image to generate"),
			{
				target: { value: "blue house" },
			},
		);

		expect(
			screen.getByText("请先在顶部 AI 设置中配置 OpenAI API Key。"),
		).toBeTruthy();
		expect(screen.getByText("GPT Image 2")).toBeTruthy();
		expect(screen.getByText("GPT Image 1.5")).toBeTruthy();
		expect(screen.queryByText("Mock Standard")).toBeNull();
		expect(
			(screen.getByRole("button", { name: /Generate/i }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("generate 会提交 OpenAI 模型、质量和尺寸参数", async () => {
		useAiProviderConfigStore.setState({
			config: {
				openai: {
					endpoint: "https://api.openai.com/v1",
					apiKey: "sk-test",
				},
			},
		});
		const client = renderPanel(createNode());

		fireEvent.change(
			screen.getByPlaceholderText("Describe the image to generate"),
			{
				target: { value: "blue house" },
			},
		);
		fireEvent.change(screen.getByLabelText("生图模型"), {
			target: { value: "gpt-image-1.5" },
		});
		fireEvent.change(screen.getByLabelText("图片质量"), {
			target: { value: "medium" },
		});
		fireEvent.change(screen.getByLabelText("图片尺寸"), {
			target: { value: "1024x1536" },
		});
		fireEvent.click(screen.getByRole("button", { name: /Generate/i }));

		await waitFor(() => {
			expect(client.createRun).toHaveBeenCalledTimes(1);
		});
		expect(client.createRun).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "image.generate",
				input: {
					prompt: "blue house",
				},
				params: {
					model: "gpt-image-1.5",
					quality: "medium",
					size: "1024x1536",
					variants: 1,
				},
			}),
		);
	});

	it("edit 会提交 OpenAI 模型和质量参数", async () => {
		useAiProviderConfigStore.setState({
			config: {
				openai: {
					endpoint: "https://api.openai.com/v1",
					apiKey: "sk-test",
				},
			},
		});
		const node = createNode({ assetId: "asset-image-1" });
		useProjectStore.setState({
			currentProject: createProject(node),
		});
		const client = renderPanel(node);

		fireEvent.change(screen.getByPlaceholderText("Describe the edit"), {
			target: { value: "add a sunset" },
		});
		fireEvent.change(screen.getByLabelText("编辑模型"), {
			target: { value: "gpt-image-1" },
		});
		fireEvent.change(screen.getByLabelText("编辑图片质量"), {
			target: { value: "high" },
		});
		fireEvent.click(screen.getByRole("button", { name: /Edit/i }));

		await waitFor(() => {
			expect(client.createRun).toHaveBeenCalledTimes(1);
		});
		expect(client.createRun).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "image.edit",
				input: {
					instruction: "add a sunset",
				},
				params: {
					model: "gpt-image-1",
					quality: "high",
					size: "auto",
				},
				context: {
					sourceAssetId: "asset-image-1",
					targetNodeId: expect.any(String),
				},
			}),
		);
	});
});
