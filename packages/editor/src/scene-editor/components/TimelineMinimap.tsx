import type { TimelineElement } from "core/element/types";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";
import { useTimelineStore } from "../contexts/TimelineContext";
import { getPixelsPerFrame } from "../utils/timelineScale";
import {
	MAX_TIMELINE_SCALE,
	MIN_TIMELINE_SCALE,
} from "../utils/timelineZoom";

interface TimelineMinimapProps {
	fps: number;
	timelinePaddingLeft: number;
	className?: string;
}

type DragMode = "move-viewport" | "resize-left" | "resize-right";

interface DragState {
	mode: DragMode;
	pointerId: number;
	startClientX: number;
	startFrame: number;
	startVisibleFrameCount: number;
	visualFrameSpan: number;
}

const MIN_VIEWPORT_WIDTH_PX = 12;
const MAX_SEGMENT_HEIGHT_PX = 5;
const MIN_HANDLE_HIT_WIDTH_PX = 10;

const clamp = (value: number, min: number, max: number): number => {
	return Math.min(max, Math.max(min, value));
};

const resolveSegmentColor = (elementType: TimelineElement["type"]) => {
	switch (elementType) {
		case "VideoClip":
			return "#4995FF";
		case "AudioClip":
			return "#34d399";
		case "Image":
			return "#FFFA62";
		case "FreezeFrame":
			return "#FFFA62";
		case "Filter":
			return "#EB61E7";
		default:
			return "#fcd34d";
	}
};

