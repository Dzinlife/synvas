import type { FrameCanvasNode } from "core/studio/types";
import { registerCanvasNodeDefinition } from "../registryCore";
import type { CanvasNodeDefinition } from "../types";
import { FrameNodeSkiaRenderer } from "./renderer";
import { frameNodeTilePictureCapability } from "./tilePicture";
import { FrameNodeToolbar } from "./toolbar";

const frameDefinition: CanvasNodeDefinition<FrameCanvasNode> = {
	type: "frame",
	title: "Frame",
	create: () => ({ type: "frame" }),
	skiaRenderer: FrameNodeSkiaRenderer,
	tilePicture: frameNodeTilePictureCapability,
	toolbar: FrameNodeToolbar,
	focusable: false,
};

registerCanvasNodeDefinition(frameDefinition);
