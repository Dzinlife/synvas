import type { TextCanvasNode } from "core/studio/types";
import type { CanvasNodeToolbarProps } from "../types";

export const TextNodeToolbar = ({
	node,
	updateNode,
}: CanvasNodeToolbarProps<TextCanvasNode>) => {
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
