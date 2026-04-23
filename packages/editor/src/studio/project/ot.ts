import type { OtCommand, OtEngineSnapshot } from "core/timeline-system/ot";
import type { SceneNode, StudioProject, StudioProjectOt } from "./types";

export const createEmptyStudioOt = (params?: {
	actorId?: string;
	streamIds?: string[];
}): StudioProjectOt => {
	const streamIds = params?.streamIds ?? ["canvas"];
	const streams = Object.fromEntries(
		streamIds.map((streamId) => [
			streamId,
			{
				opIds: [],
				undoStack: [],
				redoStack: [],
			},
		]),
	);
	return {
		version: 1,
		actorId: params?.actorId ?? "studio-local",
		lamport: 0,
		streams,
		ops: [],
		transactions: [],
		tombstones: {
			scenes: {},
		},
	};
};

export const ensureStudioProjectOt = (
	project: StudioProject,
): StudioProjectOt => {
	if (project.ot) return project.ot;
	const sceneStreamIds = Object.keys(project.scenes).map(
		(sceneId) => `timeline:${sceneId}`,
	);
	return createEmptyStudioOt({
		streamIds: ["canvas", ...sceneStreamIds],
	});
};

export const mergeStudioOtSnapshot = <TCommand extends OtCommand>(
	existing: StudioProjectOt | undefined,
	snapshot: OtEngineSnapshot<TCommand>,
): StudioProjectOt => {
	const current = existing ?? createEmptyStudioOt({ actorId: snapshot.actorId });
	return {
		...current,
		actorId: snapshot.actorId,
		lamport: snapshot.lamport,
		streams: { ...snapshot.streams },
		ops: snapshot.opLog as StudioProjectOt["ops"],
		transactions: snapshot.txns as StudioProjectOt["transactions"],
	};
};

export const writeSceneTombstone = (
	project: StudioProject,
	sceneId: string,
	node: SceneNode,
	deletedAt: number,
): StudioProjectOt => {
	const ot = ensureStudioProjectOt(project);
	const scene = project.scenes[sceneId];
	if (!scene) return ot;
	return {
		...ot,
		tombstones: {
			...ot.tombstones,
			scenes: {
				...ot.tombstones.scenes,
				[sceneId]: {
					scene,
					node,
					deletedAt,
				},
			},
		},
	};
};

export const clearSceneTombstone = (
	project: StudioProject,
	sceneId: string,
): StudioProjectOt => {
	const ot = ensureStudioProjectOt(project);
	const { [sceneId]: _removed, ...rest } = ot.tombstones.scenes;
	return {
		...ot,
		tombstones: {
			...ot.tombstones,
			scenes: rest,
		},
	};
};
