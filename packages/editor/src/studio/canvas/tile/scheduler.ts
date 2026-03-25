import { Skia, type SkSurface } from "react-skia-lite";
import {
	TILE_CAMERA_EPSILON,
	TILE_FRAME_BUDGET_MS,
	TILE_LOD_BASE,
	TILE_MAX_READY_TILES,
	TILE_MAX_TASKS_PER_TICK,
	TILE_OVERSCAN_TILES,
	TILE_PIXEL_SIZE,
	TILE_SURFACE_POOL_SIZE,
	TILE_WORLD_SIZE_L0,
} from "./constants";
import {
	createTileAabb,
	decodeTileKey,
	encodeTileKey,
	isTileAabbIntersected,
	resolveTileWorldRect,
} from "./geometry";
import { PriorityTaskQueue, RenderTaskPool } from "./taskQueue";
import type {
	TileAabb,
	TileDebugItem,
	TileDrawItem,
	TileFrameResult,
	TileInput,
	TilePriority,
	TileRecord,
	TileSchedulerFrameInput,
	TileSchedulerStats,
} from "./types";

interface TileSchedulerOptions {
	frameBudgetMs?: number;
	maxTasksPerTick?: number;
	maxReadyTiles?: number;
}

const DEFAULT_TILE_STATS: TileSchedulerStats = {
	visibleCount: 0,
	readyVisibleCount: 0,
	fallbackNodeCount: 0,
	queuedCount: 0,
	renderingCount: 0,
	readyCount: 0,
	staleCount: 0,
	frameTaskCount: 0,
};

const isCameraChanged = (
	left: { x: number; y: number; zoom: number } | null,
	right: { x: number; y: number; zoom: number },
): boolean => {
	if (!left) return true;
	return (
		Math.abs(left.x - right.x) > TILE_CAMERA_EPSILON ||
		Math.abs(left.y - right.y) > TILE_CAMERA_EPSILON ||
		Math.abs(left.zoom - right.zoom) > TILE_CAMERA_EPSILON
	);
};

const disposeImage = (
	image: { dispose?: (() => void) | undefined } | null | undefined,
) => {
	if (!image) return;
	try {
		image.dispose?.();
	} catch {}
};

const resolveNowMs = (): number => {
	if (typeof performance !== "undefined") {
		return performance.now();
	}
	return Date.now();
};

export class StaticTileScheduler {
	private readonly frameBudgetMs: number;

	private readonly maxTasksPerTick: number;

	private readonly maxReadyTiles: number;

	private readonly tileByKey = new Map<number, TileRecord>();

	private readonly taskPool = new RenderTaskPool();

	private readonly taskQueue = new PriorityTaskQueue();

	private readonly visibleKeys: number[] = [];

	private readonly visibleKeySet = new Set<number>();

	private readonly drawItems: TileDrawItem[] = [];

	private readonly debugItems: TileDebugItem[] = [];

	private readonly fallbackNodeIdSet = new Set<string>();

	private readonly fallbackNodeIds: string[] = [];

	private readonly visibleFallbackKeySet = new Set<number>();

	private readonly visibleCoveredKeySet = new Set<number>();

	private readonly surfaces: SkSurface[] = [];

	private readonly imagePaint = Skia.Paint();

	private inputs: TileInput[] = [];

	private queueEpoch = 1;

	private tick = 0;

	private cameraSnapshot: { x: number; y: number; zoom: number } | null = null;

	constructor(options: TileSchedulerOptions = {}) {
		this.frameBudgetMs = options.frameBudgetMs ?? TILE_FRAME_BUDGET_MS;
		this.maxTasksPerTick = options.maxTasksPerTick ?? TILE_MAX_TASKS_PER_TICK;
		this.maxReadyTiles = options.maxReadyTiles ?? TILE_MAX_READY_TILES;
	}

