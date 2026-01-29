import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ModelManager } from "@/dsl/model";
import { TimelineElement } from "@/dsl/types";
import EditorSidebars from "./components/EditorSidebars";
import PreviewProvider from "./contexts/PreviewProvider";
import { TimelineProvider } from "./contexts/TimelineContext";
import PreviewEditor from "./PreviewEditor";
import TimelineEditor from "./TimelineEditor";
import type { TimelineTrack } from "./timeline/types";
import timelineData from "./timeline.json";
import { loadTimelineFromObject, type TimelineSettings } from "./timelineLoader";

// 导入所有组件以触发注册
import "@/dsl/BackdropZoom";
import "@/dsl/VideoClip";
import "@/dsl/CloudBackground";
import "@/dsl/ColorFilterLayer";
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
				<div
					className="h-1.5 cursor-ns-resize bg-neutral-700 hover:bg-neutral-600 active:bg-blue-500 transition-colors shrink-0"
					onMouseDown={handleResizeMouseDown}
				/>
				<TimelineEditor />
			</div>
		</div>
	);
};

const Editor = () => {
	const [elements, setElements] = useState<TimelineElement[]>([]);
	const [tracks, setTracks] = useState<TimelineTrack[]>([]);
	const [timelineFps, setTimelineFps] = useState(30);
	const [canvasSize, setCanvasSize] = useState({ width: 1920, height: 1080 });
	const [timelineSettings, setTimelineSettings] =
		useState<TimelineSettings | null>(null);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		try {
			const loaded = loadTimelineFromObject(timelineData as any);
			setElements(loaded.elements);
			setTracks(loaded.tracks);
			setTimelineFps(loaded.fps);
			setCanvasSize(loaded.canvas);
			setTimelineSettings(loaded.settings);
		} catch (error) {
			console.error("Failed to load timeline:", error);
		} finally {
			setIsLoading(false);
		}
	}, []);

	const queryClient = new QueryClient();

	if (isLoading) {
		return <div>Loading timeline...</div>;
	}

	return (
		<QueryClientProvider client={queryClient}>
			<Toaster />
			<TimelineProvider
				elements={elements}
				tracks={tracks}
				canvasSize={canvasSize}
				fps={timelineFps}
				settings={timelineSettings ?? undefined}
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
