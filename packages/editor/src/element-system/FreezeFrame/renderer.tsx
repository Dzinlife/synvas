import { Group, Image } from "react-skia-lite";
import { resolveVideoImageTransform } from "@/lib/videoImageTransform";
import { useTimelineStore } from "@/scene-editor/contexts/TimelineContext";
import { createModelSelector } from "../model/registry";
import type { FreezeFrameInternal, FreezeFrameProps } from "./model";

interface FreezeFrameRendererProps extends FreezeFrameProps {
	id: string;
}

const useFreezeFrameSelector = createModelSelector<
	FreezeFrameProps,
	FreezeFrameInternal
>();

const FreezeFrameRenderer: React.FC<FreezeFrameRendererProps> = ({ id }) => {
	const elementTransform = useTimelineStore(
		(state) => state.getElementById(id)?.transform,
	);
	const width = elementTransform?.baseSize.width ?? 0;
	const height = elementTransform?.baseSize.height ?? 0;

	const isLoading = useFreezeFrameSelector(
		id,
		(state) => state.constraints.isLoading ?? false,
	);
	const hasError = useFreezeFrameSelector(
		id,
		(state) => state.constraints.hasError ?? false,
	);
	const image = useFreezeFrameSelector(id, (state) => state.internal.image);
	const videoRotation = useFreezeFrameSelector(
		id,
		(state) => state.internal.videoRotation,
	);

	if (isLoading) {
		return null;
	}

	if (hasError) {
		return null;
	}

	if (!image || width <= 0 || height <= 0) {
		return null;
	}

	const sourceWidth = Math.max(1, image.width());
	const sourceHeight = Math.max(1, image.height());
	const imageTransform = resolveVideoImageTransform({
		src: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
		dst: { x: 0, y: 0, width, height },
		rotation: videoRotation,
	});

	return (
		<Group transform={imageTransform}>
			<Image
				image={image}
				x={0}
				y={0}
				width={sourceWidth}
				height={sourceHeight}
				fit="fill"
			/>
		</Group>
	);
};

export default FreezeFrameRenderer;
