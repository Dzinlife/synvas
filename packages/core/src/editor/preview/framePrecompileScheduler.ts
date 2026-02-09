export interface PrecompileSchedulerHandle {
	cancel: () => void;
}

export type PrecompileTaskScheduler = (
	task: () => void,
) => PrecompileSchedulerHandle;

export const schedulePrecompileTask: PrecompileTaskScheduler = (task) => {
	const globalScheduler = globalThis as typeof globalThis & {
		requestIdleCallback?: (
			callback: IdleRequestCallback,
			options?: IdleRequestOptions,
		) => number;
		cancelIdleCallback?: (handle: number) => void;
	};
	if (
		typeof globalScheduler.requestIdleCallback === "function" &&
		typeof globalScheduler.cancelIdleCallback === "function"
	) {
		const handle = globalScheduler.requestIdleCallback(
			() => {
				task();
			},
			{ timeout: 16 },
		);
		return {
			cancel: () => globalScheduler.cancelIdleCallback?.(handle),
		};
	}
	if (typeof globalThis.requestAnimationFrame === "function") {
		const handle = globalThis.requestAnimationFrame(() => {
			task();
		});
		return {
			cancel: () => globalThis.cancelAnimationFrame(handle),
		};
	}
	const timeoutHandle = globalThis.setTimeout(task, 0);
	return {
		cancel: () => globalThis.clearTimeout(timeoutHandle),
	};
};
