import type { TimelineElement } from "core/timeline-system/types";
import type { StudioProject } from "@/studio/project/types";

type CompositionSceneRefProps = {
	sceneId?: unknown;
};

export const resolveSceneReferenceSceneIdFromElement = (
	element: TimelineElement,
): string | null => {
	if (
		element.type !== "Composition" &&
		element.type !== "CompositionAudioClip"
	) {
		return null;
	}
	const sceneId = (element.props as CompositionSceneRefProps | undefined)
		?.sceneId;
	if (typeof sceneId !== "string") return null;
	const trimmed = sceneId.trim();
	return trimmed.length > 0 ? trimmed : null;
};

export const resolveCompositionSceneIdFromElement =
	resolveSceneReferenceSceneIdFromElement;

export const resolveDeletedSceneIdsToRetain = (
	project: StudioProject,
	deletedSceneIds: Iterable<string>,
): Set<string> => {
	const deletedSceneIdSet = new Set(deletedSceneIds);
	if (deletedSceneIdSet.size === 0) {
		return new Set<string>();
	}
	const retainedSceneIds = new Set<string>();
	const visitedSceneIds = new Set<string>();
	const stack = Object.keys(project.scenes).filter(
		(sceneId) => !deletedSceneIdSet.has(sceneId),
	);

	while (stack.length > 0) {
		const currentSceneId = stack.pop();
		if (!currentSceneId || visitedSceneIds.has(currentSceneId)) continue;
		visitedSceneIds.add(currentSceneId);

		const scene = project.scenes[currentSceneId];
		if (!scene) continue;
		for (const element of scene.timeline.elements) {
			const nextSceneId = resolveSceneReferenceSceneIdFromElement(element);
			if (!nextSceneId || visitedSceneIds.has(nextSceneId)) continue;
			if (deletedSceneIdSet.has(nextSceneId)) {
				retainedSceneIds.add(nextSceneId);
			}
			stack.push(nextSceneId);
		}
	}

	return retainedSceneIds;
};

export const wouldCreateSceneCompositionCycle = (
	project: StudioProject,
	parentSceneId: string,
	childSceneId: string,
): boolean => {
	if (parentSceneId === childSceneId) return true;
	const stack = [childSceneId];
	const visited = new Set<string>();

	while (stack.length > 0) {
		const currentSceneId = stack.pop();
		if (!currentSceneId) continue;
		if (currentSceneId === parentSceneId) {
			return true;
		}
		if (visited.has(currentSceneId)) continue;
		visited.add(currentSceneId);

		const scene = project.scenes[currentSceneId];
		if (!scene) continue;
		for (const element of scene.timeline.elements) {
			const nextSceneId = resolveSceneReferenceSceneIdFromElement(element);
			if (!nextSceneId) continue;
			stack.push(nextSceneId);
		}
	}

	return false;
};
