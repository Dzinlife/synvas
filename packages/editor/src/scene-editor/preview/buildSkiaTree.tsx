import type { RendererPrepareFrameContext } from "core/element/model/types";
import {
	type BuildSkiaDeps,
	buildSkiaFrameSnapshotCore,
	buildSkiaRenderStateCore,
	buildSkiaTreeCore,
} from "core/editor/preview/buildSkiaTree";
import type { ReactNode } from "react";
import { componentRegistry } from "@/element/model/componentRegistry";
import { renderNodeToPicture } from "@/element/Transition/picture";
import { isTransitionElement } from "@/scene-editor/utils/transitions";

type BuildSkiaOverrides = {
	renderNodeToPicture?: BuildSkiaDeps["renderNodeToPicture"];
	wrapRenderNode?: (node: ReactNode) => ReactNode;
};

const createBuildSkiaDeps = (overrides?: BuildSkiaOverrides): BuildSkiaDeps => ({
	resolveComponent: (componentId) => componentRegistry.get(componentId),
	listComponentIds: () => componentRegistry.getComponentIds(),
	renderNodeToPicture: (node, size) => {
		const wrappedNode = overrides?.wrapRenderNode
			? overrides.wrapRenderNode(node)
			: node;
		const render = overrides?.renderNodeToPicture ?? renderNodeToPicture;
		return render(wrappedNode, size);
	},
	isTransitionElement,
});

export const buildSkiaRenderState = async (
	args: Parameters<typeof buildSkiaRenderStateCore>[0],
	overrides?: BuildSkiaOverrides,
) => {
	return buildSkiaRenderStateCore(args, createBuildSkiaDeps(overrides));
};

export const buildSkiaFrameSnapshot = async (
	args: Parameters<typeof buildSkiaFrameSnapshotCore>[0],
	overrides?: BuildSkiaOverrides,
) => {
	return buildSkiaFrameSnapshotCore(args, createBuildSkiaDeps(overrides));
};

export const buildSkiaTree = async (
	args: Parameters<typeof buildSkiaTreeCore>[0],
	overrides?: BuildSkiaOverrides,
) => {
	return buildSkiaTreeCore(args, createBuildSkiaDeps(overrides));
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
