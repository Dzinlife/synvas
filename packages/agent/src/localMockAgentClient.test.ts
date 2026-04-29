import { describe, expect, it, vi } from "vitest";
import {
	LOCAL_MOCK_AGENT_RUN_DURATION_MS,
	LocalMockAgentClient,
} from "./localMockAgentClient";

describe("LocalMockAgentClient", () => {
	it("按事件流完成 generate run", async () => {
		vi.useFakeTimers();
		const client = new LocalMockAgentClient({ stepDelayMs: 10 });
		const run = await client.createRun({
			providerId: "local-mock",
			modelId: "mock-image-standard",
			kind: "image.generate",
			scope: { type: "node", projectId: "project-1", nodeId: "node-1" },
			input: { prompt: "blue house" },
			params: { aspectRatio: "16:9" },
		});
		const statuses: string[] = [];
		client.subscribeRun(run.id, (event) => {
			statuses.push(event.run.status);
		});

		await vi.advanceTimersByTimeAsync(30);
		expect(statuses).toContain("queued");
		expect(statuses).toContain("running");
		expect(statuses).toContain("materializing_artifacts");
		expect(statuses).toContain("applying_effects");

		const applyingRun = statuses.at(-1);
		expect(applyingRun).toBe("applying_effects");
		await client.completeRunApplication(run.id, [
			{ effectId: "effect-1", status: "applied" },
		]);
		expect(statuses.at(-1)).toBe("succeeded");
		vi.useRealTimers();
	});

	it("默认 mock run 会在 10s 左右进入 applying_effects", async () => {
		vi.useFakeTimers();
		const client = new LocalMockAgentClient();
		const run = await client.createRun({
			providerId: "local-mock",
			modelId: "mock-image-standard",
			kind: "image.generate",
			scope: { type: "node", projectId: "project-1", nodeId: "node-1" },
			input: { prompt: "long loading" },
		});
		const statuses: string[] = [];
		client.subscribeRun(run.id, (event) => {
			statuses.push(event.run.status);
		});

		await vi.advanceTimersByTimeAsync(LOCAL_MOCK_AGENT_RUN_DURATION_MS - 1);
		expect(statuses.at(-1)).not.toBe("applying_effects");

		await vi.advanceTimersByTimeAsync(2);
		expect(statuses.at(-1)).toBe("applying_effects");
		vi.useRealTimers();
	});

	it("cancel 会停止未完成 run", async () => {
		vi.useFakeTimers();
		const client = new LocalMockAgentClient({ stepDelayMs: 10 });
		const run = await client.createRun({
			providerId: "local-mock",
			modelId: "mock-image-edit",
			kind: "image.edit",
			scope: { type: "node", projectId: "project-1", nodeId: "node-1" },
			input: { instruction: "make it brighter" },
			context: { targetNodeId: "node-2" },
		});
		const statuses: string[] = [];
		client.subscribeRun(run.id, (event) => {
			statuses.push(event.run.status);
		});

		await client.cancelRun(run.id);
		await vi.advanceTimersByTimeAsync(40);

		expect(statuses.at(-1)).toBe("cancelled");
		expect(statuses).not.toContain("applying_effects");
		vi.useRealTimers();
	});

	it("edit run 输出 artifact 和绑定目标节点的 effect", async () => {
		vi.useFakeTimers();
		const client = new LocalMockAgentClient({ stepDelayMs: 10 });
		const run = await client.createRun({
			providerId: "local-mock",
			modelId: "mock-image-edit",
			kind: "image.edit",
			scope: { type: "node", projectId: "project-1", nodeId: "source-node" },
			input: { instruction: "add a sunset" },
			context: { targetNodeId: "target-node" },
		});
		let latest = run;
		client.subscribeRun(run.id, (event) => {
			latest = event.run;
		});

		await vi.advanceTimersByTimeAsync(30);

		expect(latest.artifacts).toHaveLength(1);
		expect(latest.effects).toMatchObject([
			{
				type: "image-node.bind-artifact",
				nodeId: "target-node",
				artifactId: latest.artifacts[0]?.id,
			},
		]);
		vi.useRealTimers();
	});
});
