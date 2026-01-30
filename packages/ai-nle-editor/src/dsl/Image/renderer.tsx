import { Group, ImageShader, Rect } from "react-skia-lite";
import { createModelSelector } from "../model/registry";
import { useRenderLayout } from "../useRenderLayout";
import type { ImageInternal, ImageProps } from "./model";

interface ImageRendererProps extends ImageProps {
	id: string;
}

const useImageSelector = createModelSelector<ImageProps, ImageInternal>();

const ImageRenderer: React.FC<ImageRendererProps> = ({ id }) => {
	const renderLayout = useRenderLayout(id);
	// 将中心坐标转换为左上角坐标
	const { cx, cy, w: width, h: height, rotation: rotate = 0 } = renderLayout;
	const x = cx - width / 2;
	const y = cy - height / 2;

	// 订阅需要的状态
	const isLoading = useImageSelector(
		id,
		(state) => state.constraints.isLoading ?? false,
	);
	const hasError = useImageSelector(
		id,
		(state) => state.constraints.hasError ?? false,
	);
	const image = useImageSelector(id, (state) => state.internal.image);

	// Loading 状态
	if (isLoading) {
		return (
			<Group>
				<Rect x={x} y={y} width={width} height={height} color="#e5e7eb" />
			</Group>
		);
	}

	// Error 状态
	if (hasError) {
		return (
			<Group>
				<Rect x={x} y={y} width={width} height={height} color="#fee2e2" />
			</Group>
		);
	}

	// 正常渲染
	return (
		<Group>
			<Rect
				x={x}
				y={y}
				width={width}
				height={height}
				transform={[{ rotate }]}
				origin={{ x, y }}
			>
				{image && (
					<ImageShader
						image={image}
						fit="contain"
						x={x}
						y={y}
						width={width}
						height={height}
					/>
				)}
			</Rect>
		</Group>
	);
};

export default ImageRenderer;
