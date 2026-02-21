import type { TimelineElement } from "../dsl/types";
import type { CompositionDocument } from "./types";

const createId = (prefix: string): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

export const createCompositionDocument = (options: {
	name: string;
	elements: TimelineElement[];
	durationFrames: number;
	now?: number;
}): CompositionDocument => {
	const now = options.now ?? Date.now();
	return {
		id: createId("composition"),
		name: options.name,
		elements: options.elements,
		durationFrames: options.durationFrames,
		createdAt: now,
		updatedAt: now,
	};
};
