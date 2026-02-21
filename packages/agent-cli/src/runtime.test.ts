import type { TimelineElement } from "core/dsl/types";
import { describe, expect, it } from "vitest";
import { createAgentCliRuntime } from "./runtime";
import type {
	AgentCliHost,
	ParsedCommand,
	TimelineCommandSnapshot,
} from "./types";

const createElement = (id: string, start: number, end: number): TimelineElement => ({
	id,
	type: "VideoClip",
	component: "video-clip",
	name: id,
	timeline: {
		start,
		end,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:03:00",
		trackIndex: 0,
		trackId: "main-track",
	},
	props: {},
});

const createSnapshot = (): TimelineCommandSnapshot => ({
	revision: 1,
	fps: 30,
	currentTime: 0,
	elements: [createElement("clip-1", 0, 30)],
	assets: [],
	tracks: [
		{
			id: "main-track",
			role: "clip",
			hidden: false,
			locked: false,
			muted: false,
			solo: false,
		},
	],
	audioTrackStates: {},
	autoAttach: false,
	rippleEditingEnabled: false,
});

const createMockHost = (): AgentCliHost & {
	state: TimelineCommandSnapshot;
	undoCalls: number;
	redoCalls: number;
} => {
	let historyPastLength = 0;
	const host = {
		state: createSnapshot(),
		undoCalls: 0,
		redoCalls: 0,
		getSnapshot() {
			return this.state;
		},
		applySnapshot(snapshot: TimelineCommandSnapshot, options?: { history?: boolean }) {
			if (options?.history !== false) {
				historyPastLength += 1;
			}
			this.state = {
				...snapshot,
				revision: this.state.revision + 1,
			};
		},
		getRevision() {
			return this.state.revision;
		},
		getHistoryPastLength() {
			return historyPastLength;
		},
		undo() {
			this.undoCalls += 1;
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
			};
		},
		redo() {
			this.redoCalls += 1;
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
			};
		},
	};
	return host;
};

describe("agent-cli runtime", () => {
	it("支持计划->dry-run->确认->应用流程", () => {
		const host = createMockHost();
		const runtime = createAgentCliRuntime(host);
		const commands: ParsedCommand[] = [
			{
				id: "timeline.element.move",
				args: { id: "clip-1", start: 10 },
				raw: "timeline.element.move --id clip-1 --start 10",
			},
		];

		const plan = runtime.createPlan(commands);
		const report = runtime.dryRunPlan(plan);
		expect(report.ok).toBe(true);
		const confirmed = runtime.confirmPlan(plan.id);
		expect(confirmed).not.toBeNull();
		const result = runtime.applyPlan(confirmed!);
		expect(result.ok).toBe(true);
		expect(result.executed).toBe(1);
		expect(result.undoToken?.historyIndexBefore).toBe(0);
		expect(result.undoToken?.historyIndexAfter).toBe(1);
		expect(host.state.elements[0]?.timeline.start).toBe(10);
	});

	it("基线不一致时应返回 rebaseRequired", () => {
		const host = createMockHost();
		const runtime = createAgentCliRuntime(host);
		const commands: ParsedCommand[] = [
			{
				id: "timeline.seek",
				args: { time: 20 },
				raw: "timeline.seek --time 20",
			},
		];
		const plan = runtime.createPlan(commands, { baseRevision: 0 });
		const confirmed = runtime.confirmPlan(plan.id);
		expect(confirmed).not.toBeNull();
		const result = runtime.applyPlan(confirmed!);
		expect(result.ok).toBe(false);
		expect(result.rebaseRequired).toBe(true);
		expect(result.plan).toBeTruthy();
	});

	it("历史命令应走 host undo/redo", () => {
		const host = createMockHost();
		const runtime = createAgentCliRuntime(host);
		const plan = runtime.createPlan([
			{ id: "timeline.undo", args: {}, raw: "timeline.undo" },
		]);
		const confirmed = runtime.confirmPlan(plan.id);
		expect(confirmed).not.toBeNull();
		const result = runtime.applyPlan(confirmed!);
		expect(result.ok).toBe(true);
		expect(result.executed).toBe(1);
		expect(host.undoCalls).toBe(1);
		expect(host.redoCalls).toBe(0);
	});

	it("applyPlan 遇到 runtime 命令时应提示使用 applyPlanAsync", () => {
		const host = createMockHost();
		const runtime = createAgentCliRuntime(host);
		const plan = runtime.createPlan([
			{
				id: "timeline.element.quick-split",
				args: { id: "clip-1" },
				raw: "timeline.element.quick-split --id clip-1",
			},
		]);
		const confirmed = runtime.confirmPlan(plan.id);
		expect(confirmed).not.toBeNull();
		const result = runtime.applyPlan(confirmed!);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("applyPlanAsync");
	});

	it("applyPlanAsync 支持 runtime 与 state 命令混合批量执行", async () => {
		const host = createMockHost();
		host.executeRuntimeCommand = async () => {
			host.state = {
				...host.state,
				currentTime: 5,
				revision: host.state.revision + 1,
			};
			return {
				ok: true,
				changed: true,
				summaryText: "runtime ok",
			};
		};
		const runtime = createAgentCliRuntime(host);
		const plan = runtime.createPlan([
			{
				id: "timeline.element.quick-split",
				args: { id: "clip-1" },
				raw: "timeline.element.quick-split --id clip-1",
			},
			{
				id: "timeline.seek",
				args: { time: 20 },
				raw: "timeline.seek --time 20",
			},
		]);
		const dryRun = runtime.dryRunPlan(plan);
		expect(dryRun.ok).toBe(true);
		expect(dryRun.summaryText).toContain("runtime 命令");
		const confirmed = runtime.confirmPlan(plan.id);
		expect(confirmed).not.toBeNull();
		const result = await runtime.applyPlanAsync(confirmed!);
		expect(result.ok).toBe(true);
		expect(result.executed).toBe(2);
		expect(host.state.currentTime).toBe(20);
		expect(result.summaryText).toContain("runtime ok");
	});

	it("applyPlanAsync 可执行 runtime 命令", async () => {
		const host = createMockHost();
		host.executeRuntimeCommand = async (command) => {
			expect(command.id).toBe("timeline.element.quick-split");
			host.state = {
				...host.state,
				revision: host.state.revision + 1,
			};
			return {
				ok: true,
				changed: true,
				summaryText: "runtime quick split ok",
			};
		};
		const runtime = createAgentCliRuntime(host);
		const plan = runtime.createPlan([
			{
				id: "timeline.element.quick-split",
				args: { id: "clip-1" },
				raw: "timeline.element.quick-split --id clip-1",
			},
		]);
		const confirmed = runtime.confirmPlan(plan.id);
		expect(confirmed).not.toBeNull();
		const result = await runtime.applyPlanAsync(confirmed!);
		expect(result.ok).toBe(true);
		expect(result.executed).toBe(1);
		expect(result.summaryText).toContain("runtime quick split ok");
	});
});
