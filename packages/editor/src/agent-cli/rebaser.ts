import type { PlanDraft } from "./types";

const createRebasedPlanId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

export const rebasePlan = (
	plan: PlanDraft,
	nextRevision: number,
): PlanDraft => {
	return {
		...plan,
		id: createRebasedPlanId(),
		baseRevision: nextRevision,
		summaryText: `${plan.summaryText}\n(已自动 rebase 到 revision ${nextRevision})`,
	};
};
