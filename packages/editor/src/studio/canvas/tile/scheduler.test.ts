import type { SkImage } from "react-skia-lite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTileAabb } from "./geometry";
import { StaticTileScheduler } from "./scheduler";
import { PriorityTaskQueue, RenderTaskPool } from "./taskQueue";
import type { TileInput } from "./types";

const { makeOffscreenSpy, createdCanvases } = vi.hoisted(() => {
	return {
		makeOffscreenSpy: vi.fn(),
		createdCanvases: [] as Array<{
			clear: ReturnType<typeof vi.fn>;
			save: ReturnType<typeof vi.fn>;
			restore: ReturnType<typeof vi.fn>;
			translate: ReturnType<typeof vi.fn>;
			scale: ReturnType<typeof vi.fn>;
			drawPicture: ReturnType<typeof vi.fn>;
			drawImageRect: ReturnType<typeof vi.fn>;
		}>,
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
		createdCanvases.push(canvas);
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
		debugEnabled: boolean;
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
		debugEnabled: input?.debugEnabled ?? false,
	};
};

const warmScheduler = (
	scheduler: StaticTileScheduler,
	frames: number,
	input?: Parameters<typeof createFrameInput>[0],
) => {
	for (let index = 0; index < frames; index += 1) {
		scheduler.beginFrame(createFrameInput(input));
	}
};

describe("tile scheduler", () => {
	beforeEach(() => {
		makeOffscreenSpy.mockClear();
		createdCanvases.length = 0;
	});

	it("同一可见集重复 beginFrame 不会重复入队", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 0,
		});
		scheduler.setInputs([createRasterInput()]);
		const firstFrame = scheduler.beginFrame(
			createFrameInput({
				debugEnabled: true,
			}),
		);
		const secondFrame = scheduler.beginFrame(
			createFrameInput({
				debugEnabled: true,
			}),
		);
		expect(firstFrame.stats.queuedCount).toBeGreaterThan(0);
		expect(secondFrame.stats.queuedCount).toBe(firstFrame.stats.queuedCount);
		expect(firstFrame.debugItems.length).toBe(firstFrame.stats.visibleCount);
		expect(firstFrame.debugItems[0]).toMatchObject({
			state: expect.any(String),
			queued: expect.any(Boolean),
			coverMode: expect.any(String),
		});
		scheduler.dispose();
	});

	it("每帧都会返回新的输出数组引用", () => {
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

	it("camera 平移不会清空已有队列", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 0,
		});
		scheduler.setInputs([
			createRasterInput({
				left: -4096,
				top: -4096,
				right: 4096,
				bottom: 4096,
			}),
		]);
		const firstFrame = scheduler.beginFrame(
			createFrameInput({
				x: 0,
				y: 0,
				stageWidth: 768,
				stageHeight: 768,
			}),
		);
		const secondFrame = scheduler.beginFrame(
			createFrameInput({
				x: 1536,
				y: 0,
				stageWidth: 768,
				stageHeight: 768,
			}),
		);
		expect(firstFrame.stats.queuedCount).toBeGreaterThan(0);
		expect(secondFrame.stats.queuedCount).toBeGreaterThan(0);
		expect(secondFrame.hasPendingWork).toBe(true);
		scheduler.dispose();
	});

	it("LOD 切换会逐帧推进 composeLod（每帧最多一级）", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 0,
		});
		scheduler.setInputs([
			createRasterInput({
				left: -4096,
				top: -4096,
				right: 4096,
				bottom: 4096,
			}),
		]);
		const stable = scheduler.beginFrame(
			createFrameInput({
				zoom: 1,
			}),
		);
		const farZoom1 = scheduler.beginFrame(
			createFrameInput({
				zoom: 0.02,
			}),
		);
		const farZoom2 = scheduler.beginFrame(
			createFrameInput({
				zoom: 0.02,
			}),
		);
		expect(stable.stats.composeLod).toBe(0);
		expect(farZoom1.stats.targetLod).toBeLessThanOrEqual(-5);
		expect(farZoom1.stats.composeLod).toBe(-1);
		expect(farZoom2.stats.composeLod).toBe(-2);
		scheduler.dispose();
	});

	it("LOD 迟滞可避免边界抖动", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 0,
		});
		scheduler.setInputs([createRasterInput()]);
		const baseFrame = scheduler.beginFrame(
			createFrameInput({
				zoom: 1,
			}),
		);
		const nearThresholdFrame = scheduler.beginFrame(
			createFrameInput({
				zoom: 2 ** 0.6,
			}),
		);
		const passThresholdFrame = scheduler.beginFrame(
			createFrameInput({
				zoom: 2 ** 0.75,
			}),
		);
		expect(baseFrame.stats.targetLod).toBe(0);
		expect(nearThresholdFrame.stats.targetLod).toBe(0);
		expect(passThresholdFrame.stats.targetLod).toBe(1);
		scheduler.dispose();
	});

	it("高 dpr 下会提升 target lod", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 0,
		});
		scheduler.setInputs([createRasterInput()]);
		const descriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		Object.defineProperty(globalThis, "window", {
			value: {
				devicePixelRatio: 2,
			},
			configurable: true,
		});
		try {
			const frame = scheduler.beginFrame(
				createFrameInput({
					zoom: 1,
				}),
			);
			expect(frame.stats.targetLod).toBe(1);
		} finally {
			if (descriptor) {
				Object.defineProperty(globalThis, "window", descriptor);
			} else {
				delete (globalThis as { window?: unknown }).window;
			}
			scheduler.dispose();
		}
	});

	it("LOD 切级会丢弃旧批次队列并限制为当前可见规模", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 0,
		});
		scheduler.setInputs([
			createRasterInput({
				left: -4096,
				top: -4096,
				right: 4096,
				bottom: 4096,
			}),
		]);
		const firstFrame = scheduler.beginFrame(
			createFrameInput({
				zoom: 1,
			}),
		);
		const secondFrame = scheduler.beginFrame(
			createFrameInput({
				zoom: 0.02,
			}),
		);
		expect(firstFrame.stats.queuedCount).toBeGreaterThan(0);
		expect(secondFrame.stats.queuedCount).toBeLessThanOrEqual(
			secondFrame.stats.visibleCount,
		);
		scheduler.dispose();
	});

	it("无输入且 debug 关闭时走快路径", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 2,
		});
		scheduler.setInputs([]);
		const frame = scheduler.beginFrame(
			createFrameInput({
				stageWidth: 4096,
				stageHeight: 4096,
				zoom: 0.2,
				debugEnabled: false,
			}),
		);
		expect(frame.stats.visibleCount).toBe(0);
		expect(frame.stats.queuedCount).toBe(0);
		expect(frame.stats.readyVisibleCount).toBe(0);
		expect(frame.debugItems).toHaveLength(0);
		expect(frame.hasPendingWork).toBe(false);
		expect(makeOffscreenSpy).toHaveBeenCalledTimes(0);
		scheduler.dispose();
	});

	it("无输入但 debug 开启时仍会输出调试格子", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 0,
		});
		scheduler.setInputs([]);
		const frame = scheduler.beginFrame(
			createFrameInput({
				stageWidth: 1024,
				stageHeight: 1024,
				zoom: 1,
				debugEnabled: true,
			}),
		);
		expect(frame.stats.visibleCount).toBeGreaterThan(0);
		expect(frame.debugItems.length).toBe(frame.stats.visibleCount);
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

	it("不同 lod 渲染会按 worldSize 缩放到固定 tile 纹理", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 1,
		});
		scheduler.setInputs([
			createRasterInput({
				left: -1024,
				top: -1024,
				right: 2048,
				bottom: 2048,
			}),
		]);
		scheduler.beginFrame(
			createFrameInput({
				zoom: 0.5,
				stageWidth: 512,
				stageHeight: 512,
			}),
		);
		const firstCanvas = createdCanvases[0];
		expect(firstCanvas).toBeTruthy();
		expect(firstCanvas.scale).toHaveBeenCalledWith(0.5, 0.5);
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

	it("一跳父级兜底可在切到更细 lod 时保持连续", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 8,
		});
		scheduler.setInputs([
			createRasterInput({
				nodeId: "node-parent-cover",
				left: -1024,
				top: -1024,
				right: 2048,
				bottom: 2048,
			}),
		]);
		warmScheduler(scheduler, 20, {
			zoom: 0.5,
			stageWidth: 512,
			stageHeight: 512,
		});
		const schedulerWithPatchedBudget = scheduler as unknown as {
			runTasksWithinBudget: (nowMs: number) => number;
		};
		schedulerWithPatchedBudget.runTasksWithinBudget = () => 0;
		const switchedFrame = scheduler.beginFrame(
			createFrameInput({
				zoom: 1,
				stageWidth: 512,
				stageHeight: 512,
				debugEnabled: true,
			}),
		);
		expect(
			switchedFrame.debugItems.some((item) => item.coverMode === "PARENT"),
		).toBe(true);
		expect(switchedFrame.fallbackNodeIds.length).toBe(0);
		scheduler.dispose();
	});

	it("一跳子级兜底可在切到更粗 lod 时复用已有细节 tile", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 8,
		});
		scheduler.setInputs([
			createRasterInput({
				nodeId: "node-child-cover",
				left: -1024,
				top: -1024,
				right: 2048,
				bottom: 2048,
			}),
		]);
		warmScheduler(scheduler, 20, {
			zoom: 1,
			stageWidth: 512,
			stageHeight: 512,
		});
		const schedulerWithPatchedBudget = scheduler as unknown as {
			runTasksWithinBudget: (nowMs: number) => number;
		};
		schedulerWithPatchedBudget.runTasksWithinBudget = () => 0;
		const switchedFrame = scheduler.beginFrame(
			createFrameInput({
				zoom: 0.5,
				stageWidth: 512,
				stageHeight: 512,
				debugEnabled: true,
			}),
		);
		expect(
			switchedFrame.debugItems.some((item) => item.coverMode === "CHILD"),
		).toBe(true);
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
		warmScheduler(scheduler, 40, {
			stageWidth: 1400,
			stageHeight: 768,
			zoom: 1,
		});
		const warmFrame = scheduler.beginFrame(
			createFrameInput({
				stageWidth: 1400,
				stageHeight: 768,
				zoom: 1,
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
				zoom: 1,
			}),
		);
		expect(dirtyFrame.hasPendingWork).toBe(true);
		expect(dirtyFrame.stats.queuedCount).toBeGreaterThan(0);
		scheduler.dispose();
	});
});
