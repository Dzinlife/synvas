import type { ClipMeta, TimelineElement } from "../../dsl/types";

export const CLIP_GAIN_DB_MIN = -48;
export const CLIP_GAIN_DB_MAX = 12;
export const CLIP_GAIN_DB_DEFAULT = 0;

const clamp = (value: number, minValue: number, maxValue: number) => {
	return Math.min(maxValue, Math.max(minValue, value));
};

export const normalizeClipGainDb = (value: number | undefined): number => {
	if (!Number.isFinite(value)) return CLIP_GAIN_DB_DEFAULT;
	return clamp(value as number, CLIP_GAIN_DB_MIN, CLIP_GAIN_DB_MAX);
};

export const clipGainDbToLinear = (gainDb: number): number => {
	const safeDb = normalizeClipGainDb(gainDb);
	return 10 ** (safeDb / 20);
};

export const resolveClipGainDb = (clip: ClipMeta | undefined): number => {
	return normalizeClipGainDb(clip?.gainDb);
};

export const resolveTimelineElementClipGainDb = (
	element: TimelineElement | null | undefined,
): number => {
	return resolveClipGainDb(element?.clip);
};

export const resolveTimelineElementClipGainLinear = (
	element: TimelineElement | null | undefined,
): number => {
	return clipGainDbToLinear(resolveTimelineElementClipGainDb(element));
};
