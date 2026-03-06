import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ModelManager } from "@/element/model";
import { useProjectStore } from "@/projects/projectStore";
import { useSceneSessionBridge } from "@/studio/scene/useSceneSessionBridge";
import { useTimelineRuntimeRegistryBridge } from "@/studio/scene/useTimelineRuntimeRegistryBridge";
import { useStudioHotkeys } from "@/studio/useStudioHotkeys";
import PreviewProvider from "./contexts/PreviewProvider";
import { TimelineProvider } from "./contexts/TimelineContext";
import { createScopedStudioRuntime } from "./runtime/createScopedStudioRuntime";
import {
	EditorRuntimeProvider,
	useEditorRuntime,
} from "./runtime/EditorRuntimeProvider";
import type { EditorRuntime, StudioRuntimeManager } from "./runtime/types";
import ViewportHost from "./ViewportHost";

// 导入所有组件以触发注册
import "@/element/AudioClip";
import "@/element/Composition";
import "@/element/VideoClip";
import "@/element/ColorFilterLayer";
import "@/element/FreezeFrame";
import "@/element/HalationFilterLayer";
import "@/element/Image";
import "@/element/Lottie";
import "@/element/Transition";
import "@/element/PixelShaderTransition";
import "@/element/RippleDissolveTransition";

// 调试：检查组件注册情况
import { componentRegistry } from "@/element/model/componentRegistry";

console.log(
	"[Editor] Registered components:",
	componentRegistry.getComponentIds(),
);

// 内部编辑器内容组件（可以使用 hooks）
const EditorContent: React.FC = () => {
	useTimelineRuntimeRegistryBridge();
	useSceneSessionBridge();
	useStudioHotkeys();
	return <ViewportHost />;
};

const Editor = () => {
	const runtimeManager = useEditorRuntime() as EditorRuntime &
		StudioRuntimeManager;
	const status = useProjectStore((state) => state.status);
	const hasProject = useProjectStore((state) => state.currentProject !== null);
	const activeSceneId = useProjectStore(
		(state) => state.currentProject?.ui.activeSceneId ?? null,
	);
	const initialize = useProjectStore((state) => state.initialize);
	const activeSceneIdRef = useRef<string | null>(activeSceneId);
	activeSceneIdRef.current = activeSceneId;

	useEffect(() => {
		initialize();
	}, [initialize]);

	const queryClient = useMemo(() => new QueryClient(), []);
	const scopedRuntime = useMemo(
		() =>
			createScopedStudioRuntime({
				runtimeManager,
				activeSceneId: () => activeSceneIdRef.current,
			}),
		[runtimeManager],
	);

	if (status !== "ready" || !hasProject) {
		return <div>Loading timeline...</div>;
	}

	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<Toaster />
				<EditorRuntimeProvider runtime={scopedRuntime}>
					<TimelineProvider>
						<ModelManager>
							<PreviewProvider>
								<EditorContent />
							</PreviewProvider>
						</ModelManager>
					</TimelineProvider>
				</EditorRuntimeProvider>
			</TooltipProvider>
		</QueryClientProvider>
	);
};

export default Editor;
