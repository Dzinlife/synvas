export type DisposableFrameState = {
	dispose?: (() => void) | undefined;
};

export type FrameIndex = number;

export type FrameCacheStatus = "pending" | "ready" | "consumed";

export type FrameBuildFactory<TState extends DisposableFrameState> = (
	frameIndex: FrameIndex,
) => Promise<TState>;

export interface FrameCacheEntry<TState extends DisposableFrameState> {
	key: FrameIndex;
	epoch: number;
	promise: Promise<TState>;
	state?: TState;
	status: FrameCacheStatus;
	disposeTransferred: boolean;
}

export type FrameCacheEvent =
	| { type: "miss"; frameIndex: FrameIndex }
	| {
			type: "hit-start" | "hit-resolved";
			frameIndex: FrameIndex;
			status: FrameCacheStatus;
	  };

interface CreateFramePrecompileBufferOptions {
	lookaheadFrames: number;
	onPrefetchError?: (error: unknown, frameIndex: FrameIndex) => void;
	onCacheEvent?: (event: FrameCacheEvent) => void;
}

export interface FramePrecompileBuffer<TState extends DisposableFrameState> {
	getOrBuildCurrent: (
		frameIndex: FrameIndex,
		factory: FrameBuildFactory<TState>,
	) => Promise<FrameCacheEntry<TState>>;
	prefetch: (
		frameIndex: FrameIndex,
		factory: FrameBuildFactory<TState>,
	) => void;
	takeDispose: (entry: FrameCacheEntry<TState>) => (() => void) | undefined;
	invalidateAll: () => void;
	evictOutsideForwardWindow: (currentFrame: FrameIndex) => void;
	disposeAll: () => void;
	readonly size: number;
}

const staleEntrySymbol = Symbol("stale-frame-entry");

type StaleEntryError = Error & {
	[staleEntrySymbol]: true;
};

const createStaleEntryError = (): StaleEntryError => {
	const error = new Error("Frame cache entry became stale") as StaleEntryError;
	error[staleEntrySymbol] = true;
	return error;
};

const isStaleEntryError = (error: unknown): error is StaleEntryError => {
	return Boolean(
		error &&
			typeof error === "object" &&
			staleEntrySymbol in (error as Record<PropertyKey, unknown>),
	);
};

const disposeState = <TState extends DisposableFrameState>(
	state: TState | undefined,
) => {
	const dispose = state?.dispose;
	if (typeof dispose === "function") {
		dispose();
	}
};

const disposeEntry = <TState extends DisposableFrameState>(
	entry: FrameCacheEntry<TState>,
) => {
	if (entry.disposeTransferred) return;
	entry.disposeTransferred = true;
	entry.status = "consumed";
	disposeState(entry.state);
};

export const toFrameIndex = (displayTime: number, _fps: number): FrameIndex => {
	if (!Number.isFinite(displayTime)) return 0;
	return Math.round(displayTime);
};

export const toDisplayTimeFromFrameIndex = (
	frameIndex: FrameIndex,
	_fps: number,
	fallbackDisplayTime: number,
): number => {
	if (!Number.isFinite(frameIndex)) return fallbackDisplayTime;
	return frameIndex;
};

export const createFramePrecompileBuffer = <
	TState extends DisposableFrameState,
>(
	options: CreateFramePrecompileBufferOptions,
): FramePrecompileBuffer<TState> => {
	const { lookaheadFrames, onPrefetchError, onCacheEvent } = options;
	const cache = new Map<FrameIndex, FrameCacheEntry<TState>>();
	let epoch = 0;

	const createEntry = (
		frameIndex: FrameIndex,
		factory: FrameBuildFactory<TState>,
	): FrameCacheEntry<TState> => {
		let entry!: FrameCacheEntry<TState>;
		const promise = Promise.resolve()
			.then(() => factory(frameIndex))
			.then((state) => {
				// 条目异步完成后再次校验，避免写入已经失效/淘汰的缓存。
				const currentEntry = cache.get(frameIndex);
				if (entry.epoch !== epoch || currentEntry !== entry) {
					disposeState(state);
					throw createStaleEntryError();
				}
				entry.state = state;
				if (entry.status === "pending") {
					entry.status = "ready";
				}
				return state;
			})
			.catch((error) => {
				const currentEntry = cache.get(frameIndex);
				if (currentEntry === entry) {
					cache.delete(frameIndex);
				}
				throw error;
			});
		entry = {
			key: frameIndex,
			epoch,
			promise,
			status: "pending",
			disposeTransferred: false,
		};
		cache.set(frameIndex, entry);
		return entry;
	};

	const ensureEntry = (
		frameIndex: FrameIndex,
		factory: FrameBuildFactory<TState>,
	): FrameCacheEntry<TState> => {
		const existingEntry = cache.get(frameIndex);
		if (existingEntry) return existingEntry;
		return createEntry(frameIndex, factory);
	};

	const getOrBuildCurrent = async (
		frameIndex: FrameIndex,
		factory: FrameBuildFactory<TState>,
	): Promise<FrameCacheEntry<TState>> => {
		const hasExistingEntry = cache.has(frameIndex);
		const entry = ensureEntry(frameIndex, factory);
		if (hasExistingEntry) {
			onCacheEvent?.({
				type: "hit-start",
				frameIndex,
				status: entry.status,
			});
		} else {
			onCacheEvent?.({ type: "miss", frameIndex });
		}
		await entry.promise;
		if (hasExistingEntry) {
			onCacheEvent?.({
				type: "hit-resolved",
				frameIndex,
				status: entry.status,
			});
		}
		return entry;
	};

	const prefetch = (
		frameIndex: FrameIndex,
		factory: FrameBuildFactory<TState>,
	) => {
		const entry = ensureEntry(frameIndex, factory);
		entry.promise.catch((error) => {
			if (isStaleEntryError(error)) return;
			onPrefetchError?.(error, frameIndex);
		});
	};

	const takeDispose = (entry: FrameCacheEntry<TState>) => {
		entry.status = "consumed";
		entry.disposeTransferred = true;
		if (cache.get(entry.key) === entry) {
			cache.delete(entry.key);
		}
		const dispose = entry.state?.dispose;
		return typeof dispose === "function" ? dispose : undefined;
	};

	const invalidateAll = () => {
		epoch += 1;
		const entries = Array.from(cache.values());
		cache.clear();
		for (const entry of entries) {
			disposeEntry(entry);
		}
	};

	const evictOutsideForwardWindow = (currentFrame: FrameIndex) => {
		const maxFrame = currentFrame + lookaheadFrames;
		for (const [frameIndex, entry] of cache) {
			const shouldKeep = frameIndex > currentFrame && frameIndex <= maxFrame;
			if (shouldKeep) continue;
			cache.delete(frameIndex);
			disposeEntry(entry);
		}
	};

	const disposeAll = () => {
		invalidateAll();
	};

	return {
		getOrBuildCurrent,
		prefetch,
		takeDispose,
		invalidateAll,
		evictOutsideForwardWindow,
		disposeAll,
		get size() {
			return cache.size;
		},
	};
};
