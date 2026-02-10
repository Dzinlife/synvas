import type { TimelineElement } from "core/dsl/types";
import {
	AUDIO_EXPORT_BLOCK_SIZE_VALUES,
	AUDIO_EXPORT_SAMPLE_RATE_VALUES,
	type ExportAudioDspSettings,
} from "core/editor/audio/dsp/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { exportCanvasAsImage } from "@/dsl/export";
import { exportTimelineAsVideo } from "@/editor/exportVideo";
import { cn } from "@/lib/utils";
import { clampFrame } from "@/utils/timecode";
import { usePreview } from "../contexts/PreviewProvider";
import {
	useAttachments,
	useElements,
	useFps,
	useMultiSelect,
	usePlaybackControl,
	usePreviewAxis,
	useRippleEditing,
	useSnap,
	useTimelineHistory,
	useTimelineScale,
	useTimelineStore,
} from "../contexts/TimelineContext";
import {
	isTransitionElement,
	reconcileTransitions,
} from "../utils/transitions";
import AsrDialog from "./AsrDialog";
import { buildSplitElements } from "./timelineSplit";

const isSplittableClip = (element: TimelineElement) =>
	element.type === "VideoClip" || element.type === "AudioClip";

const createElementId = () => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `clip-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 6)}`;
};

const clampNumber = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const parseNumberInput = (value: string): number | null => {
	if (value.trim() === "") return null;
	const next = Number(value);
	if (!Number.isFinite(next)) return null;
	return next;
};

const remapTransitionsAfterSplit = (
	elements: TimelineElement[],
	options: {
		clipId: string;
		rightClipId: string;
		originalEnd: number;
	},
): TimelineElement[] => {
	const { clipId, rightClipId, originalEnd } = options;
	let didChange = false;
	const next = elements.map((element) => {
		if (!isTransitionElement(element)) return element;
		const transition = element.transition;
		if (!transition) return element;
		if (transition.fromId !== clipId) return element;
		if (transition.boundry !== originalEnd) return element;
		didChange = true;
		return {
			...element,
			transition: {
				...transition,
				fromId: rightClipId,
			},
		};
	});
	return didChange ? next : elements;
};

