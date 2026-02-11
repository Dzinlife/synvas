type Size = {
	width: number;
	height: number;
};

const resolveSafeSize = (size: Size): Size => {
	const width = Number.isFinite(size.width) && size.width > 0 ? size.width : 1;
	const height =
		Number.isFinite(size.height) && size.height > 0 ? size.height : 1;
	return { width, height };
};

/**
 * 将 Transform position（画布中心原点、Y 轴向上）转换为画布点坐标（左上角原点、Y 轴向下）。
 */
export const transformPositionToCanvasPoint = (
	positionX: number,
	positionY: number,
	picture: Size,
	canvas: Size,
) => {
	const safePicture = resolveSafeSize(picture);
	const safeCanvas = resolveSafeSize(canvas);
	const scaleX = safeCanvas.width / safePicture.width;
	const scaleY = safeCanvas.height / safePicture.height;

	return {
		canvasX: (positionX + safePicture.width / 2) * scaleX,
		canvasY: (safePicture.height / 2 - positionY) * scaleY,
	};
};

/**
 * 将画布点坐标（左上角原点、Y 轴向下）转换为 Transform position（画布中心原点、Y 轴向上）。
 */
export const canvasPointToTransformPosition = (
	canvasX: number,
	canvasY: number,
	picture: Size,
	canvas: Size,
) => {
	const safePicture = resolveSafeSize(picture);
	const safeCanvas = resolveSafeSize(canvas);
	const scaleX = safePicture.width / safeCanvas.width;
	const scaleY = safePicture.height / safeCanvas.height;

	return {
		positionX: canvasX * scaleX - safePicture.width / 2,
		positionY: safePicture.height / 2 - canvasY * scaleY,
	};
};
