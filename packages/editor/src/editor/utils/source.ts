import type { TimelineElement, TimelineSource } from "core/dsl/types";

export const getSourceById = (
	sources: TimelineSource[],
	sourceId: string | null | undefined,
): TimelineSource | null => {
	if (!sourceId) return null;
	return sources.find((source) => source.id === sourceId) ?? null;
};

export const resolveElementSource = (
	element: TimelineElement | null | undefined,
	sources: TimelineSource[],
): TimelineSource | null => {
	if (!element?.sourceId) return null;
	return getSourceById(sources, element.sourceId);
};

export const resolveElementSourceUri = (
	element: TimelineElement | null | undefined,
	sources: TimelineSource[],
): string | null => {
	const source = resolveElementSource(element, sources);
	if (!source) return null;
	return source.uri;
};
