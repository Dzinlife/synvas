import type { AudioCanvasNode } from "core/studio/types";
import { isAudioFile, readAudioMetadata } from "@/asr/opfsAudio";
import { registerCanvasNodeDefinition } from "../registryCore";
import type { CanvasNodeDefinition } from "../types";
import { AudioNodeSkiaRenderer } from "./renderer";
import { AudioNodeToolbar } from "./toolbar";

const audioDefinition: CanvasNodeDefinition<AudioCanvasNode> = {
	type: "audio",
	title: "Audio",
	create: () => ({ type: "audio" }),
	skiaRenderer: AudioNodeSkiaRenderer,
	toolbar: AudioNodeToolbar,
	fromExternalFile: async (file, context) => {
		if (!isAudioFile(file)) return null;
		const metadata = await readAudioMetadata(file).catch(() => ({
			duration: 1,
		}));
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
