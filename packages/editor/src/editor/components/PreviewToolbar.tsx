import { EllipsisIcon } from "lucide-react";
import type React from "react";
import { memo, useCallback, useMemo, useState } from "react";
import type { CanvasRef } from "react-skia-lite";
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
import {
	usePlaybackControl,
	useTimelineStore,
} from "@/editor/contexts/TimelineContext";
import { framesToTimecode } from "@/utils/timecode";
import PreviewLoudnessMeterCanvas from "./PreviewLoudnessMeterCanvas";

export interface PreviewToolbarProps {
	effectiveZoomLevel: number;
	onZoomChange: (value: number) => void;
	onResetView: () => void;
	canvasRef: React.RefObject<CanvasRef | null>;
}

const PreviewToolbarComponent: React.FC<PreviewToolbarProps> = ({
	effectiveZoomLevel,
	onZoomChange,
	onResetView,
	canvasRef,
}) => {
	const { isPlaying, togglePlay } = usePlaybackControl();
	const currentTime = useTimelineStore((state) => state.currentTime);
	const previewTime = useTimelineStore((state) => state.previewTime);
	const fps = useTimelineStore((state) => state.fps);
	const [isExportingFrame, setIsExportingFrame] = useState(false);

	const handleExportFrame = useCallback(async () => {
		if (isExportingFrame) return;
		setIsExportingFrame(true);
		try {
			await exportCanvasAsImage(canvasRef.current, {
				format: "png",
				waitForReady: true,
			});
		} finally {
			setIsExportingFrame(false);
		}
	}, [canvasRef, isExportingFrame]);

	const displayTime = previewTime ?? currentTime;
	const previewTimecode = useMemo(() => {
		return framesToTimecode(displayTime, fps);
	}, [displayTime, fps]);
	const previewTimecodeMuted = previewTimecode.slice(0, 4);
	const previewTimecodeStrong = previewTimecode.slice(4);

	return (
		<div
			data-testid="preview-toolbar"
			className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/60 px-1.5 py-1.5 rounded-full backdrop-blur-md ring-1 ring-white/10"
		>
			<Tooltip>
				<TooltipTrigger
					type="button"
					aria-label="播放 / 暂停"
					data-testid="preview-play-toggle"
					onClick={togglePlay}
					className="size-8 -mr-2 rounded-full bg-transparent p-0 text-md text-white hover:bg-white/10 data-popup-open:bg-white/15"
				>
					{isPlaying ? "⏸" : "▶"}
				</TooltipTrigger>
				<TooltipContent>播放 / 暂停</TooltipContent>
			</Tooltip>
			<div
				data-testid="preview-toolbar-timecode"
				className="text-md text-white font-mono font-medium tracking-tight"
			>
				<span className="text-neutral-400">{previewTimecodeMuted}</span>
				<span>{previewTimecodeStrong}</span>
			</div>
			<PreviewLoudnessMeterCanvas />

			<DropdownMenu>
				<DropdownMenuTrigger
					chevron={null}
					className="border-none rounded-full bg-transparent size-8 -ml-2 p-0 text-xs text-white hover:bg-white/10 data-popup-open:bg-white/15"
				>
					<EllipsisIcon className="size-4" />
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="center"
					side="top"
					className="min-w-[240px]"
				>
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
								onZoomChange(nextValue);
							}}
							className="w-full py-2"
						/>
					</div>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={onResetView}>
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
	);
};

const PreviewToolbar = memo(PreviewToolbarComponent);

export default PreviewToolbar;
