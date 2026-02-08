import type { TransformMeta } from "core/dsl/types";

type CreateTransformMetaOptions = {
	width: number;
	height: number;
	anchorX?: number;
	anchorY?: number;
	positionX?: number;
	positionY?: number;
};

/**
 * 创建 V2 transform 默认值
 */
export const createTransformMeta = ({
	width,
	height,
	anchorX = 0.5,
	anchorY = 0.5,
	positionX = width / 2,
	positionY = height / 2,
}: CreateTransformMetaOptions): TransformMeta => {
	return {
		schema: "v2",
		baseSize: {
			width,
			height,
		},
		position: {
			x: positionX,
			y: positionY,
			space: "canvas",
		},
		anchor: {
			x: anchorX,
			y: anchorY,
			space: "normalized",
		},
		scale: {
			x: 1,
			y: 1,
		},
		rotation: {
			value: 0,
			unit: "deg",
		},
		distort: {
			type: "none",
		},
	};
};

/**
 * 计算 V2 transform 的最终尺寸
 */
export const getTransformSize = (transform: TransformMeta) => {
	return {
		width: transform.baseSize.width * Math.abs(transform.scale.x),
		height: transform.baseSize.height * Math.abs(transform.scale.y),
	};
};
