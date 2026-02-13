import { Group, ImageShader, Rect } from "react-skia-lite";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
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
	const transform = useTimelineStore(
		(state) => state.getElementById(id)?.transform,
	);
	const width = transform?.baseSize.width ?? 0;
	const height = transform?.baseSize.height ?? 0;

	const isLoading = useFreezeFrameSelector(
		id,
		(state) => state.constraints.isLoading ?? false,
	);
	const hasError = useFreezeFrameSelector(
		id,
		(state) => state.constraints.hasError ?? false,
	);
	const image = useFreezeFrameSelector(id, (state) => state.internal.image);

	if (isLoading) {
		return (
			<Group>
				<Rect x={0} y={0} width={width} height={height} color="#e5e7eb" />
			</Group>
		);
	}

	if (hasError) {
		return (
			<Group>
				<Rect x={0} y={0} width={width} height={height} color="#fee2e2" />
			</Group>
		);
	}

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

export default FreezeFrameRenderer;
