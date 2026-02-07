import { useCallback, useEffect, useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { exportCanvasAsImage } from "@/dsl/export";
import type { TimelineElement } from "@/dsl/types";
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
import { updateElementTime } from "../utils/timelineTime";
import {
	isTransitionElement,
	reconcileTransitions,
} from "../utils/transitions";
import AsrDialog from "./AsrDialog";

const isSplittableClip = (element: TimelineElement) =>
	element.type === "VideoClip" || element.type === "AudioClip";

const normalizeOffsetFrames = (value: unknown): number => {
	if (!Number.isFinite(value as number)) return 0;
	return Math.max(0, Math.round(value as number));
};

const createElementId = () => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `clip-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 6)}`;
};

const buildSplitElements = (
	element: TimelineElement,
	splitFrame: number,
	fps: number,
	newId: string,
): { left: TimelineElement; right: TimelineElement } => {
	const originalStart = element.timeline.start;
	const originalEnd = element.timeline.end;
	const offsetFrames = normalizeOffsetFrames(element.timeline.offset);
	const rightOffset = offsetFrames + (splitFrame - originalStart);

	const left = updateElementTime(element, originalStart, splitFrame, fps);
	const rightBase: TimelineElement = {
		...element,
		id: newId,
		timeline: {
			...element.timeline,
			offset: rightOffset,
		},
	};
	const right = updateElementTime(rightBase, splitFrame, originalEnd, fps);
	return { left, right };
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
				<button
					type="button"
					onClick={() => setSnapEnabled(!snapEnabled)}
					className={cn(
						"px-2 py-1 text-xs rounded transition-colors",
						snapEnabled
							? "bg-green-600 text-white"
							: "bg-neutral-700 text-neutral-400 hover:bg-neutral-600",
					)}
					title="水平吸附"
				>
					吸附
				</button>
				<button
					type="button"
					onClick={() => setAutoAttach(!autoAttach)}
					className={cn(
						"px-2 py-1 text-xs rounded transition-colors",
						autoAttach
							? "bg-green-600 text-white"
							: "bg-neutral-700 text-neutral-400 hover:bg-neutral-600",
					)}
					title="主轴联动"
				>
					联动
				</button>
				<button
					type="button"
					onClick={() => setRippleEditingEnabled(!rippleEditingEnabled)}
					className={cn(
						"px-2 py-1 text-xs rounded transition-colors",
						rippleEditingEnabled
							? "bg-green-600 text-white"
							: "bg-neutral-700 text-neutral-400 hover:bg-neutral-600",
					)}
					title="主轨波纹编辑"
				>
					波纹编辑
				</button>
				<button
					type="button"
					onClick={() => setPreviewAxisEnabled(!previewAxisEnabled)}
					className={cn(
						"px-2 py-1 text-xs rounded transition-colors",
						previewAxisEnabled
							? "bg-green-600 text-white"
							: "bg-neutral-700 text-neutral-400 hover:bg-neutral-600",
					)}
					title="预览轴"
				>
					预览轴
				</button>
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