const TimelineToolbar: React.FC<{ className?: string }> = ({ className }) => {
	const { isPlaying, togglePlay } = usePlaybackControl();
	const { canvasRef } = usePreview();
	const [isExporting, setIsExporting] = useState(false);
	const [isVideoExporting, setIsVideoExporting] = useState(false);
	const { snapEnabled, setSnapEnabled } = useSnap();
	const { autoAttach, setAutoAttach } = useAttachments();
	const { rippleEditingEnabled, setRippleEditingEnabled } = useRippleEditing();
	const { previewAxisEnabled, setPreviewAxisEnabled } = usePreviewAxis();
	const { timelineScale, setTimelineScale } = useTimelineScale();
	const { canUndo, canRedo, undo, redo } = useTimelineHistory();
	const { elements, setElements } = useElements();
	const { primaryId } = useMultiSelect();
	const { fps } = useFps();
	const currentTime = useTimelineStore((state) => state.currentTime);
	const audioSettings = useTimelineStore((state) => state.audioSettings);
	const setAudioSettings = useTimelineStore((state) => state.setAudioSettings);

	// 全局空格键播放/暂停
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// 避免在输入框中触发
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement ||
				(e.target as HTMLElement | null)?.isContentEditable
			) {
				return;
			}

			if (e.code === "Space" && !e.repeat) {
				e.preventDefault();
				togglePlay();
				return;
			}

			const isModifier = e.metaKey || e.ctrlKey;
			if (!isModifier) return;

			const key = e.key.toLowerCase();
			if (key === "z") {
				e.preventDefault();
				if (e.shiftKey) {
					redo();
				} else {
					undo();
				}
				return;
			}

			if (key === "y") {
				e.preventDefault();
				redo();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [togglePlay, undo, redo]);

	const handleExport = useCallback(async () => {
		if (isExporting || isVideoExporting) return;

		setIsExporting(true);
		try {
			await exportCanvasAsImage(canvasRef.current, {
				format: "png",
				waitForReady: true,
			});
		} finally {
			setIsExporting(false);
		}
	}, [canvasRef, isExporting, isVideoExporting]);

	const handleExportVideo = useCallback(async () => {
		if (isExporting || isVideoExporting) return;
		setIsVideoExporting(true);
		try {
			await exportTimelineAsVideo({
				fps,
			});
		} finally {
			setIsVideoExporting(false);
		}
	}, [fps, isExporting, isVideoExporting]);

	const handleScaleChange = useCallback(
		(value: number | readonly number[]) => {
			const nextValue = Array.isArray(value) ? value[0] : value;
			if (!Number.isFinite(nextValue)) return;
			setTimelineScale(nextValue);
		},
		[setTimelineScale],
	);

	const updateAudioSettings = useCallback(
		(updater: (prev: ExportAudioDspSettings) => ExportAudioDspSettings) => {
			const prev = useTimelineStore.getState().audioSettings;
			setAudioSettings(updater(prev));
		},
		[setAudioSettings],
	);

	const updateCompressor = useCallback(
		(
			updater: (
				prev: ExportAudioDspSettings["compressor"],
			) => ExportAudioDspSettings["compressor"],
		) => {
			updateAudioSettings((prev) => ({
				...prev,
				compressor: updater(prev.compressor),
			}));
		},
		[updateAudioSettings],
	);

	const handleSampleRateChange = useCallback(
		(value: number) => {
			if (value !== 44100 && value !== 48000) return;
			updateAudioSettings((prev) => ({ ...prev, exportSampleRate: value }));
		},
		[updateAudioSettings],
	);

	const handleBlockSizeChange = useCallback(
		(value: number) => {
			if (value !== 256 && value !== 512 && value !== 1024) return;
			updateAudioSettings((prev) => ({ ...prev, exportBlockSize: value }));
		},
		[updateAudioSettings],
	);

	const handleMasterGainChange = useCallback(
		(value: number) => {
			if (!Number.isFinite(value)) return;
			updateAudioSettings((prev) => ({
				...prev,
				masterGainDb: clampNumber(value, -24, 24),
			}));
		},
		[updateAudioSettings],
	);

	const handleCompressorToggle = useCallback(() => {
		updateCompressor((prev) => ({
			...prev,
			enabled: !prev.enabled,
		}));
	}, [updateCompressor]);

	const handleThresholdChange = useCallback(
		(value: number) => {
			if (!Number.isFinite(value)) return;
			updateCompressor((prev) => ({
				...prev,
				thresholdDb: clampNumber(value, -60, 0),
			}));
		},
		[updateCompressor],
	);

	const handleRatioChange = useCallback(
		(value: number) => {
			if (!Number.isFinite(value)) return;
			updateCompressor((prev) => ({
				...prev,
				ratio: clampNumber(value, 1, 20),
			}));
		},
		[updateCompressor],
	);

	const handleKneeChange = useCallback(
		(value: number) => {
			if (!Number.isFinite(value)) return;
			updateCompressor((prev) => ({
				...prev,
				kneeDb: clampNumber(value, 0, 24),
			}));
		},
		[updateCompressor],
	);

	const handleAttackChange = useCallback(
		(value: number) => {
			if (!Number.isFinite(value)) return;
			updateCompressor((prev) => ({
				...prev,
				attackMs: clampNumber(value, 0.1, 200),
			}));
		},
		[updateCompressor],
	);

	const handleReleaseChange = useCallback(
		(value: number) => {
			if (!Number.isFinite(value)) return;
			updateCompressor((prev) => ({
				...prev,
				releaseMs: clampNumber(value, 10, 1200),
			}));
		},
		[updateCompressor],
	);

	const handleMakeupChange = useCallback(
		(value: number) => {
			if (!Number.isFinite(value)) return;
			updateCompressor((prev) => ({
				...prev,
				makeupGainDb: clampNumber(value, -24, 24),
			}));
		},
		[updateCompressor],
	);

	const splitCandidate = useMemo(() => {
		if (!primaryId) return null;
		const target = elements.find((el) => el.id === primaryId) ?? null;
		if (!target || !isSplittableClip(target)) return null;
		if (currentTime <= target.timeline.start) return null;
		if (currentTime >= target.timeline.end) return null;
		return target;
	}, [currentTime, elements, primaryId]);

	const handleSplit = useCallback(() => {
		if (!splitCandidate) return;
		// 在当前时间点把选中 clip 切成左右两段
		setElements((prev) => {
			const targetIndex = prev.findIndex((el) => el.id === splitCandidate.id);
			if (targetIndex < 0) return prev;
			const target = prev[targetIndex];
			if (!isSplittableClip(target)) return prev;
			const splitFrame = clampFrame(currentTime);
			if (splitFrame <= target.timeline.start) return prev;
			if (splitFrame >= target.timeline.end) return prev;
			const originalEnd = target.timeline.end;
			const newId = createElementId();
			const { left, right } = buildSplitElements(
				target,
				splitFrame,
				fps,
				newId,
			);
			const next = [...prev];
			next[targetIndex] = left;
			next.splice(targetIndex + 1, 0, right);
			const remapped = remapTransitionsAfterSplit(next, {
				clipId: target.id,
				rightClipId: newId,
				originalEnd,
			});
			return reconcileTransitions(remapped, fps);
		});
	}, [currentTime, fps, setElements, splitCandidate]);

	return (
		<div className={cn("flex items-center gap-3 px-4", className)}>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={undo}
					disabled={!canUndo}
					className={cn(
						"px-2 py-1 text-xs rounded transition-colors",
						canUndo
							? "bg-neutral-700 text-white hover:bg-neutral-600"
							: "bg-neutral-800 text-neutral-500 cursor-not-allowed",
					)}
					title="撤销 (Ctrl/Cmd+Z)"
				>
					撤销
				</button>
				<button
					type="button"
					onClick={redo}
					disabled={!canRedo}
					className={cn(
						"px-2 py-1 text-xs rounded transition-colors",
						canRedo
							? "bg-neutral-700 text-white hover:bg-neutral-600"
							: "bg-neutral-800 text-neutral-500 cursor-not-allowed",
					)}
					title="重做 (Ctrl/Cmd+Shift+Z / Ctrl+Y)"
				>
					重做
				</button>
			</div>
			<button
				type="button"
				onClick={togglePlay}
				className="w-8 h-8 flex items-center justify-center rounded bg-neutral-700 hover:bg-neutral-600 text-white"
			>
				{isPlaying ? "⏸" : "▶"}
			</button>
			<button
				type="button"
				onClick={handleSplit}
				disabled={!splitCandidate}
				className={cn(
					"px-2 py-1 text-xs rounded transition-colors",
					splitCandidate
						? "bg-amber-600 text-white hover:bg-amber-500"
						: "bg-neutral-800 text-neutral-500 cursor-not-allowed",
				)}
				title="在当前时间点分割选中片段"
			>
				分割
			</button>
			{/* 开关按钮组 */}
			<div className="flex items-center gap-2 ml-4">
				<Tooltip>
					<TooltipTrigger
						type="button"
						onClick={() => setSnapEnabled(!snapEnabled)}
						className={cn(
							"px-2 py-1 text-xs rounded transition-colors",
							snapEnabled
								? "bg-green-600 text-white"
								: "bg-neutral-700 text-neutral-400 hover:bg-neutral-600",
						)}
					>
						吸附
					</TooltipTrigger>
					<TooltipContent>水平吸附</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger
						type="button"
						onClick={() => setAutoAttach(!autoAttach)}
						className={cn(
							"px-2 py-1 text-xs rounded transition-colors",
							autoAttach
								? "bg-green-600 text-white"
								: "bg-neutral-700 text-neutral-400 hover:bg-neutral-600",
						)}
					>
						联动
					</TooltipTrigger>
					<TooltipContent>主轴联动</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger
						type="button"
						onClick={() => setRippleEditingEnabled(!rippleEditingEnabled)}
						className={cn(
							"px-2 py-1 text-xs rounded transition-colors",
							rippleEditingEnabled
								? "bg-green-600 text-white"
								: "bg-neutral-700 text-neutral-400 hover:bg-neutral-600",
						)}
					>
						波纹编辑
					</TooltipTrigger>
					<TooltipContent>主轨波纹编辑</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger
						type="button"
						onClick={() => setPreviewAxisEnabled(!previewAxisEnabled)}
						className={cn(
							"px-2 py-1 text-xs rounded transition-colors",
							previewAxisEnabled
								? "bg-green-600 text-white"
								: "bg-neutral-700 text-neutral-400 hover:bg-neutral-600",
						)}
					>
						预览轴
					</TooltipTrigger>
					<TooltipContent>预览轴</TooltipContent>
				</Tooltip>
			</div>
			<div className="flex items-center gap-2">
				<Slider
					min={0.01}
					max={10}
					step={0.1}
					value={[timelineScale]}
					onValueChange={handleScaleChange}
					className="w-16"
				/>
			</div>
			<div className="ml-1 flex items-center gap-2 rounded border border-neutral-700 bg-neutral-800/70 px-2 py-1">
				<span className="text-[11px] text-neutral-300">DSP</span>
				<label className="flex items-center gap-1 text-[11px] text-neutral-300">
					SR
					<select
						value={audioSettings.exportSampleRate}
						onChange={(event) => {
							const parsed = parseNumberInput(event.target.value);
							if (parsed === null) return;
							handleSampleRateChange(parsed);
						}}
						className="h-6 rounded bg-neutral-900 px-1 text-[11px] text-neutral-100 outline-none"
					>
						{AUDIO_EXPORT_SAMPLE_RATE_VALUES.map((sampleRate) => (
							<option key={sampleRate} value={sampleRate}>
								{sampleRate}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-1 text-[11px] text-neutral-300">
					Block
					<select
						value={audioSettings.exportBlockSize}
						onChange={(event) => {
							const parsed = parseNumberInput(event.target.value);
							if (parsed === null) return;
							handleBlockSizeChange(parsed);
						}}
						className="h-6 rounded bg-neutral-900 px-1 text-[11px] text-neutral-100 outline-none"
					>
						{AUDIO_EXPORT_BLOCK_SIZE_VALUES.map((blockSize) => (
							<option key={blockSize} value={blockSize}>
								{blockSize}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-1 text-[11px] text-neutral-300">
					Master
					<input
						type="number"
						step={0.1}
						min={-24}
						max={24}
						value={audioSettings.masterGainDb}
						onChange={(event) => {
							const parsed = parseNumberInput(event.target.value);
							if (parsed === null) return;
							handleMasterGainChange(parsed);
						}}
						className="h-6 w-14 rounded bg-neutral-900 px-1 text-[11px] text-neutral-100 outline-none"
					/>
				</label>
				<button
					type="button"
					onClick={handleCompressorToggle}
					className={cn(
						"px-2 py-1 text-[11px] rounded transition-colors",
						audioSettings.compressor.enabled
							? "bg-blue-600 text-white hover:bg-blue-500"
							: "bg-neutral-700 text-neutral-200 hover:bg-neutral-600",
					)}
				>
					Comp
				</button>
				<label className="flex items-center gap-1 text-[11px] text-neutral-300">
					Thr
					<input
						type="number"
						step={0.1}
						min={-60}
						max={0}
						value={audioSettings.compressor.thresholdDb}
						disabled={!audioSettings.compressor.enabled}
						onChange={(event) => {
							const parsed = parseNumberInput(event.target.value);
							if (parsed === null) return;
							handleThresholdChange(parsed);
						}}
						className="h-6 w-12 rounded bg-neutral-900 px-1 text-[11px] text-neutral-100 outline-none disabled:opacity-40"
					/>
				</label>
				<label className="flex items-center gap-1 text-[11px] text-neutral-300">
					Ratio
					<input
						type="number"
						step={0.1}
						min={1}
						max={20}
						value={audioSettings.compressor.ratio}
						disabled={!audioSettings.compressor.enabled}
						onChange={(event) => {
							const parsed = parseNumberInput(event.target.value);
							if (parsed === null) return;
							handleRatioChange(parsed);
						}}
						className="h-6 w-12 rounded bg-neutral-900 px-1 text-[11px] text-neutral-100 outline-none disabled:opacity-40"
					/>
				</label>
				<label className="flex items-center gap-1 text-[11px] text-neutral-300">
					Knee
					<input
						type="number"
						step={0.1}
						min={0}
						max={24}
						value={audioSettings.compressor.kneeDb}
						disabled={!audioSettings.compressor.enabled}
						onChange={(event) => {
							const parsed = parseNumberInput(event.target.value);
							if (parsed === null) return;
							handleKneeChange(parsed);
						}}
						className="h-6 w-12 rounded bg-neutral-900 px-1 text-[11px] text-neutral-100 outline-none disabled:opacity-40"
					/>
				</label>
				<label className="flex items-center gap-1 text-[11px] text-neutral-300">
					Atk
					<input
						type="number"
						step={0.1}
						min={0.1}
						max={200}
						value={audioSettings.compressor.attackMs}
						disabled={!audioSettings.compressor.enabled}
						onChange={(event) => {
							const parsed = parseNumberInput(event.target.value);
							if (parsed === null) return;
							handleAttackChange(parsed);
						}}
						className="h-6 w-12 rounded bg-neutral-900 px-1 text-[11px] text-neutral-100 outline-none disabled:opacity-40"
					/>
				</label>
				<label className="flex items-center gap-1 text-[11px] text-neutral-300">
					Rel
					<input
						type="number"
						step={1}
						min={10}
						max={1200}
						value={audioSettings.compressor.releaseMs}
						disabled={!audioSettings.compressor.enabled}
						onChange={(event) => {
							const parsed = parseNumberInput(event.target.value);
							if (parsed === null) return;
							handleReleaseChange(parsed);
						}}
						className="h-6 w-12 rounded bg-neutral-900 px-1 text-[11px] text-neutral-100 outline-none disabled:opacity-40"
					/>
				</label>
				<label className="flex items-center gap-1 text-[11px] text-neutral-300">
					Makeup
					<input
						type="number"
						step={0.1}
						min={-24}
						max={24}
						value={audioSettings.compressor.makeupGainDb}
						disabled={!audioSettings.compressor.enabled}
						onChange={(event) => {
							const parsed = parseNumberInput(event.target.value);
							if (parsed === null) return;
							handleMakeupChange(parsed);
						}}
						className="h-6 w-12 rounded bg-neutral-900 px-1 text-[11px] text-neutral-100 outline-none disabled:opacity-40"
					/>
				</label>
			</div>
			<div className="flex-1" />
			<AsrDialog />
			<button
				type="button"
				onClick={handleExport}
				disabled={isExporting || isVideoExporting}
				className="px-3 py-1 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-600 disabled:cursor-not-allowed text-white"
			>
				{isExporting ? "Exporting..." : "Export"}
			</button>
			<button
				type="button"
				onClick={handleExportVideo}
				disabled={isExporting || isVideoExporting}
				className="px-3 py-1 text-sm rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-600 disabled:cursor-not-allowed text-white"
			>
				{isVideoExporting ? "导出中..." : "导出视频"}
			</button>
		</div>
	);
};

export default TimelineToolbar;
