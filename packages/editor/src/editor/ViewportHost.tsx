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
			<div
				className="min-h-60 flex flex-col border-t border-neutral-700"
				style={{ height: timelineMaxHeight }}
			>
				<button
					type="button"
					aria-label="调整时间线高度"
					className="h-1.5 cursor-ns-resize bg-neutral-700 hover:bg-neutral-600 active:bg-blue-500 transition-colors shrink-0"
					onMouseDown={onResizeMouseDown}
				/>
				<TimelineEditor />
			</div>
		</div>
	);
};

export default ViewportHost;
