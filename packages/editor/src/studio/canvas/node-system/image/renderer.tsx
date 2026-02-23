import type { ImageCanvasNode } from "core/studio/types";
import { useEffect, useState } from "react";
import { ImageShader, Rect, type SkImage } from "react-skia-lite";
import type { AssetHandle } from "@/assets/AssetStore";
import { acquireImageAsset, type ImageAsset } from "@/assets/imageAsset";
import type { CanvasNodeSkiaRenderProps } from "../types";

export const ImageNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<ImageCanvasNode>
> = ({ node, asset }) => {
	const [image, setImage] = useState<SkImage | null>(null);

	useEffect(() => {
		if (node.type !== "image") {
			setImage(null);
			return;
		}
		if (!asset || asset.kind !== "image" || !asset.uri) {
			setImage(null);
			return;
		}

		let disposed = false;
		let localHandle: AssetHandle<ImageAsset> | null = null;
		setImage(null);
		void (async () => {
			try {
				localHandle = await acquireImageAsset(asset.uri);
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
	}, [node.type, asset?.kind, asset?.uri]);

	if (node.type !== "image") return null;
	const width = Math.max(1, node.width);
	const height = Math.max(1, node.height);

	return (
		<Rect x={0} y={0} width={width} height={height} color="#312e81">
			{image ? (
				<ImageShader
					image={image}
					fit="contain"
					x={0}
					y={0}
					width={width}
					height={height}
				/>
			) : null}
		</Rect>
	);
};
