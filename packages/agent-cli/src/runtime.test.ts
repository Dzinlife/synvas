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
});
