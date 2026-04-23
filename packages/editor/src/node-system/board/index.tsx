import type { BoardCanvasNode } from "@/studio/project/types";
import { registerCanvasNodeDefinition } from "../registryCore";
import type { CanvasNodeDefinition } from "../types";
import { BoardNodeSkiaRenderer } from "./renderer";
import { boardNodeTilePictureCapability } from "./tilePicture";
import { BoardNodeToolbar } from "./toolbar";

const boardDefinition: CanvasNodeDefinition<BoardCanvasNode> = {
	type: "board",
	title: "Board",
	create: () => ({ type: "board" }),
	skiaRenderer: BoardNodeSkiaRenderer,
	tilePicture: boardNodeTilePictureCapability,
	toolbar: BoardNodeToolbar,
	focusable: false,
};

registerCanvasNodeDefinition(boardDefinition);
