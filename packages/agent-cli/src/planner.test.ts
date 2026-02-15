import { describe, expect, it } from "vitest";
import { createPlannerStore } from "./planner";
import type { ParsedCommand } from "./types";

describe("planner", () => {
	it("实例内应维护计划草稿", () => {
		const planner = createPlannerStore();
		const commands: ParsedCommand[] = [
			{
				id: "timeline.seek",
				args: { time: 12 },
				raw: "timeline.seek --time 12",
			},
		];
		const plan = planner.createPlan(commands, { baseRevision: 3 });
		expect(plan.baseRevision).toBe(3);
		expect(plan.commands).toHaveLength(1);
		expect(planner.getPlanDraft(plan.id)).toEqual(plan);
	});

	it("confirmPlan 应返回确认态计划", () => {
		const planner = createPlannerStore();
		const plan = planner.createPlan([], { baseRevision: 1 });
		const confirmed = planner.confirmPlan(plan.id);
		expect(confirmed).not.toBeNull();
		expect((confirmed?.confirmedAt ?? 0) > 0).toBe(true);
	});
});
