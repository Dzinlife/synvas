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
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import type { ImageCanvasNode, StudioProject } from "@/studio/project/types";
import { ImageNodeAgentPanel } from "./agent";

vi.mock("@/components/ui/select", async () => {
	const React = await import("react");
	type Option = { value: string; label: string };
	type SelectContextValue = {
		value: string;
		onValueChange: (value: string) => void;
		items: Option[];
	};
	const SelectContext = React.createContext<SelectContextValue | null>(null);

	return {
		Select: ({
			value,
			onValueChange,
			items,
			children,
		}: SelectContextValue & { children: React.ReactNode }) => (
			<SelectContext.Provider value={{ value, onValueChange, items }}>
				{children}
			</SelectContext.Provider>
		),
		SelectTrigger: ({ "aria-label": ariaLabel }: { "aria-label": string }) => {
			const context = React.useContext(SelectContext);
			if (!context) return null;
			return (
				<select
					aria-label={ariaLabel}
					value={context.value}
					onChange={(event) => context.onValueChange(event.currentTarget.value)}
				>
					{context.items.map((item) => (
						<option key={item.value} value={item.value}>
							{item.label}
						</option>
					))}
				</select>
			);
		},
		SelectValue: () => null,
		SelectContent: () => null,
		SelectItem: () => null,
	};
});

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

const readSelectedOptionLabel = (ariaLabel: string): string =>
	(screen.getByLabelText(ariaLabel) as HTMLSelectElement).selectedOptions[0]
		?.textContent ?? "";

const selectOption = async (ariaLabel: string, optionName: string) => {
	const select = screen.getByLabelText(ariaLabel) as HTMLSelectElement;
	const option = Array.from(select.options).find(
		(item) => item.textContent === optionName,
	);
	expect(option).toBeTruthy();
	fireEvent.change(select, { target: { value: option?.value } });
	await waitFor(() => {
		expect(readSelectedOptionLabel(ariaLabel)).toBe(optionName);
	});
};

