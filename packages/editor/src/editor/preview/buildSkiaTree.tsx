import type { RendererPrepareFrameContext } from "core/dsl/model/types";
import {
	type BuildSkiaDeps,
	buildSkiaRenderStateCore,
	buildSkiaTreeCore,
} from "core/editor/preview/buildSkiaTree";
import { componentRegistry } from "@/dsl/model/componentRegistry";
import { renderNodeToPicture } from "@/dsl/Transition/picture";
import { isTransitionElement } from "@/editor/utils/transitions";

const deps: BuildSkiaDeps = {
	resolveComponent: (componentId) => componentRegistry.get(componentId),
	listComponentIds: () => componentRegistry.getComponentIds(),
	renderNodeToPicture,
	isTransitionElement,
};

export const buildSkiaRenderState = async (
	args: Parameters<typeof buildSkiaRenderStateCore>[0],
) => {
	return buildSkiaRenderStateCore(args, deps);
};

export const buildSkiaTree = async (
	args: Parameters<typeof buildSkiaTreeCore>[0],
) => {
	return buildSkiaTreeCore(args, deps);
};

export const buildKonvaTree = (
	args: Pick<
		Parameters<typeof buildSkiaRenderStateCore>[0],
		"elements" | "displayTime" | "tracks" | "sortByTrackIndex"
	>,
) => {
	const { elements, displayTime, tracks, sortByTrackIndex } = args;
	const visibleElements = elements.filter((element) => {
		const { start = 0, end = Infinity } = element.timeline;
		const trackIndex = element.timeline.trackIndex ?? 0;
		const trackHidden = tracks[trackIndex]?.hidden ?? false;
		const renderVisible = element.render?.visible !== false;
		return (
			renderVisible && !trackHidden && displayTime >= start && displayTime < end
		);
	});
	return sortByTrackIndex(
		visibleElements.filter(
			(element) =>
				!isTransitionElement(element) && element.type !== "Filter",
		),
	);
};

export type { RendererPrepareFrameContext };
