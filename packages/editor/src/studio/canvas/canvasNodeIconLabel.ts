import type { CanvasNode, CanvasNodeType } from "core/studio/types";

export const CANVAS_NODE_ICON_FONT_FAMILY = "SynvasIcon";

export const CANVAS_NODE_ICON_BY_TYPE: Record<CanvasNodeType, string> = {
	scene: "\uF000",
	video: "\uF001",
	frame: "\uF002",
	audio: "\uF003",
	text: "\uF004",
	image: "\uF005",
};

export const resolveCanvasNodeTypeIcon = (type: CanvasNodeType): string => {
	return CANVAS_NODE_ICON_BY_TYPE[type];
};

export const resolveCanvasNodeLabelText = (
	node: Pick<CanvasNode, "type" | "name">,
): string => {
	const labelText = node.name.trim();
	if (!labelText) return "";
	return `${resolveCanvasNodeTypeIcon(node.type)}  ${labelText}`;
};
