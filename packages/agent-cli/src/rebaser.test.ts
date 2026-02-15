import { describe, expect, it } from "vitest";
import { rebasePlan } from "./rebaser";
import type { PlanDraft } from "./types";

describe("rebasePlan", () => {
	it("应更新 revision 并生成新 plan id", () => {
		const plan: PlanDraft = {
			id: "plan-old",
			baseRevision: 1,
			commands: [],
			summaryText: "old",
		};
		const rebased = rebasePlan(plan, 9);
		expect(rebased.baseRevision).toBe(9);
		expect(rebased.id).not.toBe(plan.id);
		expect(rebased.summaryText).toContain("rebase 到 revision 9");
	});
});
