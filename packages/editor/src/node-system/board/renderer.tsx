import type { BoardCanvasNode } from "@/studio/project/types";
import { Group, Rect } from "react-skia-lite";
import type { CanvasNodeSkiaRenderProps } from "../types";

export const BOARD_NODE_BACKGROUND_COLOR = "rgba(34,34,34,0.72)";
export const BOARD_NODE_BORDER_COLOR = "rgba(255,255,255,0.16)";
export const BOARD_NODE_BORDER_WIDTH = 1;

interface BoardNodeSurfaceProps {
	width: number;
	height: number;
}

export const BoardNodeSurface: React.FC<BoardNodeSurfaceProps> = ({
	width,
	height,
}) => {
	const borderInset = BOARD_NODE_BORDER_WIDTH / 2;
	const borderWidth = Math.max(0, width - BOARD_NODE_BORDER_WIDTH);
	const borderHeight = Math.max(0, height - BOARD_NODE_BORDER_WIDTH);

	return (
		<Group>
			<Rect
				x={0}
				y={0}
				width={width}
				height={height}
				color={BOARD_NODE_BACKGROUND_COLOR}
			/>
			{borderWidth > 0 && borderHeight > 0 && (
				<Rect
					x={borderInset}
					y={borderInset}
					width={borderWidth}
					height={borderHeight}
					style="stroke"
					strokeWidth={BOARD_NODE_BORDER_WIDTH}
					color={BOARD_NODE_BORDER_COLOR}
				/>
			)}
		</Group>
	);
};

export const BoardNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<BoardCanvasNode>
> = ({ node }) => {
	if (node.type !== "board") return null;
	const width = Math.max(1, Math.round(Math.abs(node.width)));
	const height = Math.max(1, Math.round(Math.abs(node.height)));
	return <BoardNodeSurface width={width} height={height} />;
};
