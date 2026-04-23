export const NODE_THUMBNAIL_VERSION = 1 as const;
export const NODE_THUMBNAIL_FRAME = 0;
export const NODE_THUMBNAIL_MAX_EDGE = 720;

const canvasToBlob = async (
	canvas: HTMLCanvasElement,
	type: string,
	quality: number,
): Promise<Blob | null> => {
	if (typeof canvas.toBlob !== "function") return null;
	return new Promise<Blob | null>((resolve) => {
		canvas.toBlob((blob) => resolve(blob), type, quality);
	});
};

export const encodeCanvasThumbnailBlob = async (
	canvas: HTMLCanvasElement,
): Promise<Blob | null> => {
	const candidates: Array<{ type: string; quality: number }> = [
		{ type: "image/webp", quality: 0.82 },
		{ type: "image/jpeg", quality: 0.86 },
		{ type: "image/png", quality: 0.9 },
	];
	for (const candidate of candidates) {
		const blob = await canvasToBlob(canvas, candidate.type, candidate.quality);
		if (blob) return blob;
	}
	return null;
};

export const resolveThumbnailSize = (
	width: number,
	height: number,
	maxEdge = NODE_THUMBNAIL_MAX_EDGE,
): { width: number; height: number } => {
	const safeWidth = Number.isFinite(width) && width > 0 ? width : maxEdge;
	const safeHeight = Number.isFinite(height) && height > 0 ? height : maxEdge;
	const longestEdge = Math.max(safeWidth, safeHeight, 1);
	const scale = Math.min(1, maxEdge / longestEdge);
	return {
		width: Math.max(1, Math.round(safeWidth * scale)),
		height: Math.max(1, Math.round(safeHeight * scale)),
	};
};
