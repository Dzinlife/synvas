import { createFramePrecompileController } from "core/render-system/framePrecompileController";
import { describe, expect, it, vi } from "vitest";

type MockFrameState = {
	frame: number;
	dispose: ReturnType<typeof vi.fn>;
};

const waitForMicrotasks = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

const createManualScheduler = () => {
	const tasks: Array<{ run: () => void; cancelled: boolean }> = [];
	const scheduleTask = (task: () => void) => {
		const slot = { run: task, cancelled: false };
		tasks.push(slot);
		return {
			cancel: () => {
				slot.cancelled = true;
			},
		};
	};
	const flushAll = () => {
		const snapshot = tasks.splice(0, tasks.length);
		for (const task of snapshot) {
			if (!task.cancelled) {
				task.run();
			}
		}
	};
	return { scheduleTask, flushAll };
};

describe("framePrecompileController", () => {
	it("prefetches next frame immediately and schedules remaining lookahead", async () => {
		const scheduler = createManualScheduler();
		const controller = createFramePrecompileController<MockFrameState>({
			lookaheadFrames: 3,
			scheduleTask: scheduler.scheduleTask,
		});
		const factory = vi.fn(async (frame: number) => ({
			frame,
			dispose: vi.fn(),
		}));

		const entry = await controller.getOrBuildCurrent(10, factory);
		const dispose = controller.takeDispose(entry);
		dispose?.();
		controller.commitFrame(10, factory);
		await waitForMicrotasks();

		expect(factory.mock.calls.map(([frame]) => frame)).toEqual([10, 11]);

		scheduler.flushAll();
		await waitForMicrotasks();
		expect(factory.mock.calls.map(([frame]) => frame)).toEqual([
			10, 11, 12, 13,
		]);
		controller.disposeAll();
	});

	it("invalidates buffered future frames when jump exceeds lookahead window", async () => {
		const scheduler = createManualScheduler();
		const disposeByFrame = new Map<number, ReturnType<typeof vi.fn>>();
		const controller = createFramePrecompileController<MockFrameState>({
			lookaheadFrames: 3,
			scheduleTask: scheduler.scheduleTask,
		});
		const factory = vi.fn(async (frame: number) => {
			const dispose = vi.fn();
			disposeByFrame.set(frame, dispose);
			return { frame, dispose };
		});

		const entry = await controller.getOrBuildCurrent(30, factory);
		const dispose = controller.takeDispose(entry);
		dispose?.();
		controller.commitFrame(30, factory);
		await waitForMicrotasks();
		expect(controller.cacheSize).toBeGreaterThan(0);
		await controller.getOrBuildCurrent(31, factory);

		controller.reconcileFrame(40);
		expect(controller.cacheSize).toBe(0);
		expect(disposeByFrame.get(31)).toHaveBeenCalledTimes(1);
		controller.disposeAll();
	});

	it("disposeAll cancels deferred precompile tasks", async () => {
		const scheduler = createManualScheduler();
		const controller = createFramePrecompileController<MockFrameState>({
			lookaheadFrames: 3,
			scheduleTask: scheduler.scheduleTask,
		});
		const factory = vi.fn(async (frame: number) => ({
			frame,
			dispose: vi.fn(),
		}));

		const entry = await controller.getOrBuildCurrent(50, factory);
		const dispose = controller.takeDispose(entry);
		dispose?.();
		controller.commitFrame(50, factory);
		await waitForMicrotasks();
		controller.disposeAll();

		scheduler.flushAll();
		await waitForMicrotasks();
		expect(factory.mock.calls.map(([frame]) => frame)).toEqual([50, 51]);
	});
});
