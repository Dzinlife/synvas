import type { RenderLayout, TransformMeta } from "core/dsl/types";

/**
 * 解析单位值，支持数值、百分比和 "auto"
 * @param value 要解析的值
 * @param reference 百分比计算的参考值（如 picture 的宽度或高度）
 * @returns 解析后的数值（canvas 坐标系）
 */
export const parseUnit = (
	value?: number | string | "auto",
	reference?: number,
): number => {
	if (value === undefined || value === null) {
		return 0;
	}

	if (typeof value === "number") {
		return value;
	}

	if (value === "auto") {
		return 0;
	}

	// 处理百分比
	if (typeof value === "string" && value.endsWith("%")) {
		const percent = parseFloat(value);
		if (Number.isNaN(percent) || reference === undefined) {
			return 0;
		}
		return (percent / 100) * reference;
	}

	// 处理普通数值字符串
	const num = parseFloat(value);
	return Number.isNaN(num) ? 0 : num;
};

/**
 * 解析旋转角度字符串，支持 "45deg" 格式
 * @param rotate 旋转角度字符串，如 "45deg" 或数字（度数）
 * @returns 解析后的角度数值（弧度）
 */
export const parseRotate = (rotate?: string | number): number => {
	if (rotate === undefined || rotate === null) {
		return 0;
	}

	let degrees = 0;

	if (typeof rotate === "number") {
		degrees = rotate;
	} else if (typeof rotate === "string") {
		// 处理 "45deg" 格式
		const match = rotate.match(/^(-?\d+(?:\.\d+)?)deg$/);
		if (match) {
			degrees = parseFloat(match[1]);
		} else {
			// 如果不是 "deg" 格式，尝试直接解析为数字（假设是度数）
			const num = parseFloat(rotate);
			degrees = Number.isNaN(num) ? 0 : num;
		}
	}

	// 将度数转换为弧度
	return (degrees * Math.PI) / 180;
};

/**
 * 计算 TransformMeta 的最终可见尺寸（以项目画布坐标为基准）
 */
export const resolveTransformSize = (
	transform: TransformMeta,
): {
	width: number;
	height: number;
} => {
	return {
		width: transform.baseSize.width * Math.abs(transform.scale.x),
		height: transform.baseSize.height * Math.abs(transform.scale.y),
	};
};

/**
 * 将 TransformMeta 转换为 RenderLayout
 * @param transform 变换属性
 * @param picture 项目画布尺寸（逻辑坐标）
 * @param canvas 渲染画布尺寸（像素坐标）
 * @returns RenderLayout 用于渲染的布局信息
 */
export const resolveTransformToRenderLayout = (
	transform: TransformMeta,
	picture: {
		width: number;
		height: number;
	},
	canvas: {
		width: number;
		height: number;
	},
	pixelRatio = 1,
): RenderLayout => {
	const size = resolveTransformSize(transform);

	// position 语义为元素中心坐标
	const projectTopLeftX = transform.position.x - size.width / 2;
	const projectTopLeftY = transform.position.y - size.height / 2;

	// 计算缩放比例（从项目画布到渲染画布）
	const scaleX = (canvas.width / picture.width) * pixelRatio;
	const scaleY = (canvas.height / picture.height) * pixelRatio;

	const canvasTopLeftX = projectTopLeftX * scaleX;
	const canvasTopLeftY = projectTopLeftY * scaleY;
	const canvasWidth = size.width * scaleX;
	const canvasHeight = size.height * scaleY;
	const rotation = (transform.rotation.value * Math.PI) / 180;

	return {
		cx: canvasTopLeftX + canvasWidth / 2,
		cy: canvasTopLeftY + canvasHeight / 2,
		w: canvasWidth,
		h: canvasHeight,
		rotation,
	};
};

export const transformMetaToRenderLayout = resolveTransformToRenderLayout;

/**
 * 将 RenderLayout（中心坐标）转换为左上角坐标
 * 用于 Konva 等使用左上角坐标的库
 */
export const renderLayoutToTopLeft = (
	layout: RenderLayout,
): {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
} => {
	const { cx, cy, w, h, rotation } = layout;
	const halfWidth = w / 2;
	const halfHeight = h / 2;
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	const centerOffsetX = halfWidth * cos - halfHeight * sin;
	const centerOffsetY = halfWidth * sin + halfHeight * cos;
	return {
		// 这里返回 Konva 语义下的“旋转基点左上角坐标”
		// Konva 默认以节点左上角为旋转原点，因此需要把中心坐标反解为 top-left
		x: cx - centerOffsetX,
		y: cy - centerOffsetY,
		width: w,
		height: h,
		rotation,
	};
};
