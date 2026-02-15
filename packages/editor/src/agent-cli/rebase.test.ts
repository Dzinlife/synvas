import { describe, expect, it } from "vitest";
import { rebasePlan } from "./rebaser";
import type { PlanDraft } from "./types";

describe("rebasePlan", () => {
	it("应返回新 revision 的计划", () => {
		const plan: PlanDraft = {
			id: "plan-1",
			baseRevision: 1,
			commands: [],
			summaryText: "test",
		};
		const rebased = rebasePlan(plan, 5);
		expect(rebased.baseRevision).toBe(5);
		expect(rebased.id).not.toBe(plan.id);
		expect(rebased.summaryText).toContain("rebase");
	});
});