const TimelineMinimap: React.FC<TimelineMinimapProps> = ({
	fps,
	timelinePaddingLeft,
	className,
}) => {
	const elements = useTimelineStore((state) => state.elements);
	const timelineScale = useTimelineStore((state) => state.timelineScale);
	const scrollLeft = useTimelineStore((state) => state.scrollLeft);
	const timelineMaxScrollLeft = useTimelineStore(
		(state) => state.timelineMaxScrollLeft,
	);
	const timelineViewportWidth = useTimelineStore(
		(state) => state.timelineViewportWidth,
	);
	const setScrollLeft = useTimelineStore((state) => state.setScrollLeft);
	const setTimelineScale = useTimelineStore((state) => state.setTimelineScale);

	const containerRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);
	const [containerWidth, setContainerWidth] = useState(0);
	const [containerHeight, setContainerHeight] = useState(0);
	const [dragState, setDragState] = useState<DragState | null>(null);

	const ratio = getPixelsPerFrame(fps, timelineScale);
	const pixelsPerFrame =
		Number.isFinite(ratio) && ratio > 0 ? ratio : getPixelsPerFrame(fps, 1);
	const viewportWidth = Math.max(0, timelineViewportWidth);

	const timelineEndFrame = useMemo(() => {
		return elements.reduce((maxFrame, element) => {
			const endFrame = Math.round(element.timeline.end ?? 0);
			return Math.max(maxFrame, endFrame);
		}, 1);
	}, [elements]);

	const trackOrder = useMemo(() => {
		if (elements.length === 0) return [0];
		const trackSet = new Set<number>();
		for (const element of elements) {
			const rawTrackIndex = element.timeline.trackIndex;
			const trackIndex =
				typeof rawTrackIndex === "number" && Number.isFinite(rawTrackIndex)
					? rawTrackIndex
					: 0;
			trackSet.add(trackIndex);
		}
		return Array.from(trackSet).sort((a, b) => b - a);
	}, [elements]);

	const trackLaneMap = useMemo(() => {
		return new Map(
			trackOrder.map((trackIndex, laneIndex) => [trackIndex, laneIndex]),
		);
	}, [trackOrder]);
	const laneCount = Math.max(1, trackOrder.length);
	const visibleFrameCount =
		pixelsPerFrame > 0 ? viewportWidth / pixelsPerFrame : 0;
	const maxScrollLeft = Math.max(0, timelineMaxScrollLeft);
	const maxStartFrame =
		pixelsPerFrame > 0
			? Math.max(0, (maxScrollLeft - timelinePaddingLeft) / pixelsPerFrame)
			: 0;
	const timelineVisualEndFrame = Math.max(
		1,
		timelineEndFrame,
		maxStartFrame + visibleFrameCount,
	);

	const segments = useMemo(() => {
		const nextSegments = elements
			.map((element) => {
				const startFrame = Math.max(0, Math.round(element.timeline.start ?? 0));
				const rawEndFrame = Math.round(element.timeline.end ?? startFrame + 1);
				const endFrame = Math.max(startFrame + 1, rawEndFrame);
				const rawTrackIndex = element.timeline.trackIndex;
				const trackIndex =
					typeof rawTrackIndex === "number" && Number.isFinite(rawTrackIndex)
						? rawTrackIndex
						: 0;
				const laneIndex = trackLaneMap.get(trackIndex) ?? 0;
				const leftPercent = (startFrame / timelineVisualEndFrame) * 100;
				const widthPercent = Math.max(
					((endFrame - startFrame) / timelineVisualEndFrame) * 100,
					0.3,
				);

				return {
					id: element.id,
					leftPercent,
					widthPercent,
					laneIndex,
					color: resolveSegmentColor(element.type),
				};
			})
			.filter((segment) => segment.leftPercent <= 100);
		nextSegments.sort(
			(a, b) => a.laneIndex - b.laneIndex || a.leftPercent - b.leftPercent,
		);
		return nextSegments;
	}, [elements, timelineVisualEndFrame, trackLaneMap]);

	const visibleStartFrame = clamp(
		(scrollLeft - timelinePaddingLeft) / pixelsPerFrame,
		0,
		maxStartFrame,
	);

	// 视窗最小宽度用像素限制，保证拖拽时命中区域可操作
	const minViewportWidthPercent =
		containerWidth > 0 ? (MIN_VIEWPORT_WIDTH_PX / containerWidth) * 100 : 0;
	const viewportWidthPercent = Math.min(
		100,
		Math.max(
			(visibleFrameCount / timelineVisualEndFrame) * 100,
			minViewportWidthPercent,
		),
	);
	const viewportLeftPercent = clamp(
		(visibleStartFrame / timelineVisualEndFrame) * 100,
		0,
		Math.max(0, 100 - viewportWidthPercent),
	);

	const setViewportStartFrame = useCallback(
		(nextStartFrame: number) => {
			const clampedStartFrame = clamp(nextStartFrame, 0, maxStartFrame);
			const rawScrollLeft =
				clampedStartFrame <= 0
					? 0
					: clampedStartFrame * pixelsPerFrame + timelinePaddingLeft;
			setScrollLeft(rawScrollLeft);
		},
		[maxStartFrame, pixelsPerFrame, setScrollLeft, timelinePaddingLeft],
	);
	const setScaleByVisibleFrameCount = useCallback(
		(nextVisibleFrameCount: number, anchorOffsetPx: number) => {
			if (viewportWidth <= 0) return;
			const safeVisibleFrameCount = Math.max(nextVisibleFrameCount, 1e-6);
			const basePixelsPerFrame = getPixelsPerFrame(fps, 1);
			if (!Number.isFinite(basePixelsPerFrame) || basePixelsPerFrame <= 0) {
				return;
			}
			const nextPixelsPerFrame = viewportWidth / safeVisibleFrameCount;
			const nextScale = clamp(
				nextPixelsPerFrame / basePixelsPerFrame,
				MIN_TIMELINE_SCALE,
				MAX_TIMELINE_SCALE,
			);
			setTimelineScale(nextScale, { anchorOffsetPx });
		},
		[fps, setTimelineScale, viewportWidth],
	);

	const updateContainerWidth = useCallback(() => {
		const rect = containerRef.current?.getBoundingClientRect();
		const nextWidth = rect?.width ?? 0;
		const nextHeight = rect?.height ?? 0;
		setContainerWidth(
			Number.isFinite(nextWidth) ? Math.max(0, nextWidth) : containerWidth,
		);
		setContainerHeight(
			Number.isFinite(nextHeight) ? Math.max(0, nextHeight) : containerHeight,
		);
	}, [containerHeight, containerWidth]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || containerWidth <= 0 || containerHeight <= 0) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const dpr =
			typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
				? Math.max(1, window.devicePixelRatio)
				: 1;
		const targetWidth = Math.max(1, Math.round(containerWidth * dpr));
		const targetHeight = Math.max(1, Math.round(containerHeight * dpr));
		if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
			canvas.width = targetWidth;
			canvas.height = targetHeight;
		}

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, containerWidth, containerHeight);

		const laneHeight =
			laneCount > 0
				? Math.min(MAX_SEGMENT_HEIGHT_PX, containerHeight / laneCount)
				: 0;
		const lanePadding = Math.min(1, laneHeight * 0.2);
		const segmentHeight = Math.max(0, laneHeight - lanePadding * 2);
		const segmentGroupHeight = laneHeight * laneCount;
		const offsetY = Math.max(0, (containerHeight - segmentGroupHeight) / 2);

		// 用 canvas 绘制海量元素缩略块，避免大量 DOM 节点渲染开销
		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i];
			if (!segment) continue;

			const prevSegment = segments[i - 1];
			const nextSegment = segments[i + 1];
			const hasPrevSibling = prevSegment?.laneIndex === segment.laneIndex;
			const hasNextSibling = nextSegment?.laneIndex === segment.laneIndex;
			const baseInsetLeft = hasPrevSibling ? lanePadding / 2 : 0;
			const baseInsetRight = hasNextSibling ? lanePadding / 2 : 0;

			const rawX = (segment.leftPercent / 100) * containerWidth;
			const rawWidth = Math.max(
				(segment.widthPercent / 100) * containerWidth,
				0.5,
			);
			const totalBaseInset = baseInsetLeft + baseInsetRight;
			const maxInset = Math.max(0, rawWidth - 0.5);
			const insetScale =
				totalBaseInset > 0 ? Math.min(1, maxInset / totalBaseInset) : 0;
			const insetLeft = baseInsetLeft * insetScale;
			const insetRight = baseInsetRight * insetScale;
			const x = rawX + insetLeft;
			const y = offsetY + segment.laneIndex * laneHeight + lanePadding;
			const width = Math.max(rawWidth - insetLeft - insetRight, 0.5);
			const height = segmentHeight;
			if (x > containerWidth) continue;
			ctx.fillStyle = segment.color;
			ctx.fillRect(x, y, Math.min(width, containerWidth - x), height);
		}
	}, [containerHeight, containerWidth, laneCount, segments]);

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) return;
			const container = containerRef.current;
			if (!container) return;

			updateContainerWidth();

			const target = event.target as HTMLElement;
			const resizeHandle = target.closest(
				"[data-minimap-resize-handle]",
			) as HTMLElement | null;
			const resizeHandleSide = resizeHandle?.dataset.minimapResizeHandle;
			if (resizeHandleSide === "left" || resizeHandleSide === "right") {
				event.preventDefault();
				container.setPointerCapture?.(event.pointerId);
				setDragState({
					mode:
						resizeHandleSide === "left" ? "resize-left" : "resize-right",
					pointerId: event.pointerId,
					startClientX: event.clientX,
					startFrame: visibleStartFrame,
					startVisibleFrameCount: visibleFrameCount,
					visualFrameSpan: timelineVisualEndFrame,
				});
				return;
			}
			const isViewportHandle = Boolean(
				target.closest('[data-minimap-viewport="true"]'),
			);

			if (isViewportHandle) {
				event.preventDefault();
				container.setPointerCapture?.(event.pointerId);
				setDragState({
					mode: "move-viewport",
					pointerId: event.pointerId,
					startClientX: event.clientX,
					startFrame: visibleStartFrame,
					startVisibleFrameCount: visibleFrameCount,
					visualFrameSpan: timelineVisualEndFrame,
				});
				return;
			}

			const rect = container.getBoundingClientRect();
			if (rect.width <= 0) return;
			const pointerRatio = clamp(
				(event.clientX - rect.left) / rect.width,
				0,
				1,
			);
			const frameAtPointer = pointerRatio * timelineVisualEndFrame;
			setViewportStartFrame(frameAtPointer - visibleFrameCount / 2);
		},
		[
			setViewportStartFrame,
			timelineVisualEndFrame,
			updateContainerWidth,
			visibleFrameCount,
			visibleStartFrame,
		],
	);

	const handlePointerMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (!dragState || event.pointerId !== dragState.pointerId) return;
			const container = containerRef.current;
			if (!container) return;
			const rect = container.getBoundingClientRect();
			if (rect.width <= 0) return;

			const deltaX = event.clientX - dragState.startClientX;
			const frameDelta = (deltaX / rect.width) * dragState.visualFrameSpan;
			if (dragState.mode === "move-viewport") {
				setViewportStartFrame(dragState.startFrame + frameDelta);
				return;
			}
			if (viewportWidth <= 0) return;
			const minVisibleFrameCount = viewportWidth / getPixelsPerFrame(
				fps,
				MAX_TIMELINE_SCALE,
			);
			const maxVisibleFrameCount = viewportWidth / getPixelsPerFrame(
				fps,
				MIN_TIMELINE_SCALE,
			);
			if (
				!Number.isFinite(minVisibleFrameCount) ||
				!Number.isFinite(maxVisibleFrameCount) ||
				minVisibleFrameCount <= 0 ||
				maxVisibleFrameCount <= 0
			) {
				return;
			}
			const nextVisibleFrameCount = clamp(
				dragState.mode === "resize-left"
					? dragState.startVisibleFrameCount - frameDelta
					: dragState.startVisibleFrameCount + frameDelta,
				Math.min(minVisibleFrameCount, maxVisibleFrameCount),
				Math.max(minVisibleFrameCount, maxVisibleFrameCount),
			);
			setScaleByVisibleFrameCount(
				nextVisibleFrameCount,
				dragState.mode === "resize-left" ? viewportWidth : 0,
			);
		},
		[dragState, fps, setScaleByVisibleFrameCount, setViewportStartFrame, viewportWidth],
	);

	const stopDragging = useCallback((pointerId?: number) => {
		const container = containerRef.current;
		if (
			container &&
			typeof pointerId === "number" &&
			container.hasPointerCapture?.(pointerId)
		) {
			container.releasePointerCapture?.(pointerId);
		}
		setDragState((prev) => (prev ? null : prev));
	}, []);

	const setContainerElement = useCallback((node: HTMLDivElement | null) => {
		if (resizeObserverRef.current) {
			resizeObserverRef.current.disconnect();
			resizeObserverRef.current = null;
		}

		containerRef.current = node;
		if (!node) {
			setContainerWidth(0);
			setContainerHeight(0);
			return;
		}
		const rect = node.getBoundingClientRect();
		setContainerWidth(
			Number.isFinite(rect.width) ? Math.max(0, rect.width) : 0,
		);
		setContainerHeight(
			Number.isFinite(rect.height) ? Math.max(0, rect.height) : 0,
		);
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const { width, height } = entry.contentRect;
			setContainerWidth(Number.isFinite(width) ? Math.max(0, width) : 0);
			setContainerHeight(Number.isFinite(height) ? Math.max(0, height) : 0);
		});
		observer.observe(node);
		resizeObserverRef.current = observer;
	}, []);

	useEffect(() => {
		return () => {
			if (!resizeObserverRef.current) return;
			resizeObserverRef.current.disconnect();
			resizeObserverRef.current = null;
		};
	}, []);

	return (
		<section
			ref={setContainerElement}
			aria-label="timeline minimap"
			className={cn(
				"relative h-8 w-full rounded border-transparent grayscale opacity-50 hover:grayscale-30 hover:opacity-100 bg-neutral-900/90 overflow-hidden touch-none select-none transition-all",
				className,
			)}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={(event) => stopDragging(event.pointerId)}
			onPointerCancel={(event) => stopDragging(event.pointerId)}
			onLostPointerCapture={(event) => stopDragging(event.pointerId)}
		>
			<canvas
				ref={canvasRef}
				className="absolute inset-0 h-full w-full"
				aria-hidden
			/>
			<div className="absolute inset-0 bg-linear-to-r from-neutral-800/30 via-neutral-700/10 to-neutral-800/30" />
			<div
				data-minimap-viewport="true"
				className="absolute top-0 bottom-0 border border-transparent bg-white/5 backdrop-brightness-150 cursor-grab hover:bg-white/10 active:bg-white/15 active:cursor-grabbing transition"
				style={{
					left: `${viewportLeftPercent}%`,
					width: `${viewportWidthPercent}%`,
					minWidth: `${MIN_VIEWPORT_WIDTH_PX}px`,
				}}
			>
				{/* 左右手柄用于直接调整缩放比例，保持对侧边界稳定 */}
				<div
					data-minimap-resize-handle="left"
					className="absolute top-0 bottom-0 left-0 touch-none cursor-ew-resize"
					style={{
						width: `${MIN_HANDLE_HIT_WIDTH_PX}px`,
						transform: "translateX(-50%)",
					}}
				>
					<div className="absolute top-1 bottom-1 left-1/2 w-px -translate-x-1/2 rounded-full bg-white/60" />
				</div>
				<div
					data-minimap-resize-handle="right"
					className="absolute top-0 bottom-0 right-0 touch-none cursor-ew-resize"
					style={{
						width: `${MIN_HANDLE_HIT_WIDTH_PX}px`,
						transform: "translateX(50%)",
					}}
				>
					<div className="absolute top-1 bottom-1 left-1/2 w-px -translate-x-1/2 rounded-full bg-white/60" />
				</div>
			</div>
		</section>
	);
};

export default TimelineMinimap;
