import type { TimelineAsset } from "core/element/types";
import type { CanvasNodeThumbnail } from "core/studio/types";
import { useEffect, useMemo, useState } from "react";
import type { SkImage } from "react-skia-lite";
import type { AssetHandle } from "@/assets/AssetStore";
import { acquireImageAsset, type ImageAsset } from "@/assets/imageAsset";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";

const resolveThumbnailAsset = (
	assetId: string | null,
	assets: TimelineAsset[] | undefined,
): TimelineAsset | null => {
	if (!assetId) return null;
	return (
		assets?.find((asset) => asset.id === assetId && asset.kind === "image") ??
		null
	);
};

export const useCanvasNodeThumbnailImage = (
	thumbnail: CanvasNodeThumbnail | undefined,
): SkImage | null => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const currentProjectAssets = useProjectStore(
		(state) => state.currentProject?.assets,
	);
	const [thumbnailImage, setThumbnailImage] = useState<SkImage | null>(null);
	const thumbnailAssetId = thumbnail?.assetId ?? null;

	const thumbnailAsset = useMemo(() => {
		return resolveThumbnailAsset(thumbnailAssetId, currentProjectAssets);
	}, [currentProjectAssets, thumbnailAssetId]);
	const thumbnailUri = useMemo(() => {
		if (!thumbnailAsset) return null;
		return resolveAssetPlayableUri(thumbnailAsset, {
			projectId: currentProjectId,
		});
	}, [currentProjectId, thumbnailAsset]);

	useEffect(() => {
		if (!thumbnailUri) {
			setThumbnailImage(null);
			return;
		}
		let disposed = false;
		let localHandle: AssetHandle<ImageAsset> | null = null;
		setThumbnailImage(null);
		void (async () => {
			try {
				localHandle = await acquireImageAsset(thumbnailUri);
				if (disposed) {
					localHandle.release();
					return;
				}
				setThumbnailImage(localHandle.asset.image);
			} catch {
				if (disposed) return;
				setThumbnailImage(null);
			}
		})();
		return () => {
			disposed = true;
			localHandle?.release();
		};
	}, [thumbnailUri]);

	return thumbnailImage;
};
