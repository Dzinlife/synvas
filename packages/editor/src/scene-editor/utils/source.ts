import type { TimelineElement, TimelineAsset } from "core/timeline-system/types";
import {
	resolveAssetPlayableUri,
	type ResolveAssetPlayableUriContext,
} from "@/projects/assetLocator";

export const getAssetById = (
	assets: TimelineAsset[],
	assetId: string | null | undefined,
): TimelineAsset | null => {
	if (!assetId) return null;
	return assets.find((source) => source.id === assetId) ?? null;
};

export const resolveElementSource = (
	element: TimelineElement | null | undefined,
	assets: TimelineAsset[],
): TimelineAsset | null => {
	if (!element?.assetId) return null;
	return getAssetById(assets, element.assetId);
};

export const resolveElementSourceUri = (
	element: TimelineElement | null | undefined,
	assets: TimelineAsset[],
	context: ResolveAssetPlayableUriContext = {},
): string | null => {
	const source = resolveElementSource(element, assets);
	if (!source) return null;
	return resolveAssetPlayableUri(source, context);
};
