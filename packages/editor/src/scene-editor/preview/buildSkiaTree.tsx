import {
	type BuildSkiaDeps,
	buildSkiaFrameSnapshotCore,
	buildSkiaRenderStateCore,
	buildSkiaTreeCore,
} from "core/render-system/buildSkiaTree";
import {
	renderNodeToImage,
	renderNodeToPicture,
} from "core/render-system/renderNodeSnapshot";
import type { RendererPrepareFrameContext } from "core/timeline-system/model/types";
import type { ReactNode } from "react";
import { componentRegistry } from "@/element-system/model/componentRegistry";
import { isTransitionElement } from "@/scene-editor/utils/transitions";

type BuildSkiaOverrides = {
	renderNodeToPicture?: BuildSkiaDeps["renderNodeToPicture"];
	renderNodeToImage?: BuildSkiaDeps["renderNodeToImage"];
	wrapRenderNode?: (node: ReactNode) => ReactNode;
	resolveCompositionTimeline?: BuildSkiaDeps["resolveCompositionTimeline"];
};

const createBuildSkiaDeps = (
	overrides?: BuildSkiaOverrides,
): BuildSkiaDeps => ({
	resolveComponent: (componentId) => componentRegistry.get(componentId),
	listComponentIds: () => componentRegistry.getComponentIds(),
	renderNodeToPicture: (node, size) => {
		const wrappedNode = overrides?.wrapRenderNode
			? overrides.wrapRenderNode(node)
			: node;
		const render = overrides?.renderNodeToPicture ?? renderNodeToPicture;
		return render(wrappedNode, size);
	},
	renderNodeToImage: (node, size) => {
		const wrappedNode = overrides?.wrapRenderNode
			? overrides.wrapRenderNode(node)
			: node;
		const render = overrides?.renderNodeToImage ?? renderNodeToImage;
		return render(wrappedNode, size);
	},
	isTransitionElement,
	resolveCompositionTimeline: overrides?.resolveCompositionTimeline,
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

export const resolveInteractiveTimelineElements = (
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
			(element) => !isTransitionElement(element) && element.type !== "Filter",
		),
	);
};

export type { RendererPrepareFrameContext };
