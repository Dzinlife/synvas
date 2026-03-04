import { createFramePrecompileBuffer } from "core/editor/preview/framePrecompileBuffer";
import { describe, expect, it, vi } from "vitest";

type MockFrameState = {
	frame: number;
	dispose: ReturnType<typeof vi.fn>;
};

const waitForMicrotasks = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

const createDeferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
};

describe("framePrecompileBuffer", () => {
	it("should prefetch next 3 frames after committing current frame", async () => {
		const buffer = createFramePrecompileBuffer<MockFrameState>({
			lookaheadFrames: 3,
		});
		const factory = vi.fn(async (frame: number) => ({
			frame,
			dispose: vi.fn(),
		}));

		const currentEntry = await buffer.getOrBuildCurrent(10, factory);
		const currentDispose = buffer.takeDispose(currentEntry);
		buffer.evictOutsideForwardWindow(10);
		for (let nextFrame = 11; nextFrame <= 13; nextFrame += 1) {
			buffer.prefetch(nextFrame, factory);
		}
		await waitForMicrotasks();

		expect(factory.mock.calls.map(([frame]) => frame)).toEqual([
			10, 11, 12, 13,
		]);
		expect(buffer.size).toBe(3);
		currentDispose?.();
		buffer.disposeAll();
	});

	it("should reuse prefetched frame for current render without duplicate build", async () => {
		const buffer = createFramePrecompileBuffer<MockFrameState>({
			lookaheadFrames: 3,
		});
		const disposeByFrame = new Map<number, ReturnType<typeof vi.fn>>();
		const factory = vi.fn(async (frame: number) => {
			const dispose = vi.fn();
			disposeByFrame.set(frame, dispose);
			return { frame, dispose };
		});

		buffer.prefetch(20, factory);
		await waitForMicrotasks();
		const entry = await buffer.getOrBuildCurrent(20, factory);
		const dispose = buffer.takeDispose(entry);
		dispose?.();
		buffer.invalidateAll();

		expect(factory).toHaveBeenCalledTimes(1);
		expect(disposeByFrame.get(20)).toHaveBeenCalledTimes(1);
	});

	it("should fallback to sync build when current frame cache miss", async () => {
		const buffer = createFramePrecompileBuffer<MockFrameState>({
			lookaheadFrames: 3,
		});
		const deferred = createDeferred<MockFrameState>();
		const factory = vi.fn(async () => deferred.promise);

		const currentPromise = buffer.getOrBuildCurrent(30, factory);
		await waitForMicrotasks();
		expect(factory).toHaveBeenCalledTimes(1);

		const dispose = vi.fn();
		deferred.resolve({ frame: 30, dispose });
		const entry = await currentPromise;
		const transferredDispose = buffer.takeDispose(entry);
		transferredDispose?.();
		buffer.disposeAll();

		expect(entry.state?.frame).toBe(30);
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("should invalidate and dispose all cache entries on seek/jump/reverse", async () => {
		const buffer = createFramePrecompileBuffer<MockFrameState>({
			lookaheadFrames: 3,
		});
		const disposeByFrame = new Map<number, ReturnType<typeof vi.fn>>();
		const factory = vi.fn(async (frame: number) => {
			const dispose = vi.fn();
			disposeByFrame.set(frame, dispose);
			return { frame, dispose };
		});

		buffer.prefetch(40, factory);
		buffer.prefetch(41, factory);
		await buffer.getOrBuildCurrent(40, factory);
		await buffer.getOrBuildCurrent(41, factory);
		buffer.invalidateAll();

		expect(disposeByFrame.get(40)).toHaveBeenCalledTimes(1);
		expect(disposeByFrame.get(41)).toHaveBeenCalledTimes(1);
		expect(buffer.size).toBe(0);
	});

	it("should dispose stale async prefetch results after epoch change", async () => {
		const buffer = createFramePrecompileBuffer<MockFrameState>({
			lookaheadFrames: 3,
		});
		const deferred = createDeferred<MockFrameState>();
		const factory = vi.fn(async () => deferred.promise);

		buffer.prefetch(50, factory);
		await waitForMicrotasks();
		buffer.invalidateAll();

		const dispose = vi.fn();
		deferred.resolve({ frame: 50, dispose });
		await waitForMicrotasks();

		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("should evict frames outside forward window and call dispose exactly once", async () => {
		const buffer = createFramePrecompileBuffer<MockFrameState>({
			lookaheadFrames: 3,
		});
		const disposeByFrame = new Map<number, ReturnType<typeof vi.fn>>();
		const factory = vi.fn(async (frame: number) => {
			const dispose = vi.fn();
			disposeByFrame.set(frame, dispose);
			return { frame, dispose };
		});

		for (let frame = 1; frame <= 6; frame += 1) {
			buffer.prefetch(frame, factory);
		}
		for (let frame = 1; frame <= 6; frame += 1) {
			await buffer.getOrBuildCurrent(frame, factory);
		}
		buffer.evictOutsideForwardWindow(2);

		expect(disposeByFrame.get(1)).toHaveBeenCalledTimes(1);
		expect(disposeByFrame.get(2)).toHaveBeenCalledTimes(1);
		expect(disposeByFrame.get(6)).toHaveBeenCalledTimes(1);
		expect(disposeByFrame.get(3)).toHaveBeenCalledTimes(0);
		expect(disposeByFrame.get(4)).toHaveBeenCalledTimes(0);
		expect(disposeByFrame.get(5)).toHaveBeenCalledTimes(0);

		buffer.disposeAll();
		expect(disposeByFrame.get(1)).toHaveBeenCalledTimes(1);
		expect(disposeByFrame.get(2)).toHaveBeenCalledTimes(1);
		expect(disposeByFrame.get(6)).toHaveBeenCalledTimes(1);
	});

	it("should cleanup all cached states on unmount", async () => {
		const buffer = createFramePrecompileBuffer<MockFrameState>({
			lookaheadFrames: 3,
		});
		const pending = createDeferred<MockFrameState>();
		const readyDispose = vi.fn();
		const pendingDispose = vi.fn();
		const factory = vi.fn(async (frame: number) => {
			if (frame === 100) {
				return { frame, dispose: readyDispose };
			}
			return pending.promise;
		});

		buffer.prefetch(100, factory);
		await waitForMicrotasks();
		buffer.prefetch(101, factory);
		await waitForMicrotasks();

		buffer.disposeAll();
		expect(readyDispose).toHaveBeenCalledTimes(1);

		pending.resolve({ frame: 101, dispose: pendingDispose });
		await waitForMicrotasks();
		expect(pendingDispose).toHaveBeenCalledTimes(1);
		expect(buffer.size).toBe(0);
	});
});
