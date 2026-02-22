import { createContext, useContext } from "react";
import type { ModelRegistryClass } from "@/dsl/model/registry";
import type { TimelineStoreApi } from "@/editor/contexts/TimelineContext";
import type { EditorRuntime } from "./types";

export const EditorRuntimeContext = createContext<EditorRuntime | null>(null);

const resolveRuntime = (): EditorRuntime => {
	const runtime = useContext(EditorRuntimeContext);
	if (!runtime) {
		throw new Error(
			"EditorRuntimeProvider is missing. Wrap the editor tree with EditorRuntimeProvider.",
		);
	}
	return runtime;
};

export const EditorRuntimeProvider = ({
	runtime,
	children,
}: {
	runtime: EditorRuntime;
	children: React.ReactNode;
}) => {
	return (
		<EditorRuntimeContext.Provider value={runtime}>
			{children}
		</EditorRuntimeContext.Provider>
	);
};

export const useEditorRuntime = (): EditorRuntime => {
	return resolveRuntime();
};

export const useTimelineStoreApi = (): TimelineStoreApi => {
	return resolveRuntime().timelineStore;
};

export const useModelRegistry = (): ModelRegistryClass => {
	return resolveRuntime().modelRegistry;
};
