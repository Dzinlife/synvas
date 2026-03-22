import type { VideoCanvasNode } from "core/studio/types";
import { resolveAssetDisplayLabel } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import type { CanvasNodeToolbarProps } from "../types";

export const VideoNodeToolbar = ({
	asset,
}: CanvasNodeToolbarProps<VideoCanvasNode>) => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const sourceLabel = resolveAssetDisplayLabel(asset, {
		projectId: currentProjectId,
	});

	return (
		<div className="text-xs text-white/90">
			Video Source: {sourceLabel ?? "未绑定视频素材"}
		</div>
	);
};
