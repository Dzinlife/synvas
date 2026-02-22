import type React from "react";
import { TimelineProvider } from "@/editor/contexts/TimelineContext";
import { EditorRuntimeProvider } from "./EditorRuntimeProvider";
import { createEditorRuntime } from "./createEditorRuntime";
import type { EditorRuntime } from "./types";

export const createTestEditorRuntime = (id = "test-runtime"): EditorRuntime => {
	return createEditorRuntime({ id });
};

export const createEditorRuntimeWrapper = (
	runtime: EditorRuntime,
	timelineProps?: React.ComponentProps<typeof TimelineProvider>,
) => {
	return ({ children }: { children: React.ReactNode }) => {
		return (
			<EditorRuntimeProvider runtime={runtime}>
				<TimelineProvider {...timelineProps}>{children}</TimelineProvider>
			</EditorRuntimeProvider>
		);
	};
};

export const createRuntimeProviderWrapper = (runtime: EditorRuntime) => {
	return ({ children }: { children: React.ReactNode }) => {
		return <EditorRuntimeProvider runtime={runtime}>{children}</EditorRuntimeProvider>;
	};
};
