import type { TimelineAsset } from "core/timeline-system/types";
import type { VideoCanvasNode } from "@/studio/project/types";
import { useMemo } from "react";
import { ImageShader, Rect } from "react-skia-lite";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import { resolveSceneColorContext } from "@/studio/project/colorManagement";
import type { CanvasNodeSkiaRenderProps } from "../types";
import { useCanvasNodeThumbnailImage } from "../thumbnail/useCanvasNodeThumbnailImage";
import { useVideoNodePlayback } from "./useVideoNodePlayback";

const DEFAULT_FPS = 30;

const resolveVideoAssetUri = (
	asset: TimelineAsset | null,
	projectId: string | null,
): string | null => {
	if (!asset || asset.kind !== "video") return null;
	return resolveAssetPlayableUri(asset, { projectId });
};

const resolvePlaybackFps = (
	runtimeManager: CanvasNodeSkiaRenderProps<VideoCanvasNode>["runtimeManager"],
): number => {
	const activeTimelineRuntime = runtimeManager.getActiveEditTimelineRuntime();
	const rawFps = activeTimelineRuntime?.timelineStore.getState().fps;
	if (typeof rawFps !== "number" || !Number.isFinite(rawFps) || rawFps <= 0) {
		return DEFAULT_FPS;
	}
	return Math.round(rawFps);
};

export const VideoNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<VideoCanvasNode>
> = ({ node, scene, asset, isActive, runtimeManager }) => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const currentProject = useProjectStore((state) => state.currentProject);
	const width = Math.max(1, node.width);
	const height = Math.max(1, node.height);
	const assetUri = useMemo(
		() => resolveVideoAssetUri(asset, currentProjectId),
		[asset, currentProjectId],
	);
	const targetColorSpace = useMemo(
		() =>
			resolveSceneColorContext(currentProject, scene).previewTargetColorSpace,
		[currentProject, scene],
	);
	const fps = resolvePlaybackFps(runtimeManager);
	const { snapshot } = useVideoNodePlayback({
		nodeId: node.id,
		assetUri,
		assetId: asset?.id ?? null,
		fps,
		runtimeManager,
		targetColorSpace,
		active: isActive,
	});
	const thumbnailImage = useCanvasNodeThumbnailImage(node.thumbnail);
	const displayFrame = snapshot.currentFrame ?? thumbnailImage;

	return (
		<Rect x={0} y={0} width={width} height={height} color="#082f49">
			{displayFrame ? (
				<ImageShader
					image={displayFrame}
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
