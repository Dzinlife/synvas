import { EllipsisIcon } from "lucide-react";
import { LayoutGroup, motion, Transition } from "motion/react";
import type React from "react";
import { memo, useCallback, useMemo, useState } from "react";
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
import { usePreview } from "@/editor/contexts/PreviewProvider";
import {
	usePlaybackControl,
	useTimelineStore,
} from "@/editor/contexts/TimelineContext";
import { cn } from "@/lib/utils";
import { useStudioStore } from "@/studio/studioStore";
import { framesToTimecode } from "@/utils/timecode";
import PreviewLoudnessMeterCanvas from "./PreviewLoudnessMeterCanvas";

const BAR_LAYOUT_TRANSITION: Transition = {
	type: "spring",
	stiffness: 380,
	damping: 32,
	mass: 0.75,
};

const BAR_PRESENCE_TRANSITION: Transition = {
	type: "spring",
	stiffness: 420,
	damping: 34,
	mass: 0.72,
};

const PreviewControlBarComponent: React.FC = () => {
	const { isPlaying, togglePlay } = usePlaybackControl();
	const currentTime = useTimelineStore((state) => state.currentTime);
	const previewTime = useTimelineStore((state) => state.previewTime);
	const fps = useTimelineStore((state) => state.fps);
	const {
		canvasRef,
		pinchState,
		zoomLevel,
		setZoomLevel,
		resetPanOffset,
		fitZoomLevel,
	} = usePreview();
	const [isExportingFrame, setIsExportingFrame] = useState(false);
	const activeMainView = useStudioStore((state) => state.activeMainView);
	const setActiveMainView = useStudioStore((state) => state.setActiveMainView);
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
		if (activeMainView !== "preview") return;
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
	}, [activeMainView, canvasRef, isExportingFrame]);

	const displayTime = previewTime ?? currentTime;
	const previewTimecode = useMemo(() => {
		return framesToTimecode(displayTime, fps);
	}, [displayTime, fps]);
	const previewTimecodeMuted = previewTimecode.slice(0, 4);
	const previewTimecodeStrong = previewTimecode.slice(4);

	return (
		<LayoutGroup>
			<motion.div
				layout
				className="absolute flex items-center justify-center w-full gap-3 bottom-4 pointer-events-none"
				transition={BAR_LAYOUT_TRANSITION}
			>
				<motion.div
					layout
					layoutId="main-view-panel"
					data-testid={
						activeMainView === "preview" ? "preview-control-bar" : undefined
					}
					className={cn(
						"pointer-events-auto bg-black/60 backdrop-blur-md ring-1 ring-white/10",
						activeMainView === "preview"
							? "flex items-center gap-3 px-1.5 py-1.5 rounded-full"
							: "w-18 h-11 rounded-md flex items-center justify-center text-xs",
					)}
					transition={BAR_PRESENCE_TRANSITION}
				>
					{activeMainView === "preview" ? (
						<>
							<Tooltip>
								<TooltipTrigger
									type="button"
									aria-label="播放 / 暂停"
									data-testid="preview-control-play-toggle"
									onClick={togglePlay}
									className="size-8 -mr-2 rounded-full bg-transparent p-0 text-md text-white hover:bg-white/10 data-popup-open:bg-white/15"
								>
									{isPlaying ? "⏸" : "▶"}
								</TooltipTrigger>
								<TooltipContent>播放 / 暂停</TooltipContent>
							</Tooltip>
							<div
								data-testid="preview-control-bar-timecode"
								className="text-md text-white font-mono font-medium tracking-tight"
							>
								<span className="text-neutral-400">{previewTimecodeMuted}</span>
								<span>{previewTimecodeStrong}</span>
							</div>
							<PreviewLoudnessMeterCanvas />
							{/* <div
								className="flex items-center rounded-full border border-white/10 bg-black/40 p-0.5"
								role="group"
								aria-label="主视图切换"
							>
								<button
									type="button"
									className={`rounded-full px-2 py-1 text-[11px] transition-colors ${
										activeMainView === "preview"
											? "bg-white/20 text-white"
											: "text-neutral-300 hover:text-white"
									}`}
									onClick={() => {
										setActiveMainView("preview");
									}}
								>
									Preview
								</button>
								<button
									type="button"
									className={`rounded-full px-2 py-1 text-[11px] transition-colors ${
										activeMainView === "canvas"
											? "bg-white/20 text-white"
											: "text-neutral-300 hover:text-white"
									}`}
									onClick={() => {
										setActiveMainView("canvas");
									}}
								>
									Canvas
								</button>
							</div> */}
							<DropdownMenu>
								<DropdownMenuTrigger
									chevron={false}
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
												const nextValue = Array.isArray(value)
													? value[0]
													: value;
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
										disabled={isExportingFrame || activeMainView !== "preview"}
									>
										{isExportingFrame
											? "导出中..."
											: activeMainView === "preview"
												? "导出静帧画面"
												: "Canvas 模式不可导出"}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</>
					) : (
						<button
							type="button"
							className="w-full h-full"
							onClick={() => {
								setActiveMainView("preview");
							}}
						>
							Preview
						</button>
					)}
				</motion.div>
				<motion.div
					layout
					transition={BAR_LAYOUT_TRANSITION}
					className="flex pointer-events-auto items-center gap-3 bg-black/60 px-1.5 py-1.5 rounded-full backdrop-blur-md ring-1 ring-white/10"
				>
					<button
						type="button"
						className={`h-8 rounded-full px-2 py-1 text-[11px] transition-colors ${
							activeMainView === "canvas"
								? "bg-white/20 text-white"
								: "text-neutral-300 hover:text-white"
						}`}
						onClick={() => {
							setActiveMainView("canvas");
						}}
					>
						Storyboard
					</button>
					{activeMainView === "canvas" ? (
						<motion.div layout transition={BAR_PRESENCE_TRANSITION}>
							<DropdownMenu>
								<DropdownMenuTrigger
									chevron={false}
									className="border-none rounded-full bg-transparent size-8 -ml-2 p-0 text-xs text-white hover:bg-white/10 data-popup-open:bg-white/15"
								>
									<EllipsisIcon className="size-4" />
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="center"
									side="top"
									className="min-w-[240px]"
								>
									<DropdownMenuItem>test</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem>test</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</motion.div>
					) : null}
				</motion.div>
			</motion.div>
		</LayoutGroup>
	);
};

const PreviewControlBar = memo(PreviewControlBarComponent);

export default PreviewControlBar;
