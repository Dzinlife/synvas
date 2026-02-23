import type { ImageCanvasNode } from "core/studio/types";
import type { CanvasNodeToolbarProps } from "../types";

export const ImageNodeToolbar = ({
	asset,
}: CanvasNodeToolbarProps<ImageCanvasNode>) => {
	return (
		<div className="text-xs text-white/90">
			Image Source: {asset?.uri ?? "未绑定图片素材"}
		</div>
	);
};
