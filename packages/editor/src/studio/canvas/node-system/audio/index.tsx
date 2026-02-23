import type { AudioCanvasNode } from "core/studio/types";
import { Rect } from "react-skia-lite";
import { isAudioFile, readAudioMetadata } from "@/asr/opfsAudio";
import { registerCanvasNodeDefinition } from "../registryCore";
import type {
	CanvasNodeDefinition,
	CanvasNodeSkiaRenderProps,
	CanvasNodeToolbarProps,
} from "../types";

const AudioNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<AudioCanvasNode>
> = ({ node }) => {
	if (node.type !== "audio") return null;
	return (
		<Rect
			x={0}
			y={0}
			width={Math.max(1, node.width)}
			height={Math.max(1, node.height)}
			color="#052e16"
		/>
	);
};

const AudioNodeToolbar = ({ asset }: CanvasNodeToolbarProps<AudioCanvasNode>) => {
	return (
		<div className="text-xs text-white/90">
			Audio Source: {asset?.uri ?? "未绑定音频素材"}
		</div>
	);
};

const audioDefinition: CanvasNodeDefinition<AudioCanvasNode> = {
	type: "audio",
	title: "Audio",
	create: () => ({ type: "audio" }),
	skiaRenderer: AudioNodeSkiaRenderer,
	toolbar: AudioNodeToolbar,
	fromExternalFile: async (file, context) => {
		if (!isAudioFile(file)) return null;
		const metadata = await readAudioMetadata(file).catch(() => ({ duration: 1 }));
		const uri = await context.resolveExternalFileUri(file, "audio");
		const assetId = context.ensureProjectAssetByUri({
			uri,
			kind: "audio",
			name: file.name,
		});
		return {
			type: "audio",
			assetId,
			name: file.name,
			duration: Math.max(1, Math.round(metadata.duration * context.fps)),
		};
	},
};

registerCanvasNodeDefinition(audioDefinition);
