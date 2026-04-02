type DisposeTiming = "immediate" | "animationFrame" | "idle" | "manual";

export type SkiaDisposableLike =
	| {
			dispose?: () => void;
			delete?: () => void;
	  }
	| null
	| undefined;

type ScheduleDisposeOptions = {
	timing?: DisposeTiming;
};

type DisposeQueueKey = Exclude<DisposeTiming, "immediate">;

type DisposeQueueEntry = {
	id: number;
	target: SkiaDisposableLike;
};

type DisposalStats = {
	pendingAnimationFrame: number;
	pendingIdle: number;
	pendingManual: number;
};

const DISPOSE_BATCH_SIZE = 128;
const MANUAL_IDLE_BATCH_SIZE = 24;
const MANUAL_IDLE_QUIET_MS = 220;
const IDLE_CALLBACK_TIMEOUT_MS = 200;
const FALLBACK_TIMER_DELAY_MS = 16;

let nextDisposeEntryId = 1;
const animationFrameQueue = new Map<number, DisposeQueueEntry>();
const idleQueue = new Map<number, DisposeQueueEntry>();
const manualQueue = new Map<number, DisposeQueueEntry>();
let animationFrameTaskId: number | null = null;
let idleTaskId: number | null = null;
let idleTaskUsesIdleCallback = false;
let manualTaskId: number | null = null;
let manualTaskUsesIdleCallback = false;
let runtimeBusyCount = 0;
let lastRuntimeActivityAtMs = Number.NEGATIVE_INFINITY;

const hasWindow = () => {
	return typeof window !== "undefined";
};

const resolveNowMs = () => {
	if (typeof performance !== "undefined") {
		return performance.now();
	}
	return Date.now();
};

const isDisposableObject = (
	target: SkiaDisposableLike,
): target is NonNullable<SkiaDisposableLike> => {
	return !!target && typeof target === "object";
};

const disposeOne = (target: SkiaDisposableLike) => {
	if (!isDisposableObject(target)) return;
	try {
		if (typeof target.dispose === "function") {
			target.dispose();
			return;
		}
		if (typeof target.delete === "function") {
			target.delete();
		}
	} catch {}
};

const resolveQueueByTiming = (timing: DisposeQueueKey) => {
	if (timing === "animationFrame") return animationFrameQueue;
	if (timing === "idle") return idleQueue;
	return manualQueue;
};

const flushQueueBatch = (
	queue: Map<number, DisposeQueueEntry>,
	batchSize = DISPOSE_BATCH_SIZE,
) => {
	let disposedCount = 0;
	for (const [id, entry] of queue) {
		disposeOne(entry.target);
		queue.delete(id);
		disposedCount += 1;
		if (disposedCount >= batchSize) break;
	}
	return disposedCount;
};

const scheduleAnimationFrameDrain = () => {
	if (!hasWindow()) return;
	if (animationFrameTaskId !== null) return;
	if (typeof window.requestAnimationFrame !== "function") return;
	animationFrameTaskId = window.requestAnimationFrame(() => {
		animationFrameTaskId = null;
		flushQueueBatch(animationFrameQueue);
		if (animationFrameQueue.size > 0) {
			scheduleAnimationFrameDrain();
		}
	});
};

const scheduleIdleDrain = () => {
	if (!hasWindow()) return;
	if (idleTaskId !== null) return;
	const windowWithIdle = window as Window & {
		requestIdleCallback?: (
			callback: IdleRequestCallback,
			options?: IdleRequestOptions,
		) => number;
		cancelIdleCallback?: (handle: number) => void;
	};
	if (typeof windowWithIdle.requestIdleCallback === "function") {
		idleTaskUsesIdleCallback = true;
		idleTaskId = windowWithIdle.requestIdleCallback(
			() => {
				idleTaskId = null;
				idleTaskUsesIdleCallback = false;
				flushQueueBatch(idleQueue);
				if (idleQueue.size > 0) {
					scheduleIdleDrain();
				}
			},
			{ timeout: IDLE_CALLBACK_TIMEOUT_MS },
		);
		return;
	}
	idleTaskUsesIdleCallback = false;
	idleTaskId = window.setTimeout(() => {
		idleTaskId = null;
		idleTaskUsesIdleCallback = false;
		flushQueueBatch(idleQueue);
		if (idleQueue.size > 0) {
			scheduleIdleDrain();
		}
	}, FALLBACK_TIMER_DELAY_MS);
};

