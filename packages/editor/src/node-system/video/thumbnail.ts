import type { VideoCanvasNode } from "@/studio/project/types";
import { acquireVideoAsset } from "@/assets/videoAsset";
import { getThumbnail, getVideoSize } from "@/element-system/VideoClip/thumbnailCache";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import type { CanvasNodeThumbnailCapability } from "../types";
import {
	encodeCanvasThumbnailBlob,
	NODE_THUMBNAIL_FRAME,
	resolveThumbnailSize,
} from "../thumbnail/utils";

const buildVideoSourceSignature = (
	node: VideoCanvasNode,
	hash: unknown,
): string => {
	const normalizedHash = typeof hash === "string" ? hash : "";
	return `${node.assetId}:${normalizedHash}`;
};

export const videoNodeThumbnailCapability: CanvasNodeThumbnailCapability<VideoCanvasNode> =
	{
		getSourceSignature: ({ node, asset }) => {
			if (!node.assetId) return null;
			return buildVideoSourceSignature(node, asset?.meta?.hash);
		},
		generate: async ({ node, asset, project }) => {
			if (!asset || asset.kind !== "video" || !node.assetId) return null;
			const sourceSignature = buildVideoSourceSignature(node, asset.meta?.hash);
			const assetUri = resolveAssetPlayableUri(asset, {
				projectId: project.id,
			});
			if (!assetUri) return null;
			const handle = await acquireVideoAsset(assetUri);
			try {
				// 用独立 sample sink 取缩略图，避免与播放控制器共享游标相互干扰。
				const thumbnailSink = handle.asset.createVideoSampleSink();
				const sourceSize =
					(await getVideoSize(assetUri, thumbnailSink)) ?? {
						width: Math.max(1, Math.round(node.width)),
						height: Math.max(1, Math.round(node.height)),
					};
				const targetSize = resolveThumbnailSize(sourceSize.width, sourceSize.height);
				const frameCanvas = await getThumbnail({
					uri: assetUri,
					time: NODE_THUMBNAIL_FRAME,
					timeKey: Math.max(0, Math.round(NODE_THUMBNAIL_FRAME * 1000)),
					width: targetSize.width,
					height: targetSize.height,
					pixelRatio: 1,
					videoSampleSink: thumbnailSink,
					input: handle.asset.input,
					preferKeyframes: true,
				});
				if (!frameCanvas) return null;
				const blob = await encodeCanvasThumbnailBlob(frameCanvas);
				if (!blob) return null;
				return {
					blob,
					sourceSignature,
					frame: NODE_THUMBNAIL_FRAME,
					sourceSize,
				};
			} finally {
				handle.release();
			}
		},
	};
