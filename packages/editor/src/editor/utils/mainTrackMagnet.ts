import {
	compactMainTrackElements as compactMainTrackElementsCore,
	finalizeTimelineElements as finalizeTimelineElementsCore,
	type MainTrackMagnetOptions,
	shiftMainTrackElementsAfter as shiftMainTrackElementsAfterCore,
	type TimelinePostProcessOptions,
} from "core/editor/utils/mainTrackMagnet";
import type { TimelineElement } from "@/dsl/types";
import { resolveTimelineElementRole } from "./resolveRole";

const withResolveRole = (
	options?: MainTrackMagnetOptions,
): MainTrackMagnetOptions => ({
	...(options ?? {}),
	resolveRole: resolveTimelineElementRole,
});

export type { MainTrackMagnetOptions, TimelinePostProcessOptions };

export const compactMainTrackElements = (
	elements: TimelineElement[],
	options: MainTrackMagnetOptions,
): TimelineElement[] =>
	compactMainTrackElementsCore(elements, withResolveRole(options));

export const finalizeTimelineElements = (
	elements: TimelineElement[],
	options?: TimelinePostProcessOptions,
): TimelineElement[] =>
	finalizeTimelineElementsCore(elements, withResolveRole(options));

export const shiftMainTrackElementsAfter = (
	elements: TimelineElement[],
	targetId: string,
	newEnd: number,
	delta: number,
	options: TimelinePostProcessOptions,
): TimelineElement[] =>
	shiftMainTrackElementsAfterCore(
		elements,
		targetId,
		newEnd,
		delta,
		withResolveRole(options),
	);