const flushManualQueueBatch = (
	batchSize = MANUAL_IDLE_BATCH_SIZE,
	idleDeadline?: IdleDeadline,
) => {
	let disposedCount = 0;
	for (const [id, entry] of manualQueue) {
		disposeOne(entry.target);
		manualQueue.delete(id);
		disposedCount += 1;
		if (disposedCount >= batchSize) break;
		if (
			idleDeadline &&
			disposedCount > 0 &&
			idleDeadline.timeRemaining() <= 1
		) {
			break;
		}
	}
	return disposedCount;
};

const resolveManualDrainWaitMs = (nowMs: number): number => {
	if (runtimeBusyCount > 0) return FALLBACK_TIMER_DELAY_MS;
	const quietForMs = nowMs - lastRuntimeActivityAtMs;
	if (quietForMs >= MANUAL_IDLE_QUIET_MS) return 0;
	return Math.max(FALLBACK_TIMER_DELAY_MS, MANUAL_IDLE_QUIET_MS - quietForMs);
};

const runManualDrain = (idleDeadline?: IdleDeadline) => {
	if (manualQueue.size <= 0) return;
	// 只有在运行时安静一段时间后才回收，避免影响 pan/zoom/focus 动画流畅度。
	const nowMs = resolveNowMs();
	const waitMs = resolveManualDrainWaitMs(nowMs);
	if (waitMs > 0) {
		scheduleManualDrain(waitMs);
		return;
	}
	flushManualQueueBatch(MANUAL_IDLE_BATCH_SIZE, idleDeadline);
	if (manualQueue.size > 0) {
		scheduleManualDrain(0);
	}
};

const scheduleManualDrain = (waitMs = 0) => {
	if (!hasWindow()) return;
	if (manualQueue.size <= 0) return;
	if (manualTaskId !== null) return;

	if (waitMs > 0) {
		manualTaskUsesIdleCallback = false;
		manualTaskId = window.setTimeout(() => {
			manualTaskId = null;
			manualTaskUsesIdleCallback = false;
			scheduleManualDrain(0);
		}, waitMs);
		return;
	}

	const windowWithIdle = window as Window & {
		requestIdleCallback?: (
			callback: IdleRequestCallback,
			options?: IdleRequestOptions,
		) => number;
	};
	if (typeof windowWithIdle.requestIdleCallback === "function") {
		manualTaskUsesIdleCallback = true;
		manualTaskId = windowWithIdle.requestIdleCallback(
			(deadline) => {
				manualTaskId = null;
				manualTaskUsesIdleCallback = false;
				runManualDrain(deadline);
			},
			{ timeout: IDLE_CALLBACK_TIMEOUT_MS },
		);
		return;
	}

	manualTaskUsesIdleCallback = false;
	manualTaskId = window.setTimeout(() => {
		manualTaskId = null;
		manualTaskUsesIdleCallback = false;
		runManualDrain();
	}, FALLBACK_TIMER_DELAY_MS);
};

const cancelScheduledDrainTask = (
	taskId: number | null,
	usesIdleCallback: boolean,
) => {
	if (taskId === null || !hasWindow()) return;
	const windowWithIdle = window as Window & {
		cancelIdleCallback?: (handle: number) => void;
	};
	if (usesIdleCallback && typeof windowWithIdle.cancelIdleCallback === "function") {
		windowWithIdle.cancelIdleCallback(taskId);
		return;
	}
	window.clearTimeout(taskId);
};

const cancelScheduledDrains = () => {
	if (!hasWindow()) return;
	if (
		animationFrameTaskId !== null &&
		typeof window.cancelAnimationFrame === "function"
	) {
		window.cancelAnimationFrame(animationFrameTaskId);
	}
	animationFrameTaskId = null;
	cancelScheduledDrainTask(idleTaskId, idleTaskUsesIdleCallback);
	idleTaskId = null;
	idleTaskUsesIdleCallback = false;
	cancelScheduledDrainTask(manualTaskId, manualTaskUsesIdleCallback);
	manualTaskId = null;
	manualTaskUsesIdleCallback = false;
};

const enqueueDispose = (target: SkiaDisposableLike, timing: DisposeQueueKey) => {
	if (!isDisposableObject(target)) return 0;
	const id = nextDisposeEntryId++;
	const queue = resolveQueueByTiming(timing);
	queue.set(id, { id, target });
	if (timing === "animationFrame") {
		scheduleAnimationFrameDrain();
	} else if (timing === "idle") {
		scheduleIdleDrain();
	} else {
		scheduleManualDrain(resolveManualDrainWaitMs(resolveNowMs()));
	}
	return id;
};

