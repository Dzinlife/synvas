import type { ImageCanvasNode } from "core/studio/types";
import { Rect } from "react-skia-lite";
import type { CanvasNodeSkiaRenderProps } from "../types";

export const ImageNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<ImageCanvasNode>
> = ({ node }) => {
	if (node.type !== "image") return null;
	return (
		<Rect
			x={0}
			y={0}
			width={Math.max(1, node.width)}
			height={Math.max(1, node.height)}
			color="#312e81"
		/>
	);
};
