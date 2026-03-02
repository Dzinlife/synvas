import type { SceneNode } from "core/studio/types";
import { useMemo } from "react";
import { usePlaybackOwnerController } from "@/studio/scene/usePlaybackOwnerController";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import type { CanvasNodeToolbarProps } from "../types";

export const SceneNodeToolbar = ({
	node,
	scene,
	setActiveScene,
	setFocusedScene,
}: CanvasNodeToolbarProps<SceneNode>) => {
	const { togglePlayback, isOwnerPlaying } = usePlaybackOwnerController();
	const sceneRef = useMemo(() => toSceneTimelineRef(node.sceneId), [node.sceneId]);
	if (node.type !== "scene") return null;
	const isPlaying = isOwnerPlaying(sceneRef);
	return (
		<div className="flex items-center gap-3 text-xs text-white/90">
			<div className="font-medium">{scene?.name ?? node.name}</div>
			<div className="text-white/60">{node.sceneId}</div>
				<button
					type="button"
					className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
					onClick={() => {
						setActiveScene(node.sceneId);
						togglePlayback(sceneRef);
					}}
				>
					{isPlaying ? "暂停 Scene" : "播放 Scene"}
				</button>
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
