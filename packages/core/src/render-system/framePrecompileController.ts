import {
	createFramePrecompileBuffer,
	type DisposableFrameState,
	type FrameBuildFactory,
	type FrameCacheEntry,
	type FrameCacheEvent,
	type FrameIndex,
} from "./framePrecompileBuffer";
import type {
	PrecompileSchedulerHandle,
	PrecompileTaskScheduler,
} from "./framePrecompileScheduler";

interface CreateFramePrecompileControllerOptions {
	lookaheadFrames: number;
	scheduleTask: PrecompileTaskScheduler;
	onPrefetchError?: (error: unknown, frameIndex: FrameIndex) => void;
	onCacheEvent?: (event: FrameCacheEvent) => void;
}

export interface FramePrecompileController<
	TState extends DisposableFrameState,
> {
	reconcileFrame: (frameIndex: FrameIndex) => void;
	getOrBuildCurrent: (
		frameIndex: FrameIndex,
		factory: FrameBuildFactory<TState>,
	) => Promise<FrameCacheEntry<TState>>;
	takeDispose: (entry: FrameCacheEntry<TState>) => (() => void) | undefined;
	commitFrame: (
		frameIndex: FrameIndex,
		factory: FrameBuildFactory<TState>,
	) => void;
	invalidateAll: () => void;
	disposeAll: () => void;
	readonly cacheSize: number;
}

export const createFramePrecompileController = <
	TState extends DisposableFrameState,
>(
	options: CreateFramePrecompileControllerOptions,
): FramePrecompileController<TState> => {
	const { lookaheadFrames, scheduleTask, onPrefetchError, onCacheEvent } =
		options;
	const buffer = createFramePrecompileBuffer<TState>({
		lookaheadFrames,
		onPrefetchError,
		onCacheEvent,
	});
	const handles = new Set<PrecompileSchedulerHandle>();
	let lastCommittedFrame: FrameIndex | null = null;
	let sessionVersion = 0;

	const cancelScheduledTasks = () => {
		for (const handle of handles) {
			handle.cancel();
		}
		handles.clear();
	};

	const invalidateAll = () => {
		sessionVersion += 1;
		cancelScheduledTasks();
		buffer.invalidateAll();
		lastCommittedFrame = null;
	};

	const reconcileFrame = (frameIndex: FrameIndex) => {
		if (lastCommittedFrame === null) return;
		const isBackward = frameIndex < lastCommittedFrame;
		const isForwardJumpBeyondLookahead =
			frameIndex > lastCommittedFrame + lookaheadFrames;
		if (isBackward || isForwardJumpBeyondLookahead) {
			// 保守失效，避免跨段命中旧缓存。
			invalidateAll();
		}
	};

	const getOrBuildCurrent = (
		frameIndex: FrameIndex,
		factory: FrameBuildFactory<TState>,
	) => {
		return buffer.getOrBuildCurrent(frameIndex, factory);
	};

	const takeDispose = (entry: FrameCacheEntry<TState>) => {
		return buffer.takeDispose(entry);
	};

	const commitFrame = (
		frameIndex: FrameIndex,
		factory: FrameBuildFactory<TState>,
	) => {
		lastCommittedFrame = frameIndex;
		buffer.evictOutsideForwardWindow(frameIndex);

		// 先同步预编译下一帧，保证连续播放下尽快产生命中。
		buffer.prefetch(frameIndex + 1, factory);

		if (lookaheadFrames <= 1) return;
		const currentVersion = sessionVersion;
		let handle!: PrecompileSchedulerHandle;
		handle = scheduleTask(() => {
			handles.delete(handle);
			if (sessionVersion !== currentVersion) {
				return;
			}
			for (let offset = 2; offset <= lookaheadFrames; offset += 1) {
				buffer.prefetch(frameIndex + offset, factory);
			}
		});
		handles.add(handle);
	};

	const disposeAll = () => {
		invalidateAll();
	};

	return {
		reconcileFrame,
		getOrBuildCurrent,
		takeDispose,
		commitFrame,
		invalidateAll,
		disposeAll,
		get cacheSize() {
			return buffer.size;
		},
	};
};
