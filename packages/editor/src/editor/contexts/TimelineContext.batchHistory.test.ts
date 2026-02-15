import type { TimelineElement } from "core/dsl/types";
import { afterEach, describe, expect, it } from "vitest";
import {
	createAgentCliRuntime,
	type ParsedCommand,
} from "@ai-nle/agent-cli";
import { createTimelineStoreAgentCliHost } from "../agent-cli/createTimelineStoreAgentCliHost";
import { resolveTimelineElementRole } from "../utils/resolveRole";
import { useTimelineStore } from "./TimelineContext";

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

const initialState = useTimelineStore.getState();

afterEach(() => {
	useTimelineStore.setState(initialState, true);
});

describe("TimelineContext batch history", () => {
	it("批次命令执行后应只产生一次 history entry，且一次 undo 可完整回退", () => {
		const runtime = createAgentCliRuntime(createTimelineStoreAgentCliHost(), {
			resolveRole: resolveTimelineElementRole,
		});
		useTimelineStore.setState({
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
			historyPast: [],
			historyFuture: [],
		});

		const commands: ParsedCommand[] = [
			{
				id: "timeline.element.move",
				args: {
					id: "clip-1",
					start: 10,
				},
				raw: "timeline.element.move --id clip-1 --start 10",
			},
			{
				id: "timeline.track.set-flag",
				args: {
					trackIndex: 0,
					flag: "muted",
					value: true,
				},
				raw: "timeline.track.set-flag --track-index 0 --flag muted --value true",
			},
		];

		const baseRevision = useTimelineStore.getState().getRevision();
		const plan = runtime.createPlan(commands, { baseRevision });
		const confirmed = runtime.confirmPlan(plan.id);
		expect(confirmed).not.toBeNull();

		const historyBefore = useTimelineStore.getState().historyPast.length;
		const result = runtime.applyPlan(confirmed!);
		expect(result.ok).toBe(true);
		expect(result.executed).toBe(2);
		const stateAfter = useTimelineStore.getState();
		expect(stateAfter.historyPast.length).toBe(historyBefore + 1);
		expect(stateAfter.elements[0]?.timeline.start).toBe(10);
		expect(stateAfter.elements[0]?.timeline.end).toBe(40);
		expect(stateAfter.tracks[0]?.muted).toBe(true);

		stateAfter.undo();
		const stateUndone = useTimelineStore.getState();
		expect(stateUndone.elements[0]?.timeline.start).toBe(0);
		expect(stateUndone.elements[0]?.timeline.end).toBe(30);
		expect(stateUndone.tracks[0]?.muted).toBe(false);
	});
});
