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
	resolveResizeConstraints: ({ node, scene }) => {
		const sourceWidth = scene?.timeline.canvas.width ?? node.width;
		const sourceHeight = scene?.timeline.canvas.height ?? node.height;
		if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) {
			return {
				lockAspectRatio: true,
			};
		}
		if (sourceWidth <= 0 || sourceHeight <= 0) {
			return {
				lockAspectRatio: true,
			};
		}
		return {
			lockAspectRatio: true,
			aspectRatio: sourceWidth / sourceHeight,
		};
	},
	focusable: true,
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
