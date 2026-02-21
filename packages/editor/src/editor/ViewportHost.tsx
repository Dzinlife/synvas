import type React from "react";
import CanvasWorkspace from "@/studio/canvas/CanvasWorkspace";
import { useStudioStore } from "@/studio/studioStore";
import EditorSidebars from "./components/EditorSidebars";
import PreviewControlBar from "./components/PreviewControlBar";
import PreviewEditor from "./PreviewEditor";
import TimelineEditor from "./TimelineEditor";

interface ViewportHostProps {
	timelineMaxHeight: number;
	onResizeMouseDown: (event: React.MouseEvent) => void;
}

const ViewportHost: React.FC<ViewportHostProps> = ({
	timelineMaxHeight,
	onResizeMouseDown,
}) => {
	const activeMainView = useStudioStore((state) => state.activeMainView);

	return (
		<div className="relative flex flex-col flex-1 min-h-0">
			<div className="relative flex-1 min-h-0 bg-neutral-900">
				<div
					data-main-view-preview
					data-active={activeMainView === "preview" ? "true" : "false"}
					className={`absolute inset-0 ${
						activeMainView === "preview"
							? "pointer-events-auto opacity-100"
							: "pointer-events-none opacity-0"
					}`}
				>
					<PreviewEditor />
				</div>
				<div
					data-main-view-canvas
					data-active={activeMainView === "canvas" ? "true" : "false"}
					className={`absolute inset-0 ${
						activeMainView === "canvas"
							? "pointer-events-auto opacity-100"
							: "pointer-events-none opacity-0"
					}`}
				>
					<CanvasWorkspace />
				</div>
				<EditorSidebars />
				<PreviewControlBar />
			</div>
			<div className="h-0 relative z-100">
				<button
					type="button"
					aria-label="调整时间线高度"
					className="absolute -bottom-2 z-50 h-4 w-full cursor-ns-resize shrink-0 group"
					onMouseDown={onResizeMouseDown}
				>
					<div className="absolute bottom-2 w-full h-1 bg-transparent group-hover:bg-white/30 group-active:bg-white/70 transition-colors"></div>
				</button>
			</div>
			<div
				className="min-h-60 flex flex-col border-t border-neutral-700"
				style={{ height: timelineMaxHeight }}
			>
				<TimelineEditor />
			</div>
		</div>
	);
};

export default ViewportHost;
