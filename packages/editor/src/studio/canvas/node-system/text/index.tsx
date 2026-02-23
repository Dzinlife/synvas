import type { TextCanvasNode } from "core/studio/types";
import { registerCanvasNodeDefinition } from "../registryCore";
import type { CanvasNodeDefinition } from "../types";
import { TextNodeSkiaRenderer } from "./renderer";
import { TextNodeToolbar } from "./toolbar";

const textDefinition: CanvasNodeDefinition<TextCanvasNode> = {
	type: "text",
	title: "Text",
	create: () => ({ type: "text", text: "新建文本", name: "Text" }),
	skiaRenderer: TextNodeSkiaRenderer,
	toolbar: TextNodeToolbar,
};

registerCanvasNodeDefinition(textDefinition);
