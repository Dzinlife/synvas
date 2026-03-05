import type { TimelineElement } from "core/element/types";
import type { StudioProject } from "core/studio/types";

type CompositionSceneRefProps = {
	sceneId?: unknown;
};

export const resolveCompositionSceneIdFromElement = (
	element: TimelineElement,
): string | null => {
	if (element.type !== "Composition") return null;
	const sceneId = (element.props as CompositionSceneRefProps | undefined)
		?.sceneId;
	if (typeof sceneId !== "string") return null;
	const trimmed = sceneId.trim();
	return trimmed.length > 0 ? trimmed : null;
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
			const nextSceneId = resolveCompositionSceneIdFromElement(element);
			if (!nextSceneId) continue;
			stack.push(nextSceneId);
		}
	}

	return false;
};
