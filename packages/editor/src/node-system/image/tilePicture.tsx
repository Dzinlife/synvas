import { renderNodeToPicture } from "core/render-system/renderNodeSnapshot";
import type { TimelineAsset } from "core/timeline-system/types";
import type { AssetHandle } from "@/assets/AssetStore";
import { acquireImageAsset, type ImageAsset } from "@/assets/imageAsset";
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
		generate: async ({ node, asset, projectId, offscreenSurfaceOptions }) => {
			if (!asset || asset.kind !== "image") return null;
			const assetUri = resolveAssetPlayableUri(asset, { projectId });
			if (!assetUri) return null;

			let imageHandle: AssetHandle<ImageAsset> | null = null;
			try {
				imageHandle = await acquireImageAsset(assetUri);
			} catch {
				return null;
			}

			const sourceWidth = Math.max(1, Math.round(Math.abs(node.width)));
			const sourceHeight = Math.max(1, Math.round(Math.abs(node.height)));
			const pictureElement = renderImageNodeTilePictureContent(
				node,
				imageHandle.asset.image,
			);
			if (!pictureElement) {
				imageHandle.release();
				return null;
			}
			const picture = renderNodeToPicture(
				pictureElement,
				{
					width: sourceWidth,
					height: sourceHeight,
				},
				offscreenSurfaceOptions,
			);
			if (!picture) {
				imageHandle.release();
				return null;
			}

			return {
				picture,
				sourceWidth,
				sourceHeight,
				dispose: () => {
					imageHandle?.release();
					imageHandle = null;
				},
			};
		},
	};
