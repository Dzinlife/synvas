import type { ModelRegistryClass } from "@/dsl/model/registry";
import type { TimelineStoreApi } from "@/editor/contexts/TimelineContext";

export interface EditorRuntime {
	id: string;
	timelineStore: TimelineStoreApi;
	modelRegistry: ModelRegistryClass;
}
