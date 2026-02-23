import type { VideoCanvasNode } from "core/studio/types";
import { Rect } from "react-skia-lite";
import type { CanvasNodeSkiaRenderProps } from "../types";

export const VideoNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<VideoCanvasNode>
> = ({ node }) => {
	if (node.type !== "video") return null;
	return (
		<Rect
			x={0}
			y={0}
			width={Math.max(1, node.width)}
			height={Math.max(1, node.height)}
			color="#082f49"
		/>
	);
};
