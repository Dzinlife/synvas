import { getCommandDescriptor } from "core/editor/command/registry";
import type {
	ConfirmedPlan,
	ParsedCommand,
	PlanContext,
	PlanDraft,
} from "./types";

export interface PlannerStore {
	createPlan(commands: ParsedCommand[], context: PlanContext): PlanDraft;
	getPlanDraft(planId: string): PlanDraft | undefined;
	confirmPlan(planId: string): ConfirmedPlan | null;
	upsertPlanDraft(plan: PlanDraft): PlanDraft;
	discardPlanDraft(planId: string): void;
}

const createPlanId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const buildSummary = (commands: ParsedCommand[]): string => {
	if (commands.length === 0) {
		return "空计划";
	}
	const lines = commands.map((command, index) => {
		const descriptor = getCommandDescriptor(command.id);
		const summary = descriptor?.summary ?? "未知命令";
		return `${index + 1}. ${command.id} - ${summary}`;
	});
	return [`共 ${commands.length} 条命令`, ...lines].join("\n");
};

export const createPlannerStore = (): PlannerStore => {
	const planDraftStore = new Map<string, PlanDraft>();

	return {
		createPlan(commands: ParsedCommand[], context: PlanContext): PlanDraft {
			const plan: PlanDraft = {
				id: createPlanId(),
				baseRevision: context.baseRevision,
				commands,
				summaryText: buildSummary(commands),
			};
			planDraftStore.set(plan.id, plan);
			return plan;
		},
		getPlanDraft(planId: string): PlanDraft | undefined {
			return planDraftStore.get(planId);
		},
		confirmPlan(planId: string): ConfirmedPlan | null {
			const draft = planDraftStore.get(planId);
			if (!draft) return null;
			return {
				...draft,
				confirmedAt: Date.now(),
			};
		},
		upsertPlanDraft(plan: PlanDraft): PlanDraft {
			planDraftStore.set(plan.id, plan);
			return plan;
		},
		discardPlanDraft(planId: string): void {
			planDraftStore.delete(planId);
		},
	};
};
