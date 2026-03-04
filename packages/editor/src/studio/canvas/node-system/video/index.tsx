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
		return {
			type: "video",
			assetId,
			name: file.name,
			width: metadata.width,
			height: metadata.height,
			duration: Math.max(1, Math.round(metadata.duration * context.fps)),
			naturalWidth: metadata.width,
			naturalHeight: metadata.height,
		};
	},
};

registerCanvasNodeDefinition(videoDefinition);
