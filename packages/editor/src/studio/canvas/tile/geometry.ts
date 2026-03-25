import { TILE_LOD_BASE, TILE_WORLD_SIZE_L0 } from "./constants";
import type { TileAabb, TileKey } from "./types";

const TILE_COORD_OFFSET = 1 << 20;
const TILE_COORD_BITS = 21;
const TILE_COORD_BASE = 2 ** TILE_COORD_BITS;
const TILE_LOD_STRIDE = TILE_COORD_BASE * TILE_COORD_BASE;
const TILE_LOD_BITS = 11;
const TILE_LOD_BASE_VALUE = 2 ** TILE_LOD_BITS;
const TILE_LOD_BIAS = TILE_LOD_BASE_VALUE / 2;

const normalizeCoord = (value: number): number => {
	const rounded = Math.round(value);
	const normalized = rounded + TILE_COORD_OFFSET;
	return ((normalized % TILE_COORD_BASE) + TILE_COORD_BASE) % TILE_COORD_BASE;
};

const normalizeLod = (lod: number): number => {
	const rounded = Math.round(lod);
	const clamped = Math.max(-TILE_LOD_BIAS, Math.min(TILE_LOD_BIAS - 1, rounded));
	return clamped + TILE_LOD_BIAS;
};

export const createTileAabb = (
	left: number,
	top: number,
	right: number,
	bottom: number,
): TileAabb => {
	const normalizedLeft = Math.min(left, right);
	const normalizedRight = Math.max(left, right);
	const normalizedTop = Math.min(top, bottom);
	const normalizedBottom = Math.max(top, bottom);
	return {
		left: normalizedLeft,
		top: normalizedTop,
		right: normalizedRight,
		bottom: normalizedBottom,
		width: Math.max(1, normalizedRight - normalizedLeft),
		height: Math.max(1, normalizedBottom - normalizedTop),
	};
};

export const isTileAabbIntersected = (
	left: TileAabb,
	right: TileAabb,
): boolean => {
	return (
		left.left < right.right &&
		left.right > right.left &&
		left.top < right.bottom &&
		left.bottom > right.top
	);
};

export const encodeTileKey = ({ lod, tx, ty }: TileKey): number => {
	const encodedLod = normalizeLod(lod);
	const encodedTx = normalizeCoord(tx);
	const encodedTy = normalizeCoord(ty);
	return encodedLod * TILE_LOD_STRIDE + encodedTx * TILE_COORD_BASE + encodedTy;
};

export const decodeTileKey = (key: number): TileKey => {
	const safeKey = Math.max(0, Math.floor(key));
	const encodedLod = Math.floor(safeKey / TILE_LOD_STRIDE);
	const remainder = safeKey - encodedLod * TILE_LOD_STRIDE;
	const txEncoded = Math.floor(remainder / TILE_COORD_BASE);
	const tyEncoded = remainder - txEncoded * TILE_COORD_BASE;
	const tx = txEncoded - TILE_COORD_OFFSET;
	const ty = tyEncoded - TILE_COORD_OFFSET;
	const lod = encodedLod - TILE_LOD_BIAS;
	return { lod, tx, ty };
};

export const resolveTileWorldSize = (lod: number = TILE_LOD_BASE): number => {
	return TILE_WORLD_SIZE_L0 * 2 ** -lod;
};

export const resolveTileWorldRect = (
	tx: number,
	ty: number,
	lod: number = TILE_LOD_BASE,
): TileAabb => {
	const worldSize = resolveTileWorldSize(lod);
	const left = tx * worldSize;
	const top = ty * worldSize;
	const right = left + worldSize;
	const bottom = top + worldSize;
	return {
		left,
		top,
		right,
		bottom,
		width: worldSize,
		height: worldSize,
	};
};
