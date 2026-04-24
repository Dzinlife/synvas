import type { BoardCanvasNode } from "@/studio/project/types";
import type { CanvasNodeToolbarProps } from "../types";

export const BoardNodeToolbar = ({
	node,
	onBoardLayoutModeChange,
}: CanvasNodeToolbarProps<BoardCanvasNode>) => {
	if (node.type !== "board") return null;
	const layoutMode = node.layoutMode === "auto" ? "auto" : "free";
	return (
		<div className="flex items-center gap-1 text-xs text-white/90">
			<button
				type="button"
				aria-pressed={layoutMode === "free"}
				className={`rounded px-2 py-1 transition ${
					layoutMode === "free"
						? "bg-white/20 text-white"
						: "bg-white/5 text-white/65 hover:bg-white/10"
				}`}
				onClick={() => {
					onBoardLayoutModeChange?.(node.id, "free");
				}}
			>
				Free
			</button>
			<button
				type="button"
				aria-pressed={layoutMode === "auto"}
				className={`rounded px-2 py-1 transition ${
					layoutMode === "auto"
						? "bg-white/20 text-white"
						: "bg-white/5 text-white/65 hover:bg-white/10"
				}`}
				onClick={() => {
					onBoardLayoutModeChange?.(node.id, "auto");
				}}
			>
				Auto
			</button>
		</div>
	);
};
