import type {
	AgentImageAspectRatioOption,
	AgentImageModelCapabilities,
	AgentImageSize,
} from "./types";

export const formatAgentImageSize = (size: AgentImageSize): string =>
	`${size.width}x${size.height}`;

export const parseAgentImageSize = (value: unknown): AgentImageSize | null => {
	if (typeof value !== "string") return null;
	const match = /^(\d+)x(\d+)$/.exec(value.trim());
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	if (width <= 0 || height <= 0) return null;
	return { width, height };
};

const gcd = (left: number, right: number): number => {
	let a = Math.abs(Math.round(left));
	let b = Math.abs(Math.round(right));
	while (b > 0) {
		const next = a % b;
		a = b;
		b = next;
	}
	return a || 1;
};

export const reduceAgentImageRatio = (size: AgentImageSize): string => {
	const divisor = gcd(size.width, size.height);
	return `${Math.round(size.width / divisor)}:${Math.round(size.height / divisor)}`;
};

const sameRatio = (
	size: AgentImageSize,
	option: AgentImageAspectRatioOption,
): boolean => {
	return size.width * option.height === size.height * option.width;
};

const pixelCount = (size: AgentImageSize): number => size.width * size.height;

const snapToMultiple = (
	value: number,
	multiple: number,
	direction: "nearest" | "ceil" | "floor" = "nearest",
): number => {
	if (!Number.isFinite(value)) return multiple;
	const ratio = value / multiple;
	if (direction === "ceil") return Math.ceil(ratio) * multiple;
	if (direction === "floor") return Math.floor(ratio) * multiple;
	return Math.round(ratio) * multiple;
};

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const findFixedSizeByRatio = (
	capabilities: AgentImageModelCapabilities,
	aspectRatio: string | null,
): AgentImageSize | null => {
	if (!aspectRatio) return null;
	const option = capabilities.aspectRatios.find(
		(item) => item.value === aspectRatio,
	);
	if (!option?.size) return null;
	return option.size;
};

const normalizeFixedSize = (
	capabilities: AgentImageModelCapabilities,
	size: AgentImageSize,
	aspectRatio: string | null,
): AgentImageSize => {
	if (capabilities.size.mode !== "fixed") return size;
	const exactSize = capabilities.size.sizes.find(
		(item) => item.width === size.width && item.height === size.height,
	);
	if (exactSize) return exactSize;
	const ratioSize = findFixedSizeByRatio(capabilities, aspectRatio);
	if (ratioSize) return ratioSize;
	const targetRatio = size.width / size.height;
	const targetPixels = pixelCount(size);
	return capabilities.size.sizes.reduce((best, item) => {
		const bestRatioDelta = Math.abs(best.width / best.height - targetRatio);
		const itemRatioDelta = Math.abs(item.width / item.height - targetRatio);
		if (itemRatioDelta < bestRatioDelta) return item;
		if (itemRatioDelta > bestRatioDelta) return best;
		const bestPixelDelta = Math.abs(pixelCount(best) - targetPixels);
		const itemPixelDelta = Math.abs(pixelCount(item) - targetPixels);
		return itemPixelDelta < bestPixelDelta ? item : best;
	}, capabilities.defaultSize);
};

const normalizeFlexibleSize = (
	capabilities: AgentImageModelCapabilities,
	size: AgentImageSize,
): AgentImageSize => {
	if (capabilities.size.mode !== "flexible") return size;
	const constraint = capabilities.size;
	const multiple = constraint.multiple;
	let width = clamp(
		snapToMultiple(size.width, multiple),
		multiple,
		constraint.maxEdge,
	);
	let height = clamp(
		snapToMultiple(size.height, multiple),
		multiple,
		constraint.maxEdge,
	);

	for (let index = 0; index < 4; index += 1) {
		if (width / height > constraint.maxLongEdgeRatio) {
			height = clamp(
				snapToMultiple(width / constraint.maxLongEdgeRatio, multiple, "ceil"),
				multiple,
				constraint.maxEdge,
			);
		}
		if (height / width > constraint.maxLongEdgeRatio) {
			width = clamp(
				snapToMultiple(height / constraint.maxLongEdgeRatio, multiple, "ceil"),
				multiple,
				constraint.maxEdge,
			);
		}

		const pixels = width * height;
		if (pixels < constraint.minPixels) {
			const scale = Math.sqrt(constraint.minPixels / pixels);
			width = clamp(
				snapToMultiple(width * scale, multiple, "ceil"),
				multiple,
				constraint.maxEdge,
			);
			height = clamp(
				snapToMultiple(height * scale, multiple, "ceil"),
				multiple,
				constraint.maxEdge,
			);
			continue;
		}
		if (pixels > constraint.maxPixels) {
			const scale = Math.sqrt(constraint.maxPixels / pixels);
			width = clamp(
				snapToMultiple(width * scale, multiple, "floor"),
				multiple,
				constraint.maxEdge,
			);
			height = clamp(
				snapToMultiple(height * scale, multiple, "floor"),
				multiple,
				constraint.maxEdge,
			);
			continue;
		}
		break;
	}

	return { width, height };
};

export const normalizeAgentImageSize = (
	capabilities: AgentImageModelCapabilities,
	input: AgentImageSize | string | null | undefined,
	aspectRatio?: string | null,
): AgentImageSize => {
	const size =
		typeof input === "string"
			? parseAgentImageSize(input)
			: input && Number.isFinite(input.width) && Number.isFinite(input.height)
				? input
				: null;
	const fallback =
		findFixedSizeByRatio(capabilities, aspectRatio ?? null) ??
		capabilities.defaultSize;
	if (!size) return fallback;
	if (capabilities.size.mode === "fixed") {
		return normalizeFixedSize(capabilities, size, aspectRatio ?? null);
	}
	return normalizeFlexibleSize(capabilities, size);
};

export const resolveAgentImageAspectRatio = (
	capabilities: AgentImageModelCapabilities,
	size: AgentImageSize,
): string => {
	const preset = capabilities.aspectRatios.find(
		(option) => option.value !== "custom" && sameRatio(size, option),
	);
	if (preset) return preset.value;
	const hasCustom = capabilities.aspectRatios.some(
		(option) => option.value === "custom",
	);
	return hasCustom ? "custom" : capabilities.defaultAspectRatio;
};
