import type { TimelineAsset, TimelineElement } from "../dsl/types";
import type { TimelineJSON } from "../editor/timelineLoader";

export interface CompositionDocument {
	id: string;
	name: string;
	elements: TimelineElement[];
	durationFrames: number;
	createdAt: number;
	updatedAt: number;
}

export type MainTimelineDocument = TimelineJSON;

export type StudioScope =
	| {
			type: "main";
	  }
	| {
			type: "composition";
			compositionId: string;
	  };

export interface StudioProject {
	id: string;
	revision: number;
	timeline: MainTimelineDocument;
	compositions: Record<string, CompositionDocument>;
	assets: Record<string, TimelineAsset>;
	ui: {
		activeMainView: "preview" | "canvas";
		activeScope: StudioScope;
	};
	createdAt: number;
	updatedAt: number;
}
