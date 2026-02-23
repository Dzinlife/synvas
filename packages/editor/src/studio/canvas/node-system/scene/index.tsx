import type { SceneNode } from "core/studio/types";
import { registerCanvasNodeDefinition } from "../registryCore";
import type { CanvasNodeDefinition } from "../types";
import { SceneNodeSkiaRenderer } from "./renderer";
import { SceneNodeToolbar } from "./toolbar";

const sceneDefinition: CanvasNodeDefinition<SceneNode> = {
	type: "scene",
	title: "Scene",
	create: () => ({ type: "scene" }),
	skiaRenderer: SceneNodeSkiaRenderer,
	toolbar: SceneNodeToolbar,
};

registerCanvasNodeDefinition(sceneDefinition);
