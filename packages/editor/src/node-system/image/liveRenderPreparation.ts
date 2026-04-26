import { acquireImageAsset } from "@/assets/imageAsset";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import type { ImageCanvasNode } from "@/studio/project/types";
import type { CanvasNodeLiveRenderPreparationCapability } from "../types";

export const imageNodeLiveRenderPreparationCapability: CanvasNodeLiveRenderPreparationCapability<ImageCanvasNode> =
	{
		getSourceSignature: ({ asset, projectId }) => {
			if (!asset || asset.kind !== "image") return null;
			return resolveAssetPlayableUri(asset, { projectId }) ?? null;
		},
		prepare: async ({ asset, projectId }) => {
			if (!asset || asset.kind !== "image") return null;
			const assetUri = resolveAssetPlayableUri(asset, { projectId });
			if (!assetUri) return null;
			const handle = await acquireImageAsset(assetUri);
			return {
				dispose: () => {
					handle.release();
				},
			};
		},
	};
