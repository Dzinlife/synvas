type LegacyLayoutMeta = {
	width?: number | "auto" | string;
	height?: number | "auto" | string;
	left?: number | string;
	right?: number | string;
	top?: number | string;
	bottom?: number | string;
	constraints?: {
		horizontal: "LEFT" | "RIGHT" | "CENTER" | "LEFT_RIGHT" | "SCALE";
		vertical: "TOP" | "BOTTOM" | "CENTER" | "TOP_BOTTOM" | "SCALE";
	};
	rotate?: string;
	anchor?: "top-left" | "center" | "bottom-right";
	zIndex?: number;
	visible?: boolean;
};

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
		if (isNaN(percent) || reference === undefined) {
			return 0;
		}
		return (percent / 100) * reference;
	}

	// 处理普通数值字符串
	const num = parseFloat(value);
	return isNaN(num) ? 0 : num;
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
			degrees = isNaN(num) ? 0 : num;
		}
	}

	// 将度数转换为弧度
	return (degrees * Math.PI) / 180;
};

/**
 * 将 meta layout（picture 坐标系）转换为 canvas layout（canvas 坐标系）
 * @param metaLayout 布局元数据
 * @param picture 影片尺寸（原始坐标系）
 * @param canvas 画布尺寸（目标坐标系）
 * @returns canvas 坐标系下的位置和尺寸
 */
