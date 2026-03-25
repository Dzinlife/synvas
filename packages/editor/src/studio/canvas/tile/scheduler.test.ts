import type { SkImage } from "react-skia-lite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTileAabb } from "./geometry";
import { StaticTileScheduler } from "./scheduler";
import { PriorityTaskQueue, RenderTaskPool } from "./taskQueue";
import type { TileInput } from "./types";

const { makeOffscreenSpy } = vi.hoisted(() => {
	return {
		makeOffscreenSpy: vi.fn(),
	};
});

vi.mock("react-skia-lite", () => {
	let imageId = 1;
	const createImage = () => {
		return {
			id: imageId++,
			dispose: vi.fn(),
		};
	};
	const createSurface = () => {
		const canvas = {
			clear: vi.fn(),
			save: vi.fn(),
			restore: vi.fn(),
			translate: vi.fn(),
			scale: vi.fn(),
			drawPicture: vi.fn(),
			drawImageRect: vi.fn(),
		};
		return {
			getCanvas: () => canvas,
			flush: vi.fn(),
			asImageCopy: () => createImage(),
			makeImageSnapshot: () => createImage(),
			dispose: vi.fn(),
		};
	};
	makeOffscreenSpy.mockImplementation(() => {
		return createSurface();
	});
	return {
		Skia: {
			Paint: () => ({
				dispose: vi.fn(),
			}),
			Surface: {
				MakeOffscreen: makeOffscreenSpy,
			},
		},
	};
});

const createRasterInput = (
	input: Partial<{
		id: number;
		nodeId: string;
		left: number;
		top: number;
		right: number;
		bottom: number;
	}> = {},
): TileInput => {
	const left = input.left ?? 0;
	const top = input.top ?? 0;
	const right = input.right ?? 256;
	const bottom = input.bottom ?? 256;
	return {
		kind: "raster",
		id: input.id ?? 1,
		nodeId: input.nodeId ?? "node-a",
		image: {
			dispose: vi.fn(),
		} as unknown as SkImage,
		aabb: createTileAabb(left, top, right, bottom),
		sourceWidth: Math.max(1, Math.round(right - left)),
		sourceHeight: Math.max(1, Math.round(bottom - top)),
		epoch: 1,
	};
};

const createFrameInput = (
	input?: Partial<{
		x: number;
		y: number;
		zoom: number;
		stageWidth: number;
		stageHeight: number;
		nowMs: number;
	}>,
) => {
	return {
		camera: {
			x: input?.x ?? 0,
			y: input?.y ?? 0,
			zoom: input?.zoom ?? 1,
		},
		stageWidth: input?.stageWidth ?? 512,
		stageHeight: input?.stageHeight ?? 512,
		nowMs:
			input?.nowMs ??
			(typeof performance !== "undefined" ? performance.now() : Date.now()),
	};
};

