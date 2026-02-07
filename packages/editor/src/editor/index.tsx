import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranscriptStore } from "@/asr/transcriptStore";
import { Toaster } from "@/components/ui/toast";
import { ModelManager } from "@/dsl/model";
import { useProjectStore } from "@/projects/projectStore";
import EditorSidebars from "./components/EditorSidebars";
import PreviewProvider from "./contexts/PreviewProvider";
import { TimelineProvider } from "./contexts/TimelineContext";
import PreviewEditor from "./PreviewEditor";
import TimelineEditor from "./TimelineEditor";

// 导入所有组件以触发注册
import "@/dsl/BackdropZoom";
import "@/dsl/AudioClip";
import "@/dsl/VideoClip";
import "@/dsl/CloudBackground";
import "@/dsl/ColorFilterLayer";
import "@/dsl/HalationFilterLayer";
import "@/dsl/Image";
import "@/dsl/Lottie";
import "@/dsl/SeaWave";
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
	// Timeline 高度状态和拖拽逻辑
	const [timelineMaxHeight, setTimelineMaxHeight] = useState(300);
	const isDraggingRef = useRef(false);
	const startYRef = useRef(0);
	const startHeightRef = useRef(0);

	const handleResizeMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			isDraggingRef.current = true;
			startYRef.current = e.clientY;
			startHeightRef.current = timelineMaxHeight;

			const handleMouseMove = (e: MouseEvent) => {
				if (!isDraggingRef.current) return;
				const delta = startYRef.current - e.clientY;
				const newHeight = Math.max(
					100,
					Math.min(600, startHeightRef.current + delta),
				);
				setTimelineMaxHeight(newHeight);
			};

			const handleMouseUp = () => {
				isDraggingRef.current = false;
				document.removeEventListener("mousemove", handleMouseMove);
				document.removeEventListener("mouseup", handleMouseUp);
			};

			document.addEventListener("mousemove", handleMouseMove);
			document.addEventListener("mouseup", handleMouseUp);
		},
		[timelineMaxHeight],
	);

	return (
		<div className="relative flex flex-col flex-1 min-h-0">
			<div className="relative flex-1 min-h-0 bg-neutral-900">
				<PreviewEditor />
				<EditorSidebars />
			</div>
			<div
				className="min-h-60 flex flex-col border-t border-neutral-700"
				style={{ height: timelineMaxHeight }}
			>
				{/* 拖拽手柄 */}
				<button
					type="button"
					aria-label="调整时间线高度"
					className="h-1.5 cursor-ns-resize bg-neutral-700 hover:bg-neutral-600 active:bg-blue-500 transition-colors shrink-0"
					onMouseDown={handleResizeMouseDown}
				/>
				<TimelineEditor />
			</div>
		</div>
	);
};

const Editor = () => {
	const status = useProjectStore((state) => state.status);
	const currentProjectData = useProjectStore(
		(state) => state.currentProjectData,
	);
	const initialize = useProjectStore((state) => state.initialize);
	const setTranscripts = useTranscriptStore((state) => state.setTranscripts);

	useEffect(() => {
		initialize();
	}, [initialize]);

	useEffect(() => {
		if (!currentProjectData) return;
		// 同步项目转写数据到转写 store
		setTranscripts(currentProjectData.transcripts ?? []);
	}, [currentProjectData, setTranscripts]);

	const queryClient = new QueryClient();

	if (status !== "ready" || !currentProjectData) {
		return <div>Loading timeline...</div>;
	}

	return (
		<QueryClientProvider client={queryClient}>
			<Toaster />
			<TimelineProvider
				elements={currentProjectData.elements}
				tracks={currentProjectData.tracks}
				canvasSize={currentProjectData.canvas}
				fps={currentProjectData.fps}
				settings={currentProjectData.settings}
			>
				<ModelManager>
					<PreviewProvider>
						<EditorContent />
					</PreviewProvider>
				</ModelManager>
			</TimelineProvider>
		</QueryClientProvider>
	);
};

export default Editor;
