import type { TimelineElement } from "core/timeline-system/types";

export const clampNumber = (value: number, min: number, max: number): number => {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
};

export const roundToDecimals = (value: number, decimals = 2): number => {
	if (!Number.isFinite(value)) return value;
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
};

export const resolveInputNumber = (value: string, fallback: number): number => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return parsed;
};

export const resolveRenderVisible = (element: TimelineElement): boolean =>
	element.render?.visible !== false;

export const resolveRenderOpacity = (element: TimelineElement): number =>
	clampNumber(
		typeof element.render?.opacity === "number" ? element.render.opacity : 1,
		0,
		1,
	);
