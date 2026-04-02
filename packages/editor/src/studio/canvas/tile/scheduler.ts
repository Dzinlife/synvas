import { scheduleSkiaDispose, Skia, type SkSurface } from "react-skia-lite";
import RBush from "rbush";
import {
	TILE_CAMERA_EPSILON,
	TILE_FRAME_BUDGET_MS,
	TILE_LOD_BASE,
	TILE_LOD_HYSTERESIS,
	TILE_LOD_MAX,
	TILE_LOD_MIN,
	TILE_LOD_STEP_PER_FRAME,
	TILE_MAX_READY_TILES,
	TILE_MAX_TASKS_PER_TICK,
	TILE_OVERSCAN_TILES,
	TILE_PIXEL_SIZE,
	TILE_SURFACE_POOL_SIZE,
} from "./constants";
import {
	createTileAabb,
	decodeTileKey,
	encodeTileKey,
	isTileAabbIntersected,
	resolveTileWorldRect,
	resolveTileWorldSize,
} from "./geometry";
import { PriorityTaskQueue, RenderTaskPool } from "./taskQueue";
import type {
	TileAabb,
	TileCoverMode,
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

interface TileCoverInfo {
	mode: TileCoverMode;
	sourceLod: number | null;
}

type TileResourceDisposeTiming = "immediate" | "idle";

interface TileInputSpatialItem {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	order: number;
}

const DEFAULT_TILE_STATS: TileSchedulerStats = {
	visibleCount: 0,
	readyVisibleCount: 0,
	fallbackNodeCount: 0,
	coverFallbackCount: 0,
	queuedCount: 0,
	renderingCount: 0,
	readyCount: 0,
	staleCount: 0,
	frameTaskCount: 0,
	targetLod: TILE_LOD_BASE,
	composeLod: TILE_LOD_BASE,
};

const disposeImage = (
	image: { dispose?: (() => void) | undefined } | null | undefined,
) => {
	if (!image) return;
	try {
		image.dispose?.();
	} catch {}
};

const scheduleImageDispose = (
	image: { dispose?: (() => void) | undefined } | null | undefined,
) => {
	if (!image) return;
	// 切项目后图块会集中失效，使用 idle 回收可避免 manual 队列长时间滞留。
	scheduleSkiaDispose(image, { timing: "idle" });
};

const disposeTileImageByTiming = (
	image: { dispose?: (() => void) | undefined } | null | undefined,
	timing: TileResourceDisposeTiming,
) => {
	if (timing === "immediate") {
		disposeImage(image);
		return;
	}
	scheduleImageDispose(image);
};

const resolveNowMs = (): number => {
	if (typeof performance !== "undefined") {
		return performance.now();
	}
	return Date.now();
};

const clampLod = (lod: number): number => {
	return Math.max(TILE_LOD_MIN, Math.min(TILE_LOD_MAX, Math.round(lod)));
};

const TILE_INPUT_SIGNATURE_SCALE = 1000;

const quantizeSignatureValue = (value: number): number => {
	return Math.round(value * TILE_INPUT_SIGNATURE_SCALE);
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

	private readonly visibleCoveredKeySet = new Set<number>();

	private readonly visibleFallbackKeySet = new Set<number>();

	private readonly visibleCoverInfoByKey = new Map<number, TileCoverInfo>();

	private readonly drawSourceKeySet = new Set<number>();

	private readonly drawItems: TileDrawItem[] = [];

	private readonly debugItems: TileDebugItem[] = [];

	private readonly fallbackNodeIdSet = new Set<string>();

	private readonly fallbackNodeIds: string[] = [];

	private readonly surfaces: SkSurface[] = [];

	private readonly imagePaint = Skia.Paint();

	private readonly inputSpatialIndex = new RBush<TileInputSpatialItem>();

	private readonly inputQueryScratch: TileInput[] = [];

	private inputs: TileInput[] = [];

	private queueEpoch = 1;

	private tick = 0;

	private targetLod: number = TILE_LOD_BASE;

	private composeLod: number = TILE_LOD_BASE;

	private missingVisibleCount = 0;

	private readyVisibleCount = 0;

	private coverFallbackCount = 0;

	constructor(options: TileSchedulerOptions = {}) {
		this.frameBudgetMs = options.frameBudgetMs ?? TILE_FRAME_BUDGET_MS;
		this.maxTasksPerTick = options.maxTasksPerTick ?? TILE_MAX_TASKS_PER_TICK;
		this.maxReadyTiles = options.maxReadyTiles ?? TILE_MAX_READY_TILES;
	}

	setInputs(inputs: TileInput[]): void {
		if (this.inputs === inputs) return;
		if (inputs.length <= 0 && this.inputs.length > 0) {
			this.clearReadyTiles();
			this.bumpQueueEpoch();
		}
		this.inputs = inputs;
		this.rebuildInputSpatialIndex();
	}

	private rebuildInputSpatialIndex(): void {
		this.inputSpatialIndex.clear();
		if (this.inputs.length <= 0) return;
		const items: TileInputSpatialItem[] = new Array(this.inputs.length);
		for (let order = 0; order < this.inputs.length; order += 1) {
			const input = this.inputs[order];
			items[order] = {
				minX: input.aabb.left,
				minY: input.aabb.top,
				maxX: input.aabb.right,
				maxY: input.aabb.bottom,
				order,
			};
		}
		this.inputSpatialIndex.load(items);
	}

	private queryInputsByRect(rect: TileAabb): TileInput[] {
		this.inputQueryScratch.length = 0;
		if (this.inputs.length <= 0) return this.inputQueryScratch;
		const hits = this.inputSpatialIndex.search({
			minX: rect.left,
			minY: rect.top,
			maxX: rect.right,
			maxY: rect.bottom,
		});
		if (hits.length <= 0) return this.inputQueryScratch;
		hits.sort((left, right) => left.order - right.order);
		for (const hit of hits) {
			const input = this.inputs[hit.order];
			if (!input) continue;
			this.inputQueryScratch.push(input);
		}
		return this.inputQueryScratch;
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
		for (const record of this.tileByKey.values()) {
			if (record.state !== "READY" || !record.image) continue;
			const tileRect = createTileAabb(
				record.worldLeft,
				record.worldTop,
				record.worldLeft + record.worldSize,
				record.worldTop + record.worldSize,
			);
			if (!isTileAabbIntersected(tileRect, rect)) continue;
			record.state = "STALE";
		}
		this.bumpQueueEpoch();
	}

	beginFrame(input: TileSchedulerFrameInput): TileFrameResult {
		this.tick += 1;
		const debugEnabled = Boolean(input.debugEnabled);
		const maxTasksPerTick = this.resolveFrameMaxTasksPerTick(
			input.maxTasksPerTick,
		);
		const lodTransitionMode = input.lodTransitionMode ?? "follow";
		const nextTargetLod =
			lodTransitionMode === "snap"
				? this.resolveTargetLodDirect(
						Number.isFinite(input.lodAnchorZoom)
							? (input.lodAnchorZoom ?? input.camera.zoom)
							: input.camera.zoom,
					)
				: lodTransitionMode === "freeze"
					? this.targetLod
					: this.resolveTargetLod(input.camera.zoom);
		const targetChanged = nextTargetLod !== this.targetLod;
		this.targetLod = nextTargetLod;
		const nextComposeLod =
			lodTransitionMode === "snap"
				? nextTargetLod
				: lodTransitionMode === "freeze"
					? this.composeLod
					: this.resolveComposeLod(nextTargetLod);
		const composeChanged = nextComposeLod !== this.composeLod;
		this.composeLod = nextComposeLod;
		if (targetChanged || composeChanged) {
			this.bumpQueueEpoch();
		}

		if (this.inputs.length <= 0 && !debugEnabled) {
			this.visibleKeys.length = 0;
			this.drawItems.length = 0;
			this.debugItems.length = 0;
			this.fallbackNodeIds.length = 0;
			this.missingVisibleCount = 0;
			this.readyVisibleCount = 0;
			this.coverFallbackCount = 0;
			const stats = this.collectStats(0);
			return {
				drawItems: [],
				debugItems: [],
				fallbackNodeIds: [],
				hasPendingWork: this.taskQueue.size() > 0,
				stats,
			};
		}

		this.resolveVisibleKeys(input);
		this.resolveVisibleCoveredKeys();
		this.enqueueMissingVisibleTiles(
			input.camera,
			input.stageWidth,
			input.stageHeight,
		);
		const frameTaskCount = this.runTasksWithinBudget(
			input.nowMs,
			maxTasksPerTick,
		);
		this.resolveDrawItemsAndFallback();
		this.resolveDebugItems(debugEnabled);
		this.evictLeastRecentlyUsedReadyTiles();
		const stats = this.collectStats(frameTaskCount);
		return {
			drawItems: [...this.drawItems],
			debugItems: [...this.debugItems],
			fallbackNodeIds: [...this.fallbackNodeIds],
			hasPendingWork: this.taskQueue.size() > 0,
			stats,
		};
	}

	dispose(): void {
		this.reset({ disposeTiming: "immediate" });
		try {
			this.imagePaint.dispose?.();
		} catch {}
	}

	reset(options?: { disposeTiming?: TileResourceDisposeTiming }): void {
		const disposeTiming = options?.disposeTiming ?? "immediate";
		this.clearTaskQueue();
		this.clearReadyTiles(disposeTiming);
		this.tileByKey.clear();
		for (const surface of this.surfaces) {
			try {
				surface.dispose?.();
			} catch {}
		}
		this.surfaces.length = 0;
		this.inputs = [];
		this.inputSpatialIndex.clear();
		this.inputQueryScratch.length = 0;
		this.visibleKeys.length = 0;
		this.visibleKeySet.clear();
		this.visibleCoveredKeySet.clear();
		this.visibleFallbackKeySet.clear();
		this.visibleCoverInfoByKey.clear();
		this.drawSourceKeySet.clear();
		this.drawItems.length = 0;
		this.debugItems.length = 0;
		this.fallbackNodeIdSet.clear();
		this.fallbackNodeIds.length = 0;
		this.missingVisibleCount = 0;
		this.readyVisibleCount = 0;
		this.coverFallbackCount = 0;
		this.targetLod = TILE_LOD_BASE;
		this.composeLod = TILE_LOD_BASE;
		this.queueEpoch += 1;
	}

	private resolveTargetLod(zoom: number): number {
		const safeZoom = Math.max(zoom, TILE_CAMERA_EPSILON);
		const zoomLevel = Math.log2(safeZoom);
		const previous = this.targetLod;
		const rounded = clampLod(Math.round(zoomLevel));
		if (rounded === previous) return previous;
		if (rounded > previous) {
			const threshold = previous + 0.5 + TILE_LOD_HYSTERESIS;
			if (zoomLevel < threshold) return previous;
		}
		if (rounded < previous) {
			const threshold = previous - 0.5 - TILE_LOD_HYSTERESIS;
			if (zoomLevel > threshold) return previous;
		}
		return rounded;
	}

	private resolveTargetLodDirect(zoom: number): number {
		const safeZoom = Math.max(zoom, TILE_CAMERA_EPSILON);
		const zoomLevel = Math.log2(safeZoom);
		return clampLod(Math.round(zoomLevel));
	}

	private resolveComposeLod(targetLod: number): number {
		const previous = this.composeLod;
		if (previous === targetLod) return previous;
		const step = Math.max(1, TILE_LOD_STEP_PER_FRAME);
		if (targetLod > previous) {
			return clampLod(Math.min(targetLod, previous + step));
		}
		return clampLod(Math.max(targetLod, previous - step));
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

	private clearReadyTiles(
		disposeTiming: TileResourceDisposeTiming = "idle",
	): void {
		for (const record of this.tileByKey.values()) {
			disposeTileImageByTiming(record.image, disposeTiming);
			record.image = null;
			record.state = "EMPTY";
			record.queued = false;
			record.lastRenderedEpoch = 0;
			record.lastRenderedInputSignature = "";
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
			lastRenderedInputSignature: "",
		};
		this.tileByKey.set(key, record);
		return record;
	}

	private buildTileInputSignature(
		tileRect: TileAabb,
		candidateInputs: TileInput[],
	): string {
		if (candidateInputs.length <= 0) return "";
		const segments: string[] = [];
		for (const input of candidateInputs) {
			if (!isTileAabbIntersected(tileRect, input.aabb)) continue;
			segments.push(
				[
					input.id,
					input.nodeId,
					input.epoch,
					quantizeSignatureValue(input.aabb.left),
					quantizeSignatureValue(input.aabb.top),
					quantizeSignatureValue(input.aabb.right),
					quantizeSignatureValue(input.aabb.bottom),
				].join(":"),
			);
		}
		return segments.join("|");
	}

	private resolveVisibleKeys(input: TileSchedulerFrameInput): void {
		this.visibleKeys.length = 0;
		if (input.stageWidth <= 0 || input.stageHeight <= 0) {
			return;
		}
		const safeZoom = Math.max(input.camera.zoom, TILE_CAMERA_EPSILON);
		const tileSize = resolveTileWorldSize(this.composeLod);
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
					lod: this.composeLod,
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
			const inputs = this.queryInputsByRect(tileRect);
			if (inputs.length <= 0) continue;
			for (const input of inputs) {
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
			const tileRect = createTileAabb(
				record.worldLeft,
				record.worldTop,
				record.worldLeft + record.worldSize,
				record.worldTop + record.worldSize,
			);
			const candidateInputs = this.queryInputsByRect(tileRect);
			const nextInputSignature = this.buildTileInputSignature(
				tileRect,
				candidateInputs,
			);
			if (record.state === "READY" && record.image) {
				if (record.lastRenderedInputSignature === nextInputSignature) {
					continue;
				}
				// 输入覆盖集合变化后，即使 tile 仍被覆盖，也要重绘清理旧内容残留。
				record.state = "STALE";
			}
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

	private resolveFrameMaxTasksPerTick(overrideValue: number | undefined): number {
		if (overrideValue === undefined) return this.maxTasksPerTick;
		if (!Number.isFinite(overrideValue)) return this.maxTasksPerTick;
		return Math.max(0, Math.floor(overrideValue));
	}

	private runTasksWithinBudget(nowMs: number, maxTasksPerTick: number): number {
		let frameTaskCount = 0;
		const frameStart =
			Number.isFinite(nowMs) && nowMs > 0 ? nowMs : resolveNowMs();
		while (frameTaskCount < maxTasksPerTick) {
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
			if (!this.visibleCoveredKeySet.has(task.key)) {
				record.state = record.image ? "READY" : "STALE";
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
			scheduleSkiaDispose(surface, { timing: "idle" });
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
		const worldToPixel = TILE_PIXEL_SIZE / Math.max(1, record.worldSize);
		const surface = this.acquireSurface();
		if (!surface) {
			record.state = "STALE";
			return;
		}
		try {
			const canvas = surface.getCanvas();
			canvas.clear(Float32Array.of(0, 0, 0, 0));
			canvas.save();
			// 不同 LOD 的 world size 不同，这里统一映射到固定 512 像素纹理。
			canvas.scale(worldToPixel, worldToPixel);
			canvas.translate(-tileRect.left, -tileRect.top);
			const candidateInputs = this.queryInputsByRect(tileRect);
			const inputSignature = this.buildTileInputSignature(
				tileRect,
				candidateInputs,
			);
			for (const input of candidateInputs) {
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
			scheduleImageDispose(record.image);
			record.image = image;
			record.state = "READY";
			record.lastRenderedEpoch = this.queueEpoch;
			record.lastRenderedInputSignature = inputSignature;
		} catch {
			record.state = "STALE";
		} finally {
			this.releaseSurface(surface);
		}
	}

	private pushDrawRecord(record: TileRecord): void {
		if (!record.image) return;
		if (this.drawSourceKeySet.has(record.key)) return;
		this.drawSourceKeySet.add(record.key);
		record.lastUsedTick = this.tick;
		this.drawItems.push({
			key: record.key,
			lod: record.lod,
			sourceLod: record.lod,
			tx: record.tx,
			ty: record.ty,
			left: record.worldLeft,
			top: record.worldTop,
			size: record.worldSize,
			image: record.image,
		});
	}

	private resolveParentCoverRecord(
		lod: number,
		tx: number,
		ty: number,
	): TileRecord | null {
		const parentLod = lod - 1;
		if (parentLod < TILE_LOD_MIN) return null;
		const parentKey = encodeTileKey({
			lod: parentLod,
			tx: Math.floor(tx / 2),
			ty: Math.floor(ty / 2),
		});
		const parentRecord = this.tileByKey.get(parentKey);
		if (!parentRecord || parentRecord.state !== "READY" || !parentRecord.image) {
			return null;
		}
		return parentRecord;
	}

	private resolveChildCoverRecords(
		lod: number,
		tx: number,
		ty: number,
	): TileRecord[] | null {
		const childLod = lod + 1;
		if (childLod > TILE_LOD_MAX) return null;
		const children: TileRecord[] = [];
		for (let offsetY = 0; offsetY <= 1; offsetY += 1) {
			for (let offsetX = 0; offsetX <= 1; offsetX += 1) {
				const childKey = encodeTileKey({
					lod: childLod,
					tx: tx * 2 + offsetX,
					ty: ty * 2 + offsetY,
				});
				const childRecord = this.tileByKey.get(childKey);
				if (!childRecord || childRecord.state !== "READY" || !childRecord.image) {
					return null;
				}
				children.push(childRecord);
			}
		}
		return children;
	}

	private resolveDrawItemsAndFallback(): void {
		this.drawItems.length = 0;
		this.fallbackNodeIds.length = 0;
		this.fallbackNodeIdSet.clear();
		this.visibleKeySet.clear();
		this.visibleFallbackKeySet.clear();
		this.visibleCoverInfoByKey.clear();
		this.drawSourceKeySet.clear();
		this.missingVisibleCount = 0;
		this.readyVisibleCount = 0;
		this.coverFallbackCount = 0;

		for (const key of this.visibleKeys) {
			this.visibleKeySet.add(key);
			const record = this.tileByKey.get(key);
			const decoded = record ?? decodeTileKey(key);
			const lod = decoded.lod;
			const tx = decoded.tx;
			const ty = decoded.ty;
			const isCovered = this.visibleCoveredKeySet.has(key);
			if (record && record.state === "READY" && record.image) {
				if (!isCovered) {
					// tile 当前无任何输入覆盖时，不应继续复用旧 READY 纹理。
					record.state = "STALE";
					this.visibleCoverInfoByKey.set(key, {
						mode: "NONE",
						sourceLod: null,
					});
					continue;
				}
				this.pushDrawRecord(record);
				this.readyVisibleCount += 1;
				this.visibleCoverInfoByKey.set(key, {
					mode: "SELF",
					sourceLod: record.lod,
				});
				continue;
			}
			const canReuseLastFrameImage =
				Boolean(record?.image) &&
				Boolean(isCovered) &&
				(record?.state === "STALE" ||
					record?.state === "QUEUED" ||
					record?.state === "RENDERING");
			if (record && canReuseLastFrameImage) {
				// 标脏后在新图块就绪前，复用上一帧图块，避免切到 live 导致频闪。
				this.pushDrawRecord(record);
				this.coverFallbackCount += 1;
				this.visibleCoverInfoByKey.set(key, {
					mode: "SELF",
					sourceLod: record.lod,
				});
				continue;
			}
			if (!isCovered) {
				this.visibleCoverInfoByKey.set(key, {
					mode: "NONE",
					sourceLod: null,
				});
				continue;
			}

			this.missingVisibleCount += 1;
			const parentRecord = this.resolveParentCoverRecord(lod, tx, ty);
			if (parentRecord) {
				this.pushDrawRecord(parentRecord);
				this.coverFallbackCount += 1;
				this.visibleCoverInfoByKey.set(key, {
					mode: "PARENT",
					sourceLod: parentRecord.lod,
				});
				continue;
			}

			const childRecords = this.resolveChildCoverRecords(lod, tx, ty);
			if (childRecords) {
				for (const childRecord of childRecords) {
					this.pushDrawRecord(childRecord);
				}
				this.coverFallbackCount += 1;
				this.visibleCoverInfoByKey.set(key, {
					mode: "CHILD",
					sourceLod: childRecords[0]?.lod ?? lod + 1,
				});
				continue;
			}
			this.visibleCoverInfoByKey.set(key, {
				mode: "NONE",
				sourceLod: null,
			});
		}

		this.drawItems.sort((left, right) => {
			if (left.lod !== right.lod) return left.lod - right.lod;
			if (left.top !== right.top) return left.top - right.top;
			if (left.left !== right.left) return left.left - right.left;
			return left.key - right.key;
		});
	}

	private resolveDebugItems(debugEnabled: boolean): void {
		this.debugItems.length = 0;
		if (!debugEnabled) {
			return;
		}
		for (const key of this.visibleKeys) {
			const record = this.tileByKey.get(key);
			const coverInfo = this.visibleCoverInfoByKey.get(key);
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
					isFallback: coverInfo?.mode === "LIVE",
					coverSourceLod: coverInfo?.sourceLod ?? null,
					coverMode: coverInfo?.mode ?? "NONE",
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
				isFallback: coverInfo?.mode === "LIVE",
				coverSourceLod: coverInfo?.sourceLod ?? null,
				coverMode: coverInfo?.mode ?? "NONE",
			});
		}
	}

	private evictLeastRecentlyUsedReadyTiles(): void {
		const evictableReadyRecords: TileRecord[] = [];
		let totalReadyCount = 0;
		for (const record of this.tileByKey.values()) {
			if (record.state !== "READY" || !record.image) continue;
			totalReadyCount += 1;
			if (this.drawSourceKeySet.has(record.key)) continue;
			evictableReadyRecords.push(record);
		}
		if (totalReadyCount <= this.maxReadyTiles) {
			return;
		}
		evictableReadyRecords.sort(
			(left, right) => left.lastUsedTick - right.lastUsedTick,
		);
		let removeCount = totalReadyCount - this.maxReadyTiles;
		for (const record of evictableReadyRecords) {
			if (removeCount <= 0) break;
			scheduleImageDispose(record.image);
			record.image = null;
			record.state = "EMPTY";
			record.lastRenderedInputSignature = "";
			removeCount -= 1;
		}
	}

	private collectStats(frameTaskCount: number): TileSchedulerStats {
		const stats: TileSchedulerStats = {
			...DEFAULT_TILE_STATS,
			visibleCount: this.visibleKeys.length,
			readyVisibleCount: this.readyVisibleCount,
			fallbackNodeCount: this.fallbackNodeIds.length,
			coverFallbackCount: this.coverFallbackCount,
			queuedCount: this.taskQueue.size(),
			frameTaskCount,
			targetLod: this.targetLod,
			composeLod: this.composeLod,
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
