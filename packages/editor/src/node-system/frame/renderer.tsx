import type { FrameCanvasNode } from "@/studio/project/types";
import { Rect } from "react-skia-lite";
import type { CanvasNodeSkiaRenderProps } from "../types";

export const FrameNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<FrameCanvasNode>
> = ({ node }) => {
	if (node.type !== "frame") return null;
	const width = Math.max(1, Math.round(Math.abs(node.width)));
	const height = Math.max(1, Math.round(Math.abs(node.height)));
	return (
		<Rect
			x={0}
			y={0}
			width={width}
			height={height}
			color="#222"
		/>
	);
};
