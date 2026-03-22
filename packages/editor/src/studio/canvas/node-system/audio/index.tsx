import type { AudioCanvasNode } from "core/studio/types";
import { isAudioFile, readAudioMetadata } from "@/asr/opfsAudio";
import { createTransformMeta } from "@/element/transform";
import { buildTimelineMeta } from "@/scene-editor/utils/timelineTime";
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
		const ingested = await context.ingestExternalFileAsset(file, "audio");
		const assetId = context.ensureProjectAsset({
			kind: "audio",
			name: ingested.name,
			locator: ingested.locator,
			meta: ingested.meta,
		});
		return {
			type: "audio",
			assetId,
			name: file.name,
			duration: Math.max(1, Math.round(metadata.duration * context.fps)),
		};
	},
	toTimelineClipboardElement: ({
		node,
		fps,
		startFrame,
		trackIndex,
		createElementId,
	}) => {
		if (!node.assetId) return null;
		const durationFrames = Math.max(1, Math.round(node.duration ?? 1));
		const width = Math.max(1, Math.round(Math.abs(node.width)));
		const height = Math.max(1, Math.round(Math.abs(node.height)));
		return {
			id: createElementId(),
			type: "AudioClip",
			component: "audio-clip",
			name: node.name,
			assetId: node.assetId,
			props: {
				reversed: false,
			},
			transform: createTransformMeta({
				width,
				height,
				positionX: 0,
				positionY: 0,
			}),
			timeline: buildTimelineMeta(
				{
					start: startFrame,
					end: startFrame + durationFrames,
					trackIndex: trackIndex < 0 ? trackIndex : -1,
					role: "audio",
				},
				fps,
			),
			render: {
				zIndex: 0,
				visible: true,
				opacity: 1,
			},
		};
	},
};

registerCanvasNodeDefinition(audioDefinition);
