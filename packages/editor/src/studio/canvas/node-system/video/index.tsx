import type { VideoCanvasNode } from "core/studio/types";
import {
	getFallbackVideoMetadata,
	isVideoFile,
	readVideoMetadata,
} from "@/scene-editor/utils/externalVideo";
import { registerCanvasNodeDefinition } from "../registryCore";
import type { CanvasNodeDefinition } from "../types";
import { VideoNodeSkiaRenderer } from "./renderer";
import { VideoNodeToolbar } from "./toolbar";

const videoDefinition: CanvasNodeDefinition<VideoCanvasNode> = {
	type: "video",
	title: "Video",
	create: () => ({ type: "video" }),
	skiaRenderer: VideoNodeSkiaRenderer,
	toolbar: VideoNodeToolbar,
	resolveResizeConstraints: ({ node, asset }) => {
		const sourceWidth = asset?.meta?.sourceSize?.width ?? node.width;
		const sourceHeight = asset?.meta?.sourceSize?.height ?? node.height;
		if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) {
			return {
				lockAspectRatio: true,
			};
		}
		if (sourceWidth <= 0 || sourceHeight <= 0) {
			return {
				lockAspectRatio: true,
			};
		}
		return {
			lockAspectRatio: true,
			aspectRatio: sourceWidth / sourceHeight,
		};
	},
	fromExternalFile: async (file, context) => {
		if (!isVideoFile(file)) return null;
		const metadata = await readVideoMetadata(file).catch(() =>
			getFallbackVideoMetadata(),
		);
		const uri = await context.resolveExternalFileUri(file, "video");
		const assetId = context.ensureProjectAssetByUri({
			uri,
			kind: "video",
			name: file.name,
		});
		context.updateProjectAssetMeta(assetId, (prev) => {
			if (
				prev?.sourceSize?.width === metadata.width &&
				prev?.sourceSize?.height === metadata.height
			) {
				return prev;
			}
			return {
				...prev,
				sourceSize: {
					width: metadata.width,
					height: metadata.height,
				},
			};
		});
		return {
			type: "video",
			assetId,
			name: file.name,
			width: metadata.width,
			height: metadata.height,
			duration: Math.max(1, Math.round(metadata.duration * context.fps)),
		};
	},
};

registerCanvasNodeDefinition(videoDefinition);
