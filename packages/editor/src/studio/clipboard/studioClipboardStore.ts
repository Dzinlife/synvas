import type { CanvasNode, SceneDocument } from "core/studio/types";
import { create } from "zustand";
import type {
	TimelineClipboardPayload,
	TimelineClipboardSource,
} from "@/scene-editor/utils/timelineClipboard";

export interface StudioTimelineClipboardPayload {
	kind: "timeline-elements";
	payload: TimelineClipboardPayload;
	source?: TimelineClipboardSource;
}

export interface StudioTimelineCanvasDropRequest {
	payload: StudioTimelineClipboardPayload;
	clientX: number;
	clientY: number;
}

export interface StudioCanvasClipboardEntry {
	node: CanvasNode;
	scene?: SceneDocument;
}

export interface StudioCanvasClipboardPayload {
	kind: "canvas-nodes";
	entries: StudioCanvasClipboardEntry[];
}

export type StudioClipboardPayload =
	| StudioTimelineClipboardPayload
	| StudioCanvasClipboardPayload;

interface StudioClipboardState {
	payload: StudioClipboardPayload | null;
	setPayload: (payload: StudioClipboardPayload | null) => void;
	clearPayload: () => void;
}

const cloneClipboardPayload = (
	payload: StudioClipboardPayload,
): StudioClipboardPayload => {
	return JSON.parse(JSON.stringify(payload)) as StudioClipboardPayload;
};

export const useStudioClipboardStore = create<StudioClipboardState>((set) => ({
	payload: null,
	setPayload: (payload) => {
		set({ payload: payload ? cloneClipboardPayload(payload) : null });
	},
	clearPayload: () => {
		set({ payload: null });
	},
}));

export const getStudioClipboardPayload = (): StudioClipboardPayload | null => {
	return useStudioClipboardStore.getState().payload;
};

export const setStudioClipboardPayload = (
	payload: StudioClipboardPayload | null,
): void => {
	useStudioClipboardStore.getState().setPayload(payload);
};
