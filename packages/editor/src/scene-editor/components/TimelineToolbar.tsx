import { buildSplitElements } from "core/editor/command/split";
import type { TimelineElement } from "core/element/types";
import { Film, Mic, Sparkles, Split, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSupportedAssetMediaUri } from "@/asr";
import {
	AutoAttachIcon,
	RippleEditingIcon,
	ScrollPreviewIcon,
	SnapIcon,
} from "@/components/icons";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Progress,
	ProgressIndicator,
	ProgressTrack,
} from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useProjectAssets } from "@/projects/useProjectAssets";
import { clampFrame } from "@/utils/timecode";
import {
	useAttachments,
	useElements,
	useFps,
	useMultiSelect,
	usePreviewAxis,
	useRippleEditing,
	useSnap,
	useTimelineScale,
	useTimelineStore,
	useTracks,
} from "../contexts/TimelineContext";
import { getAudioTrackControlState } from "../utils/audioTrackState";
import { MAX_TIMELINE_SCALE, MIN_TIMELINE_SCALE } from "../utils/timelineZoom";
import {
	isTransitionElement,
	reconcileTransitions,
} from "../utils/transitions";
import SmartSpeechCutDialog from "./SmartSpeechCutDialog";
import TimelineMinimap from "./TimelineMinimap";
import { applyFreezeFrame, resolveFreezeCandidate } from "./timelineFreeze";
import {
	analyzeVideoChangeForElement,
	applyQuickSplitFrames,
	QUICK_SPLIT_DEFAULTS,
	type QuickSplitMode,
	resolveQuickSplitCandidate,
} from "./timelineQuickSplit";

const isSplittableClip = (element: TimelineElement) =>
	element.type === "VideoClip" ||
	element.type === "AudioClip" ||
	element.type === "CompositionAudioClip" ||
	element.type === "Composition";