	setInputs(inputs: TileInput[]): void {
		if (inputs.length <= 0 && this.inputs.length > 0) {
			this.clearReadyTiles();
			this.bumpQueueEpoch();
		}
		this.inputs = inputs;
	}

	markDirtyUnion(oldAabb: TileAabb | null, nextAabb: TileAabb | null): void {
		if (!oldAabb && !nextAabb) return;
		if (!oldAabb) {
			this.markDirtyRect(nextAabb);
			return;
		}
		if (!nextAabb) {
			this.markDirtyRect(oldAabb);
			return;
		}
		const unionRect = createTileAabb(
			Math.min(oldAabb.left, nextAabb.left),
			Math.min(oldAabb.top, nextAabb.top),
			Math.max(oldAabb.right, nextAabb.right),
			Math.max(oldAabb.bottom, nextAabb.bottom),
		);
		this.markDirtyRect(unionRect);
	}

	markDirtyRect(rect: TileAabb | null): void {
		if (!rect) return;
		const tileSize = TILE_WORLD_SIZE_L0;
		const txStart = Math.floor(rect.left / tileSize);
		const txEnd = Math.floor((rect.right - Number.EPSILON) / tileSize);
		const tyStart = Math.floor(rect.top / tileSize);
		const tyEnd = Math.floor((rect.bottom - Number.EPSILON) / tileSize);
		for (let ty = tyStart; ty <= tyEnd; ty += 1) {
			for (let tx = txStart; tx <= txEnd; tx += 1) {
				const key = encodeTileKey({
					lod: TILE_LOD_BASE,
					tx,
					ty,
				});
				const record = this.ensureTileRecord(key);
				if (record.state === "READY") {
					record.state = "STALE";
				}
			}
		}
		this.bumpQueueEpoch();
	}

	beginFrame(input: TileSchedulerFrameInput): TileFrameResult {
		this.tick += 1;
		const cameraChanged = isCameraChanged(this.cameraSnapshot, input.camera);
		if (cameraChanged) {
			this.bumpQueueEpoch();
			this.cameraSnapshot = {
				x: input.camera.x,
				y: input.camera.y,
				zoom: input.camera.zoom,
			};
		}

		this.resolveVisibleKeys(input);
		this.resolveVisibleCoveredKeys();
		this.enqueueMissingVisibleTiles(
			input.camera,
			input.stageWidth,
			input.stageHeight,
		);
		const frameTaskCount = this.runTasksWithinBudget(input.nowMs);
		this.resolveDrawItemsAndFallback();
		this.resolveDebugItems();
		this.evictLeastRecentlyUsedReadyTiles();
		const stats = this.collectStats(frameTaskCount);
		return {
			drawItems: [...this.drawItems],
			debugItems: [...this.debugItems],
			fallbackNodeIds: [...this.fallbackNodeIds],
			hasPendingWork:
				this.taskQueue.size() > 0 ||
				this.drawItems.length < this.visibleCoveredKeySet.size,
			stats,
		};
	}

	dispose(): void {
		this.clearTaskQueue();
		for (const record of this.tileByKey.values()) {
			disposeImage(record.image);
			record.image = null;
		}
		this.tileByKey.clear();
		for (const surface of this.surfaces) {
			try {
				surface.dispose?.();
			} catch {}
		}
		this.surfaces.length = 0;
		try {
			this.imagePaint.dispose?.();
		} catch {}
	}

	private clearTaskQueue(): void {
		this.taskQueue.clear((task) => {
			const record = this.tileByKey.get(task.key);
			if (record?.queued) {
				record.queued = false;
				if (record.state === "QUEUED") {
					record.state = "STALE";
				}
			}
			this.taskPool.release(task);
		});
	}

	private bumpQueueEpoch(): void {
		this.queueEpoch += 1;
		this.clearTaskQueue();
	}

	private clearReadyTiles(): void {
		for (const record of this.tileByKey.values()) {
			disposeImage(record.image);
			record.image = null;
			record.state = "EMPTY";
			record.queued = false;
			record.lastRenderedEpoch = 0;
		}
	}

