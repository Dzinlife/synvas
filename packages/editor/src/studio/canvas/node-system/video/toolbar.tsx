import type { VideoCanvasNode } from "core/studio/types";
import type { CanvasNodeToolbarProps } from "../types";

export const VideoNodeToolbar = ({
	asset,
}: CanvasNodeToolbarProps<VideoCanvasNode>) => {
	return (
		<div className="text-xs text-white/90">
			Video Source: {asset?.uri ?? "未绑定视频素材"}
		</div>
	);
};
