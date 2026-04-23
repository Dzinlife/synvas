import type { AudioCanvasNode } from "@/studio/project/types";
import { resolveAssetDisplayLabel } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import type { CanvasNodeToolbarProps } from "../types";

export const AudioNodeToolbar = ({
	asset,
}: CanvasNodeToolbarProps<AudioCanvasNode>) => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const sourceLabel = resolveAssetDisplayLabel(asset, {
		projectId: currentProjectId,
	});

	return (
		<div className="text-xs text-white/90">
			Audio Source: {sourceLabel ?? "未绑定音频素材"}
		</div>
	);
};
