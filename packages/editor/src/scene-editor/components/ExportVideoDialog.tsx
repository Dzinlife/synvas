import { useCallback, useEffect, useMemo, useState } from "react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Progress,
	ProgressIndicator,
	ProgressTrack,
	ProgressValue,
} from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { VideoIcon } from "lucide-react";

type ExportVideoOptions = {
	filename: string;
	fps: number;
	startFrame: number;
	endFrame: number;
	signal: AbortSignal;
	onFrame?: (frame: number) => void;
};

type ExportVideoDialogProps = {
	disabled?: boolean;
	defaultFps: number;
	timelineEndFrame: number;
	canvasSize: { width: number; height: number };
	onExport: (options: ExportVideoOptions) => Promise<void>;
	onExportingChange?: (isExporting: boolean) => void;
	triggerClassName?: string;
};

type ExportDialogStatus = "idle" | "running" | "error";

type ParsedExportForm = {
	filename: string;
	fps: number;
	startFrame: number;
	endFrame: number;
	totalFrames: number;
};

const createDefaultFilename = (): string => {
	return `timeline-${Date.now()}.mp4`;
};

const isAbortError = (error: unknown): boolean => {
	if (error instanceof DOMException) {
		return error.name === "AbortError";
	}
	return error instanceof Error && error.name === "AbortError";
};

const ensureMp4Filename = (filename: string): string => {
	if (filename.toLowerCase().endsWith(".mp4")) return filename;
	return `${filename}.mp4`;
};

const parseIntegerInput = (value: string): number | null => {
	if (value.trim() === "") return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return null;
	if (!Number.isInteger(parsed)) return null;
	return parsed;
};

const clamp = (value: number, min: number, max: number): number => {
	return Math.min(max, Math.max(min, value));
};

