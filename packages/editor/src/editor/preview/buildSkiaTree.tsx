import { componentRegistry } from "@/dsl/model/componentRegistry";
import type {
	ComponentModelStore,
	RendererPrepareFrameContext,
} from "@/dsl/model/types";
import { renderNodeToPicture } from "@/dsl/Transition/picture";
import type { TimelineElement } from "@/dsl/types";
import type { TimelineTrack } from "@/editor/timeline/types";
import { isTransitionElement } from "@/editor/utils/transitions";
import {
	buildKonvaTree as buildKonvaTreeCore,
	buildSkiaRenderStateCore,
	buildSkiaTreeCore,
	type BuildSkiaDeps,
} from "core/editor/preview/buildSkiaTree";

const deps: BuildSkiaDeps = {
	resolveComponent: (componentId) => componentRegistry.get(componentId),
	listComponentIds: () => componentRegistry.getComponentIds(),
	renderNodeToPicture,
	isTransitionElement,
};

export const buildSkiaRenderState = async ({
	elements,
	displayTime,
	tracks,
	getTrackIndexForElement,
	sortByTrackIndex,
	prepare,
}: {
	elements: TimelineElement[];
	displayTime: number;
	tracks: TimelineTrack[];
	getTrackIndexForElement: (element: TimelineElement) => number;
	sortByTrackIndex: (elements: TimelineElement[]) => TimelineElement[];
	prepare?: {
		isExporting: boolean;
		fps: number;
		canvasSize: { width: number; height: number };
		getModelStore?: (id: string) => ComponentModelStore | undefined;
		prepareTransitionPictures?: boolean;
	};
}) => {
	return buildSkiaRenderStateCore(
		{
			elements,
			displayTime,
			tracks,
			getTrackIndexForElement,
			sortByTrackIndex,
			prepare,
		},
		deps,
	);
};

export const buildSkiaTree = async (args: {
	elements: TimelineElement[];
	displayTime: number;
	tracks: TimelineTrack[];
	getTrackIndexForElement: (element: TimelineElement) => number;
	sortByTrackIndex: (elements: TimelineElement[]) => TimelineElement[];
	prepare?: {
		isExporting: boolean;
		fps: number;
		canvasSize: { width: number; height: number };
		getModelStore?: (id: string) => ComponentModelStore | undefined;
		prepareTransitionPictures?: boolean;
	};
}) => {
	return buildSkiaTreeCore(args, deps);
};

export const buildKonvaTree = ({
	elements,
	displayTime,
	tracks,
	sortByTrackIndex,
}: {
	elements: TimelineElement[];
	displayTime: number;
	tracks: TimelineTrack[];
	sortByTrackIndex: (elements: TimelineElement[]) => TimelineElement[];
}) => buildKonvaTreeCore({ elements, displayTime, tracks, sortByTrackIndex });

export type { RendererPrepareFrameContext };
