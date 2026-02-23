import type { VideoCanvasNode } from "core/studio/types";
import { Rect } from "react-skia-lite";
import {
	getFallbackVideoMetadata,
	isVideoFile,
	readVideoMetadata,
} from "@/editor/utils/externalVideo";
import { registerCanvasNodeDefinition } from "../registryCore";
import type {
	CanvasNodeDefinition,
	CanvasNodeSkiaRenderProps,
	CanvasNodeToolbarProps,
} from "../types";

const VideoNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<VideoCanvasNode>
> = ({ node }) => {
	if (node.type !== "video") return null;
	return (
		<Rect
			x={0}
			y={0}
			width={Math.max(1, node.width)}
			height={Math.max(1, node.height)}
			color="#082f49"
		/>
	);
};

const VideoNodeToolbar = ({ asset }: CanvasNodeToolbarProps<VideoCanvasNode>) => {
	return (
		<div className="text-xs text-white/90">
			Video Source: {asset?.uri ?? "未绑定视频素材"}
		</div>
	);
};

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