const dequeueDispose = (entryId: number) => {
	animationFrameQueue.delete(entryId);
	idleQueue.delete(entryId);
	manualQueue.delete(entryId);
};

export const scheduleSkiaDispose = (
	target: SkiaDisposableLike,
	options?: ScheduleDisposeOptions,
) => {
	const timing = options?.timing ?? "animationFrame";
	if (timing === "immediate") {
		disposeOne(target);
		return 0;
	}
	return enqueueDispose(target, timing);
};

export const drainSkiaDisposals = (
	timing: DisposeQueueKey,
	batchSize = DISPOSE_BATCH_SIZE,
) => {
	const safeBatchSize = Number.isFinite(batchSize)
		? Math.max(1, Math.floor(batchSize))
		: DISPOSE_BATCH_SIZE;
	return flushQueueBatch(resolveQueueByTiming(timing), safeBatchSize);
};

export const markSkiaRuntimeActivity = () => {
	lastRuntimeActivityAtMs = resolveNowMs();
	if (manualQueue.size > 0) {
		scheduleManualDrain(resolveManualDrainWaitMs(lastRuntimeActivityAtMs));
	}
};

export const runSkiaWithBusyScope = <T,>(callback: () => T): T => {
	runtimeBusyCount += 1;
	try {
		return callback();
	} finally {
		runtimeBusyCount = Math.max(0, runtimeBusyCount - 1);
		if (manualQueue.size > 0) {
			scheduleManualDrain(resolveManualDrainWaitMs(resolveNowMs()));
		}
	}
};

export const flushSkiaDisposals = (timing?: DisposeQueueKey) => {
	if (!timing) {
		cancelScheduledDrains();
		drainSkiaDisposals("animationFrame", Number.POSITIVE_INFINITY);
		drainSkiaDisposals("idle", Number.POSITIVE_INFINITY);
		drainSkiaDisposals("manual", Number.POSITIVE_INFINITY);
		return;
	}
	drainSkiaDisposals(timing, Number.POSITIVE_INFINITY);
};

export const getSkiaDisposalStats = (): DisposalStats => {
	return {
		pendingAnimationFrame: animationFrameQueue.size,
		pendingIdle: idleQueue.size,
		pendingManual: manualQueue.size,
	};
};

export const clearSkiaDisposalQueue = () => {
	cancelScheduledDrains();
	animationFrameQueue.clear();
	idleQueue.clear();
	manualQueue.clear();
};

type ScopeEntry = {
	target: SkiaDisposableLike;
	queuedEntryId: number;
};

export type SkiaResourceScope = {
	track: (target: SkiaDisposableLike) => void;
	release: (target: SkiaDisposableLike, options?: ScheduleDisposeOptions) => void;
	disposeAll: (options?: ScheduleDisposeOptions) => void;
	size: () => number;
};

export const createSkiaResourceScope = (): SkiaResourceScope => {
	const entries = new Map<SkiaDisposableLike, ScopeEntry>();

	const track = (target: SkiaDisposableLike) => {
		if (!isDisposableObject(target)) return;
		const previous = entries.get(target);
		if (previous && previous.queuedEntryId > 0) {
			dequeueDispose(previous.queuedEntryId);
		}
		entries.set(target, {
			target,
			queuedEntryId: 0,
		});
	};

	const release = (target: SkiaDisposableLike, options?: ScheduleDisposeOptions) => {
		if (!isDisposableObject(target)) return;
		const existing = entries.get(target);
		if (!existing) {
			track(target);
		}
		const entry = entries.get(target);
		if (!entry) return;
		if (entry.queuedEntryId > 0) {
			dequeueDispose(entry.queuedEntryId);
			entry.queuedEntryId = 0;
		}
		const queueEntryId = scheduleSkiaDispose(target, options);
		entry.queuedEntryId = queueEntryId;
		// 资源一旦进入释放流程，就从 scope 所有权中移除，避免长期持有引用。
		entries.delete(target);
	};

	const disposeAll = (options?: ScheduleDisposeOptions) => {
		const currentEntries = [...entries.values()];
		for (const entry of currentEntries) {
			if (entry.queuedEntryId > 0) {
				dequeueDispose(entry.queuedEntryId);
				entry.queuedEntryId = 0;
			}
			scheduleSkiaDispose(entry.target, {
				timing: options?.timing ?? "immediate",
			});
			entries.delete(entry.target);
		}
	};

	const size = () => entries.size;

	return {
		track,
		release,
		disposeAll,
		size,
	};
};