	private ensureTileRecord(key: number): TileRecord {
		const existing = this.tileByKey.get(key);
		if (existing) return existing;
		const { lod, tx, ty } = decodeTileKey(key);
		const worldRect = resolveTileWorldRect(tx, ty, lod);
		const record: TileRecord = {
			key,
			lod,
			tx,
			ty,
			worldLeft: worldRect.left,
			worldTop: worldRect.top,
			worldSize: worldRect.width,
			state: "EMPTY",
			queued: false,
			image: null,
			lastUsedTick: this.tick,
			lastRenderedEpoch: 0,
		};
		this.tileByKey.set(key, record);
		return record;
	}

	private resolveVisibleKeys(input: TileSchedulerFrameInput): void {
		this.visibleKeys.length = 0;
		if (input.stageWidth <= 0 || input.stageHeight <= 0) {
			return;
		}
		const safeZoom = Math.max(input.camera.zoom, TILE_CAMERA_EPSILON);
		const tileSize = TILE_WORLD_SIZE_L0;
		const overscanWorld = tileSize * TILE_OVERSCAN_TILES;
		const left = -input.camera.x - overscanWorld;
		const right = input.stageWidth / safeZoom - input.camera.x + overscanWorld;
		const top = -input.camera.y - overscanWorld;
		const bottom =
			input.stageHeight / safeZoom - input.camera.y + overscanWorld;
		const txStart = Math.floor(left / tileSize);
		const txEnd = Math.floor((right - Number.EPSILON) / tileSize);
		const tyStart = Math.floor(top / tileSize);
		const tyEnd = Math.floor((bottom - Number.EPSILON) / tileSize);
		for (let ty = tyStart; ty <= tyEnd; ty += 1) {
			for (let tx = txStart; tx <= txEnd; tx += 1) {
				const key = encodeTileKey({
					lod: TILE_LOD_BASE,
					tx,
					ty,
				});
				this.visibleKeys.push(key);
			}
		}
	}

	private resolveVisibleCoveredKeys(): void {
		this.visibleCoveredKeySet.clear();
		if (this.inputs.length <= 0 || this.visibleKeys.length <= 0) {
			return;
		}
		for (const key of this.visibleKeys) {
			const { lod, tx, ty } = decodeTileKey(key);
			const tileRect = resolveTileWorldRect(tx, ty, lod);
			for (const input of this.inputs) {
				if (!isTileAabbIntersected(tileRect, input.aabb)) continue;
				this.visibleCoveredKeySet.add(key);
				break;
			}
		}
	}

	private resolveTilePriority(
		record: TileRecord,
		camera: { x: number; y: number; zoom: number },
		stageWidth: number,
		stageHeight: number,
	): TilePriority {
		const safeZoom = Math.max(camera.zoom, TILE_CAMERA_EPSILON);
		const centerWorldX = stageWidth / safeZoom / 2 - camera.x;
		const centerWorldY = stageHeight / safeZoom / 2 - camera.y;
		const tileCenterX = record.worldLeft + record.worldSize / 2;
		const tileCenterY = record.worldTop + record.worldSize / 2;
		const dx = Math.abs(tileCenterX - centerWorldX) / record.worldSize;
		const dy = Math.abs(tileCenterY - centerWorldY) / record.worldSize;
		const distance = Math.max(dx, dy);
		if (distance <= 1) return "HIGH";
		if (distance <= 2.5) return "MID";
		return "LOW";
	}

