import type { TimelineJSON } from "core/timeline-system/loader";
import type { StudioProject } from "@/studio/project/types";
import type {
	TimelineRef,
	TimelineRuntimeId,
} from "@/scene-editor/runtime/types";

interface TimelineWriteOptions {
	recordHistory?: boolean;
	txnId?: string;
	historyOpId?: string;
}

interface TimelineProjectWriter {
	updateSceneTimeline: (
		sceneId: string,
		timeline: TimelineJSON,
		options?: TimelineWriteOptions,
	) => void;
}

export const buildTimelineRuntimeIdFromRef = (
	ref: TimelineRef,
): TimelineRuntimeId => {
	return `${ref.kind}:${ref.sceneId}`;
};

export const isTimelineRefEqual = (
	left: TimelineRef | null | undefined,
	right: TimelineRef | null | undefined,
): boolean => {
	if (!left || !right) return false;
	return left.kind === right.kind && left.sceneId === right.sceneId;
};

export const toSceneTimelineRef = (sceneId: string): TimelineRef => ({
	kind: "scene",
	sceneId,
});

export const listTimelineRefs = (project: StudioProject): TimelineRef[] => {
	return Object.keys(project.scenes).map(toSceneTimelineRef);
};

export const readTimelineByRef = (
	project: StudioProject,
	ref: TimelineRef,
): TimelineJSON | null => {
	if (ref.kind === "scene") {
		return project.scenes[ref.sceneId]?.timeline ?? null;
	}
	return null;
};

export const writeTimelineByRef = (
	projectWriter: TimelineProjectWriter,
	ref: TimelineRef,
	timeline: TimelineJSON,
	options?: TimelineWriteOptions,
): void => {
	if (ref.kind === "scene") {
		projectWriter.updateSceneTimeline(ref.sceneId, timeline, options);
	}
};
