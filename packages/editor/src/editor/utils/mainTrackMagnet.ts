import type { TimelineElement } from "@/dsl/types";
import type { ResolveRole } from "core/editor/utils/trackAssignment";
import {
	compactMainTrackElements as compactMainTrackElementsCore,
	finalizeTimelineElements as finalizeTimelineElementsCore,
	shiftMainTrackElementsAfter as shiftMainTrackElementsAfterCore,
	type MainTrackMagnetOptions,
	type TimelinePostProcessOptions,
} from "core/editor/utils/mainTrackMagnet";
import { getElementRoleFromComponent } from "../timeline/trackConfig";

const resolveRole: ResolveRole = (element: TimelineElement) =>
	getElementRoleFromComponent(element.component, "clip");

const withResolveRole = (
	options?: MainTrackMagnetOptions,
): MainTrackMagnetOptions => ({
	...(options ?? {}),
	resolveRole,
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
	finalizeTimelineElementsCore(
		elements,
		withResolveRole(options),
	);

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