const ExportVideoDialog = ({
	disabled = false,
	defaultFps,
	timelineEndFrame,
	canvasSize,
	onExport,
	onExportingChange,
	triggerClassName,
}: ExportVideoDialogProps) => {
	const [open, setOpen] = useState(false);
	const [status, setStatus] = useState<ExportDialogStatus>("idle");
	const [filenameInput, setFilenameInput] = useState(createDefaultFilename);
	const [fpsInput, setFpsInput] = useState(() => String(defaultFps));
	const [startFrameInput, setStartFrameInput] = useState("0");
	const [endFrameInput, setEndFrameInput] = useState(() =>
		String(timelineEndFrame),
	);
	const [error, setError] = useState<string | null>(null);
	const [progress, setProgress] = useState(0);
	const [currentFrame, setCurrentFrame] = useState(0);
	const [activeTotalFrames, setActiveTotalFrames] = useState(0);
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);

	const isRunning = status === "running";

	useEffect(() => {
		onExportingChange?.(isRunning);
	}, [isRunning, onExportingChange]);

	const resetForm = useCallback(() => {
		setFilenameInput(createDefaultFilename());
		setFpsInput(String(defaultFps));
		setStartFrameInput("0");
		setEndFrameInput(String(timelineEndFrame));
	}, [defaultFps, timelineEndFrame]);

	const resetRuntime = useCallback(() => {
		setStatus("idle");
		setError(null);
		setProgress(0);
		setCurrentFrame(0);
		setActiveTotalFrames(0);
		setAbortController(null);
	}, []);

	const metadata = useMemo(() => {
		const parsedFps = parseIntegerInput(fpsInput);
		const parsedStart = parseIntegerInput(startFrameInput);
		const parsedEnd = parseIntegerInput(endFrameInput);
		const fps = clamp(parsedFps ?? defaultFps, 1, 120);
		const startFrame = Math.max(0, parsedStart ?? 0);
		const endFrame = clamp(parsedEnd ?? timelineEndFrame, 0, timelineEndFrame);
		const frameCount = Math.max(0, endFrame - startFrame);
		const durationSeconds = frameCount / fps;
		return {
			fps,
			frameCount,
			durationSeconds,
		};
	}, [defaultFps, endFrameInput, fpsInput, startFrameInput, timelineEndFrame]);

	const validateForm = useCallback((): ParsedExportForm | null => {
		const rawFilename = filenameInput.trim();
		if (rawFilename.length === 0) {
			setError("文件名不能为空");
			return null;
		}

		const fps = parseIntegerInput(fpsInput);
		if (fps === null || fps < 1 || fps > 120) {
			setError("FPS 必须是 1-120 的整数");
			return null;
		}

		const startFrame = parseIntegerInput(startFrameInput);
		if (startFrame === null || startFrame < 0) {
			setError("开始帧必须是大于等于 0 的整数");
			return null;
		}

		const endFrame = parseIntegerInput(endFrameInput);
		if (endFrame === null) {
			setError("结束帧必须是整数");
			return null;
		}
		if (endFrame <= startFrame) {
			setError("结束帧必须大于开始帧");
			return null;
		}
		if (endFrame > timelineEndFrame) {
			setError("结束帧不能超过时间轴末帧");
			return null;
		}

		const filename = ensureMp4Filename(rawFilename);
		const totalFrames = endFrame - startFrame;
		return { filename, fps, startFrame, endFrame, totalFrames };
	}, [
		endFrameInput,
		filenameInput,
		fpsInput,
		startFrameInput,
		timelineEndFrame,
	]);

	const handleOpenChange = useCallback(
		(
			nextOpen: boolean,
			details?: {
				cancel: () => void;
			},
		) => {
			if (!nextOpen && isRunning) {
				details?.cancel();
				return;
			}
			setOpen(nextOpen);
			if (nextOpen) {
				resetForm();
				resetRuntime();
				return;
			}
			resetRuntime();
		},
		[isRunning, resetForm, resetRuntime],
	);

	const handleStartExport = useCallback(async () => {
		if (isRunning) return;
		const form = validateForm();
		if (!form) return;

		setFilenameInput(form.filename);
		setError(null);
		setStatus("running");
		setProgress(0);
		setCurrentFrame(0);
		setActiveTotalFrames(form.totalFrames);

		const controller = new AbortController();
		setAbortController(controller);

		try {
			await onExport({
				filename: form.filename,
				fps: form.fps,
				startFrame: form.startFrame,
				endFrame: form.endFrame,
				signal: controller.signal,
				onFrame: (frame) => {
					if (controller.signal.aborted) return;
					const completedFrames = clamp(
						frame - form.startFrame + 1,
						0,
						form.totalFrames,
					);
					setCurrentFrame(completedFrames);
					setProgress((completedFrames / form.totalFrames) * 100);
				},
			});

			if (controller.signal.aborted) {
				resetRuntime();
				setOpen(false);
				return;
			}

			setCurrentFrame(form.totalFrames);
			setProgress(100);
			resetRuntime();
			setOpen(false);
		} catch (caughtError) {
			if (controller.signal.aborted || isAbortError(caughtError)) {
				resetRuntime();
				setOpen(false);
				return;
			}
			setStatus("error");
			setError(
				caughtError instanceof Error
					? caughtError.message
					: String(caughtError),
			);
		} finally {
			setAbortController(null);
		}
	}, [isRunning, onExport, resetRuntime, validateForm]);

	const handleAbort = useCallback(() => {
		if (!abortController) return;
		abortController.abort();
	}, [abortController]);

	const progressPercentage = Math.round(clamp(progress, 0, 100));
	const progressTotalFrames = isRunning
		? activeTotalFrames
		: metadata.frameCount;
	const progressFrameLabel =
		progressTotalFrames > 0
			? `${currentFrame}/${progressTotalFrames} 帧`
			: "0 帧";

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger
				disabled={disabled || isRunning}
				className={cn(
					"px-3 py-1 text-sm bg-white/10 hover:bg-white/20 disabled:bg-neutral-600 disabled:cursor-not-allowed text-white",
					triggerClassName,
				)}
			>
				<VideoIcon className="size-4" aria-hidden="true" />
			</DialogTrigger>
			<DialogContent className="max-w-xl">
				<div className="flex items-start justify-between gap-3 border-b border-neutral-700 px-4 py-3">
					<div className="grid gap-1">
						<DialogTitle>导出视频</DialogTitle>
						<DialogDescription>
							填写导出参数后开始渲染视频文件。
						</DialogDescription>
					</div>
					<DialogClose
						disabled={isRunning}
						className={cn(
							"rounded px-2 py-1 text-xs transition-colors",
							isRunning
								? "bg-neutral-700 text-neutral-500 cursor-not-allowed"
								: "bg-neutral-700 text-neutral-200 hover:bg-neutral-600",
						)}
					>
						关闭
					</DialogClose>
				</div>
				<form
					className="grid gap-4 px-4 py-4"
					onSubmit={(event) => {
						event.preventDefault();
						void handleStartExport();
					}}
				>
					<div className="grid gap-3 sm:grid-cols-2">
						<label
							className="grid gap-1 text-xs text-neutral-300"
							htmlFor="export-video-filename"
						>
							文件名
							<input
								id="export-video-filename"
								type="text"
								value={filenameInput}
								disabled={isRunning}
								onChange={(event) => setFilenameInput(event.target.value)}
								className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-neutral-100 outline-none focus:border-neutral-500 disabled:opacity-60"
							/>
						</label>
						<label
							className="grid gap-1 text-xs text-neutral-300"
							htmlFor="export-video-fps"
						>
							FPS
							<input
								id="export-video-fps"
								type="number"
								min={1}
								max={120}
								step={1}
								value={fpsInput}
								disabled={isRunning}
								onChange={(event) => setFpsInput(event.target.value)}
								className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-neutral-100 outline-none focus:border-neutral-500 disabled:opacity-60"
							/>
						</label>
						<label
							className="grid gap-1 text-xs text-neutral-300"
							htmlFor="export-video-start-frame"
						>
							开始帧
							<input
								id="export-video-start-frame"
								type="number"
								min={0}
								step={1}
								value={startFrameInput}
								disabled={isRunning}
								onChange={(event) => setStartFrameInput(event.target.value)}
								className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-neutral-100 outline-none focus:border-neutral-500 disabled:opacity-60"
							/>
						</label>
						<label
							className="grid gap-1 text-xs text-neutral-300"
							htmlFor="export-video-end-frame"
						>
							结束帧（不含）
							<input
								id="export-video-end-frame"
								type="number"
								min={1}
								step={1}
								value={endFrameInput}
								disabled={isRunning}
								onChange={(event) => setEndFrameInput(event.target.value)}
								className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-neutral-100 outline-none focus:border-neutral-500 disabled:opacity-60"
							/>
						</label>
					</div>

					<div className="grid gap-2 rounded border border-neutral-700 bg-neutral-800/70 px-3 py-2 text-xs text-neutral-300 sm:grid-cols-3">
						<div>
							分辨率：{canvasSize.width} × {canvasSize.height}
						</div>
						<div>总帧数：{metadata.frameCount}</div>
						<div>时长：{metadata.durationSeconds.toFixed(2)} s</div>
					</div>

					<div className="grid gap-2">
						<div className="flex items-center justify-between text-xs text-neutral-300">
							<span>导出进度</span>
							<span className="tabular-nums">{progressPercentage}%</span>
						</div>
						<Progress
							value={progressPercentage}
							min={0}
							max={100}
							aria-label="导出进度"
							aria-valuetext={`${progressPercentage}%`}
							className="w-full"
						>
							<ProgressTrack>
								<ProgressIndicator />
							</ProgressTrack>
							<ProgressValue className="mt-1 block text-right">
								{() => progressFrameLabel}
							</ProgressValue>
						</Progress>
					</div>

					{error && <div className="text-xs text-red-400">{error}</div>}

					<div className="flex items-center justify-end gap-2">
						{isRunning ? (
							<button
								type="button"
								onClick={handleAbort}
								className="rounded bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-500"
							>
								取消导出
							</button>
						) : (
							<>
								<DialogClose className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 transition-colors hover:bg-neutral-600">
									关闭
								</DialogClose>
								<button
									type="submit"
									className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-emerald-500"
								>
									开始导出
								</button>
							</>
						)}
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
};

export type { ExportVideoOptions };
export default ExportVideoDialog;