export const converMetaLayoutToCanvasLayout = (
	metaLayout: LegacyLayoutMeta,
	picture: {
		width: number;
		height: number;
	},
	canvas: {
		width: number;
		height: number;
	},
	pixelRatio = 1,
): {
	x: number;
	y: number;
	width: number;
	height: number;
	rotate: number;
} => {
	const {
		left,
		right,
		top,
		bottom,
		width: metaWidth,
		height: metaHeight,
		constraints,
		rotate,
	} = metaLayout;

	// 计算缩放比例（从 picture 到 canvas）
	const scaleX = (canvas.width / picture.width) * pixelRatio;
	const scaleY = (canvas.height / picture.height) * pixelRatio;

	// 解析 picture 坐标系下的值
	const parsePictureUnit = (
		value: number | string | "auto" | undefined,
		reference: number,
	) => parseUnit(value, reference);

	// 计算 picture 坐标系下的位置和尺寸
	let pictureX = 0;
	let pictureY = 0;
	let pictureWidth = 0;
	let pictureHeight = 0;

	// 处理水平方向
	if (left !== undefined && right !== undefined) {
		// 同时有 left 和 right，计算 width
		if (left === "auto" && right === "auto") {
			// 两个都是 auto，水平居中
			if (metaWidth === "auto") {
				// width 也是 auto，填充整个宽度
				pictureWidth = picture.width;
				pictureX = 0;
			} else {
				pictureWidth = parsePictureUnit(metaWidth, picture.width);
				pictureX = (picture.width - pictureWidth) / 2;
			}
		} else if (left === "auto") {
			// left 是 auto，right 有值，计算 left 使元素居中
			const rightValue = parsePictureUnit(right, picture.width);
			if (metaWidth === "auto") {
				// width 是 auto，填充剩余空间
				pictureWidth = picture.width - rightValue;
				pictureX = 0;
			} else {
				pictureWidth = parsePictureUnit(metaWidth, picture.width);
				pictureX = (picture.width - pictureWidth - rightValue) / 2;
			}
		} else if (right === "auto") {
			// right 是 auto，left 有值，计算 right 使元素居中
			const leftValue = parsePictureUnit(left, picture.width);
			if (metaWidth === "auto") {
				// width 是 auto，填充剩余空间
				pictureWidth = picture.width - leftValue;
				pictureX = leftValue;
			} else {
				pictureWidth = parsePictureUnit(metaWidth, picture.width);
				pictureX = leftValue;
			}
		} else {
			// 都不是 auto，正常计算
			const leftValue = parsePictureUnit(left, picture.width);
			const rightValue = parsePictureUnit(right, picture.width);
			pictureX = leftValue;
			pictureWidth = picture.width - leftValue - rightValue;
		}
	} else if (left !== undefined) {
		if (left === "auto") {
			// left 是 auto，水平居中
			if (metaWidth === "auto") {
				// width 也是 auto，填充整个宽度
				pictureWidth = picture.width;
				pictureX = 0;
			} else {
				pictureWidth = parsePictureUnit(metaWidth, picture.width);
				pictureX = (picture.width - pictureWidth) / 2;
			}
		} else {
			pictureX = parsePictureUnit(left, picture.width);
			if (metaWidth === "auto") {
				// width 是 auto，填充剩余空间
				pictureWidth = picture.width - pictureX;
			} else {
				pictureWidth = parsePictureUnit(metaWidth, picture.width);
			}
		}
	} else if (right !== undefined) {
		if (right === "auto") {
			// right 是 auto，水平居中
			if (metaWidth === "auto") {
				// width 也是 auto，填充整个宽度
				pictureWidth = picture.width;
				pictureX = 0;
			} else {
				pictureWidth = parsePictureUnit(metaWidth, picture.width);
				pictureX = (picture.width - pictureWidth) / 2;
			}
		} else {
			const rightValue = parsePictureUnit(right, picture.width);
			if (metaWidth === "auto") {
				// width 是 auto，填充剩余空间
				pictureWidth = picture.width - rightValue;
				pictureX = 0;
			} else {
				pictureWidth = parsePictureUnit(metaWidth, picture.width);
				pictureX = picture.width - rightValue - pictureWidth;
			}
		}
	} else {
		// 都没有，默认为 0
		if (metaWidth === "auto") {
			// width 是 auto，填充整个宽度
			pictureWidth = picture.width;
			pictureX = 0;
		} else {
			pictureX = 0;
			pictureWidth = parsePictureUnit(metaWidth, picture.width);
		}
	}

	// 处理垂直方向
	if (top !== undefined && bottom !== undefined) {
		// 同时有 top 和 bottom，计算 height
		if (top === "auto" && bottom === "auto") {
			// 两个都是 auto，垂直居中
			if (metaHeight === "auto") {
				// height 也是 auto，填充整个高度
				pictureHeight = picture.height;
				pictureY = 0;
			} else {
				pictureHeight = parsePictureUnit(metaHeight, picture.height);
				pictureY = (picture.height - pictureHeight) / 2;
			}
		} else if (top === "auto") {
			// top 是 auto，bottom 有值，计算 top 使元素居中
			const bottomValue = parsePictureUnit(bottom, picture.height);
			if (metaHeight === "auto") {
				// height 是 auto，填充剩余空间
				pictureHeight = picture.height - bottomValue;
				pictureY = 0;
			} else {
				pictureHeight = parsePictureUnit(metaHeight, picture.height);
				pictureY = (picture.height - pictureHeight - bottomValue) / 2;
			}
		} else if (bottom === "auto") {
			// bottom 是 auto，top 有值，计算 bottom 使元素居中
			const topValue = parsePictureUnit(top, picture.height);
			if (metaHeight === "auto") {
				// height 是 auto，填充剩余空间
				pictureHeight = picture.height - topValue;
				pictureY = topValue;
			} else {
				pictureHeight = parsePictureUnit(metaHeight, picture.height);
				pictureY = topValue;
			}
		} else {
			// 都不是 auto，正常计算
			const topValue = parsePictureUnit(top, picture.height);
			const bottomValue = parsePictureUnit(bottom, picture.height);
			pictureY = topValue;
			pictureHeight = picture.height - topValue - bottomValue;
		}
	} else if (top !== undefined) {
		if (top === "auto") {
			// top 是 auto，垂直居中
			if (metaHeight === "auto") {
				// height 也是 auto，填充整个高度
				pictureHeight = picture.height;
				pictureY = 0;
			} else {
				pictureHeight = parsePictureUnit(metaHeight, picture.height);
				pictureY = (picture.height - pictureHeight) / 2;
			}
		} else {
			pictureY = parsePictureUnit(top, picture.height);
			if (metaHeight === "auto") {
				// height 是 auto，填充剩余空间
				pictureHeight = picture.height - pictureY;
			} else {
				pictureHeight = parsePictureUnit(metaHeight, picture.height);
			}
		}
	} else if (bottom !== undefined) {
		if (bottom === "auto") {
			// bottom 是 auto，垂直居中
			if (metaHeight === "auto") {
				// height 也是 auto，填充整个高度
				pictureHeight = picture.height;
				pictureY = 0;
			} else {
				pictureHeight = parsePictureUnit(metaHeight, picture.height);
				pictureY = (picture.height - pictureHeight) / 2;
			}
		} else {
			const bottomValue = parsePictureUnit(bottom, picture.height);
			if (metaHeight === "auto") {
				// height 是 auto，填充剩余空间
				pictureHeight = picture.height - bottomValue;
				pictureY = 0;
			} else {
				pictureHeight = parsePictureUnit(metaHeight, picture.height);
				pictureY = picture.height - bottomValue - pictureHeight;
			}
		}
	} else {
		// 都没有，默认为 0
		if (metaHeight === "auto") {
			// height 是 auto，填充整个高度
			pictureHeight = picture.height;
			pictureY = 0;
		} else {
			pictureY = 0;
			pictureHeight = parsePictureUnit(metaHeight, picture.height);
		}
	}

	// 转换到 canvas 坐标系
	let canvasX = pictureX * scaleX;
	let canvasY = pictureY * scaleY;
	let canvasWidth = pictureWidth * scaleX;
	let canvasHeight = pictureHeight * scaleY;

	// 处理约束（constraints）- 在 canvas 坐标系中应用
	if (constraints) {
		const { horizontal, vertical } = constraints;

		// 如果任一方向是 SCALE，需要保持宽高比
		const hasScale = horizontal === "SCALE" || vertical === "SCALE";
		if (hasScale) {
			// 使用统一的缩放比例（取较小的，确保内容不被裁剪）
			const scale = Math.min(scaleX, scaleY);
			canvasWidth = pictureWidth * scale;
			canvasHeight = pictureHeight * scale;
		}

		// 水平约束
		switch (horizontal) {
			case "LEFT":
				// 保持左边缘固定，宽度不变（已经是默认行为）
				break;
			case "RIGHT":
				// 保持右边缘固定，调整 x 位置
				canvasX = canvas.width - canvasWidth;
				break;
			case "CENTER":
				// 居中，调整 x 位置
				canvasX = (canvas.width - canvasWidth) / 2;
				break;
			case "LEFT_RIGHT":
				// 左右边缘固定，宽度填充整个 canvas
				if (left !== undefined && right !== undefined) {
					// 如果已经通过 left/right 计算了宽度，保持该宽度
					// 但调整 x 位置以保持左边缘固定
					canvasX = parsePictureUnit(left, picture.width) * scaleX;
				} else {
					// 如果没有同时指定 left 和 right，则填充整个宽度
					canvasWidth = canvas.width;
					canvasX = 0;
				}
				break;
			case "SCALE":
				// SCALE 只影响尺寸，位置保持原样（由 left/top 或其他约束决定）
				// 如果没有其他位置约束，默认居中
				if (vertical !== "CENTER" && vertical !== "SCALE") {
					// 垂直方向有特定约束，水平位置保持原样
				} else {
					// 否则水平居中
					canvasX = (canvas.width - canvasWidth) / 2;
				}
				break;
		}

		// 垂直约束
		switch (vertical) {
			case "TOP":
				// 保持上边缘固定，高度不变（已经是默认行为）
				break;
			case "BOTTOM":
				// 保持下边缘固定，调整 y 位置
				canvasY = canvas.height - canvasHeight;
				break;
			case "CENTER":
				// 居中，调整 y 位置
				canvasY = (canvas.height - canvasHeight) / 2;
				break;
			case "TOP_BOTTOM":
				// 上下边缘固定，高度填充整个 canvas
				if (top !== undefined && bottom !== undefined) {
					// 如果已经通过 top/bottom 计算了高度，保持该高度
					// 但调整 y 位置以保持上边缘固定
					canvasY = parsePictureUnit(top, picture.height) * scaleY;
				} else {
					// 如果没有同时指定 top 和 bottom，则填充整个高度
					canvasHeight = canvas.height;
					canvasY = 0;
				}
				break;
			case "SCALE":
				// SCALE 只影响尺寸，位置保持原样（由 left/top 或其他约束决定）
				// 如果没有其他位置约束，默认居中
				if (horizontal !== "CENTER" && horizontal !== "SCALE") {
					// 水平方向有特定约束，垂直位置保持原样
				} else {
					// 否则垂直居中
					canvasY = (canvas.height - canvasHeight) / 2;
				}
				break;
		}
	}

	return {
		x: canvasX,
		y: canvasY,
		width: canvasWidth,
		height: canvasHeight,
		rotate: parseRotate(rotate),
	};
};

