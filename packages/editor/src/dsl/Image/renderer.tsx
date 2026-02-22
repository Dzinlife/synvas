import { Group, ImageShader, Rect } from "react-skia-lite";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import { createModelSelector } from "../model/registry";
import type { ImageInternal, ImageProps } from "./model";

interface ImageRendererProps extends ImageProps {
	id: string;
}

const useImageSelector = createModelSelector<ImageProps, ImageInternal>();

const ImageRenderer: React.FC<ImageRendererProps> = ({ id }) => {
	const transform = useTimelineStore(
		(state) => state.getElementById(id)?.transform,
	);
	const width = transform?.baseSize.width ?? 0;
	const height = transform?.baseSize.height ?? 0;

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
		return null;
	}

	// Error 状态
	if (hasError) {
		return null;
	}

	// 正常渲染
	return (
		<Group>
			<Rect x={0} y={0} width={width} height={height}>
				{image && (
					<ImageShader
						image={image}
						fit="contain"
						x={0}
						y={0}
						width={width}
						height={height}
					/>
				)}
			</Rect>
		</Group>
	);
};

export default ImageRenderer;
