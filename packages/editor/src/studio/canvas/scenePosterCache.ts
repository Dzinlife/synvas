interface PosterCacheEntry {
	frame: number;
	picture: { dispose?: () => void } | null;
}

const posterCache = new Map<string, PosterCacheEntry>();

export const getScenePosterFrame = (sceneId: string): number | null => {
	return posterCache.get(sceneId)?.frame ?? null;
};

export const setScenePoster = (
	sceneId: string,
	frame: number,
	picture: { dispose?: () => void } | null,
): void => {
	const previous = posterCache.get(sceneId);
	if (previous?.picture && previous.picture !== picture) {
		previous.picture.dispose?.();
	}
	posterCache.set(sceneId, {
		frame,
		picture,
	});
};

export const disposeScenePoster = (sceneId: string): void => {
	const previous = posterCache.get(sceneId);
	if (!previous) return;
	previous.picture?.dispose?.();
	posterCache.delete(sceneId);
};

export const clearScenePosterCache = (): void => {
	for (const entry of posterCache.values()) {
		entry.picture?.dispose?.();
	}
	posterCache.clear();
};
