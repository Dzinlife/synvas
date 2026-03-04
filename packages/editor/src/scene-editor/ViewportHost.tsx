import type React from "react";
import CanvasWorkspace from "@/studio/canvas/CanvasWorkspace";

const ViewportHost: React.FC = () => {
	return (
		<div className="relative flex flex-1 min-h-0 bg-neutral-900">
			<CanvasWorkspace />
		</div>
	);
};

export default ViewportHost;
