// @vitest-environment jsdom

import type { AgentRun } from "@synvas/agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "@/projects/projectStore";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import type { StudioProject } from "@/studio/project/types";
import { applyAgentEffects } from "./applyAgentEffects";

const mocks = vi.hoisted(() => ({
	ingestExternalFileAsset: vi.fn(),
}));

vi.mock("@/projects/assetIngest", () => ({
	ingestExternalFileAsset: mocks.ingestExternalFileAsset,
}));

const createProject = (): StudioProject => ({
	id: "project-1",
	revision: 0,
	assets: [],
	canvas: {
		nodes: [
			{
				id: "node-image-1",
				type: "image",
				assetId: null,
				name: "Image",
				x: 0,
				y: 0,
				width: 512,
				height: 512,
				siblingOrder: 0,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
		],
	},
	scenes: {},
	ui: {
		activeSceneId: null,
		focusedNodeId: null,
		activeNodeId: "node-image-1",
		canvasSnapEnabled: true,
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

const createRun = (
	nodeId = "node-image-1",
	artifactSize: { width: number; height: number } = {
		width: 2048,
		height: 1152,
	},
): AgentRun => ({
	id: "run-1",
	sessionId: "session-1",
	providerId: "openai",
	modelId: "gpt-image-2",
	scope: { type: "node", projectId: "project-1", nodeId },
	kind: "image.generate",
	status: "applying_effects",
	actorId: "agent:local",
	input: { prompt: "blue house" },
	params: {},
	context: {},
	steps: [],
	artifacts: [
		{
			id: "artifact-1",
			runId: "run-1",
			kind: "image",
			status: "ready",
			name: "mock.png",
			mimeType: "image/png",
			width: artifactSize.width,
			height: artifactSize.height,
			source: {
				type: "inline-bytes",
				mimeType: "image/png",
				base64:
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
			},
			createdAt: 1,
		},
	],
	effects: [
		{
			id: "effect-1",
			type: "image-node.bind-artifact",
			nodeId,
			artifactId: "artifact-1",
			metadata: {
				sourceNodeId: nodeId,
				prompt: "blue house",
			},
		},
	],
	effectApplications: [],
	createdAt: 1,
	updatedAt: 1,
});

describe("applyAgentEffects", () => {
	beforeEach(() => {
		mocks.ingestExternalFileAsset.mockResolvedValue({
			name: "mock.png",
			locator: {
				type: "managed",
				fileName: "mock.png",
			},
			meta: {
				hash: "hash-1",
				fileName: "mock.png",
			},
		});
		useProjectStore.setState({
			status: "ready",
			projects: [],
			currentProjectId: "project-1",
			currentProject: createProject(),
			focusedSceneDrafts: {},
			error: null,
		});
		useStudioHistoryStore.getState().clear();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("会持久化 artifact 并绑定到 image node", async () => {
		const applications = await applyAgentEffects(createRun());

		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find(
			(item) => item.id === "node-image-1",
		);
		expect(applications).toEqual([{ effectId: "effect-1", status: "applied" }]);
		expect(project?.assets).toHaveLength(1);
		expect(node).toMatchObject({
			type: "image",
			width: 512,
			height: 288,
			assetId: project?.assets[0]?.id,
			ai: {
				sourceRunId: "run-1",
				sourceNodeId: "node-image-1",
			},
		});
		expect(useStudioHistoryStore.getState().past).toHaveLength(0);
	});

	it("目标节点不存在时保留 asset 并跳过 effect", async () => {
		const applications = await applyAgentEffects(createRun("missing-node"));

		const project = useProjectStore.getState().currentProject;
		expect(project?.assets).toHaveLength(1);
		expect(applications).toEqual([
			{
				effectId: "effect-1",
				status: "skipped",
				reason: "target_missing",
			},
		]);
	});

	it("undo 不回滚 agent 生成结果绑定", async () => {
		const historyNode = createProject().canvas.nodes[0];
		if (!historyNode) throw new Error("Missing test node.");
		useStudioHistoryStore.getState().push({
			kind: "canvas.node-create",
			node: historyNode,
			focusNodeId: null,
		});
		await applyAgentEffects(createRun());
		const assetId = useProjectStore.getState().currentProject?.assets[0]?.id;

		useStudioHistoryStore.getState().undo();

		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find(
			(item) => item.id === "node-image-1",
		);
		expect(project?.assets[0]?.id).toBe(assetId);
		expect(node).toMatchObject({
			type: "image",
			width: 512,
			height: 288,
			assetId,
			ai: {
				sourceRunId: "run-1",
				sourceNodeId: "node-image-1",
			},
		});
	});

	it("artifact 尺寸无效时保留当前 node 尺寸", async () => {
		useProjectStore.getState().updateCanvasNodeLayout("node-image-1", {
			width: 512,
			height: 288,
		});

		await applyAgentEffects(createRun("node-image-1", { width: 0, height: 0 }));

		const project = useProjectStore.getState().currentProject;
		const node = project?.canvas.nodes.find(
			(item) => item.id === "node-image-1",
		);
		expect(node).toMatchObject({
			type: "image",
			width: 512,
			height: 288,
			assetId: project?.assets[0]?.id,
			ai: {
				sourceRunId: "run-1",
				sourceNodeId: "node-image-1",
			},
		});
		expect(useStudioHistoryStore.getState().past).toHaveLength(0);
	});
});
