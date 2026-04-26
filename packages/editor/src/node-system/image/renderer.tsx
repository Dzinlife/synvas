import type { ImageCanvasNode } from "@/studio/project/types";
import { useEffect, useMemo, useState } from "react";
import { ImageShader, Rect, type SkImage } from "react-skia-lite";
import type { AssetHandle } from "@/assets/AssetStore";
import {
	acquireImageAsset,
	peekImageAsset,
	type ImageAsset,
} from "@/assets/imageAsset";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import type { CanvasNodeSkiaRenderProps } from "../types";

export const renderImageNodeTilePictureContent = (
	node: ImageCanvasNode,
	image: SkImage | null,
) => {
	if (!image) return null;

	const width = Math.max(1, node.width);
	const height = Math.max(1, node.height);

	return (
		<Rect x={0} y={0} width={width} height={height}>
			<ImageShader
				image={image}
				fit="contain"
				x={0}
				y={0}
				width={width}
				height={height}
			/>
		</Rect>
	);
};

export const ImageNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<ImageCanvasNode>
> = ({ node, asset }) => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const [image, setImage] = useState<SkImage | null>(null);
	const assetUri = useMemo(() => {
		if (node.type !== "image") return null;
		if (!asset || asset.kind !== "image") return null;
		return (
			resolveAssetPlayableUri(asset, {
				projectId: currentProjectId,
			}) ?? null
		);
	}, [node.type, asset, currentProjectId]);

	useEffect(() => {
		if (!assetUri) {
			setImage(null);
			return;
		}

		let disposed = false;
		let localHandle: AssetHandle<ImageAsset> | null = null;
		setImage(null);
		void (async () => {
			try {
				localHandle = await acquireImageAsset(assetUri);
				if (disposed) {
					localHandle.release();
					return;
				}
				setImage(localHandle.asset.image);
			} catch (error) {
				if (disposed) return;
				console.warn("加载画布图片失败:", error);
				setImage(null);
			}
		})();

		return () => {
			disposed = true;
			localHandle?.release();
		};
	}, [assetUri]);

	const renderImage =
		image ?? (assetUri ? peekImageAsset(assetUri)?.image : null);
	if (node.type !== "image" || !renderImage) return null;
	const width = Math.max(1, node.width);
	const height = Math.max(1, node.height);

	return (
		<Rect x={0} y={0} width={width} height={height}>
			<ImageShader
				image={renderImage}
				fit="contain"
				x={0}
				y={0}
				width={width}
				height={height}
			/>
		</Rect>
	);
};
