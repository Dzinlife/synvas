import type { FrameCanvasNode } from "core/studio/types";
import type { CanvasNodeToolbarProps } from "../types";

export const FrameNodeToolbar = ({
	node,
}: CanvasNodeToolbarProps<FrameCanvasNode>) => {
	if (node.type !== "frame") return null;
	return null;
};
