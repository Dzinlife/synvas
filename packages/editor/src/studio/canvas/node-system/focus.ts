import type { CanvasNode } from "core/studio/types";
import type { CanvasNodeDefinition } from "./types";

export const resolveNodeFocusable = (
	definition: Pick<CanvasNodeDefinition, "focusable"> | undefined,
): boolean => {
	return definition?.focusable ?? false;
};

type CanvasNodeDefinitionResolver = (
	type: CanvasNode["type"],
) => Pick<CanvasNodeDefinition, "focusable"> | undefined;

export const isCanvasNodeFocusable = (
	node: CanvasNode,
	resolveDefinition?: CanvasNodeDefinitionResolver,
): boolean => {
	if (!resolveDefinition) {
		return node.type === "scene";
	}
	return resolveNodeFocusable(resolveDefinition(node.type));
};
