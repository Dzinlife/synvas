import type { SceneNode } from "core/studio/types";
import type { CanvasNodeToolbarProps } from "../types";

export const SceneNodeToolbar = ({
	node,
	scene,
	setActiveScene,
	setFocusedScene,
}: CanvasNodeToolbarProps<SceneNode>) => {
	if (node.type !== "scene") return null;
	return (
		<div className="flex items-center gap-3 text-xs text-white/90">
			<div className="font-medium">{scene?.name ?? node.name}</div>
			<div className="text-white/60">{node.sceneId}</div>
			<button
				type="button"
				className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
				onClick={() => {
					setActiveScene(node.sceneId);
					setFocusedScene(node.sceneId);
				}}
			>
				聚焦 Scene
			</button>
			<button
				type="button"
				className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
				onClick={() => {
					setFocusedScene(null);
				}}
			>
				退出聚焦
			</button>
		</div>
	);
};