/**
 * 将 TransformMeta（中心坐标系统）转换为 RenderLayout
 * 这是新架构的核心转换函数
 * @param transform 中心坐标系的变换属性
 * @param picture 影片尺寸（原始坐标系）
 * @param canvas 画布尺寸（目标坐标系）
 * @returns RenderLayout 用于渲染的布局信息
 */
export const transformMetaToRenderLayout = (
	transform: import("./types").TransformMeta,
	picture: {
		width: number;
		height: number;
	},
	canvas: {
		width: number;
		height: number;
	},
	pixelRatio = 1,
): import("./types").RenderLayout => {
	const { centerX, centerY, width, height, rotation } = transform;

	// 计算缩放比例（从 picture 到 canvas）
	const scaleX = (canvas.width / picture.width) * pixelRatio;
	const scaleY = (canvas.height / picture.height) * pixelRatio;

	// 将中心坐标从画布中心坐标系转换到左上角坐标系，然后缩放到 canvas 坐标系
	// centerX/centerY 是相对于画布中心的坐标（0,0 表示画布中心）
	// 需要先加上 picture 尺寸的一半，转换为相对于左上角的坐标
	const canvasCenterX = (centerX + picture.width / 2) * scaleX;
	const canvasCenterY = (centerY + picture.height / 2) * scaleY;
	const canvasWidth = width * scaleX;
	const canvasHeight = height * scaleY;

	return {
		cx: canvasCenterX,
		cy: canvasCenterY,
		w: canvasWidth,
		h: canvasHeight,
		rotation,
	};
};

/**
 * 将 RenderLayout（中心坐标）转换为左上角坐标
 * 用于 Konva 等使用左上角坐标的库
 */
export const renderLayoutToTopLeft = (
	layout: import("./types").RenderLayout,
): {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
} => {
	const { cx, cy, w, h, rotation } = layout;
	return {
		x: cx - w / 2,
		y: cy - h / 2,
		width: w,
		height: h,
		rotation,
	};
};
