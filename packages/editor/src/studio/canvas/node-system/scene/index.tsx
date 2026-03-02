import type { SceneNode } from "core/studio/types";
import { registerCanvasNodeDefinition } from "../registryCore";
import type { CanvasNodeDefinition } from "../types";
import { SceneNodeDrawer } from "./drawer";
import { SceneNodeSkiaRenderer } from "./renderer";
import { SceneNodeToolbar } from "./toolbar";

const sceneDefinition: CanvasNodeDefinition<SceneNode> = {
	type: "scene",
	title: "Scene",
	create: () => ({ type: "scene" }),
	skiaRenderer: SceneNodeSkiaRenderer,
	toolbar: SceneNodeToolbar,
	drawer: SceneNodeDrawer,
	drawerOptions: {
		trigger: "active",
		resizable: true,
		defaultHeight: 320,
		minHeight: 240,
		maxHeightRatio: 0.75,
	},
};

registerCanvasNodeDefinition(sceneDefinition);
