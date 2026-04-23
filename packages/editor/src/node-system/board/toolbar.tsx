import type { BoardCanvasNode } from "@/studio/project/types";
import type { CanvasNodeToolbarProps } from "../types";

export const BoardNodeToolbar = ({
	node,
}: CanvasNodeToolbarProps<BoardCanvasNode>) => {
	if (node.type !== "board") return null;
	return null;
};
