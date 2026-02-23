import type { TextCanvasNode } from "core/studio/types";
import { Rect } from "react-skia-lite";
import type { CanvasNodeSkiaRenderProps } from "../types";

export const TextNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<TextCanvasNode>
> = ({ node }) => {
	if (node.type !== "text") return null;
	return (
		<Rect
			x={0}
			y={0}
			width={Math.max(1, node.width)}
			height={Math.max(1, node.height)}
			color="#451a03"
		/>
	);
};
