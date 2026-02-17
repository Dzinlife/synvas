import type { TimelineElement } from "core/dsl/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAgentCliRuntime,
	type ParsedCommand,
} from "@ai-nle/agent-cli";
import { createTimelineStoreAgentCliHost } from "../agent-cli/createTimelineStoreAgentCliHost";
import { resolveTimelineElementRole } from "../utils/resolveRole";
import { useTimelineStore } from "./TimelineContext";

const quickSplitMocks = vi.hoisted(() => ({
	analyzeVideoChangeForElement: vi.fn(),
}));

vi.mock("../components/timelineQuickSplit", async () => {
	const actual =
		await vi.importActual<typeof import("../components/timelineQuickSplit")>(
			"../components/timelineQuickSplit",
		);
	return {
		...actual,
		analyzeVideoChangeForElement: quickSplitMocks.analyzeVideoChangeForElement,
	};
});

const createElement = (
	id: string,
	start: number,
	end: number,
	options?: { sourceId?: string },
): TimelineElement => ({
	id,
	type: "VideoClip",
	component: "video-clip",
	name: id,
	...(options?.sourceId ? { sourceId: options.sourceId } : {}),
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
	quickSplitMocks.analyzeVideoChangeForElement.mockReset();
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

	it("runtime quick-split 执行后应只产生一次 history entry，且一次 undo 可完整回退", async () => {
		const runtime = createAgentCliRuntime(createTimelineStoreAgentCliHost(), {
			resolveRole: resolveTimelineElementRole,
		});
		quickSplitMocks.analyzeVideoChangeForElement.mockResolvedValue({
			sampleFrames: [0, 15, 29],
			scores: [0.2, 0.8],
			splitFrames: [15],
			shots: [
				{ start: 0, end: 15, peakScore: 0.8 },
				{ start: 15, end: 30, peakScore: 0.2 },
			],
			strideFrames: 15,
		});
		useTimelineStore.setState({
			elements: [
				createElement("clip-1", 0, 30, { sourceId: "source-video-1" }),
			],
			sources: [
				{
					id: "source-video-1",
					kind: "video",
					uri: "sample.mp4",
				},
			],
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
				id: "timeline.element.quick-split",
				args: {
					id: "clip-1",
				},
				raw: "timeline.element.quick-split --id clip-1",
			},
		];

		const baseRevision = useTimelineStore.getState().getRevision();
		const plan = runtime.createPlan(commands, { baseRevision });
		const confirmed = runtime.confirmPlan(plan.id);
		expect(confirmed).not.toBeNull();

		const historyBefore = useTimelineStore.getState().historyPast.length;
		const result = await runtime.applyPlanAsync(confirmed!);
		expect(result.ok).toBe(true);
		expect(result.executed).toBe(1);

		const stateAfter = useTimelineStore.getState();
		expect(stateAfter.historyPast.length).toBe(historyBefore + 1);
		expect(stateAfter.elements).toHaveLength(2);
		expect(stateAfter.elements[0]?.timeline.start).toBe(0);
		expect(stateAfter.elements[0]?.timeline.end).toBe(15);
		expect(stateAfter.elements[1]?.timeline.start).toBe(15);
		expect(stateAfter.elements[1]?.timeline.end).toBe(30);

		stateAfter.undo();
		const stateUndone = useTimelineStore.getState();
		expect(stateUndone.elements).toHaveLength(1);
		expect(stateUndone.elements[0]?.timeline.start).toBe(0);
		expect(stateUndone.elements[0]?.timeline.end).toBe(30);
	});
});
