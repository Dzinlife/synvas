import type { VideoCanvasNode } from "@/studio/project/types";
import { createTransformMeta } from "@/element-system/transform";
import { buildTimelineMeta } from "@/scene-editor/utils/timelineTime";
import {
	getFallbackVideoMetadata,
	isVideoFile,
	readVideoMetadata,
} from "@/scene-editor/utils/externalVideo";
import { registerCanvasNodeDefinition } from "../registryCore";
import { resolveSceneTimelineInsertionSize } from "../timelineInsertionSize";
import type { CanvasNodeDefinition } from "../types";
import { VideoNodeDrawer } from "./drawer";
import { VideoNodeSkiaRenderer } from "./renderer";
import { videoNodeThumbnailCapability } from "./thumbnail";
import { VideoNodeToolbar } from "./toolbar";

const videoDefinition: CanvasNodeDefinition<VideoCanvasNode> = {
	type: "video",
	title: "Video",
	create: () => ({ type: "video" }),
	skiaRenderer: VideoNodeSkiaRenderer,
	thumbnail: videoNodeThumbnailCapability,
	toolbar: VideoNodeToolbar,
	focusable: true,
	drawer: VideoNodeDrawer,
	drawerOptions: {
		trigger: "active",
	},
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
		const ingested = await context.ingestExternalFileAsset(file, "video");
		const assetId = context.ensureProjectAsset({
			kind: "video",
			name: ingested.name,
			locator: ingested.locator,
			meta: {
				...(ingested.meta ?? {}),
				sourceSize: {
					width: metadata.width,
					height: metadata.height,
				},
			},
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
	toTimelineClipboardElement: ({
		node,
		project,
		targetSceneId,
		asset,
		fps,
		startFrame,
		trackIndex,
		createElementId,
	}) => {
		if (!node.assetId) return null;
		const durationFrames = Math.max(1, Math.round(node.duration ?? 1));
		const targetScene = targetSceneId ? project.scenes[targetSceneId] : null;
		const { width, height } = resolveSceneTimelineInsertionSize({
			sourceSize: asset?.meta?.sourceSize,
			fallbackSize: node,
			targetSize: targetScene?.timeline.canvas,
		});
		return {
			id: createElementId(),
			type: "VideoClip",
			component: "video-clip",
			name: node.name,
			assetId: node.assetId,
			props: {},
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
					trackIndex: trackIndex >= 0 ? trackIndex : 0,
					role: "clip",
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

registerCanvasNodeDefinition(videoDefinition);
