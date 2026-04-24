export interface SceneTimelineInsertionSize {
	width: number;
	height: number;
}

const normalizeSize = (
	size: { width?: number; height?: number } | null | undefined,
): SceneTimelineInsertionSize | null => {
	if (!size) return null;
	const width = Math.abs(size.width ?? 0);
	const height = Math.abs(size.height ?? 0);
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	if (width <= 0 || height <= 0) return null;
	return { width, height };
};

const roundSize = (size: SceneTimelineInsertionSize) => ({
	width: Math.max(1, Math.round(size.width)),
	height: Math.max(1, Math.round(size.height)),
});

export const resolveSceneTimelineInsertionSize = ({
	sourceSize,
	fallbackSize,
	targetSize,
}: {
	sourceSize?: { width?: number; height?: number } | null;
	fallbackSize?: { width?: number; height?: number } | null;
	targetSize?: { width?: number; height?: number } | null;
}): SceneTimelineInsertionSize => {
	const source = normalizeSize(sourceSize) ??
		normalizeSize(fallbackSize) ?? {
			width: 1,
			height: 1,
		};
	const target = normalizeSize(targetSize);
	if (!target) return roundSize(source);

	// 只在超出目标 scene 画布时等比缩小，不做放大。
	const scale = Math.min(
		1,
		target.width / source.width,
		target.height / source.height,
	);
	return roundSize({
		width: source.width * scale,
		height: source.height * scale,
	});
};
