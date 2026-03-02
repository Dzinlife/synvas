export type AudioOwnerId = string;

export type AudioOwnerChange = {
	previousOwner: AudioOwnerId | null;
	nextOwner: AudioOwnerId | null;
};

type OwnerListener = (change: AudioOwnerChange) => void;

let activeOwnerId: AudioOwnerId | null = null;
const ownerListeners = new Set<OwnerListener>();

const notifyOwnerChange = (change: AudioOwnerChange) => {
	if (change.previousOwner === change.nextOwner) return;
	for (const listener of ownerListeners) {
		listener(change);
	}
};

export const requestOwner = (ownerId: AudioOwnerId): AudioOwnerId | null => {
	const previousOwner = activeOwnerId;
	if (previousOwner === ownerId) return previousOwner;
	activeOwnerId = ownerId;
	notifyOwnerChange({ previousOwner, nextOwner: ownerId });
	return previousOwner;
};

export const releaseOwner = (ownerId: AudioOwnerId): boolean => {
	if (activeOwnerId !== ownerId) return false;
	const previousOwner = activeOwnerId;
	activeOwnerId = null;
	notifyOwnerChange({ previousOwner, nextOwner: null });
	return true;
};

export const getOwner = (): AudioOwnerId | null => {
	return activeOwnerId;
};

export const subscribeOwnerChange = (listener: OwnerListener): (() => void) => {
	ownerListeners.add(listener);
	return () => {
		ownerListeners.delete(listener);
	};
};

export const __resetAudioOwnerForTests = () => {
	activeOwnerId = null;
	ownerListeners.clear();
};
