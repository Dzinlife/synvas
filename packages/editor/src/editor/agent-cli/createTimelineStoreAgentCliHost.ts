import type { AgentCliHost } from "@ai-nle/agent-cli";
import { useTimelineStore } from "../contexts/TimelineContext";

export const createTimelineStoreAgentCliHost = (): AgentCliHost => {
	return {
		getSnapshot() {
			return useTimelineStore.getState().getCommandSnapshot();
		},
		applySnapshot(snapshot, options) {
			useTimelineStore.getState().applyCommandSnapshot(snapshot, options);
		},
		getRevision() {
			return useTimelineStore.getState().getRevision();
		},
		getHistoryPastLength() {
			return useTimelineStore.getState().historyPast.length;
		},
		undo() {
			useTimelineStore.getState().undo();
		},
		redo() {
			useTimelineStore.getState().redo();
		},
	};
};
