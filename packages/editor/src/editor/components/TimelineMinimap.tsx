import type { TimelineElement } from "core/dsl/types";
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

interface TimelineMinimapProps {
	fps: number;
	timelinePaddingLeft: number;
	className?: string;
}

interface DragState {
	pointerId: number;
	startClientX: number;
	startFrame: number;
}

const MIN_VIEWPORT_WIDTH_PX = 12;

const clamp = (value: number, min: number, max: number): number => {
	return Math.min(max, Math.max(min, value));
};

const resolveSegmentColor = (elementType: TimelineElement["type"]) => {
	switch (elementType) {
		case "VideoClip":
			return "rgba(96, 165, 250, 0.72)";
		case "AudioClip":
			return "rgba(52, 211, 153, 0.72)";
		default:
			return "rgba(252, 211, 77, 0.68)";
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
		const laneCount = Math.max(1, trackOrder.length);
		const laneHeight = 100 / laneCount;
		const lanePadding = Math.min(2, laneHeight * 0.2);

		return elements
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
					topPercent: laneIndex * laneHeight + lanePadding,
					heightPercent: Math.max(2, laneHeight - lanePadding * 2),
					color: resolveSegmentColor(element.type),
				};
			})
			.filter((segment) => segment.leftPercent <= 100);
	}, [elements, timelineVisualEndFrame, trackLaneMap, trackOrder]);

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

		// 用 canvas 绘制海量元素缩略块，避免大量 DOM 节点渲染开销
		for (const segment of segments) {
			const x = (segment.leftPercent / 100) * containerWidth;
			const y = (segment.topPercent / 100) * containerHeight;
			const width = Math.max(
				(segment.widthPercent / 100) * containerWidth,
				0.5,
			);
			const height = Math.max(
				(segment.heightPercent / 100) * containerHeight,
				1,
			);
			if (x > containerWidth) continue;
			ctx.fillStyle = segment.color;
			ctx.fillRect(x, y, Math.min(width, containerWidth - x), height);
		}
	}, [containerHeight, containerWidth, segments]);

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) return;
			const container = containerRef.current;
			if (!container) return;

			updateContainerWidth();

			const target = event.target as HTMLElement;
			const isViewportHandle = Boolean(
				target.closest('[data-minimap-viewport="true"]'),
			);

			if (isViewportHandle) {
				event.preventDefault();
				container.setPointerCapture?.(event.pointerId);
				setDragState({
					pointerId: event.pointerId,
					startClientX: event.clientX,
					startFrame: visibleStartFrame,
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
			const frameDelta = (deltaX / rect.width) * timelineVisualEndFrame;
			setViewportStartFrame(dragState.startFrame + frameDelta);
		},
		[dragState, setViewportStartFrame, timelineVisualEndFrame],
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
				"relative h-8 w-full rounded border border-neutral-700 bg-neutral-900/70 overflow-hidden touch-none select-none",
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
				className="absolute top-0 bottom-0 rounded border border-blue-300/80 bg-blue-400/20 cursor-grab active:cursor-grabbing"
				style={{
					left: `${viewportLeftPercent}%`,
					width: `${viewportWidthPercent}%`,
					minWidth: `${MIN_VIEWPORT_WIDTH_PX}px`,
				}}
			/>
		</section>
	);
};

export default TimelineMinimap;