	private enqueueMissingVisibleTiles(
		camera: { x: number; y: number; zoom: number },
		stageWidth: number,
		stageHeight: number,
	): void {
		for (const key of this.visibleCoveredKeySet) {
			const record = this.ensureTileRecord(key);
			record.lastUsedTick = this.tick;
			if (record.state === "READY" && record.image) continue;
			if (record.queued || record.state === "RENDERING") continue;
			const task = this.taskPool.acquire();
			task.key = key;
			task.lod = record.lod;
			task.tx = record.tx;
			task.ty = record.ty;
			task.queueEpoch = this.queueEpoch;
			task.priority = this.resolveTilePriority(
				record,
				camera,
				stageWidth,
				stageHeight,
			);
			if (!this.taskQueue.enqueue(task)) {
				this.taskPool.release(task);
				continue;
			}
			record.queued = true;
			record.state = "QUEUED";
		}
	}

	private runTasksWithinBudget(nowMs: number): number {
		let frameTaskCount = 0;
		const frameStart =
			Number.isFinite(nowMs) && nowMs > 0 ? nowMs : resolveNowMs();
		while (frameTaskCount < this.maxTasksPerTick) {
			const elapsed = resolveNowMs() - frameStart;
			if (elapsed >= this.frameBudgetMs) {
				break;
			}
			const task = this.taskQueue.dequeue();
			if (!task) break;
			const record = this.tileByKey.get(task.key);
			if (!record) {
				this.taskPool.release(task);
				continue;
			}
			record.queued = false;
			if (task.queueEpoch !== this.queueEpoch) {
				record.state = "STALE";
				this.taskPool.release(task);
				continue;
			}
			this.renderTask(record);
			frameTaskCount += 1;
			this.taskPool.release(task);
		}
		return frameTaskCount;
	}

	private acquireSurface(): SkSurface | null {
		const surface = this.surfaces.pop();
		if (surface) {
			return surface;
		}
		return Skia.Surface.MakeOffscreen(TILE_PIXEL_SIZE, TILE_PIXEL_SIZE);
	}

	private releaseSurface(surface: SkSurface): void {
		if (this.surfaces.length >= TILE_SURFACE_POOL_SIZE) {
			try {
				surface.dispose?.();
			} catch {}
			return;
		}
		this.surfaces.push(surface);
	}

	private renderTask(record: TileRecord): void {
		record.state = "RENDERING";
		const tileRect = createTileAabb(
			record.worldLeft,
			record.worldTop,
			record.worldLeft + record.worldSize,
			record.worldTop + record.worldSize,
		);
		const surface = this.acquireSurface();
		if (!surface) {
			record.state = "STALE";
			return;
		}
		try {
			const canvas = surface.getCanvas();
			canvas.clear(Float32Array.of(0, 0, 0, 0));
			canvas.save();
			canvas.translate(-tileRect.left, -tileRect.top);
			for (const input of this.inputs) {
				if (!isTileAabbIntersected(tileRect, input.aabb)) continue;
				if (input.kind === "picture") {
					canvas.save();
					canvas.translate(input.aabb.left, input.aabb.top);
					canvas.scale(
						input.aabb.width / Math.max(1, input.sourceWidth),
						input.aabb.height / Math.max(1, input.sourceHeight),
					);
					canvas.drawPicture(input.picture);
					canvas.restore();
					continue;
				}
				canvas.drawImageRect(
					input.image,
					{
						x: 0,
						y: 0,
						width: Math.max(1, input.sourceWidth),
						height: Math.max(1, input.sourceHeight),
					},
					{
						x: input.aabb.left,
						y: input.aabb.top,
						width: input.aabb.width,
						height: input.aabb.height,
					},
					this.imagePaint,
					true,
				);
			}
			canvas.restore();
			surface.flush();
			const image = surface.asImageCopy?.() ?? surface.makeImageSnapshot();
			if (!image) {
				record.state = "STALE";
				return;
			}
			disposeImage(record.image);
			record.image = image;
			record.state = "READY";
			record.lastRenderedEpoch = this.queueEpoch;
		} catch {
			record.state = "STALE";
		} finally {
			this.releaseSurface(surface);
		}
	}

