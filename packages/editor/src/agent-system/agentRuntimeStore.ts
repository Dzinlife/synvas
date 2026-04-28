import type { AgentRun } from "@synvas/agent";
import { isTerminalAgentRunStatus } from "@synvas/agent";
import { create } from "zustand";

interface AgentRuntimeStoreState {
	runsById: Record<string, AgentRun>;
	activeRunIdByNodeId: Record<string, string | undefined>;
	upsertRun: (run: AgentRun) => void;
	clear: () => void;
}

const collectRunNodeIds = (run: AgentRun): string[] => {
	const nodeIds = new Set<string>();
	if (run.scope.type === "node" && run.scope.nodeId) {
		nodeIds.add(run.scope.nodeId);
	}
	const targetNodeId = run.context.targetNodeId;
	if (typeof targetNodeId === "string" && targetNodeId.trim()) {
		nodeIds.add(targetNodeId);
	}
	for (const effect of run.effects) {
		if (effect.type === "image-node.bind-artifact") {
			nodeIds.add(effect.nodeId);
		}
	}
	return [...nodeIds];
};

export const useAgentRuntimeStore = create<AgentRuntimeStoreState>()((set) => ({
	runsById: {},
	activeRunIdByNodeId: {},
	upsertRun: (run) => {
		set((state) => {
			const nextRunsById = {
				...state.runsById,
				[run.id]: run,
			};
			const nextActiveRunIdByNodeId = { ...state.activeRunIdByNodeId };
			for (const nodeId of collectRunNodeIds(run)) {
				if (isTerminalAgentRunStatus(run.status)) {
					if (nextActiveRunIdByNodeId[nodeId] === run.id) {
						delete nextActiveRunIdByNodeId[nodeId];
					}
					continue;
				}
				nextActiveRunIdByNodeId[nodeId] = run.id;
			}
			return {
				runsById: nextRunsById,
				activeRunIdByNodeId: nextActiveRunIdByNodeId,
			};
		});
	},
	clear: () => {
		set({
			runsById: {},
			activeRunIdByNodeId: {},
		});
	},
}));

export const useNodeActiveAgentRun = (nodeId: string): AgentRun | null => {
	return useAgentRuntimeStore((state) => {
		const runId = state.activeRunIdByNodeId[nodeId];
		return runId ? (state.runsById[runId] ?? null) : null;
	});
};
