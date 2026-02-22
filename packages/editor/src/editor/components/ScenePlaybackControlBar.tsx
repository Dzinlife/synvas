import { resolveTimelineEndFrame } from "core/editor/utils/timelineEndFrame";
import { EllipsisIcon, X } from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { exportCanvasAsImage } from "@/dsl/export";
import { exportTimelineAsVideo } from "@/editor/exportVideo";
import { usePreview } from "@/editor/contexts/PreviewProvider";
import {
	usePlaybackControl,
	useTimelineStore,
} from "@/editor/contexts/TimelineContext";
import { useEditorRuntime } from "@/editor/runtime/EditorRuntimeProvider";
import { framesToTimecode } from "@/utils/timecode";
import ExportVideoDialog from "./ExportVideoDialog";
import PreviewLoudnessMeterCanvas from "./PreviewLoudnessMeterCanvas";

interface ScenePlaybackControlBarProps {
	onExitFocus: () => void;
}

const ScenePlaybackControlBar: React.FC<ScenePlaybackControlBarProps> = ({
	onExitFocus,
}) => {
	const runtime = useEditorRuntime();
	const { isPlaying, togglePlay } = usePlaybackControl();
	const currentTime = useTimelineStore((state) => state.currentTime);
	const previewTime = useTimelineStore((state) => state.previewTime);
	const fps = useTimelineStore((state) => state.fps);
	const elements = useTimelineStore((state) => state.elements);
	const canvasSize = useTimelineStore((state) => state.canvasSize);
	const {
		canvasRef,
		pinchState,
		zoomLevel,
		setZoomLevel,
		resetPanOffset,
		fitZoomLevel,
	} = usePreview();
	const [isExportingFrame, setIsExportingFrame] = useState(false);
	const effectiveZoomLevel = pinchState.isPinching
		? pinchState.currentZoom
		: zoomLevel;

	const handleZoomChange = useCallback(
		(nextZoom: number) => {
			if (!Number.isFinite(nextZoom)) return;
			setZoomLevel(nextZoom);
		},
		[setZoomLevel],
	);

	const handleResetView = useCallback(() => {
		resetPanOffset();
		setZoomLevel(fitZoomLevel);
	}, [fitZoomLevel, resetPanOffset, setZoomLevel]);

	const handleExportFrame = useCallback(async () => {
		if (isExportingFrame) return;
		setIsExportingFrame(true);
		try {
			await exportCanvasAsImage(canvasRef.current, {
				format: "png",
				waitForReady: true,
				runtime,
			});
		} finally {
			setIsExportingFrame(false);
		}
	}, [canvasRef, isExportingFrame, runtime]);
	const handleExportVideo = useCallback(
		async (options: {
			filename: string;
			fps: number;
			startFrame: number;
			endFrame: number;
			signal: AbortSignal;
			onFrame?: (frame: number) => void;
		}) => {
			await exportTimelineAsVideo({
				...options,
				runtime,
			});
		},
		[runtime],
	);

	const displayTime = previewTime ?? currentTime;
	const timelineEndFrame = useMemo(
		() => resolveTimelineEndFrame(elements),
		[elements],
	);
	const previewTimecode = useMemo(() => {
		return framesToTimecode(displayTime, fps);
	}, [displayTime, fps]);

	return (
		<div className="flex items-center justify-between gap-3 border-b border-neutral-800 bg-black/55 px-3 py-2 backdrop-blur-md">
			<div className="flex items-center gap-3">
				<Tooltip>
					<TooltipTrigger
						type="button"
						aria-label="退出 Scene"
						onClick={onExitFocus}
						className="size-8 rounded-full bg-transparent p-0 text-md text-white hover:bg-white/10"
					>
						<X className="mx-auto size-4" />
					</TooltipTrigger>
					<TooltipContent>退出 Scene</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger
						type="button"
						aria-label="播放 / 暂停"
						onClick={togglePlay}
						className="size-8 rounded-full bg-transparent p-0 text-md text-white hover:bg-white/10"
					>
						{isPlaying ? "⏸" : "▶"}
					</TooltipTrigger>
					<TooltipContent>播放 / 暂停</TooltipContent>
				</Tooltip>
				<div className="text-md text-white font-mono font-medium tracking-tight">
					{previewTimecode}
				</div>
				<PreviewLoudnessMeterCanvas />
			</div>
			<div className="flex items-center gap-2">
				<ExportVideoDialog
					defaultFps={fps}
					timelineEndFrame={timelineEndFrame}
					canvasSize={canvasSize}
					onExport={handleExportVideo}
					triggerClassName="h-8 px-2 py-1 text-xs"
				/>
				<DropdownMenu>
					<DropdownMenuTrigger
						chevron={false}
						className="border-none rounded-full bg-transparent size-8 p-0 text-xs text-white hover:bg-white/10"
					>
						<EllipsisIcon className="size-4" />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" side="bottom" className="min-w-[240px]">
						<div className="px-4 py-2.5">
							<div className="mb-2 flex items-center justify-between text-xs text-gray-600">
								<span>缩放</span>
								<span>{Math.round(effectiveZoomLevel * 100)}%</span>
							</div>
							<Slider
								min={0.1}
								max={2}
								step={0.001}
								value={[effectiveZoomLevel]}
								onValueChange={(value) => {
									const nextValue = Array.isArray(value) ? value[0] : value;
									if (!Number.isFinite(nextValue)) return;
									handleZoomChange(nextValue);
								}}
								className="w-full py-2"
							/>
						</div>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={handleResetView}>
							重置视图位置（适应窗口）
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => {
								void handleExportFrame();
							}}
							disabled={isExportingFrame}
						>
							{isExportingFrame ? "导出中..." : "导出静帧画面"}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
};

export default ScenePlaybackControlBar;
