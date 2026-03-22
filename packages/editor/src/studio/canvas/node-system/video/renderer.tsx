import type { TimelineAsset } from "core/element/types";
import type { VideoCanvasNode } from "core/studio/types";
import { useEffect, useMemo } from "react";
import { ImageShader, Rect } from "react-skia-lite";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import type { CanvasNodeSkiaRenderProps } from "../types";
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
> = ({ node, asset, isActive, runtimeManager }) => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const width = Math.max(1, node.width);
	const height = Math.max(1, node.height);
	const assetUri = useMemo(
		() => resolveVideoAssetUri(asset, currentProjectId),
		[asset, currentProjectId],
	);
	const fps = resolvePlaybackFps(runtimeManager);
	const { snapshot, pause } = useVideoNodePlayback({
		nodeId: node.id,
		assetUri,
		fps,
		runtimeManager,
	});

	useEffect(() => {
		if (isActive) return;
		pause();
	}, [isActive, pause]);

	return (
		<Rect x={0} y={0} width={width} height={height} color="#082f49">
			{snapshot.currentFrame ? (
				<ImageShader
					image={snapshot.currentFrame}
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
