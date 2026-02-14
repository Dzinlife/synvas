import type { TimelineElement } from "core/dsl/types";
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
	useTracks,
} from "../contexts/TimelineContext";
import { getAudioTrackControlState } from "../utils/audioTrackState";
import {
	isTransitionElement,
	reconcileTransitions,
} from "../utils/transitions";
import AsrDialog from "./AsrDialog";
import ExportVideoDialog, {
	type ExportVideoOptions,
} from "./ExportVideoDialog";
import TimelineMinimap from "./TimelineMinimap";
import { applyFreezeFrame, resolveFreezeCandidate } from "./timelineFreeze";
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
	const { attachments, autoAttach, setAutoAttach } = useAttachments();
	const { rippleEditingEnabled, setRippleEditingEnabled } = useRippleEditing();
	const { previewAxisEnabled, setPreviewAxisEnabled } = usePreviewAxis();
	const { timelineScale, setTimelineScale } = useTimelineScale();
	const { canUndo, canRedo, undo, redo } = useTimelineHistory();
	const { elements, setElements } = useElements();
	const { selectedIds, primaryId } = useMultiSelect();
	const { fps } = useFps();
	const { tracks, audioTrackStates } = useTracks();
	const currentTime = useTimelineStore((state) => state.currentTime);
	const canvasSize = useTimelineStore((state) => state.canvasSize);
	const timelineEndFrame = useMemo(() => {
		return elements.reduce(
			(max, element) => Math.max(max, Math.round(element.timeline.end ?? 0)),
			0,
		);
	}, [elements]);
	const timelinePaddingLeft = 48;
	const trackLockedMap = useMemo(() => {
		const map = new Map<number, boolean>(
			tracks.map((track, index) => [index, track.locked ?? false]),
		);
		for (const trackIndexRaw of Object.keys(audioTrackStates)) {
			const trackIndex = Number(trackIndexRaw);
			if (!Number.isFinite(trackIndex)) continue;
			const state = getAudioTrackControlState(audioTrackStates, trackIndex);
			map.set(trackIndex, state.locked);
		}
		return map;
	}, [tracks, audioTrackStates]);

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

	const handleExportVideo = useCallback(async (options: ExportVideoOptions) => {
		await exportTimelineAsVideo(options);
	}, []);

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
	const freezeCandidate = useMemo(
		() =>
			resolveFreezeCandidate({
				elements,
				selectedIds,
				primaryId,
				currentTime,
			}),
		[currentTime, elements, primaryId, selectedIds],
	);

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
	const handleFreeze = useCallback(() => {
		if (!freezeCandidate) return;
		setElements((prev) =>
			applyFreezeFrame({
				elements: prev,
				candidate: freezeCandidate,
				splitFrame: clampFrame(currentTime),
				fps,
				rippleEditingEnabled,
				attachments,
				autoAttach,
				trackLockedMap,
				createElementId,
			}),
		);
	}, [
		freezeCandidate,
		setElements,
		currentTime,
		fps,
		rippleEditingEnabled,
		attachments,
		autoAttach,
		trackLockedMap,
	]);

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
			<button
				type="button"
				onClick={handleFreeze}
				disabled={!freezeCandidate}
				className={cn(
					"px-2 py-1 text-xs rounded transition-colors",
					freezeCandidate
						? "bg-cyan-600 text-white hover:bg-cyan-500"
						: "bg-neutral-800 text-neutral-500 cursor-not-allowed",
				)}
				title="在当前时间点插入 3 秒定格"
			>
				定格
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
			<div className="ml-1 flex-1 min-w-[220px]">
				<TimelineMinimap fps={fps} timelinePaddingLeft={timelinePaddingLeft} />
			</div>
			<AsrDialog />
			<button
				type="button"
				onClick={handleExport}
				disabled={isExporting || isVideoExporting}
				className="px-3 py-1 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-600 disabled:cursor-not-allowed text-white"
			>
				{isExporting ? "Exporting..." : "Export"}
			</button>
			<ExportVideoDialog
				disabled={isExporting || isVideoExporting}
				defaultFps={fps}
				timelineEndFrame={timelineEndFrame}
				canvasSize={canvasSize}
				onExport={handleExportVideo}
				onExportingChange={setIsVideoExporting}
			/>
		</div>
	);
};

export default TimelineToolbar;
