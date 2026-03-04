import { useGesture } from "@use-gesture/react";
import type { ClipMeta, TimelineElement } from "core/element/types";
import {
	CLIP_GAIN_DB_DEFAULT,
	CLIP_GAIN_DB_MAX,
	CLIP_GAIN_DB_MIN,
	normalizeClipGainDb,
	resolveTimelineElementClipGainDb,
} from "core/editor/audio/clipGain";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTimelineStore } from "@/scene-editor/contexts/TimelineContext";
import { cn } from "@/lib/utils";

type AudioGainBaselineControlProps = {
	elementId: string;
	className?: string;
	lineClassName?: string;
};

const CENTER_RATIO = 0.5;
const DB_EPSILON = 0.01;
const DOUBLE_TAP_MAX_INTERVAL_MS = 280;

const clampNumber = (value: number, minValue: number, maxValue: number) => {
	return Math.min(maxValue, Math.max(minValue, value));
};

const gainDbToRatio = (gainDb: number): number => {
	const safeDb = normalizeClipGainDb(gainDb);
	if (safeDb >= 0) {
		const upSpan = Math.max(0.001, CLIP_GAIN_DB_MAX - CLIP_GAIN_DB_DEFAULT);
		const upRatio = safeDb / upSpan;
		return CENTER_RATIO - upRatio * CENTER_RATIO;
	}
	const downSpan = Math.max(0.001, CLIP_GAIN_DB_DEFAULT - CLIP_GAIN_DB_MIN);
	const downRatio = (CLIP_GAIN_DB_DEFAULT - safeDb) / downSpan;
	return CENTER_RATIO + downRatio * CENTER_RATIO;
};

const ratioToGainDb = (ratio: number): number => {
	const safeRatio = clampNumber(ratio, 0, 1);
	if (safeRatio <= CENTER_RATIO) {
		const upSpan = CLIP_GAIN_DB_MAX - CLIP_GAIN_DB_DEFAULT;
		const upRatio = (CENTER_RATIO - safeRatio) / CENTER_RATIO;
		return normalizeClipGainDb(CLIP_GAIN_DB_DEFAULT + upRatio * upSpan);
	}
	const downSpan = CLIP_GAIN_DB_DEFAULT - CLIP_GAIN_DB_MIN;
	const downRatio = (safeRatio - CENTER_RATIO) / CENTER_RATIO;
	return normalizeClipGainDb(CLIP_GAIN_DB_DEFAULT - downRatio * downSpan);
};

const formatGainDb = (gainDb: number): string => {
	const rounded = Math.round(gainDb * 10) / 10;
	const safe = Math.abs(rounded) < 0.05 ? 0 : rounded;
	const sign = safe > 0 ? "+" : "";
	return `${sign}${safe.toFixed(1)} dB`;
};

const updateClipGainDb = (
	clip: ClipMeta | undefined,
	gainDb: number,
): ClipMeta | undefined => {
	const safeDb = normalizeClipGainDb(gainDb);
	const hasNonGainMeta =
		Boolean(clip?.sourceVideoClipId) || clip?.muteSourceAudio === true;
	if (Math.abs(safeDb - CLIP_GAIN_DB_DEFAULT) <= DB_EPSILON) {
		if (!hasNonGainMeta) return undefined;
		if (!clip) return undefined;
		const { gainDb: _removed, ...rest } = clip;
		return Object.keys(rest).length > 0 ? rest : undefined;
	}
	return {
		...(clip ?? {}),
		gainDb: safeDb,
	};
};

export const AudioGainBaselineControl: React.FC<
	AudioGainBaselineControlProps
