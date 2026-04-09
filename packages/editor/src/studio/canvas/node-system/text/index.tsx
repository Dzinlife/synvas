import type { TextCanvasNode } from "core/studio/types";
import type React from "react";
import { registerCanvasNodeDefinition } from "../registryCore";
import type {
	CanvasNodeDefinition,
	CanvasNodeFocusEditorBridgeProps,
} from "../types";
import { TextNodeSkiaRenderer } from "./renderer";
import { TextNodeFocusEditorBridge } from "./TextNodeFocusEditorBridge";
import { TextNodeFocusSkiaLayer } from "./TextNodeFocusSkiaLayer";
import { TextNodeToolbar } from "./toolbar";

const textDefinition: CanvasNodeDefinition<TextCanvasNode> = {
	type: "text",
	title: "Text",
	create: () => ({ type: "text", text: "新建文本", name: "Text" }),
	skiaRenderer: TextNodeSkiaRenderer,
	focusEditorLayer:
		TextNodeFocusSkiaLayer as unknown as React.ComponentType<unknown>,
	focusEditorBridge: TextNodeFocusEditorBridge as unknown as React.FC<
		CanvasNodeFocusEditorBridgeProps<TextCanvasNode>
	>,
	toolbar: TextNodeToolbar,
	focusable: true,
};

registerCanvasNodeDefinition(textDefinition);
