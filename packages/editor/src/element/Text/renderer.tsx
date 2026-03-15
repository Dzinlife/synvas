import { Paragraph } from "react-skia-lite";
import { useTimelineStore } from "@/scene-editor/contexts/TimelineContext";
import { createModelSelector } from "../model/registry";
import type { TextInternal, TextProps } from "./model";

interface TextRendererProps extends TextProps {
	id: string;
}

const useTextSelector = createModelSelector<TextProps, TextInternal>();

const TextRenderer: React.FC<TextRendererProps> = ({ id }) => {
	const paragraph = useTextSelector(id, (state) => state.internal.paragraph);
	const width = useTimelineStore((state) => {
		return Math.max(
			1,
			state.getElementById(id)?.transform?.baseSize.width ?? 1,
		);
	});

	if (!paragraph) return null;

	return <Paragraph paragraph={paragraph} x={0} y={0} width={width} />;
};

export default TextRenderer;
