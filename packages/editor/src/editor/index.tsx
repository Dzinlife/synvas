import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useEffect, useMemo } from "react";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ModelManager } from "@/dsl/model";
import { useProjectStore } from "@/projects/projectStore";
import { useSceneSessionBridge } from "@/studio/scene/useSceneSessionBridge";
import { useStudioHotkeys } from "@/studio/useStudioHotkeys";
import PreviewProvider from "./contexts/PreviewProvider";
import { TimelineProvider } from "./contexts/TimelineContext";
import ViewportHost from "./ViewportHost";

// 导入所有组件以触发注册
import "@/dsl/AudioClip";
import "@/dsl/VideoClip";
import "@/dsl/ColorFilterLayer";
import "@/dsl/FreezeFrame";
import "@/dsl/HalationFilterLayer";
import "@/dsl/Image";
import "@/dsl/Lottie";
import "@/dsl/Transition";
import "@/dsl/PixelShaderTransition";
import "@/dsl/RippleDissolveTransition";

// 调试：检查组件注册情况
import { componentRegistry } from "@/dsl/model/componentRegistry";

console.log(
	"[Editor] Registered components:",
	componentRegistry.getComponentIds(),
);

// 内部编辑器内容组件（可以使用 hooks）
const EditorContent: React.FC = () => {
	useSceneSessionBridge();
	useStudioHotkeys();
	return <ViewportHost />;
};

const Editor = () => {
	const status = useProjectStore((state) => state.status);
	const currentProjectData = useProjectStore(
		(state) => state.currentProjectData,
	);
	const initialize = useProjectStore((state) => state.initialize);

	useEffect(() => {
		initialize();
	}, [initialize]);

	const queryClient = useMemo(() => new QueryClient(), []);

	if (status !== "ready" || !currentProjectData) {
		return <div>Loading timeline...</div>;
	}

	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<Toaster />
				<TimelineProvider>
					<ModelManager>
						<PreviewProvider>
							<EditorContent />
						</PreviewProvider>
					</ModelManager>
				</TimelineProvider>
			</TooltipProvider>
		</QueryClientProvider>
	);
};

export default Editor;