const TIMELINE_SCALE_STEP = 0.1;

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
	const { snapEnabled, setSnapEnabled } = useSnap();
	const { attachments, autoAttach, setAutoAttach } = useAttachments();
	const { rippleEditingEnabled, setRippleEditingEnabled } = useRippleEditing();
	const { previewAxisEnabled, setPreviewAxisEnabled } = usePreviewAxis();
	const { timelineScale, setTimelineScale } = useTimelineScale();
	const { elements, setElements } = useElements();
	const { selectedIds, primaryId } = useMultiSelect();
	const { assets, getProjectAssetById } = useProjectAssets();
	const { fps } = useFps();
	const { tracks, audioTrackStates } = useTracks();
	const currentTime = useTimelineStore((state) => state.currentTime);
	const timelineViewportWidth = useTimelineStore(
		(state) => state.timelineViewportWidth,
	);
	const timelinePaddingLeft = 48;
	const centerAnchorOffset = Math.max(0, timelineViewportWidth) / 2;
	const primarySelectedElement = useMemo(() => {
		if (!primaryId) return null;
		return elements.find((element) => element.id === primaryId) ?? null;
	}, [elements, primaryId]);

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
	const [quickSplitOpen, setQuickSplitOpen] = useState(false);
	const [speechCutOpen, setSpeechCutOpen] = useState(false);
	const [quickSplitSensitivity, setQuickSplitSensitivity] = useState(
		QUICK_SPLIT_DEFAULTS.sensitivity,
	);
	const [quickSplitMinSegmentSeconds, setQuickSplitMinSegmentSeconds] =
		useState(QUICK_SPLIT_DEFAULTS.minSegmentSeconds);
	const [quickSplitMode, setQuickSplitMode] = useState<QuickSplitMode>(
		QUICK_SPLIT_DEFAULTS.mode,
	);
	const [quickSplitStatus, setQuickSplitStatus] = useState<string | null>(null);
	const [quickSplitProgress, setQuickSplitProgress] = useState(0);
	const [quickSplitRunning, setQuickSplitRunning] = useState(false);
	const quickSplitAbortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		return () => {
			quickSplitAbortRef.current?.abort();
		};
	}, []);

	const handleScaleChange = useCallback(
		(value: number | readonly number[]) => {
			const nextValue = Array.isArray(value) ? value[0] : value;
			if (!Number.isFinite(nextValue)) return;
			setTimelineScale(nextValue, {
				anchorOffsetPx: centerAnchorOffset,
			});
		},
		[centerAnchorOffset, setTimelineScale],
	);
	const handleDecreaseScale = useCallback(() => {
		const nextScale = Math.max(
			MIN_TIMELINE_SCALE,
			timelineScale - TIMELINE_SCALE_STEP,
		);
		setTimelineScale(Number(nextScale.toFixed(2)), {
			anchorOffsetPx: centerAnchorOffset,
		});
	}, [centerAnchorOffset, setTimelineScale, timelineScale]);
	const handleIncreaseScale = useCallback(() => {
		const nextScale = Math.min(
			MAX_TIMELINE_SCALE,
			timelineScale + TIMELINE_SCALE_STEP,
		);
		setTimelineScale(Number(nextScale.toFixed(2)), {
			anchorOffsetPx: centerAnchorOffset,
		});
	}, [centerAnchorOffset, setTimelineScale, timelineScale]);

	const splitCandidate = useMemo(() => {
		const target = primarySelectedElement;
		if (!target || !isSplittableClip(target)) return null;
		if (currentTime <= target.timeline.start) return null;
		if (currentTime >= target.timeline.end) return null;
		return target;
	}, [currentTime, primarySelectedElement]);
	const quickSplitCandidate = useMemo(
		() =>
			resolveQuickSplitCandidate({
				elements,
				selectedIds,
				primaryId,
			}),
		[elements, selectedIds, primaryId],
	);
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
	const speechCutCandidate = useMemo(() => {
		const target = primarySelectedElement;
		if (!target) return null;
		if (selectedIds.length !== 1 || selectedIds[0] !== target.id) return null;
		if (target.type !== "VideoClip" && target.type !== "AudioClip") return null;
		if (!target.assetId) return null;
		const asset = assets.find((item) => item.id === target.assetId);
		if (!asset) return null;
		if (asset.kind !== "video" && asset.kind !== "audio") return null;
		if (!isSupportedAssetMediaUri(asset.uri)) return null;
		return {
			elementId: target.id,
			assetId: asset.id,
		};
	}, [primarySelectedElement, selectedIds, assets]);

	useEffect(() => {
		if (speechCutCandidate) return;
		setSpeechCutOpen(false);
	}, [speechCutCandidate]);

	const handleOpenQuickSplit = useCallback(() => {
		if (!quickSplitCandidate) return;
		setQuickSplitStatus(null);
		setQuickSplitProgress(0);
		setQuickSplitOpen(true);
	}, [quickSplitCandidate]);

	const handleCancelQuickSplit = useCallback(() => {
		quickSplitAbortRef.current?.abort();
	}, []);

	const handleRunQuickSplit = useCallback(async () => {
		if (!quickSplitCandidate || quickSplitRunning) return;
		const controller = new AbortController();
		quickSplitAbortRef.current = controller;
		setQuickSplitRunning(true);
		setQuickSplitProgress(0);
		setQuickSplitStatus("正在分析画面变化...");
		try {
			const analysis = await analyzeVideoChangeForElement({
				element: quickSplitCandidate,
				fps,
				getProjectAssetById,
				sensitivity: quickSplitSensitivity,
				minSegmentSeconds: quickSplitMinSegmentSeconds,
				mode: quickSplitMode,
				signal: controller.signal,
				onProgress(progress) {
					setQuickSplitProgress(progress);
				},
			});
			if (controller.signal.aborted) return;
			setQuickSplitProgress(1);
			if (analysis.splitFrames.length === 0) {
				setQuickSplitStatus("未检测到明显变化切点。");
				return;
			}
			setElements((prev) =>
				applyQuickSplitFrames({
					elements: prev,
					targetId: quickSplitCandidate.id,
					splitFrames: analysis.splitFrames,
					fps,
					createElementId,
				}),
			);
			setQuickSplitStatus(
				`快速分割完成，新增 ${analysis.splitFrames.length} 个切点。`,
			);
		} catch (error) {
			if (controller.signal.aborted) {
				setQuickSplitProgress(0);
				setQuickSplitStatus("已取消快速分割。");
				return;
			}
			setQuickSplitProgress(0);
			const message = error instanceof Error ? error.message : String(error);
			setQuickSplitStatus(`快速分割失败：${message}`);
		} finally {
			if (quickSplitAbortRef.current === controller) {
				quickSplitAbortRef.current = null;
			}
			setQuickSplitRunning(false);
		}
	}, [
		quickSplitCandidate,
		quickSplitRunning,
		fps,
		quickSplitSensitivity,
		quickSplitMinSegmentSeconds,
		quickSplitMode,
		setElements,
		getProjectAssetById,
	]);

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
	const quickSplitProgressPercentage = Math.round(
		Math.max(0, Math.min(1, quickSplitProgress)) * 100,
	);

	return (
		<>
			<div className={cn("flex items-center gap-3 px-4", className)}>
				<div className="left-section flex flex-1 items-center gap-3 shrink-0">
					<div className="flex items-center gap-0.5 bg-black/20 rounded-full p-0.5">
						<Tooltip>
							<TooltipTrigger
								delay={0}
								onClick={handleSplit}
								disabled={!splitCandidate}
								className={cn(
									"size-7 flex items-center justify-center text-xs transition rounded-full",
									splitCandidate
										? " text-white hover:scale-115"
										: " text-neutral-500 cursor-not-allowed",
								)}
								aria-label="分割片段"
							>
								<Split className="size-3.5" />
							</TooltipTrigger>
							<TooltipContent>在当前时间点分割选中片段</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger
								delay={0}
								onClick={handleOpenQuickSplit}
								disabled={!quickSplitCandidate}
								className={cn(
									"size-7 flex items-center justify-center text-xs transition rounded-full",
									quickSplitCandidate
										? "text-white hover:scale-115"
										: "text-neutral-500 cursor-not-allowed",
								)}
								aria-label="快速分割"
							>
								<Film className="size-3.5" />
							</TooltipTrigger>
							<TooltipContent>根据画面变化自动生成切点</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger
								delay={0}
								onClick={() => setSpeechCutOpen(true)}
								disabled={!speechCutCandidate}
								className={cn(
									"size-7 flex items-center justify-center text-xs transition rounded-full",
									speechCutCandidate
										? "text-white hover:scale-115"
										: "text-neutral-500 cursor-not-allowed",
								)}
								aria-label="智能剪口播"
							>
								<Mic className="size-3.5" />
							</TooltipTrigger>
							<TooltipContent>智能剪口播</TooltipContent>
						</Tooltip>

						<Tooltip>
							<TooltipTrigger
								delay={0}
								onClick={handleFreeze}
								disabled={!freezeCandidate}
								className={cn(
									"size-7 flex items-center justify-center text-xs transition rounded-full",
									freezeCandidate
										? "text-white hover:scale-115"
										: "text-neutral-500 cursor-not-allowed",
								)}
								aria-label="定格片段"
							>
								<Sparkles className="size-3.5" />
							</TooltipTrigger>
							<TooltipContent>在当前时间点插入 3 秒定格</TooltipContent>
						</Tooltip>
					</div>
				</div>
				<div className="center-section flex-1 flex justify-center">
					<div className="flex-1 min-w-[220px] max-w-[640px]">
						<TimelineMinimap
							fps={fps}
							timelinePaddingLeft={timelinePaddingLeft}
						/>
					</div>
				</div>
				<div className="right-section flex flex-1 shrink-2 items-center justify-end gap-2">
					{/* 开关按钮组 */}
					<div className="flex items-center gap-1 px-1 rounded-full bg-black/20">
						<Tooltip>
							<TooltipTrigger
								delay={0}
								type="button"
								onClick={() => setRippleEditingEnabled(!rippleEditingEnabled)}
								aria-label="波纹编辑"
								className={cn(
									"size-8 rounded-full transition flex items-center justify-center",
									rippleEditingEnabled
										? "text-orange-500"
										: "text-neutral-400 scale-90",
								)}
							>
								<RippleEditingIcon className="size-8" />
							</TooltipTrigger>
							<TooltipContent>主轨波纹编辑</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger
								type="button"
								delay={0}
								onClick={() => setSnapEnabled(!snapEnabled)}
								aria-label="吸附"
								className={cn(
									"size-8 rounded-full transition flex items-center justify-center",
									snapEnabled ? "text-orange-500" : "text-neutral-400 scale-90",
								)}
							>
								<SnapIcon className="size-8" />
							</TooltipTrigger>
							<TooltipContent>水平吸附</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger
								type="button"
								delay={0}
								onClick={() => setAutoAttach(!autoAttach)}
								aria-label="联动"
								className={cn(
									"size-8 rounded-full transition flex items-center justify-center",
									autoAttach ? "text-orange-500" : "text-neutral-400 scale-90",
								)}
							>
								<AutoAttachIcon className="size-8" />
							</TooltipTrigger>
							<TooltipContent>主轴联动</TooltipContent>
						</Tooltip>

						<Tooltip>
							<TooltipTrigger
								delay={0}
								type="button"
								onClick={() => setPreviewAxisEnabled(!previewAxisEnabled)}
								aria-label="预览轴"
								className={cn(
									"size-8 rounded-full transition flex items-center justify-center",
									previewAxisEnabled
										? "text-orange-500"
										: "text-neutral-400 scale-90",
								)}
							>
								<ScrollPreviewIcon className="size-8" />
							</TooltipTrigger>
							<TooltipContent>预览轴</TooltipContent>
						</Tooltip>
					</div>
					<div className="group flex items-center gap-0.5 rounded-full p-0.5 bg-black/20 px-1">
						<button
							type="button"
							onClick={handleDecreaseScale}
							disabled={timelineScale <= MIN_TIMELINE_SCALE}
							className={cn(
								"size-6 rounded-full flex items-center justify-center transition-colors",
								timelineScale > MIN_TIMELINE_SCALE
									? "text-neutral-500 hover:text-neutral-400"
									: "text-neutral-700 cursor-not-allowed",
							)}
							title="缩小时间轴"
						>
							<ZoomOut className="size-3.5" />
						</button>
						<Slider
							min={MIN_TIMELINE_SCALE}
							max={MAX_TIMELINE_SCALE}
							step={TIMELINE_SCALE_STEP}
							value={[timelineScale]}
							onValueChange={handleScaleChange}
							className="w-16 opacity-60 group-hover:opacity-100"
						/>
						<button
							type="button"
							onClick={handleIncreaseScale}
							disabled={timelineScale >= MAX_TIMELINE_SCALE}
							className={cn(
								"size-6 rounded-full flex items-center justify-center transition-colors",
								timelineScale < MAX_TIMELINE_SCALE
									? "text-neutral-500 hover:text-neutral-400"
									: "text-neutral-700 cursor-not-allowed",
							)}
							title="放大时间轴"
						>
							<ZoomIn className="size-3.5" />
						</button>
					</div>
				</div>
			</div>
			<Dialog
				open={quickSplitOpen}
				onOpenChange={(open) => {
					if (!open && quickSplitRunning) return;
					setQuickSplitOpen(open);
					if (open) {
						setQuickSplitStatus(null);
						setQuickSplitProgress(0);
					}
				}}
			>
				<DialogContent className="max-w-md">
					<div className="grid gap-4 p-4">
						<div className="space-y-1">
							<DialogTitle>视频快速分割</DialogTitle>
							<DialogDescription>
								根据画面变化强度自动生成切割点，适合快速粗剪。
							</DialogDescription>
						</div>
						<div className="grid gap-2">
							<label
								htmlFor="quick-split-sensitivity"
								className="text-xs text-neutral-300"
							>
								变化强度（0-100）
							</label>
							<Input
								id="quick-split-sensitivity"
								type="number"
								min={0}
								max={100}
								step={1}
								value={quickSplitSensitivity}
								disabled={quickSplitRunning}
								onChange={(event) => {
									const value = Number(event.target.value);
									if (!Number.isFinite(value)) return;
									setQuickSplitSensitivity(
										Math.max(0, Math.min(100, Math.round(value))),
									);
								}}
								className="h-8 rounded border border-white/15 bg-neutral-900 px-2 text-sm text-neutral-100 outline-none focus:border-blue-400"
							/>
						</div>
						<div className="grid gap-2">
							<label
								htmlFor="quick-split-min-segment"
								className="text-xs text-neutral-300"
							>
								最短片段时长（秒）
							</label>
							<Input
								id="quick-split-min-segment"
								type="number"
								min={0.2}
								max={5}
								step={0.1}
								value={quickSplitMinSegmentSeconds}
								disabled={quickSplitRunning}
								onChange={(event) => {
									const value = Number(event.target.value);
									if (!Number.isFinite(value)) return;
									setQuickSplitMinSegmentSeconds(
										Number(Math.max(0.2, Math.min(5, value)).toFixed(2)),
									);
								}}
								className="h-8 rounded border border-white/15 bg-neutral-900 px-2 text-sm text-neutral-100 outline-none focus:border-blue-400"
							/>
						</div>
						<div className="grid gap-2">
							<label
								htmlFor="quick-split-mode"
								className="text-xs text-neutral-300"
							>
								分析速度
							</label>
							<Select
								id="quick-split-mode"
								value={quickSplitMode}
								disabled={quickSplitRunning}
								items={[
									{ value: "fast", label: "极速" },
									{ value: "balanced", label: "平衡" },
									{ value: "fine", label: "精细" },
								]}
								onValueChange={(value) => {
									if (value === "fast" || value === "fine") {
										setQuickSplitMode(value as QuickSplitMode);
										return;
									}
									setQuickSplitMode("balanced");
								}}
								// className="h-8 rounded border border-white/15 bg-neutral-900 px-2 text-sm text-neutral-100 outline-none focus:border-blue-400"
							>
								<SelectTrigger>
									<SelectValue placeholder="选择分析速度" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="fast">极速</SelectItem>
									<SelectItem value="balanced">平衡</SelectItem>
									<SelectItem value="fine">精细</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-1.5">
							<div className="flex items-center justify-between text-xs text-neutral-400">
								<span>分析进度</span>
								<span className="tabular-nums">
									{quickSplitProgressPercentage}%
								</span>
							</div>
							<Progress
								value={quickSplitProgressPercentage}
								min={0}
								max={100}
								aria-label="快速分割进度"
								aria-valuetext={`${quickSplitProgressPercentage}%`}
								className="w-full"
							>
								<ProgressTrack className="bg-neutral-800/90">
									<ProgressIndicator className="bg-blue-500 transition-[width] duration-100" />
								</ProgressTrack>
							</Progress>
						</div>
						<div className="min-h-5 text-xs text-neutral-400">
							{quickSplitStatus ?? "选择参数后执行快速分割。"}
						</div>
						<div className="flex justify-end gap-2">
							{quickSplitRunning ? (
								<button
									type="button"
									onClick={handleCancelQuickSplit}
									className="rounded bg-neutral-700 px-3 py-1.5 text-xs text-neutral-100 transition hover:bg-neutral-600"
								>
									取消
								</button>
							) : (
								<button
									type="button"
									onClick={() => setQuickSplitOpen(false)}
									className="rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-100 transition hover:bg-neutral-700"
								>
									关闭
								</button>
							)}
							<button
								type="button"
								disabled={!quickSplitCandidate || quickSplitRunning}
								onClick={() => {
									void handleRunQuickSplit();
								}}
								className={cn(
									"rounded px-3 py-1.5 text-xs transition",
									quickSplitCandidate && !quickSplitRunning
										? "bg-blue-600 text-white hover:bg-blue-500"
										: "bg-neutral-700 text-neutral-500 cursor-not-allowed",
								)}
							>
								{quickSplitRunning ? "分析中..." : "开始分割"}
							</button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
			<SmartSpeechCutDialog
				open={speechCutOpen}
				onOpenChange={setSpeechCutOpen}
				elementId={speechCutCandidate?.elementId ?? null}
				assetId={speechCutCandidate?.assetId ?? null}
			/>
		</>
	);
};

export default TimelineToolbar;
