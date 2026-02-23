import type { AudioCanvasNode } from "core/studio/types";
import type { CanvasNodeToolbarProps } from "../types";

export const AudioNodeToolbar = ({
	asset,
}: CanvasNodeToolbarProps<AudioCanvasNode>) => {
	return (
		<div className="text-xs text-white/90">
			Audio Source: {asset?.uri ?? "未绑定音频素材"}
		</div>
	);
};
