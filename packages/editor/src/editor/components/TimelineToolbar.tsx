import type { TimelineElement } from "core/dsl/types";
import { buildSplitElements } from "core/editor/command/split";
import {
	Eye,
	Film,
	Layers,
	Sparkles,
	Split,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import {
	AutoAttachIcon,
	RippleEditingIcon,
	ScrollPreviewIcon,
	SnapIcon,
} from "@/components/icons";
import { Slider } from "@/components/ui/slider";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { clampFrame } from "@/utils/timecode";
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
import TimelineMinimap from "./TimelineMinimap";
import { applyFreezeFrame, resolveFreezeCandidate } from "./timelineFreeze";

const isSplittableClip = (element: TimelineElement) =>
	element.type === "VideoClip" || element.type === "AudioClip";
const MIN_TIMELINE_SCALE = 0.01;
const MAX_TIMELINE_SCALE = 10;
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
	const { togglePlay } = usePlaybackControl();
	const { snapEnabled, setSnapEnabled } = useSnap();
	const { attachments, autoAttach, setAutoAttach } = useAttachments();
	const { rippleEditingEnabled, setRippleEditingEnabled } = useRippleEditing();
	const { previewAxisEnabled, setPreviewAxisEnabled } = usePreviewAxis();
	const { timelineScale, setTimelineScale } = useTimelineScale();
	const { undo, redo } = useTimelineHistory();
	const { elements, setElements } = useElements();
	const { selectedIds, primaryId } = useMultiSelect();
	const { fps } = useFps();
	const { tracks, audioTrackStates } = useTracks();
	const currentTime = useTimelineStore((state) => state.currentTime);
	const timelinePaddingLeft = 48;
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

	const handleScaleChange = useCallback(
		(value: number | readonly number[]) => {
			const nextValue = Array.isArray(value) ? value[0] : value;
			if (!Number.isFinite(nextValue)) return;
			setTimelineScale(nextValue);
		},
		[setTimelineScale],
	);
	const handleDecreaseScale = useCallback(() => {
		const nextScale = Math.max(
			MIN_TIMELINE_SCALE,
			timelineScale - TIMELINE_SCALE_STEP,
		);
		setTimelineScale(Number(nextScale.toFixed(2)));
	}, [setTimelineScale, timelineScale]);
	const handleIncreaseScale = useCallback(() => {
		const nextScale = Math.min(
			MAX_TIMELINE_SCALE,
			timelineScale + TIMELINE_SCALE_STEP,
		);
		setTimelineScale(Number(nextScale.toFixed(2)));
	}, [setTimelineScale, timelineScale]);

	const splitCandidate = useMemo(() => {
		const target = primarySelectedElement;
		if (!target || !isSplittableClip(target)) return null;
		if (currentTime <= target.timeline.start) return null;
		if (currentTime >= target.timeline.end) return null;
		return target;
	}, [currentTime, primarySelectedElement]);
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
			<div className="left-section flex flex-1 items-center gap-3 shrink-0">
				<div className="flex items-center gap-0.5 bg-black/20 rounded-full p-0.5">
					<Tooltip>
						<TooltipTrigger delay={0}>
							<button
								type="button"
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
							</button>
						</TooltipTrigger>
						<TooltipContent>在当前时间点分割选中片段</TooltipContent>
					</Tooltip>

					<Tooltip>
						<TooltipTrigger delay={0}>
							<button
								type="button"
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
							</button>
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
	);
};

export default TimelineToolbar;
