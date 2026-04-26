import type { SceneDocument, SceneNode } from "@/studio/project/types";
import type { SceneNodeFrameSnapshot } from "./frameSnapshot";

export interface SceneNodeLastLiveFrame {
	nodeId: string;
	sceneId: string;
	sceneUpdatedAt: number;
	frameIndex: number;
	displayTime: number;
	fps: number;
	sourceWidth: number;
	sourceHeight: number;
	commitRevision: number;
	sourceSignature: string;
}

export type SceneNodeLastLiveFrameListener = (
	record: SceneNodeLastLiveFrame | null,
	nodeId: string,
) => void;

const lastLiveFrameByNodeId = new Map<string, SceneNodeLastLiveFrame>();
const lastLiveFrameListeners = new Set<SceneNodeLastLiveFrameListener>();
let nextLastLiveFrameCommitRevision = 1;

const emitSceneNodeLastLiveFrameChange = (
	record: SceneNodeLastLiveFrame | null,
	nodeId: string,
): void => {
	for (const listener of lastLiveFrameListeners) {
		listener(record, nodeId);
	}
};

const buildSceneNodeLastLiveFrameSignature = (
	input: Omit<SceneNodeLastLiveFrame, "sourceSignature">,
): string => {
	return JSON.stringify({
		nodeId: input.nodeId,
		sceneId: input.sceneId,
		sceneUpdatedAt: input.sceneUpdatedAt,
		frameIndex: input.frameIndex,
		displayTime: input.displayTime,
		fps: input.fps,
		sourceWidth: input.sourceWidth,
		sourceHeight: input.sourceHeight,
		commitRevision: input.commitRevision,
	});
};

const resolveSceneCanvasSize = (
	scene: SceneDocument,
): { width: number; height: number } => ({
	width: Math.max(1, Math.round(scene.timeline.canvas.width || 1)),
	height: Math.max(1, Math.round(scene.timeline.canvas.height || 1)),
});

export const recordSceneNodeLastLiveFrame = ({
	node,
	scene,
	frame,
}: {
	node: SceneNode;
	scene: SceneDocument;
	frame: SceneNodeFrameSnapshot;
}): SceneNodeLastLiveFrame => {
	const recordWithoutSignature = {
		nodeId: node.id,
		sceneId: node.sceneId,
		sceneUpdatedAt: scene.updatedAt,
		frameIndex: frame.frameIndex,
		displayTime: frame.displayTime,
		fps: frame.fps,
		sourceWidth: frame.sourceWidth,
		sourceHeight: frame.sourceHeight,
		commitRevision: nextLastLiveFrameCommitRevision,
	};
	nextLastLiveFrameCommitRevision += 1;
	const record = {
		...recordWithoutSignature,
		sourceSignature: buildSceneNodeLastLiveFrameSignature(
			recordWithoutSignature,
		),
	};
	lastLiveFrameByNodeId.set(node.id, record);
	emitSceneNodeLastLiveFrameChange(record, node.id);
	return record;
};

export const clearSceneNodeLastLiveFrame = (nodeId: string): void => {
	if (!lastLiveFrameByNodeId.delete(nodeId)) return;
	emitSceneNodeLastLiveFrameChange(null, nodeId);
};

export const clearSceneNodeLastLiveFrames = (): void => {
	const nodeIds = [...lastLiveFrameByNodeId.keys()];
	lastLiveFrameByNodeId.clear();
	nextLastLiveFrameCommitRevision = 1;
	for (const nodeId of nodeIds) {
		emitSceneNodeLastLiveFrameChange(null, nodeId);
	}
};

export const subscribeSceneNodeLastLiveFrame = (
	listener: SceneNodeLastLiveFrameListener,
): (() => void) => {
	lastLiveFrameListeners.add(listener);
	return () => {
		lastLiveFrameListeners.delete(listener);
	};
};

export const getSceneNodeLastLiveFrame = (
	node: SceneNode,
	scene: SceneDocument | null,
): SceneNodeLastLiveFrame | null => {
	if (!scene) return null;
	const record = lastLiveFrameByNodeId.get(node.id) ?? null;
	if (!record) return null;
	if (record.nodeId !== node.id) return null;
	if (record.sceneId !== node.sceneId) return null;
	if (record.sceneId !== scene.id) return null;
	if (record.sceneUpdatedAt !== scene.updatedAt) return null;
	const sceneCanvasSize = resolveSceneCanvasSize(scene);
	if (record.sourceWidth !== sceneCanvasSize.width) return null;
	if (record.sourceHeight !== sceneCanvasSize.height) return null;
	return record;
};
