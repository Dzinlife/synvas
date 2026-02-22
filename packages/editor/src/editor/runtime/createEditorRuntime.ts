import { createModelRegistry } from "@/dsl/model/registry";
import { createTimelineStore } from "@/editor/contexts/TimelineContext";
import type { EditorRuntime } from "./types";

const createRuntimeId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `runtime-${crypto.randomUUID()}`;
	}
	return `runtime-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

export const createEditorRuntime = (options?: { id?: string }): EditorRuntime => {
	return {
		id: options?.id ?? createRuntimeId(),
		timelineStore: createTimelineStore(),
		modelRegistry: createModelRegistry(),
	};
};
