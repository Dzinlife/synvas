import { useMemo } from "react";
import { BackdropFilter, Group, ImageFilter, Skia } from "react-skia-lite";
import { useRenderLayout } from "../useRenderLayout";
import type { BackdropZoomProps } from "./model";

interface BackdropZoomRendererProps extends BackdropZoomProps {
	id: string;
	zoom: number;
	shape?: "circle" | "rect";
	size?: { width: number; height: number };
	cornerRadius?: number;
}

const BackdropZoom: React.FC<BackdropZoomRendererProps> = ({
	id,
	zoom,
	shape = "circle",
	cornerRadius = 16,
}) => {
	// 从中心坐标转换为左上角坐标
	const {
		cx,
		cy,
		w: width,
		h: height,
		rotation: rotate = 0,
	} = useRenderLayout(id);
	const x = cx - width / 2;
	const y = cy - height / 2;

	// 创建矩阵变换滤镜：先平移到中心点，然后缩放，再平移回来
	const matrixFilter = useMemo(() => {
		const matrix = Skia.Matrix();
		// 计算缩放后的偏移量，使中心点保持不变
		matrix.translate(cx - cx * zoom, cy - cy * zoom);
		matrix.scale(zoom, zoom);
		return Skia.ImageFilter.MakeMatrixTransform(matrix);
	}, [zoom, cx, cy]);

	// 创建裁剪路径（使用左上角坐标系统）
	const clipPath = useMemo(() => {
		const path = Skia.Path.Make();

		if (shape === "circle") {
			const radius = Math.min(width, height) / 2;
			// 圆心在左上角坐标系统中的位置
			path.addCircle(x + width / 2, y + height / 2, radius);
		} else {
			path.addRRect({
				rect: {
					x,
					y,
					width,
					height,
				},
				rx: cornerRadius,
				ry: cornerRadius,
			});
		}
		return path;
	}, [shape, x, y, width, height, cornerRadius]);

	return (
		<Group clip={clipPath} transform={[{ rotate }]} origin={{ x, y }}>
			<BackdropFilter filter={<ImageFilter filter={matrixFilter} />}>
				{/* 子元素会显示在放大后的背景之上 */}
			</BackdropFilter>
		</Group>
	);
};

BackdropZoom.displayName = "BackdropZoom";

export default BackdropZoom;