const readNumberInputValue = (ariaLabel: string): string =>
	(screen.getByLabelText(ariaLabel) as HTMLInputElement).value.replaceAll(
		",",
		"",
	);

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
		useStudioHistoryStore.getState().clear();
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

	it("缺少 OpenAI key 时禁用 generate 提交并显示 GPT Image 选项", async () => {
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
		await selectOption("生图模型", "GPT Image 1.5");
		expect(screen.getByText("GPT Image 1.5")).toBeTruthy();
		expect(screen.queryByText("Mock Standard")).toBeNull();
		expect(
			(screen.getByRole("button", { name: /Generate/i }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("generate 默认提交 1:1 1024 尺寸参数", async () => {
		useAiProviderConfigStore.setState({
			config: {
				openai: {
					endpoint: "https://api.openai.com/v1",
					apiKey: "sk-test",
				},
			},
		});
		const client = renderPanel(createNode());
		expect(screen.queryByText("Reference")).toBeNull();
		expect(screen.queryByText("Coming soon")).toBeNull();

		fireEvent.change(
			screen.getByPlaceholderText("Describe the image to generate"),
			{
				target: { value: "blue house" },
			},
		);
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
					model: "gpt-image-2",
					quality: "auto",
					size: "1024x1024",
					aspectRatio: "1:1",
					variants: 1,
				},
			}),
		);
	});

	it("generate 会使用客户端返回的图片模型能力", async () => {
		useAiProviderConfigStore.setState({
			config: {
				openai: {
					endpoint: "https://api.openai.com/v1",
					apiKey: "sk-test",
				},
			},
		});
		const client = createClient();
		vi.mocked(client.listModels).mockResolvedValue([
			{
				id: "vendor-image",
				label: "Vendor Image",
				kind: "image.generate",
				image: {
					qualityOptions: [{ value: "standard", label: "Standard" }],
					defaultQuality: "standard",
					aspectRatios: [
						{
							value: "1:1",
							label: "1:1",
							width: 1,
							height: 1,
							size: { width: 512, height: 512 },
						},
					],
					defaultAspectRatio: "1:1",
					defaultSize: { width: 512, height: 512 },
					size: {
						mode: "fixed",
						sizes: [{ width: 512, height: 512 }],
					},
					maxVariants: 3,
				},
			},
		]);
		renderPanel(createNode(), client);

		await waitFor(() => {
			expect(readSelectedOptionLabel("生图模型")).toBe("Vendor Image");
		});
		fireEvent.change(
			screen.getByPlaceholderText("Describe the image to generate"),
			{
				target: { value: "vendor image" },
			},
		);
		fireEvent.click(screen.getByRole("button", { name: /Generate/i }));

		await waitFor(() => {
			expect(client.createRun).toHaveBeenCalledTimes(1);
		});
		expect(client.createRun).toHaveBeenCalledWith(
			expect.objectContaining({
				params: {
					model: "vendor-image",
					quality: "standard",
					size: "512x512",
					aspectRatio: "1:1",
					variants: 1,
				},
			}),
		);
	});

	it("generate 改比例后不立刻同步 node，提交后只更新非撤销尺寸", async () => {
		useAiProviderConfigStore.setState({
			config: {
				openai: {
					endpoint: "https://api.openai.com/v1",
					apiKey: "sk-test",
				},
			},
		});
		const node = createNode();
		useProjectStore.setState({
			currentProject: createProject(node),
		});
		const client = renderPanel(node);

		fireEvent.change(
			screen.getByPlaceholderText("Describe the image to generate"),
			{
				target: { value: "wide image" },
			},
		);
		await selectOption("图片比例", "16:9");

		expect(readNumberInputValue("图片宽度")).toBe("2048");
		expect(readNumberInputValue("图片高度")).toBe("1152");
		const pendingNode = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((item) => item.id === node.id);
		expect(pendingNode?.width).toBe(512);
		expect(pendingNode?.height).toBe(512);
		expect(useStudioHistoryStore.getState().past).toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: /Generate/i }));

		await waitFor(() => {
			const syncedNode = useProjectStore
				.getState()
				.currentProject?.canvas.nodes.find((item) => item.id === node.id);
			expect(syncedNode?.width).toBe(512);
			expect(syncedNode?.height).toBe(288);
		});
		expect(useStudioHistoryStore.getState().past).toHaveLength(0);
		await waitFor(() => {
			expect(client.createRun).toHaveBeenCalledTimes(1);
		});
		expect(client.createRun).toHaveBeenCalledWith(
			expect.objectContaining({
				params: {
					model: "gpt-image-2",
					quality: "auto",
					size: "2048x1152",
					aspectRatio: "16:9",
					variants: 1,
				},
			}),
		);
	});

	it("gpt-image-2 手动分辨率会锁定 16 倍数并在提交后同步 custom 显示比例", async () => {
		useAiProviderConfigStore.setState({
			config: {
				openai: {
					endpoint: "https://api.openai.com/v1",
					apiKey: "sk-test",
				},
			},
		});
		const node = createNode();
		useProjectStore.setState({
			currentProject: createProject(node),
		});
		const client = renderPanel(node);

		fireEvent.change(
			screen.getByPlaceholderText("Describe the image to generate"),
			{
				target: { value: "custom image" },
			},
		);
		const widthInput = screen.getByLabelText("图片宽度") as HTMLInputElement;
		fireEvent.change(widthInput, { target: { value: "2001" } });
		fireEvent.blur(widthInput);

		expect(widthInput.value.replaceAll(",", "")).toBe("2000");
		expect(readSelectedOptionLabel("图片比例")).toBe("Custom");
		const pendingNode = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((item) => item.id === node.id);
		expect(pendingNode?.width).toBe(512);
		expect(pendingNode?.height).toBe(512);
		expect(useStudioHistoryStore.getState().past).toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: /Generate/i }));

		await waitFor(() => {
			const syncedNode = useProjectStore
				.getState()
				.currentProject?.canvas.nodes.find((item) => item.id === node.id);
			expect(syncedNode?.width).toBe(512);
			expect(syncedNode?.height).toBeCloseTo(262.144, 3);
		});
		await waitFor(() => {
			expect(client.createRun).toHaveBeenCalledTimes(1);
		});
		expect(client.createRun).toHaveBeenCalledWith(
			expect.objectContaining({
				params: {
					model: "gpt-image-2",
					quality: "auto",
					size: "2000x1024",
					aspectRatio: "custom",
					variants: 1,
				},
			}),
		);
	});

	it("undo 已有历史时保留 loading node 尺寸和节点本身", async () => {
		useAiProviderConfigStore.setState({
			config: {
				openai: {
					endpoint: "https://api.openai.com/v1",
					apiKey: "sk-test",
				},
			},
		});
		const node = createNode();
		useProjectStore.setState({
			currentProject: createProject(node),
		});
		useStudioHistoryStore.getState().push({
			kind: "canvas.node-create",
			node,
			focusNodeId: null,
		});
		renderPanel(node);

		fireEvent.change(
			screen.getByPlaceholderText("Describe the image to generate"),
			{
				target: { value: "wide image" },
			},
		);
		await selectOption("图片比例", "16:9");
		fireEvent.click(screen.getByRole("button", { name: /Generate/i }));
		await waitFor(() => {
			const syncedNode = useProjectStore
				.getState()
				.currentProject?.canvas.nodes.find((item) => item.id === node.id);
			expect(syncedNode?.height).toBe(288);
		});
		useStudioHistoryStore.getState().undo();

		const undoNode = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((item) => item.id === node.id);
		expect(undoNode).toMatchObject({
			type: "image",
			width: 512,
			height: 288,
			assetId: null,
		});
	});

	it("切到旧模型会夹到固定尺寸并禁用分辨率输入", async () => {
		useAiProviderConfigStore.setState({
			config: {
				openai: {
					endpoint: "https://api.openai.com/v1",
					apiKey: "sk-test",
				},
			},
		});
		renderPanel(createNode());

		await selectOption("图片比例", "16:9");
		await selectOption("生图模型", "GPT Image 1.5");

		expect(readNumberInputValue("图片宽度")).toBe("1536");
		expect(readNumberInputValue("图片高度")).toBe("1024");
		expect(
			(screen.getByLabelText("图片宽度") as HTMLInputElement).disabled,
		).toBe(true);
		expect(readSelectedOptionLabel("图片比例")).toBe("3:2");
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
		expect(screen.queryByText("Reference")).toBeNull();
		expect(screen.queryByText("Coming soon")).toBeNull();

		fireEvent.change(screen.getByPlaceholderText("Describe the edit"), {
			target: { value: "add a sunset" },
		});
		await selectOption("编辑模型", "GPT Image 1");
		await selectOption("编辑图片质量", "High");
		await selectOption("图片比例", "2:3");
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
					size: "1024x1536",
					aspectRatio: "2:3",
				},
				context: {
					sourceAssetId: "asset-image-1",
					targetNodeId: expect.any(String),
				},
			}),
		);
		const targetNodeId = vi.mocked(client.createRun).mock.calls[0]?.[0].context
			?.targetNodeId as string;
		const targetNode = useProjectStore
			.getState()
			.currentProject?.canvas.nodes.find((item) => item.id === targetNodeId);
		expect(targetNode).toMatchObject({
			type: "image",
			width: 512,
			height: 768,
		});
		expect(useStudioHistoryStore.getState().past).toHaveLength(0);
	});
});