	private resolveDrawItemsAndFallback(): void {
		this.drawItems.length = 0;
		this.fallbackNodeIds.length = 0;
		this.fallbackNodeIdSet.clear();
		this.visibleKeySet.clear();
		this.visibleFallbackKeySet.clear();

		for (const key of this.visibleCoveredKeySet) {
			this.visibleKeySet.add(key);
			const record = this.tileByKey.get(key);
			if (!record) continue;
			record.lastUsedTick = this.tick;
			if (record.state === "READY" && record.image) {
				this.drawItems.push({
					key,
					lod: record.lod,
					tx: record.tx,
					ty: record.ty,
					left: record.worldLeft,
					top: record.worldTop,
					size: record.worldSize,
					image: record.image,
				});
				continue;
			}
			const tileRect = createTileAabb(
				record.worldLeft,
				record.worldTop,
				record.worldLeft + record.worldSize,
				record.worldTop + record.worldSize,
			);
			let hasFallback = false;
			for (const input of this.inputs) {
				if (!isTileAabbIntersected(tileRect, input.aabb)) continue;
				hasFallback = true;
				if (this.fallbackNodeIdSet.has(input.nodeId)) continue;
				this.fallbackNodeIdSet.add(input.nodeId);
				this.fallbackNodeIds.push(input.nodeId);
			}
			if (hasFallback) {
				this.visibleFallbackKeySet.add(key);
			}
		}
	}

	private resolveDebugItems(): void {
		this.debugItems.length = 0;
		for (const key of this.visibleKeys) {
			const record = this.tileByKey.get(key);
			if (!record) {
				const { lod, tx, ty } = decodeTileKey(key);
				const worldRect = resolveTileWorldRect(tx, ty, lod);
				this.debugItems.push({
					key,
					lod,
					tx,
					ty,
					left: worldRect.left,
					top: worldRect.top,
					size: worldRect.width,
					state: "EMPTY",
					queued: false,
					hasImage: false,
					lastRenderedEpoch: 0,
					isFallback: false,
				});
				continue;
			}
			this.debugItems.push({
				key,
				lod: record.lod,
				tx: record.tx,
				ty: record.ty,
				left: record.worldLeft,
				top: record.worldTop,
				size: record.worldSize,
				state: record.state,
				queued: record.queued,
				hasImage: Boolean(record.image),
				lastRenderedEpoch: record.lastRenderedEpoch,
				isFallback: this.visibleFallbackKeySet.has(key),
			});
		}
	}

	private evictLeastRecentlyUsedReadyTiles(): void {
		const readyRecords: TileRecord[] = [];
		for (const record of this.tileByKey.values()) {
			if (record.state !== "READY" || !record.image) continue;
			if (this.visibleKeySet.has(record.key)) continue;
			readyRecords.push(record);
		}
		const totalReadyCount = readyRecords.length + this.drawItems.length;
		if (totalReadyCount <= this.maxReadyTiles) {
			return;
		}
		readyRecords.sort((left, right) => left.lastUsedTick - right.lastUsedTick);
		let removeCount = totalReadyCount - this.maxReadyTiles;
		for (const record of readyRecords) {
			if (removeCount <= 0) break;
			disposeImage(record.image);
			record.image = null;
			record.state = "EMPTY";
			removeCount -= 1;
		}
	}

	private collectStats(frameTaskCount: number): TileSchedulerStats {
		const stats: TileSchedulerStats = {
			...DEFAULT_TILE_STATS,
			visibleCount: this.visibleKeys.length,
			readyVisibleCount: this.drawItems.length,
			fallbackNodeCount: this.fallbackNodeIds.length,
			queuedCount: this.taskQueue.size(),
			frameTaskCount,
		};
		for (const record of this.tileByKey.values()) {
			if (record.state === "READY") {
				stats.readyCount += 1;
				continue;
			}
			if (record.state === "RENDERING") {
				stats.renderingCount += 1;
				continue;
			}
			if (record.state === "STALE") {
				stats.staleCount += 1;
			}
		}
		return stats;
	}
}
