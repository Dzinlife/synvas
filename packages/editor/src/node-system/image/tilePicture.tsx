import { renderNodeToPicture } from "core/render-system/renderNodeSnapshot";
import type { TimelineAsset } from "core/timeline-system/types";
import {
	disposeImageAsset,
	loadUncachedImageAsset,
	type ImageAsset,
} from "@/assets/imageAsset";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import type { ImageCanvasNode } from "@/studio/project/types";
import type { CanvasNodeTilePictureCapability } from "../types";
import { renderImageNodeTilePictureContent } from "./renderer";

const resolveImageTilePictureSignature = (
	node: ImageCanvasNode,
	asset: TimelineAsset | null,
	projectId: string | null | undefined,
): string => {
	return JSON.stringify({
		assetId: node.assetId,
		assetLocator: asset?.locator ?? null,
		assetHash: typeof asset?.meta?.hash === "string" ? asset.meta.hash : null,
		projectId: projectId ?? null,
		width: Math.max(1, Math.round(Math.abs(node.width))),
		height: Math.max(1, Math.round(Math.abs(node.height))),
	});
};

export const imageNodeTilePictureCapability: CanvasNodeTilePictureCapability<ImageCanvasNode> =
	{
		getSourceSignature: ({ node, asset, projectId }) => {
			return resolveImageTilePictureSignature(node, asset, projectId);
		},
		generate: async ({ node, asset, projectId }) => {
			if (!asset || asset.kind !== "image") return null;
			const assetUri = resolveAssetPlayableUri(asset, { projectId });
			if (!assetUri) return null;

			let imageAsset: ImageAsset | null = null;
			try {
				imageAsset = await loadUncachedImageAsset(assetUri);
			} catch {
				return null;
			}

			const sourceWidth = Math.max(1, Math.round(Math.abs(node.width)));
			const sourceHeight = Math.max(1, Math.round(Math.abs(node.height)));
			const pictureElement = renderImageNodeTilePictureContent(
				node,
				imageAsset.image,
			);
			if (!pictureElement) {
				disposeImageAsset(imageAsset);
				return null;
			}
			const picture = renderNodeToPicture(pictureElement, {
				width: sourceWidth,
				height: sourceHeight,
			});
			if (!picture) {
				disposeImageAsset(imageAsset);
				return null;
			}

			return {
				picture,
				sourceWidth,
				sourceHeight,
				dispose: () => {
					if (!imageAsset) return;
					disposeImageAsset(imageAsset);
					imageAsset = null;
				},
			};
		},
	};
