import type { AudioCanvasNode } from "@/studio/project/types";
import { Rect } from "react-skia-lite";
import type { CanvasNodeSkiaRenderProps } from "../types";

export const AudioNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<AudioCanvasNode>
> = ({ node }) => {
	if (node.type !== "audio") return null;
	return (
		<Rect
			x={0}
			y={0}
			width={Math.max(1, node.width)}
			height={Math.max(1, node.height)}
			color="#052e16"
		/>
	);
};