> = ({ elementId, className, lineClassName }) => {
	const setElements = useTimelineStore((state) => state.setElements);
	const getElements = useTimelineStore((state) => state.getElements);
	const gainDb = useTimelineStore((state) =>
		resolveTimelineElementClipGainDb(state.getElementById(elementId)),
	);
	const containerRef = useRef<HTMLDivElement>(null);
	const dragStartGainDbRef = useRef<number | null>(null);
	const dragStartElementsRef = useRef<TimelineElement[] | null>(null);
	const dragMovedGainDbRef = useRef<number | null>(null);
	const lastTapTimestampRef = useRef<number>(0);
	const [isDragging, setIsDragging] = useState(false);
	const [isHovered, setIsHovered] = useState(false);

	const updateElementGainDb = useCallback(
		(nextGainDb: number, withHistory: boolean) => {
			const safeDb = normalizeClipGainDb(nextGainDb);
			setElements(
				(prev) => {
					let changed = false;
					const next = prev.map((element) => {
						if (element.id !== elementId) return element;
						const currentDb = resolveTimelineElementClipGainDb(element);
						if (Math.abs(currentDb - safeDb) <= DB_EPSILON) return element;
						changed = true;
						return {
							...element,
							clip: updateClipGainDb(element.clip, safeDb),
						} satisfies TimelineElement;
					});
					return changed ? next : prev;
				},
				{ history: withHistory },
			);
		},
		[elementId, setElements],
	);

	const resolveGainDbByClientY = useCallback(
		(clientY: number): number | null => {
			const container = containerRef.current;
			if (!container) return null;
			const rect = container.getBoundingClientRect();
			if (rect.height <= 0) return null;
			const ratio = clampNumber((clientY - rect.top) / rect.height, 0, 1);
			return ratioToGainDb(ratio);
		},
		[],
	);

	const resetDragState = useCallback(() => {
		dragStartGainDbRef.current = null;
		dragStartElementsRef.current = null;
		dragMovedGainDbRef.current = null;
		setIsDragging(false);
	}, []);

	const startDragSession = useCallback(() => {
		if (dragStartGainDbRef.current !== null) return;
		dragStartGainDbRef.current = gainDb;
		dragStartElementsRef.current = getElements();
		dragMovedGainDbRef.current = null;
		setIsDragging(true);
	}, [gainDb, getElements]);

	const bindGainGesture = useGesture(
		{
			onPointerDown: ({ event }) => {
				event.preventDefault();
				event.stopPropagation();
				startDragSession();
			},
			onHover: ({ hovering }) => {
				setIsHovered(Boolean(hovering));
			},
			onDrag: ({
				first,
				last,
				tap,
				movement: [mx, my],
				xy: [, clientY],
				event,
			}) => {
				event.preventDefault();
				event.stopPropagation();

				if (first) {
					startDragSession();
				}

				const hasMoved = Math.abs(mx) > 0 || Math.abs(my) > 0;
				if (!last) {
					if (!hasMoved) return;
					const nextGainDb = resolveGainDbByClientY(clientY);
					if (nextGainDb === null) return;
					dragMovedGainDbRef.current = nextGainDb;
					updateElementGainDb(nextGainDb, false);
					return;
				}

				if (tap) {
					const currentTapTimestamp =
						typeof event.timeStamp === "number" ? event.timeStamp : Date.now();
					const isDoubleTap =
						lastTapTimestampRef.current > 0 &&
						currentTapTimestamp - lastTapTimestampRef.current <=
							DOUBLE_TAP_MAX_INTERVAL_MS;
					lastTapTimestampRef.current = isDoubleTap ? 0 : currentTapTimestamp;
					if (isDoubleTap) {
						updateElementGainDb(CLIP_GAIN_DB_DEFAULT, true);
					}
					resetDragState();
					return;
				}

				let nextGainDb = dragMovedGainDbRef.current;
				if (hasMoved) {
					const resolvedGainDb = resolveGainDbByClientY(clientY);
					if (resolvedGainDb !== null) {
						nextGainDb = resolvedGainDb;
					}
				}
				const dragStartGainDb = dragStartGainDbRef.current;
				const dragStartElements = dragStartElementsRef.current;
				if (nextGainDb !== null) {
					const hasMeaningfulChange =
						dragStartGainDb !== null &&
						Math.abs(nextGainDb - dragStartGainDb) > DB_EPSILON;
					if (hasMeaningfulChange && dragStartElements) {
						setElements(dragStartElements, { history: false });
						updateElementGainDb(nextGainDb, true);
					}
				}
				lastTapTimestampRef.current = 0;
				resetDragState();
			},
		},
		{
			drag: {
				filterTaps: true,
				threshold: 0,
				triggerAllEvents: true,
			},
		},
	);

	const lineRatio = gainDbToRatio(gainDb);
	const lineTopPercent = `${clampNumber(lineRatio, 0, 1) * 100}%`;
	const lineOpacityClassName =
		isDragging || isHovered ? "opacity-100" : "opacity-50";

	return (
		<div
			ref={containerRef}
			className={cn("absolute inset-0 z-20 pointer-events-none", className)}
		>
			<Tooltip open={isDragging} trackCursorAxis="both">
				<TooltipTrigger
					type="button"
					delay={0}
					role="slider"
					aria-label="Clip Gain"
					aria-valuemin={CLIP_GAIN_DB_MIN}
					aria-valuemax={CLIP_GAIN_DB_MAX}
					aria-valuenow={Math.round(gainDb * 10) / 10}
					aria-valuetext={formatGainDb(gainDb)}
					tabIndex={-1}
					className="absolute inset-x-0 h-2 -translate-y-1/2 cursor-row-resize touch-none pointer-events-auto appearance-none bg-transparent border-0 p-0"
					style={{ top: lineTopPercent }}
					{...bindGainGesture()}
				>
					<div
						className={cn(
							"absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-white/70 transition-opacity duration-150",
							lineOpacityClassName,
							lineClassName,
						)}
					/>
				</TooltipTrigger>
				<TooltipContent sideOffset={24}>{formatGainDb(gainDb)}</TooltipContent>
			</Tooltip>
		</div>
	);
};
