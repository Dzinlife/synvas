import type { ImageCanvasNode } from "@/studio/project/types";
import { resolveAssetDisplayLabel } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import type { CanvasNodeToolbarProps } from "../types";

export const ImageNodeToolbar = ({
	asset,
}: CanvasNodeToolbarProps<ImageCanvasNode>) => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const sourceLabel = resolveAssetDisplayLabel(asset, {
		projectId: currentProjectId,
	});

	return (
		<div className="text-xs text-white/90">
			Image Source: {sourceLabel ?? "未绑定图片素材"}
		</div>
	);
};
