import type { TimelineAsset } from "core/element/types";
import type {
	AudioCanvasNode,
	StudioProject,
	VideoCanvasNode,
} from "core/studio/types";
import type {
	StudioRuntimeManager,
	TimelineRef,
} from "@/scene-editor/runtime/types";
import {
	getVideoNodePlaybackController,
	type VideoNodePlaybackController,
} from "@/studio/canvas/node-system/video/playbackController";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";

const DEFAULT_FPS = 30;

export type ActivePlaybackTarget =
	| {
			type: "scene";
			sceneId: string;
	  }
	| {
			type: "video";
			nodeId: string;
			assetUri: string;
	  }
	| {
			type: "audio";
			nodeId: string;
			assetUri: string;
	  }
	| null;

interface ResolveActivePlaybackTargetOptions {
	currentProject: StudioProject | null;
	activeNodeId: string | null;
	assets: TimelineAsset[];
}

const resolveAssetUri = (
	assets: TimelineAsset[],
	assetId: string,
	kind: "video" | "audio",
	projectId: string,
): string | null => {
	const asset = assets.find(
		(item) => item.id === assetId && item.kind === kind,
	);
	if (!asset) return null;
	const uri = resolveAssetPlayableUri(asset, { projectId });
	if (typeof uri !== "string") return null;
	return uri.length > 0 ? uri : null;
};

const resolveVideoTarget = (
	node: VideoCanvasNode,
	assets: TimelineAsset[],
	projectId: string,
): ActivePlaybackTarget => {
	const assetUri = resolveAssetUri(assets, node.assetId, "video", projectId);
	if (!assetUri) return null;
	return {
		type: "video",
		nodeId: node.id,
		assetUri,
	};
};

const resolveAudioTarget = (
	node: AudioCanvasNode,
	assets: TimelineAsset[],
	projectId: string,
): ActivePlaybackTarget => {
	const assetUri = resolveAssetUri(assets, node.assetId, "audio", projectId);
	if (!assetUri) return null;
	return {
		type: "audio",
		nodeId: node.id,
		assetUri,
	};
};

export const resolveActivePlaybackTarget = ({
	currentProject,
	activeNodeId,
	assets,
}: ResolveActivePlaybackTargetOptions): ActivePlaybackTarget => {
	if (!currentProject || !activeNodeId) return null;
	const activeNode = currentProject.canvas.nodes.find(
		(node) => node.id === activeNodeId,
	);
	if (!activeNode) return null;
	if (activeNode.type === "scene") {
		if (!currentProject.scenes[activeNode.sceneId]) return null;
		return {
			type: "scene",
			sceneId: activeNode.sceneId,
		};
	}
	if (activeNode.type === "video") {
		return resolveVideoTarget(activeNode, assets, currentProject.id);
	}
	if (activeNode.type === "audio") {
		return resolveAudioTarget(activeNode, assets, currentProject.id);
	}
	return null;
};

const resolvePlaybackFps = (runtimeManager: StudioRuntimeManager): number => {
	const rawFps = runtimeManager
		.getActiveEditTimelineRuntime()
		?.timelineStore.getState().fps;
	if (typeof rawFps !== "number" || !Number.isFinite(rawFps) || rawFps <= 0) {
		return DEFAULT_FPS;
	}
	return Math.round(rawFps);
};

interface DispatchActivePlaybackTargetOptions {
	target: ActivePlaybackTarget;
	runtimeManager: StudioRuntimeManager;
	toggleScenePlayback: (ref: TimelineRef) => void;
	getVideoController?: (nodeId: string) => VideoNodePlaybackController | null;
}

export const dispatchActivePlaybackTarget = async ({
	target,
	runtimeManager,
	toggleScenePlayback,
	getVideoController = getVideoNodePlaybackController,
}: DispatchActivePlaybackTargetOptions): Promise<void> => {
	if (!target) return;
	if (target.type === "scene") {
		toggleScenePlayback(toSceneTimelineRef(target.sceneId));
		return;
	}
	if (target.type === "video") {
		const controller = getVideoController(target.nodeId);
		if (!controller) return;
		controller.bind({
			assetUri: target.assetUri,
			fps: resolvePlaybackFps(runtimeManager),
			runtimeManager,
		});
		await controller.togglePlayback();
		return;
	}
	// audio 先走占位分支，后续接入真正播放控制器。
};
