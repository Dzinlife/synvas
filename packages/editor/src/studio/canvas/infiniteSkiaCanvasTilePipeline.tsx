import { renderNodeToPicture } from "core/render-system/renderNodeSnapshot";
import type { TimelineAsset } from "core/timeline-system/types";
import type React from "react";
import { Skia, type SkImage, type SkPicture } from "react-skia-lite";
import type { AssetHandle } from "@/assets/AssetStore";
import type { ImageAsset } from "@/assets/imageAsset";
import type { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type { CanvasNode, StudioProject } from "@/studio/project/types";
import { getCanvasNodeDefinition } from "@/node-system/registry";
import type {
	CanvasNodeSkiaRenderProps,
	CanvasNodeTilePictureCapability,
	CanvasNodeTilePictureCapabilityContext,
} from "@/node-system/types";
import {
	createTileAabb,
	isTileAabbIntersected,
	TILE_CAMERA_EPSILON,
	TILE_LOD_MAX,
	TILE_PIXEL_SIZE,
	resolveTileWorldSize,
	type TileAabb,
	type TileDrawItem,
	type TileFrameResult,
	type TileInput,
} from "./tile";

const TILE_AABB_EPSILON = 1e-4;
const TILE_DRAW_BLEED_TEXEL = 1;
const FROZEN_NODE_SNAPSHOT_MAX_EDGE_PX = 2048;
const FROZEN_NODE_SNAPSHOT_MAX_PIXELS = 1024 * 1024;

interface RasterImageCacheEntry {
	uri: string;
	image: SkImage | null;
	width: number;
	height: number;
	handle: AssetHandle<ImageAsset> | null;
	loading: boolean;
}

interface TileInputCacheEntry {
	epoch: number;
	sourceSignature: string;
	mode: "raster" | "fallback-picture";
	rasterImage: SkImage | null;
	input: TileInput | null;
}

interface FrozenNodeRasterSnapshot {
	image: SkImage;
	sourceWidth: number;
	sourceHeight: number;
	dispose: () => void;
}

interface TileAsyncPictureCacheEntry {
	sourceSignature: string;
	status: "pending" | "ready" | "failed";
	picture: SkPicture | null;
	sourceWidth: number;
	sourceHeight: number;
	dispose: (() => void) | null;
	taskId: number;
}

interface TileAsyncPictureRequest {
	nodeId: string;
	sourceSignature: string;
	capability: CanvasNodeTilePictureCapability<CanvasNode>;
	context: CanvasNodeTilePictureCapabilityContext<CanvasNode>;
}

const disposeTileAsyncPictureCacheEntry = (
	entry: TileAsyncPictureCacheEntry | null | undefined,
): void => {
	if (!entry?.dispose) return;
	try {
		entry.dispose();
	} catch {}
};

const EMPTY_STATIC_TILE_SNAPSHOT: {
	inputs: TileInput[];
	inputByNodeId: Map<string, TileInput>;
	asyncPictureRequests: TileAsyncPictureRequest[];
	pendingPictureNodeIdSet: ReadonlySet<string>;
} = {
	inputs: [],
	inputByNodeId: new Map<string, TileInput>(),
	asyncPictureRequests: [],
	pendingPictureNodeIdSet: new Set<string>(),
};

const resolveTileNodeSourceSignature = (
	node: CanvasNode,
	scene: StudioProject["scenes"][string] | null,
	asset: TimelineAsset | null,
	thumbnailCapabilityEnabled: boolean,
): string => {
	const parts = [node.id, node.type, String(node.updatedAt)];
	if ("assetId" in node) {
		const sourceHash =
			typeof asset?.meta?.hash === "string" ? asset.meta.hash : "none";
		parts.push(node.assetId || "none", sourceHash);
	}
	if (thumbnailCapabilityEnabled) {
		parts.push(node.thumbnail?.sourceSignature ?? "none");
	}
	if (scene) {
		parts.push(String(scene.updatedAt));
	}
	return parts.join(":");
};

const hasThumbnailCapability = (node: CanvasNode): boolean => {
	const definition = getCanvasNodeDefinition(node.type);
	return Boolean(definition.thumbnail);
};

const resolveTilePictureCapability = (
	node: CanvasNode,
): CanvasNodeTilePictureCapability<CanvasNode> | null => {
	const definition = getCanvasNodeDefinition(node.type);
	return (
		(definition.tilePicture as CanvasNodeTilePictureCapability<CanvasNode>) ??
		null
	);
};

const resolveNodeScene = (
	node: CanvasNode,
	scenes: StudioProject["scenes"],
): StudioProject["scenes"][string] | null => {
	if (node.type !== "scene") return null;
	return scenes[node.sceneId] ?? null;
};

const resolveNodeAsset = (
	node: CanvasNode,
	assetById: Map<string, TimelineAsset>,
): TimelineAsset | null => {
	if (!("assetId" in node) || !node.assetId) return null;
	return assetById.get(node.assetId) ?? null;
};

const resolveSkImageSize = (
	image: SkImage,
	fallbackWidth: number,
	fallbackHeight: number,
): { width: number; height: number } => {
	const candidate = image as {
		width?: number | (() => number);
		height?: number | (() => number);
	};
	const width =
		typeof candidate.width === "function"
			? candidate.width()
			: (candidate.width ?? fallbackWidth);
	const height =
		typeof candidate.height === "function"
			? candidate.height()
			: (candidate.height ?? fallbackHeight);
	return {
		width: Math.max(1, Math.round(width)),
		height: Math.max(1, Math.round(height)),
	};
};

const disposeTileInput = (input: TileInput | null | undefined) => {
	if (!input) return;
	try {
		input.dispose?.();
	} catch {}
};

const disposeFrozenNodeRasterSnapshot = (
	snapshot: FrozenNodeRasterSnapshot | null | undefined,
) => {
	if (!snapshot) return;
	try {
		snapshot.dispose();
	} catch {}
};

const resolveFrozenNodeSnapshotSize = (
	input: TileInput,
	cameraZoom: number,
): { width: number; height: number } => {
	const safeZoom = Math.max(cameraZoom, TILE_CAMERA_EPSILON);
	const lod = Math.min(TILE_LOD_MAX, Math.round(Math.log2(safeZoom)));
	// frozen snapshot 使用 tile LOD 的像素密度，避免动画期间突然变成高清源图。
	const pixelPerWorld = TILE_PIXEL_SIZE / resolveTileWorldSize(lod);
	const rawWidth = Math.max(
		1,
		Math.ceil(Math.abs(input.aabb.width) * pixelPerWorld),
	);
	const rawHeight = Math.max(
		1,
		Math.ceil(Math.abs(input.aabb.height) * pixelPerWorld),
	);
	const pixelScale = Math.min(
		1,
		FROZEN_NODE_SNAPSHOT_MAX_EDGE_PX / rawWidth,
		FROZEN_NODE_SNAPSHOT_MAX_EDGE_PX / rawHeight,
		Math.sqrt(FROZEN_NODE_SNAPSHOT_MAX_PIXELS / (rawWidth * rawHeight)),
	);
	return {
		width: Math.max(1, Math.round(rawWidth * pixelScale)),
		height: Math.max(1, Math.round(rawHeight * pixelScale)),
	};
};

const subtractTileAabb = (source: TileAabb, clip: TileAabb): TileAabb[] => {
	const intersection = intersectTileAabb(source, clip);
	if (!intersection) return [source];
	const pieces: TileAabb[] = [];
	if (source.top < intersection.top) {
		pieces.push(
			createTileAabb(source.left, source.top, source.right, intersection.top),
		);
	}
	if (intersection.bottom < source.bottom) {
		pieces.push(
			createTileAabb(
				source.left,
				intersection.bottom,
				source.right,
				source.bottom,
			),
		);
	}
	if (source.left < intersection.left) {
		pieces.push(
			createTileAabb(
				source.left,
				intersection.top,
				intersection.left,
				intersection.bottom,
			),
		);
	}
	if (intersection.right < source.right) {
		pieces.push(
			createTileAabb(
				intersection.right,
				intersection.top,
				source.right,
				intersection.bottom,
			),
		);
	}
	return pieces.filter((piece) => {
		return piece.width > TILE_AABB_EPSILON && piece.height > TILE_AABB_EPSILON;
	});
};

const resolveTileDrawBleed = (tile: TileDrawItem): number => {
	return (tile.size / TILE_PIXEL_SIZE) * TILE_DRAW_BLEED_TEXEL;
};

const resolveTileDrawSourceWorldAabb = (tile: TileDrawItem): TileAabb => {
	const bleed = resolveTileDrawBleed(tile);
	return createTileAabb(
		tile.left - bleed,
		tile.top - bleed,
		tile.left + tile.size + bleed,
		tile.top + tile.size + bleed,
	);
};

const resolveTileDrawCoverageAabb = (tile: TileDrawItem): TileAabb => {
	return (
		tile.clipAabb ??
		createTileAabb(
			tile.left,
			tile.top,
			tile.left + tile.size,
			tile.top + tile.size,
		)
	);
};

const resolveTileImageSize = (
	tile: TileDrawItem,
): { width: number; height: number } => {
	return resolveSkImageSize(tile.image, TILE_PIXEL_SIZE, TILE_PIXEL_SIZE);
};

const resolveTileImagePixelRatio = (tile: TileDrawItem): number => {
	const imageSize = resolveTileImageSize(tile);
	const pixelRatio = Math.min(
		imageSize.width / TILE_PIXEL_SIZE,
		imageSize.height / TILE_PIXEL_SIZE,
	);
	return Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
};

const resolveSnapshotPixelRoundedIntersection = (
	intersection: TileAabb,
	targetAabb: TileAabb,
	worldToSnapshotX: number,
	worldToSnapshotY: number,
): {
	worldAabb: TileAabb;
	snapshotRect: { x: number; y: number; width: number; height: number };
} | null => {
	const snapshotLeft = Math.round(
		(intersection.left - targetAabb.left) * worldToSnapshotX,
	);
	const snapshotTop = Math.round(
		(intersection.top - targetAabb.top) * worldToSnapshotY,
	);
	const snapshotRight = Math.round(
		(intersection.right - targetAabb.left) * worldToSnapshotX,
	);
	const snapshotBottom = Math.round(
		(intersection.bottom - targetAabb.top) * worldToSnapshotY,
	);
	if (snapshotLeft >= snapshotRight || snapshotTop >= snapshotBottom) {
		return null;
	}
	return {
		worldAabb: createTileAabb(
			targetAabb.left + snapshotLeft / worldToSnapshotX,
			targetAabb.top + snapshotTop / worldToSnapshotY,
			targetAabb.left + snapshotRight / worldToSnapshotX,
			targetAabb.top + snapshotBottom / worldToSnapshotY,
		),
		snapshotRect: {
			x: snapshotLeft,
			y: snapshotTop,
			width: snapshotRight - snapshotLeft,
			height: snapshotBottom - snapshotTop,
		},
	};
};

const canCreateFrozenSnapshotFromCompositedTiles = (
	node: CanvasNode,
): boolean => {
	// board 的全局 tile 区域会包含 children，不能拿来做 board 自身的过渡纹理。
	return node.type !== "board";
};

const isTileAabbCoveredByDrawItems = (
	aabb: TileAabb,
	drawItems: TileDrawItem[],
): boolean => {
	let uncovered = [aabb];
	for (const tile of drawItems) {
		const tileAabb = resolveTileDrawCoverageAabb(tile);
		if (!isTileAabbIntersected(aabb, tileAabb)) continue;
		uncovered = uncovered.flatMap((piece) => subtractTileAabb(piece, tileAabb));
		if (uncovered.length === 0) return true;
	}
	return uncovered.length === 0;
};

const createFrozenNodeRasterSnapshotFromTiles = (
	input: TileInput,
	drawItems: TileDrawItem[],
): FrozenNodeRasterSnapshot | null => {
	const intersectedTiles = drawItems.filter((tile) => {
		const tileAabb = resolveTileDrawCoverageAabb(tile);
		return isTileAabbIntersected(input.aabb, tileAabb);
	});
	if (intersectedTiles.length === 0) return null;
	if (!isTileAabbCoveredByDrawItems(input.aabb, intersectedTiles)) return null;
	const baseTile = intersectedTiles[0];
	if (!baseTile) return null;
	const baseTileAabb = resolveTileDrawSourceWorldAabb(baseTile);
	const pixelPerWorld = TILE_PIXEL_SIZE / Math.max(1, baseTileAabb.width);
	const rawWidth = Math.max(1, Math.ceil(input.aabb.width * pixelPerWorld));
	const rawHeight = Math.max(1, Math.ceil(input.aabb.height * pixelPerWorld));
	const pixelScale = Math.min(
		1,
		FROZEN_NODE_SNAPSHOT_MAX_EDGE_PX / rawWidth,
		FROZEN_NODE_SNAPSHOT_MAX_EDGE_PX / rawHeight,
		Math.sqrt(FROZEN_NODE_SNAPSHOT_MAX_PIXELS / (rawWidth * rawHeight)),
	);
	const width = Math.max(1, Math.round(rawWidth * pixelScale));
	const height = Math.max(1, Math.round(rawHeight * pixelScale));
	const worldToSnapshotX = width / Math.max(1, input.aabb.width);
	const worldToSnapshotY = height / Math.max(1, input.aabb.height);
	const surface = Skia.Surface.MakeOffscreen(
		width,
		height,
		resolveTileImagePixelRatio(baseTile),
	);
	if (!surface) return null;
	let image: SkImage | null = null;
	const imagePaint = Skia.Paint();
	try {
		const canvas = surface.getCanvas();
		canvas.clear(Float32Array.of(0, 0, 0, 0));
		for (const tile of intersectedTiles) {
			const sourceAabb = resolveTileDrawSourceWorldAabb(tile);
			const coverageAabb = resolveTileDrawCoverageAabb(tile);
			const intersection = intersectTileAabb(input.aabb, coverageAabb);
			if (!intersection) continue;
			// drag start 从 tile buffer 截图时，tile 分界必须落在 snapshot 像素边界上，
			// 否则 drawImageRect 的抗锯齿会把透明边缘采进冻结纹理，拖拽中就会出现接缝。
			const roundedIntersection = resolveSnapshotPixelRoundedIntersection(
				intersection,
				input.aabb,
				worldToSnapshotX,
				worldToSnapshotY,
			);
			if (!roundedIntersection) continue;
			const roundedWorldAabb = roundedIntersection.worldAabb;
			const tileImageSize = resolveTileImageSize(tile);
			canvas.drawImageRect(
				tile.image,
				{
					x:
						((roundedWorldAabb.left - sourceAabb.left) / sourceAabb.width) *
						tileImageSize.width,
					y:
						((roundedWorldAabb.top - sourceAabb.top) / sourceAabb.height) *
						tileImageSize.height,
					width:
						(roundedWorldAabb.width / sourceAabb.width) * tileImageSize.width,
					height:
						(roundedWorldAabb.height / sourceAabb.height) *
						tileImageSize.height,
				},
				roundedIntersection.snapshotRect,
				imagePaint,
				true,
			);
		}
		surface.flush();
		image = surface.asImageCopy?.() ?? surface.makeImageSnapshot();
		if (!image) return null;
		return {
			image,
			sourceWidth: width,
			sourceHeight: height,
			dispose: () => {
				try {
					image?.dispose?.();
				} catch {}
			},
		};
	} catch {
		try {
			image?.dispose?.();
		} catch {}
		return null;
	} finally {
		try {
			imagePaint.dispose?.();
		} catch {}
		try {
			surface.dispose?.();
		} catch {}
	}
};

const createFrozenNodeRasterSnapshot = (
	input: TileInput,
	cameraZoom: number,
): FrozenNodeRasterSnapshot | null => {
	const { width, height } = resolveFrozenNodeSnapshotSize(input, cameraZoom);
	const surface = Skia.Surface.MakeOffscreen(width, height);
	if (!surface) return null;
	let image: SkImage | null = null;
	let imagePaint: ReturnType<typeof Skia.Paint> | null = null;
	try {
		const canvas = surface.getCanvas();
		canvas.clear(Float32Array.of(0, 0, 0, 0));
		canvas.save();
		if (input.kind === "picture") {
			canvas.scale(
				width / Math.max(1, input.sourceWidth),
				height / Math.max(1, input.sourceHeight),
			);
			canvas.drawPicture(input.picture);
		} else {
			imagePaint = Skia.Paint();
			canvas.drawImageRect(
				input.image,
				{
					x: 0,
					y: 0,
					width: Math.max(1, input.sourceWidth),
					height: Math.max(1, input.sourceHeight),
				},
				{
					x: 0,
					y: 0,
					width,
					height,
				},
				imagePaint,
				true,
			);
		}
		canvas.restore();
		surface.flush();
		image = surface.asImageCopy?.() ?? surface.makeImageSnapshot();
		if (!image) return null;
		return {
			image,
			sourceWidth: width,
			sourceHeight: height,
			dispose: () => {
				try {
					image?.dispose?.();
				} catch {}
			},
		};
	} catch {
		try {
			image?.dispose?.();
		} catch {}
		return null;
	} finally {
		try {
			imagePaint?.dispose?.();
		} catch {}
		try {
			surface.dispose?.();
		} catch {}
	}
};

const isTileAabbEqual = (left: TileAabb, right: TileAabb): boolean => {
	return (
		Math.abs(left.left - right.left) < TILE_AABB_EPSILON &&
		Math.abs(left.top - right.top) < TILE_AABB_EPSILON &&
		Math.abs(left.right - right.right) < TILE_AABB_EPSILON &&
		Math.abs(left.bottom - right.bottom) < TILE_AABB_EPSILON
	);
};

const resolveNodeWorldAabb = (
	node: Pick<CanvasNode, "x" | "y" | "width" | "height">,
): TileAabb => {
	return createTileAabb(
		node.x,
		node.y,
		node.x + node.width,
		node.y + node.height,
	);
};

const intersectTileAabb = (
	left: TileAabb,
	right: TileAabb,
): TileAabb | null => {
	const nextLeft = Math.max(left.left, right.left);
	const nextTop = Math.max(left.top, right.top);
	const nextRight = Math.min(left.right, right.right);
	const nextBottom = Math.min(left.bottom, right.bottom);
	if (nextLeft >= nextRight || nextTop >= nextBottom) return null;
	return createTileAabb(nextLeft, nextTop, nextRight, nextBottom);
};

const resolveNodeAncestorClipAabbs = (
	node: CanvasNode,
	nodeById: Map<string, CanvasNode>,
): TileAabb[] => {
	const clipAabbs: TileAabb[] = [];
	const visitedNodeIds = new Set<string>();
	let parentId = node.parentId ?? null;
	while (parentId) {
		if (visitedNodeIds.has(parentId)) break;
		visitedNodeIds.add(parentId);
		const parentNode = nodeById.get(parentId);
		if (!parentNode) break;
		if (parentNode.type === "board") {
			clipAabbs.push(resolveNodeWorldAabb(parentNode));
		}
		parentId = parentNode.parentId ?? null;
	}
	return clipAabbs.reverse();
};

const resolveClippedTileInputAabb = (
	aabb: TileAabb,
	clipAabbs: TileAabb[],
): TileAabb | null => {
	let visibleAabb: TileAabb | null = aabb;
	for (const clipAabb of clipAabbs) {
		visibleAabb = intersectTileAabb(visibleAabb, clipAabb);
		if (!visibleAabb) return null;
	}
	return visibleAabb;
};

const resolveTileClipSignature = (
	clipAabbs: TileAabb[],
	visibleAabb: TileAabb | null,
): string => {
	if (clipAabbs.length === 0) return "none";
	const aabbToSignature = (aabb: TileAabb): string => {
		return [
			Math.round(aabb.left * 1000),
			Math.round(aabb.top * 1000),
			Math.round(aabb.right * 1000),
			Math.round(aabb.bottom * 1000),
		].join(",");
	};
	return [
		visibleAabb ? aabbToSignature(visibleAabb) : "empty",
		...clipAabbs.map(aabbToSignature),
	].join("|");
};

const resolveTileRasterAsset = (
	node: CanvasNode,
	assetById: Map<string, TimelineAsset>,
): TimelineAsset | null => {
	const definition = getCanvasNodeDefinition(node.type);
	if ("assetId" in node) {
		const sourceAsset = assetById.get(node.assetId);
		if (sourceAsset?.kind === "image" && !definition.tilePicture) {
			return sourceAsset;
		}
	}
	if (!hasThumbnailCapability(node)) return null;
	const thumbnailAssetId = node.thumbnail?.assetId ?? null;
	if (!thumbnailAssetId) return null;
	const thumbnailAsset = assetById.get(thumbnailAssetId);
	if (!thumbnailAsset || thumbnailAsset.kind !== "image") return null;
	return thumbnailAsset;
};

const createTilePictureFromNodeRenderer = ({
	node,
	scene,
	asset,
	runtimeManager,
}: {
	node: CanvasNode;
	scene: StudioProject["scenes"][string] | null;
	asset: TimelineAsset | null;
	runtimeManager: ReturnType<typeof useStudioRuntimeManager>;
}): { picture: SkPicture; dispose: () => void } | null => {
	// 暂时不要把这个通用 fallback 接回 tile pipeline。
	// 它会直接录制完整 node renderer，绕过 tilePicture 的专用签名和资源准备；
	// 对依赖字体、shader 或 renderer lifecycle 的节点，static tile 曾出现不 ready / retained live 卡住。
	const definition = getCanvasNodeDefinition(node.type);
	const Renderer = definition.skiaRenderer as React.ComponentType<
		CanvasNodeSkiaRenderProps<CanvasNode>
	>;
	const sourceWidth = Math.max(1, Math.round(Math.abs(node.width)));
	const sourceHeight = Math.max(1, Math.round(Math.abs(node.height)));
	const picture = renderNodeToPicture(
		<Renderer
			node={node}
			scene={scene}
			asset={asset}
			isActive={false}
			isFocused={false}
			runtimeManager={runtimeManager}
		/>,
		{
			width: sourceWidth,
			height: sourceHeight,
		},
	);
	if (!picture) return null;
	return {
		picture,
		dispose: () => {
			try {
				picture.dispose?.();
			} catch {}
		},
	};
};

const canUseTilePipeline = (): boolean => {
	const surfaceFactory = (
		Skia as unknown as { Surface?: { MakeOffscreen?: unknown } }
	).Surface?.MakeOffscreen;
	const paintFactory = (Skia as unknown as { Paint?: unknown }).Paint;
	return (
		typeof surfaceFactory === "function" && typeof paintFactory === "function"
	);
};

const isStaticTileFrameFullyReady = (frameResult: TileFrameResult): boolean => {
	const stats = frameResult.stats;
	return (
		!frameResult.hasPendingWork &&
		stats.visibleCount <= stats.readyVisibleCount + stats.coverFallbackCount &&
		stats.queuedCount === 0 &&
		stats.renderingCount === 0
	);
};

export type {
	FrozenNodeRasterSnapshot,
	RasterImageCacheEntry,
	TileAsyncPictureCacheEntry,
	TileAsyncPictureRequest,
	TileInputCacheEntry,
};

export {
	canCreateFrozenSnapshotFromCompositedTiles,
	canUseTilePipeline,
	createFrozenNodeRasterSnapshot,
	createFrozenNodeRasterSnapshotFromTiles,
	createTilePictureFromNodeRenderer,
	disposeFrozenNodeRasterSnapshot,
	disposeTileAsyncPictureCacheEntry,
	disposeTileInput,
	EMPTY_STATIC_TILE_SNAPSHOT,
	hasThumbnailCapability,
	isStaticTileFrameFullyReady,
	isTileAabbEqual,
	resolveClippedTileInputAabb,
	resolveNodeAncestorClipAabbs,
	resolveNodeAsset,
	resolveNodeScene,
	resolveNodeWorldAabb,
	resolveSkImageSize,
	resolveTileClipSignature,
	resolveTileDrawBleed,
	resolveTileNodeSourceSignature,
	resolveTilePictureCapability,
	resolveTileRasterAsset,
};
