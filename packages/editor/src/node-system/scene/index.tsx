import type { SceneNode } from "@/studio/project/types";
import type React from "react";
import { SceneFocusEditorBridge } from "@/scene-editor/focus-editor/SceneFocusEditorBridge";
import { FocusSceneSkiaLayer } from "@/scene-editor/focus-editor/FocusSceneSkiaLayer";
import { wouldCreateSceneCompositionCycle } from "@/studio/scene/sceneComposition";
import { registerCanvasNodeDefinition } from "../registryCore";
import type {
	CanvasNodeDefinition,
	CanvasNodeFocusEditorBridgeProps,
} from "../types";
import { convertSceneNodeToTimelineElement } from "./clipboard";
import { SceneNodeDrawer } from "./drawer";
import { SceneNodeInspector } from "./inspector";
import { SceneNodeSkiaRenderer } from "./renderer";
import { sceneNodeThumbnailCapability } from "./thumbnail";
import { SceneNodeToolbar } from "./toolbar";

const sceneDefinition: CanvasNodeDefinition<SceneNode> = {
	type: "scene",
	title: "Scene",
	create: () => ({ type: "scene" }),
	skiaRenderer: SceneNodeSkiaRenderer,
	thumbnail: sceneNodeThumbnailCapability,
	focusEditorLayer: FocusSceneSkiaLayer as unknown as React.ComponentType<unknown>,
	focusEditorBridge:
		SceneFocusEditorBridge as unknown as React.FC<
			CanvasNodeFocusEditorBridgeProps<SceneNode>
		>,
	toolbar: SceneNodeToolbar,
	inspector: SceneNodeInspector,
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
	contextMenu: ({ node, project, sceneOptions, onInsertNodeToScene }) => {
		const sceneActions = sceneOptions.map((scene) => {
			const disabled =
				scene.sceneId === node.sceneId ||
				wouldCreateSceneCompositionCycle(project, scene.sceneId, node.sceneId);
			return {
				key: `insert-scene-to-scene:${scene.sceneId}`,
				label: scene.label,
				disabled,
				onSelect: () => {
					onInsertNodeToScene(scene.sceneId);
				},
			};
		});
		return [
			{
				key: "insert-scene-to-scene",
				label: "插入到其他 Scene",
				disabled: sceneActions.length === 0,
				onSelect: () => {},
				children: sceneActions,
			},
		];
	},
	toTimelineClipboardElement: convertSceneNodeToTimelineElement,
};

registerCanvasNodeDefinition(sceneDefinition);