describe("tile scheduler", () => {
	beforeEach(() => {
		makeOffscreenSpy.mockClear();
	});

	it("同一可见集重复 beginFrame 不会重复入队", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 0,
		});
		scheduler.setInputs([createRasterInput()]);
		const firstFrame = scheduler.beginFrame(createFrameInput());
		const secondFrame = scheduler.beginFrame(createFrameInput());
		expect(firstFrame.stats.queuedCount).toBeGreaterThan(0);
		expect(secondFrame.stats.queuedCount).toBe(firstFrame.stats.queuedCount);
		expect(firstFrame.debugItems.length).toBe(firstFrame.stats.visibleCount);
		expect(firstFrame.debugItems[0]).toMatchObject({
			state: expect.any(String),
			queued: expect.any(Boolean),
		});
		scheduler.dispose();
	});

	it("每帧都会返回新的调试数组引用以触发渲染更新", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 0,
		});
		scheduler.setInputs([createRasterInput()]);
		const firstFrame = scheduler.beginFrame(createFrameInput());
		const secondFrame = scheduler.beginFrame(createFrameInput());
		expect(firstFrame.drawItems).not.toBe(secondFrame.drawItems);
		expect(firstFrame.debugItems).not.toBe(secondFrame.debugItems);
		expect(firstFrame.fallbackNodeIds).not.toBe(secondFrame.fallbackNodeIds);
		scheduler.dispose();
	});

	it("优先队列消费顺序遵循 HIGH -> MID -> LOW", () => {
		const pool = new RenderTaskPool();
		const queue = new PriorityTaskQueue();
		const low = pool.acquire();
		low.priority = "LOW";
		const high = pool.acquire();
		high.priority = "HIGH";
		const mid = pool.acquire();
		mid.priority = "MID";
		expect(queue.enqueue(low)).toBe(true);
		expect(queue.enqueue(high)).toBe(true);
		expect(queue.enqueue(mid)).toBe(true);
		expect(queue.dequeue()?.priority).toBe("HIGH");
		expect(queue.dequeue()?.priority).toBe("MID");
		expect(queue.dequeue()?.priority).toBe("LOW");
	});

	it("camera 变化会 bump epoch 并替换旧队列", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 0,
		});
		scheduler.setInputs([createRasterInput()]);
		const firstFrame = scheduler.beginFrame(
			createFrameInput({
				x: 0,
				y: 0,
			}),
		);
		const secondFrame = scheduler.beginFrame(
			createFrameInput({
				x: 4096,
				y: 0,
			}),
		);
		expect(firstFrame.stats.queuedCount).toBeGreaterThan(0);
		expect(firstFrame.stats.queuedCount).toBeLessThanOrEqual(
			firstFrame.stats.visibleCount,
		);
		expect(secondFrame.stats.queuedCount).toBe(0);
		expect(secondFrame.hasPendingWork).toBe(false);
		scheduler.dispose();
	});

	it("无输入时不会持续排队或保持 pending", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 2,
		});
		scheduler.setInputs([]);
		const frame = scheduler.beginFrame(
			createFrameInput({
				stageWidth: 4096,
				stageHeight: 4096,
				zoom: 0.2,
			}),
		);
		expect(frame.stats.queuedCount).toBe(0);
		expect(frame.stats.readyVisibleCount).toBe(0);
		expect(frame.hasPendingWork).toBe(false);
		expect(makeOffscreenSpy).toHaveBeenCalledTimes(0);
		scheduler.dispose();
	});

	it("surface 会被池复用而不是每个任务新建", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 2,
		});
		scheduler.setInputs([
			createRasterInput({
				left: -1024,
				top: -1024,
				right: 2048,
				bottom: 2048,
			}),
		]);
		scheduler.beginFrame(createFrameInput());
		expect(makeOffscreenSpy).toHaveBeenCalledTimes(1);
		scheduler.dispose();
	});

	it("LRU 会在超限时优先驱逐不可见 ready tile", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 16,
			maxReadyTiles: 1,
		});
		scheduler.setInputs([
			createRasterInput({
				left: -2048,
				top: -2048,
				right: 4096,
				bottom: 4096,
			}),
		]);
		scheduler.beginFrame(
			createFrameInput({
				x: 0,
				y: 0,
				stageWidth: 768,
				stageHeight: 768,
			}),
		);
		const nextFrame = scheduler.beginFrame(
			createFrameInput({
				x: 4096,
				y: 0,
				stageWidth: 768,
				stageHeight: 768,
			}),
		);
		expect(nextFrame.stats.readyCount).toBeLessThanOrEqual(1);
		scheduler.dispose();
	});

	it("oldAABB ∪ newAABB 标脏后会触发可见 fallback", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 1,
		});
		const input = createRasterInput({
			nodeId: "node-dirty",
			left: 0,
			top: 0,
			right: 956,
			bottom: 256,
		});
		scheduler.setInputs([input]);
		for (let index = 0; index < 40; index += 1) {
			scheduler.beginFrame(
				createFrameInput({
					stageWidth: 1400,
					stageHeight: 768,
				}),
			);
		}
		const warmFrame = scheduler.beginFrame(
			createFrameInput({
				stageWidth: 1400,
				stageHeight: 768,
			}),
		);
		expect(warmFrame.stats.readyVisibleCount).toBeGreaterThan(0);
		expect(warmFrame.hasPendingWork).toBe(false);
		scheduler.markDirtyUnion(
			createTileAabb(0, 0, 256, 256),
			createTileAabb(700, 0, 956, 256),
		);
		const schedulerWithPatchedBudget = scheduler as unknown as {
			runTasksWithinBudget: (nowMs: number) => number;
		};
		schedulerWithPatchedBudget.runTasksWithinBudget = () => 0;
		const dirtyFrame = scheduler.beginFrame(
			createFrameInput({
				stageWidth: 1400,
				stageHeight: 768,
			}),
		);
		expect(dirtyFrame.hasPendingWork).toBe(true);
		expect(dirtyFrame.stats.queuedCount).toBeGreaterThan(0);
		scheduler.dispose();
	});
});
