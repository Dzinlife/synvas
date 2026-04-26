import type { SkImage } from "react-skia-lite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTileAabb,
	isTileAabbIntersected,
	resolveTileWorldSize,
} from "./geometry";
import { StaticTileScheduler } from "./scheduler";
import { PriorityTaskQueue, RenderTaskPool } from "./taskQueue";
import {
	TILE_LOD_HYSTERESIS,
	TILE_LOD_STEP_PER_FRAME,
	TILE_PIXEL_SIZE,
} from "./constants";
import type { TileDrawItem, TileInput } from "./types";

const { makeOffscreenSpy, createdCanvases } = vi.hoisted(() => {
	return {
		makeOffscreenSpy: vi.fn(),
		createdCanvases: [] as Array<{
			clear: ReturnType<typeof vi.fn>;
			save: ReturnType<typeof vi.fn>;
			restore: ReturnType<typeof vi.fn>;
			translate: ReturnType<typeof vi.fn>;
			scale: ReturnType<typeof vi.fn>;
			clipRect: ReturnType<typeof vi.fn>;
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
			clipRect: vi.fn(),
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
		ClipOp: {
			Intersect: "intersect",
			Difference: "difference",
		},
		Skia: {
			Paint: () => ({
				dispose: vi.fn(),
			}),
			Surface: {
				MakeOffscreen: makeOffscreenSpy,
			},
		},
		scheduleSkiaDispose: vi.fn((target: { dispose?: () => void } | null) => {
			target?.dispose?.();
			return 1;
		}),
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
		image: SkImage;
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
		image:
			input.image ??
			({
				dispose: vi.fn(),
			} as unknown as SkImage),
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
		maxTasksPerTick: number;
		lodTransitionMode: "follow" | "freeze" | "snap";
		lodAnchorZoom: number;
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
		maxTasksPerTick: input?.maxTasksPerTick,
		lodTransitionMode: input?.lodTransitionMode,
		lodAnchorZoom: input?.lodAnchorZoom,
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

const findTileRecord = (
	scheduler: StaticTileScheduler,
	rect: { left: number; top: number; size: number },
) => {
	const internal = scheduler as unknown as {
		tileByKey: Map<
			number,
			{
				worldLeft: number;
				worldTop: number;
				worldSize: number;
				image: unknown;
			}
		>;
	};
	return (
		[...internal.tileByKey.values()].find((record) => {
			return (
				record.worldLeft === rect.left &&
				record.worldTop === rect.top &&
				record.worldSize === rect.size
			);
		}) ?? null
	);
};

const resolveDrawCoverageAabb = (item: TileDrawItem) => {
	return (
		item.clipAabb ??
		createTileAabb(
			item.left,
			item.top,
			item.left + item.size,
			item.top + item.size,
		)
	);
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

	it("beginFrame 传入 maxTasksPerTick 时可覆盖默认消费上限", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 0,
		});
		scheduler.setInputs([
			createRasterInput({
				left: -1024,
				top: -1024,
				right: 2048,
				bottom: 2048,
			}),
		]);
		const frame = scheduler.beginFrame(
			createFrameInput({
				stageWidth: 512,
				stageHeight: 512,
				zoom: 1,
				maxTasksPerTick: 1,
			}),
		);
		expect(frame.stats.frameTaskCount).toBe(1);
		scheduler.dispose();
	});

	it("每帧任务上限的非法输入会回退默认值，负值会夹紧到 0", () => {
		const schedulerWithFallback = new StaticTileScheduler({
			maxTasksPerTick: 1,
		});
		schedulerWithFallback.setInputs([
			createRasterInput({
				left: -1024,
				top: -1024,
				right: 2048,
				bottom: 2048,
			}),
		]);
		const fallbackFrame = schedulerWithFallback.beginFrame(
			createFrameInput({
				stageWidth: 512,
				stageHeight: 512,
				zoom: 1,
				maxTasksPerTick: Number.NaN,
			}),
		);
		expect(fallbackFrame.stats.frameTaskCount).toBe(1);
		schedulerWithFallback.dispose();

		const schedulerWithClamp = new StaticTileScheduler({
			maxTasksPerTick: 1,
		});
		schedulerWithClamp.setInputs([
			createRasterInput({
				left: -1024,
				top: -1024,
				right: 2048,
				bottom: 2048,
			}),
		]);
		const clampedFrame = schedulerWithClamp.beginFrame(
			createFrameInput({
				stageWidth: 512,
				stageHeight: 512,
				zoom: 1,
				maxTasksPerTick: -7,
			}),
		);
		expect(clampedFrame.stats.frameTaskCount).toBe(0);
		expect(clampedFrame.hasPendingWork).toBe(true);
		schedulerWithClamp.dispose();
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

	it("LOD 切换会按配置步长推进 composeLod", () => {
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
		expect(farZoom1.stats.composeLod).toBe(-TILE_LOD_STEP_PER_FRAME);
		expect(farZoom2.stats.composeLod).toBe(
			Math.max(farZoom2.stats.targetLod, -TILE_LOD_STEP_PER_FRAME * 2),
		);
		scheduler.dispose();
	});

	it("freeze 模式会在动画期间锁住 target/compose LOD", () => {
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
		const baseFrame = scheduler.beginFrame(
			createFrameInput({
				zoom: 1,
			}),
		);
		const freezeFrame = scheduler.beginFrame(
			createFrameInput({
				zoom: 0.02,
				lodTransitionMode: "freeze",
			}),
		);
		expect(baseFrame.stats.targetLod).toBe(0);
		expect(baseFrame.stats.composeLod).toBe(0);
		expect(freezeFrame.stats.targetLod).toBe(0);
		expect(freezeFrame.stats.composeLod).toBe(0);
		scheduler.dispose();
	});

	it("snap 模式会按 anchor zoom 一次对齐目标 LOD", () => {
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
		scheduler.beginFrame(
			createFrameInput({
				zoom: 1,
			}),
		);
		const snapFrame = scheduler.beginFrame(
			createFrameInput({
				zoom: 1,
				lodTransitionMode: "snap",
				lodAnchorZoom: 0.02,
			}),
		);
		expect(snapFrame.stats.targetLod).toBe(-6);
		expect(snapFrame.stats.composeLod).toBe(-6);
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
				zoom: 2 ** (0.5 + TILE_LOD_HYSTERESIS - 0.01),
			}),
		);
		const passThresholdFrame = scheduler.beginFrame(
			createFrameInput({
				zoom: 2 ** (0.5 + TILE_LOD_HYSTERESIS + 0.01),
			}),
		);
		expect(baseFrame.stats.targetLod).toBe(0);
		expect(nearThresholdFrame.stats.targetLod).toBe(0);
		expect(passThresholdFrame.stats.targetLod).toBe(1);
		scheduler.dispose();
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
		const frame = scheduler.beginFrame(
			createFrameInput({
				zoom: 0.5,
				stageWidth: 512,
				stageHeight: 512,
			}),
		);
		const firstCanvas = createdCanvases[0];
		const expectedScale =
			TILE_PIXEL_SIZE / resolveTileWorldSize(frame.stats.composeLod);
		expect(firstCanvas).toBeTruthy();
		expect(firstCanvas.scale).toHaveBeenCalledWith(
			expectedScale,
			expectedScale,
		);
		scheduler.dispose();
	});

	it("空间索引查询后仍保持输入绘制顺序", () => {
		const firstImage = {
			dispose: vi.fn(),
		} as unknown as SkImage;
		const secondImage = {
			dispose: vi.fn(),
		} as unknown as SkImage;
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 1,
		});
		scheduler.setInputs([
			createRasterInput({
				id: 1,
				nodeId: "node-order-a",
				left: 0,
				top: 0,
				right: 512,
				bottom: 512,
				image: firstImage,
			}),
			createRasterInput({
				id: 2,
				nodeId: "node-order-b",
				left: 0,
				top: 0,
				right: 512,
				bottom: 512,
				image: secondImage,
			}),
		]);
		scheduler.beginFrame(
			createFrameInput({
				stageWidth: 512,
				stageHeight: 512,
				zoom: 1,
			}),
		);
		const firstCanvas = createdCanvases[0];
		expect(firstCanvas).toBeTruthy();
		expect(firstCanvas.drawImageRect).toHaveBeenCalledTimes(2);
		expect(firstCanvas.drawImageRect.mock.calls[0]?.[0]).toBe(firstImage);
		expect(firstCanvas.drawImageRect.mock.calls[1]?.[0]).toBe(secondImage);
		scheduler.dispose();
	});

	it("裁剪输入会先应用 clipRect，并保持原始绘制顺序", () => {
		const firstImage = {
			dispose: vi.fn(),
		} as unknown as SkImage;
		const secondImage = {
			dispose: vi.fn(),
		} as unknown as SkImage;
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 1,
		});
		scheduler.setInputs([
			{
				...createRasterInput({
					id: 1,
					nodeId: "node-clipped",
					left: 0,
					top: 0,
					right: 512,
					bottom: 512,
					image: firstImage,
				}),
				visibleAabb: createTileAabb(32, 32, 128, 128),
				clipAabbs: [createTileAabb(32, 32, 128, 128)],
			},
			createRasterInput({
				id: 2,
				nodeId: "node-plain",
				left: 0,
				top: 0,
				right: 512,
				bottom: 512,
				image: secondImage,
			}),
		]);
		scheduler.beginFrame(
			createFrameInput({
				stageWidth: 512,
				stageHeight: 512,
				zoom: 1,
			}),
		);

		const firstCanvas = createdCanvases[0];
		expect(firstCanvas).toBeTruthy();
		expect(firstCanvas.clipRect).toHaveBeenCalledWith(
			{
				x: 32,
				y: 32,
				width: 96,
				height: 96,
			},
			"intersect",
			true,
		);
		expect(firstCanvas.drawImageRect).toHaveBeenCalledTimes(2);
		expect(firstCanvas.drawImageRect.mock.calls[0]?.[0]).toBe(firstImage);
		expect(firstCanvas.drawImageRect.mock.calls[1]?.[0]).toBe(secondImage);
		expect(firstCanvas.clipRect.mock.invocationCallOrder[0]).toBeLessThan(
			firstCanvas.drawImageRect.mock.invocationCallOrder[0],
		);
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

	it("父级 LOD 兜底只覆盖缺失子 tile，避免半透明内容叠画", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 8,
		});
		scheduler.setInputs([
			createRasterInput({
				nodeId: "node-parent-cover-alpha",
				left: -2048,
				top: -2048,
				right: 2048,
				bottom: 2048,
			}),
		]);
		warmScheduler(scheduler, 20, {
			zoom: 0.5,
			stageWidth: 512,
			stageHeight: 512,
		});
		const switchedFrame = scheduler.beginFrame(
			createFrameInput({
				zoom: 1,
				stageWidth: 512,
				stageHeight: 512,
				maxTasksPerTick: 1,
				debugEnabled: true,
			}),
		);
		const parentFallbackItems = switchedFrame.drawItems.filter((item) => {
			return item.sourceLod === -1 && item.clipAabb;
		});
		const readyChildItems = switchedFrame.drawItems.filter((item) => {
			return item.sourceLod === 0 && !item.clipAabb;
		});
		expect(parentFallbackItems.length).toBeGreaterThan(0);
		expect(readyChildItems.length).toBeGreaterThan(0);
		expect(
			parentFallbackItems.every((item) => {
				return item.clipAabb?.width === item.size / 2;
			}),
		).toBe(true);
		for (
			let leftIndex = 0;
			leftIndex < switchedFrame.drawItems.length;
			leftIndex += 1
		) {
			const leftAabb = resolveDrawCoverageAabb(
				switchedFrame.drawItems[leftIndex],
			);
			for (
				let rightIndex = leftIndex + 1;
				rightIndex < switchedFrame.drawItems.length;
				rightIndex += 1
			) {
				const rightAabb = resolveDrawCoverageAabb(
					switchedFrame.drawItems[rightIndex],
				);
				expect(isTileAabbIntersected(leftAabb, rightAabb)).toBe(false);
			}
		}
		scheduler.dispose();
	});

	it("LOD 兜底不会复用 input 签名已变化的旧缓存", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 8,
		});
		const oldInput = createRasterInput({
			nodeId: "node-moving-cache",
			left: 64,
			top: 64,
			right: 220,
			bottom: 220,
		});
		const nextInput = createRasterInput({
			nodeId: "node-moving-cache",
			left: 700,
			top: 64,
			right: 900,
			bottom: 220,
		});
		scheduler.setInputs([oldInput]);
		warmScheduler(scheduler, 20, {
			zoom: 0.5,
			stageWidth: 512,
			stageHeight: 512,
		});
		scheduler.setInputs([nextInput]);
		scheduler.markDirtyUnion(oldInput.aabb, nextInput.aabb);
		const queuedFrame = scheduler.beginFrame(
			createFrameInput({
				zoom: 0.5,
				stageWidth: 512,
				stageHeight: 512,
				maxTasksPerTick: 0,
			}),
		);
		expect(queuedFrame.stats.queuedCount).toBeGreaterThan(0);
		scheduler.beginFrame(
			createFrameInput({
				x: -4096,
				zoom: 0.5,
				stageWidth: 512,
				stageHeight: 512,
				maxTasksPerTick: 1,
			}),
		);
		const zoomInFrame = scheduler.beginFrame(
			createFrameInput({
				x: -512,
				zoom: 1,
				stageWidth: 512,
				stageHeight: 512,
				maxTasksPerTick: 0,
				debugEnabled: true,
			}),
		);
		expect(zoomInFrame.drawItems.some((item) => item.sourceLod === -1)).toBe(
			false,
		);
		expect(
			zoomInFrame.debugItems.some((item) => item.coverMode === "PARENT"),
		).toBe(false);
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

	it("oldAABB ∪ newAABB 标脏后会优先复用 stale tile，避免 live fallback", () => {
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
				debugEnabled: true,
			}),
		);
		expect(dirtyFrame.hasPendingWork).toBe(true);
		expect(dirtyFrame.stats.queuedCount).toBeGreaterThan(0);
		expect(dirtyFrame.drawItems.length).toBeGreaterThan(0);
		expect(dirtyFrame.fallbackNodeIds.length).toBe(0);
		expect(
			dirtyFrame.debugItems.some((item) => item.coverMode === "LIVE"),
		).toBe(false);
		scheduler.dispose();
	});

	it("输入不覆盖时不会继续绘制旧 READY tile", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 8,
		});
		scheduler.setInputs([
			createRasterInput({
				nodeId: "node-ready",
				left: 0,
				top: 0,
				right: 512,
				bottom: 512,
			}),
		]);
		warmScheduler(scheduler, 10, {
			stageWidth: 512,
			stageHeight: 512,
			zoom: 1,
		});
		const warmFrame = scheduler.beginFrame(
			createFrameInput({
				stageWidth: 512,
				stageHeight: 512,
				zoom: 1,
			}),
		);
		expect(warmFrame.stats.readyVisibleCount).toBeGreaterThan(0);
		expect(warmFrame.drawItems.length).toBeGreaterThan(0);

		scheduler.setInputs([
			createRasterInput({
				id: 2,
				nodeId: "node-far",
				left: 4096,
				top: 4096,
				right: 4608,
				bottom: 4608,
			}),
		]);
		const uncoveredFrame = scheduler.beginFrame(
			createFrameInput({
				stageWidth: 512,
				stageHeight: 512,
				zoom: 1,
				debugEnabled: true,
			}),
		);
		expect(uncoveredFrame.drawItems.length).toBe(0);
		expect(
			uncoveredFrame.debugItems.every((item) => item.coverMode === "NONE"),
		).toBe(true);
		expect(
			uncoveredFrame.debugItems.some(
				(item) => item.hasImage && item.state === "READY",
			),
		).toBe(false);
		expect(uncoveredFrame.fallbackNodeIds.length).toBe(0);
		scheduler.dispose();
	});

	it("覆盖输入变更后即使旧 tile 仍有元素，也会触发一次重绘", () => {
		const scheduler = new StaticTileScheduler({
			maxTasksPerTick: 1,
		});
		const staticInput = createRasterInput({
			id: 1,
			nodeId: "node-static",
			left: 32,
			top: 32,
			right: 220,
			bottom: 220,
		});
		const movingInputInOldTile = createRasterInput({
			id: 2,
			nodeId: "node-moving",
			left: 240,
			top: 32,
			right: 420,
			bottom: 220,
		});
		scheduler.setInputs([staticInput, movingInputInOldTile]);
		warmScheduler(scheduler, 20, {
			stageWidth: 512,
			stageHeight: 512,
			zoom: 1,
		});
		const oldTileRecordBefore = findTileRecord(scheduler, {
			left: 0,
			top: 0,
			size: 512,
		});
		expect(oldTileRecordBefore?.image).toBeTruthy();
		const oldTileImageBefore = oldTileRecordBefore?.image ?? null;
		const movingInputInNewTile = createRasterInput({
			id: 2,
			nodeId: "node-moving",
			left: 1700,
			top: 32,
			right: 1880,
			bottom: 220,
		});
		scheduler.setInputs([staticInput, movingInputInNewTile]);
		scheduler.beginFrame(
			createFrameInput({
				stageWidth: 512,
				stageHeight: 512,
				zoom: 1,
				maxTasksPerTick: 1,
				debugEnabled: true,
			}),
		);
		const oldTileRecordAfter = findTileRecord(scheduler, {
			left: 0,
			top: 0,
			size: 512,
		});
		expect(oldTileRecordAfter?.image).toBeTruthy();
		expect(oldTileRecordAfter?.image).not.toBe(oldTileImageBefore);
		scheduler.dispose();
	});
});
