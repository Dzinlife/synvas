import type { TimelineElement } from "core/dsl/types";
import { describe, expect, it } from "vitest";
import { dryRunPlan } from "./executor";
import { createPlan } from "./planner";
import type { ParsedCommand } from "./types";
import type { TimelineCommandSnapshot } from "@/editor/contexts/timelineCommandAdapters";

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
	},
	props: {},
});

describe("dryRunPlan", () => {
	it("应在快照副本上计算变更", () => {
			const snapshot: TimelineCommandSnapshot = {
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
			};
		const commands: ParsedCommand[] = [
				{
					id: "timeline.element.move",
					args: {
						id: "clip-1",
						start: 10,
					},
					raw: "timeline.element.move --id clip-1 --start 10",
				},
			];
		const plan = createPlan(commands, { baseRevision: 1 });
		const report = dryRunPlan(plan, snapshot);
		expect(report.ok).toBe(true);
		expect(report.summaryText).toContain("Dry-run 成功");
		expect(report.changes.some((change) => change.field === "elements")).toBe(
			true,
		);
		// 原始快照保持不变
		expect(snapshot.elements[0]?.timeline.start).toBe(0);
	});
});
