import type { SkImage, SkPicture } from "react-skia-lite";
import type { CameraState } from "../canvasWorkspaceUtils";

export interface TileAabb {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

export type TileState = "EMPTY" | "QUEUED" | "RENDERING" | "READY" | "STALE";

export type TilePriority = "HIGH" | "MID" | "LOW";

export type TileCoverMode = "NONE" | "SELF" | "PARENT" | "CHILD" | "LIVE";

export type TileInput =
	| {
			kind: "picture";
			id: number;
			nodeId: string;
			picture: SkPicture;
			aabb: TileAabb;
			sourceWidth: number;
			sourceHeight: number;
			epoch: number;
			dispose?: (() => void) | null;
	  }
	| {
			kind: "raster";
			id: number;
			nodeId: string;
			image: SkImage;
			aabb: TileAabb;
			sourceWidth: number;
			sourceHeight: number;
			epoch: number;
			dispose?: (() => void) | null;
	  };

export interface TileKey {
	lod: number;
	tx: number;
	ty: number;
}

export interface TileRecord {
	key: number;
	lod: number;
	tx: number;
	ty: number;
	worldLeft: number;
	worldTop: number;
	worldSize: number;
	state: TileState;
	queued: boolean;
	image: SkImage | null;
	lastUsedTick: number;
	lastRenderedEpoch: number;
}

export interface RenderTask {
	key: number;
	lod: number;
	tx: number;
	ty: number;
	priority: TilePriority;
	queueEpoch: number;
}

export interface TileDrawItem {
	key: number;
	lod: number;
	sourceLod?: number;
	tx: number;
	ty: number;
	left: number;
	top: number;
	size: number;
	image: SkImage;
}

export interface TileDebugItem {
	key: number;
	lod: number;
	tx: number;
	ty: number;
	left: number;
	top: number;
	size: number;
	state: TileState;
	queued: boolean;
	hasImage: boolean;
	lastRenderedEpoch: number;
	isFallback: boolean;
	coverSourceLod: number | null;
	coverMode: TileCoverMode;
}

export interface TileSchedulerStats {
	visibleCount: number;
	readyVisibleCount: number;
	fallbackNodeCount: number;
	coverFallbackCount: number;
	queuedCount: number;
	renderingCount: number;
	readyCount: number;
	staleCount: number;
	frameTaskCount: number;
	targetLod: number;
	composeLod: number;
}

export interface TileFrameResult {
	drawItems: TileDrawItem[];
	debugItems: TileDebugItem[];
	fallbackNodeIds: string[];
	hasPendingWork: boolean;
	stats: TileSchedulerStats;
}

export interface TileSchedulerFrameInput {
	camera: CameraState;
	stageWidth: number;
	stageHeight: number;
	nowMs: number;
	debugEnabled?: boolean;
}
