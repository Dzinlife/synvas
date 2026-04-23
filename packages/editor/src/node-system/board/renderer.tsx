import type { BoardCanvasNode } from "@/studio/project/types";
import { Rect } from "react-skia-lite";
import type { CanvasNodeSkiaRenderProps } from "../types";

export const BoardNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<BoardCanvasNode>
> = ({ node }) => {
	if (node.type !== "board") return null;
	const width = Math.max(1, Math.round(Math.abs(node.width)));
	const height = Math.max(1, Math.round(Math.abs(node.height)));
	return <Rect x={0} y={0} width={width} height={height} color="#222" />;
};
