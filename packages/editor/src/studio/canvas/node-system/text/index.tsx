import type { TextCanvasNode } from "core/studio/types";
import { Rect } from "react-skia-lite";
import { registerCanvasNodeDefinition } from "../registryCore";
import type {
	CanvasNodeDefinition,
	CanvasNodeSkiaRenderProps,
	CanvasNodeToolbarProps,
} from "../types";

const TextNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<TextCanvasNode>
> = ({ node }) => {
	if (node.type !== "text") return null;
	return (
		<Rect
			x={0}
			y={0}
			width={Math.max(1, node.width)}
			height={Math.max(1, node.height)}
			color="#451a03"
		/>
	);
};

const TextNodeToolbar = ({ node, updateNode }: CanvasNodeToolbarProps<TextCanvasNode>) => {
	if (node.type !== "text") return null;
	return (
		<div className="flex items-center gap-3 text-xs text-white/90">
			<input
				type="text"
				className="h-8 min-w-56 rounded border border-white/20 bg-black/20 px-2 text-xs"
				value={node.text}
				onChange={(event) => {
					updateNode({ text: event.target.value });
				}}
			/>
			<input
				type="number"
				min={12}
				max={144}
				className="h-8 w-20 rounded border border-white/20 bg-black/20 px-2 text-xs"
				value={node.fontSize}
				onChange={(event) => {
					const nextValue = Number(event.target.value);
					if (!Number.isFinite(nextValue)) return;
					updateNode({ fontSize: Math.max(12, Math.min(144, nextValue)) });
				}}
			/>
		</div>
	);
};

const textDefinition: CanvasNodeDefinition<TextCanvasNode> = {
	type: "text",
	title: "Text",
	create: () => ({ type: "text", text: "新建文本", name: "Text" }),
	skiaRenderer: TextNodeSkiaRenderer,
	toolbar: TextNodeToolbar,
};

registerCanvasNodeDefinition(textDefinition);
