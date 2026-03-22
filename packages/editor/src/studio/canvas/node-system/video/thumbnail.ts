import type { VideoCanvasNode } from "core/studio/types";
import type { CanvasSink } from "mediabunny";
import { acquireVideoAsset } from "@/assets/videoAsset";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import type { CanvasNodeThumbnailCapability } from "../types";
import {
	encodeCanvasThumbnailBlob,
	NODE_THUMBNAIL_FRAME,
	resolveThumbnailSize,
} from "../thumbnail/utils";

const readFirstFrameCanvas = async (
	videoSink: Pick<CanvasSink, "canvases">,
): Promise<HTMLCanvasElement | OffscreenCanvas | null> => {
	const iterator = videoSink.canvases(NODE_THUMBNAIL_FRAME);
	try {
		const frame = (await iterator.next()).value;
		return frame?.canvas ?? null;
	} finally {
		await iterator.return();
	}
};

const buildVideoSourceSignature = (
	node: VideoCanvasNode,
	hash: unknown,
): string => {
	const normalizedHash = typeof hash === "string" ? hash : "";
	return `${node.assetId}:${normalizedHash}`;
};

const drawFrameToThumbnailCanvas = (
	frameCanvas: HTMLCanvasElement | OffscreenCanvas,
	targetSize: { width: number; height: number },
): HTMLCanvasElement | null => {
	const sourceWidth = frameCanvas.width;
	const sourceHeight = frameCanvas.height;
	if (sourceWidth <= 0 || sourceHeight <= 0) return null;
	const resultCanvas = document.createElement("canvas");
	resultCanvas.width = targetSize.width;
	resultCanvas.height = targetSize.height;
	const ctx = resultCanvas.getContext("2d");
	if (!ctx) return null;
	const scale = Math.min(
		targetSize.width / sourceWidth,
		targetSize.height / sourceHeight,
	);
	const drawWidth = sourceWidth * scale;
	const drawHeight = sourceHeight * scale;
	const offsetX = (targetSize.width - drawWidth) * 0.5;
	const offsetY = (targetSize.height - drawHeight) * 0.5;
	ctx.clearRect(0, 0, targetSize.width, targetSize.height);
	ctx.drawImage(
		frameCanvas,
		0,
		0,
		sourceWidth,
		sourceHeight,
		offsetX,
		offsetY,
		drawWidth,
		drawHeight,
	);
	return resultCanvas;
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
				const frameCanvas = await readFirstFrameCanvas(handle.asset.videoSink);
				if (!frameCanvas) return null;
				const sourceSize = {
					width: Math.max(1, Math.round(frameCanvas.width)),
					height: Math.max(1, Math.round(frameCanvas.height)),
				};
				const targetSize = resolveThumbnailSize(sourceSize.width, sourceSize.height);
				const resultCanvas = drawFrameToThumbnailCanvas(frameCanvas, targetSize);
				if (!resultCanvas) return null;
				const blob = await encodeCanvasThumbnailBlob(resultCanvas);
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
