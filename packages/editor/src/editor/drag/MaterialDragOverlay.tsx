import React from "react";
import { createPortal } from "react-dom";
import { secondsToFrames } from "@/utils/timecode";
import { useFps, useTimelineScale } from "../contexts/TimelineContext";
import {
	getElementHeightForTrack,
	TRACK_CONTENT_GAP,
} from "../timeline/trackConfig";
import { getPixelsPerFrame } from "../utils/timelineScale";
import { getTrackYFromHeights } from "../utils/trackAssignment";
import { getTransitionDurationParts } from "../utils/transitions";
import { isMaterialDragData, useDragStore } from "./dragStore";
import { parseTrackHeights } from "./timelineDropTargets";

const MaterialDragGhost: React.FC = () => {
	const { isDragging, ghostInfo, dragSource, dropTarget } = useDragStore();
	if (
		!isDragging ||
		!ghostInfo ||
		(dragSource !== "material-library" && dragSource !== "external-file")
	) {
		return null;
	}
	if (dropTarget?.zone === "timeline") {
		return null;
	}

	return createPortal(
		<div
			className="fixed pointer-events-none z-9999"
			style={{
				left: ghostInfo.screenX,
				top: ghostInfo.screenY,
				width: ghostInfo.width,
				height: ghostInfo.height,
			}}
		>
			{ghostInfo.thumbnailUrl && (
				<img
					src={ghostInfo.thumbnailUrl}
					alt=""
					className="w-full h-full object-cover rounded-md opacity-80"
				/>
			)}
			<div className="absolute inset-0 border-2 border-blue-500 rounded-md shadow-lg shadow-blue-500/30" />
			{ghostInfo.label && (
				<div className="absolute -bottom-6 left-0 right-0 text-center text-xs text-white bg-black/60 rounded px-1 py-0.5 truncate">
					{ghostInfo.label}
				</div>
			)}
		</div>,
		document.body,
	);
};

const MaterialDropIndicator: React.FC = () => {
	const { isDragging, dragSource, dropTarget } = useDragStore();
	const dragData = useDragStore((state) => state.dragData);
	const { fps } = useFps();
	const { timelineScale } = useTimelineScale();
	const ratio = getPixelsPerFrame(fps, timelineScale);
	const indicatorOffset = TRACK_CONTENT_GAP / 2;

	if (
		!isDragging ||
		(dragSource !== "material-library" && dragSource !== "external-file") ||
		!dropTarget
	) {
		return null;
	}
	if (dropTarget.zone !== "timeline" || !dropTarget.canDrop) {
		return null;
	}

	const targetType = dropTarget.type ?? "track";
	const trackIndex = dropTarget.trackIndex ?? 0;
	const time = dropTarget.time ?? 0;
	const defaultDurationFrames = secondsToFrames(5, fps);
	const isTransitionMaterial =
		dragData && isMaterialDragData(dragData) && dragData.type === "transition";
	const fallbackDurationFrames = isTransitionMaterial
		? 15
		: defaultDurationFrames;
	const materialDurationFrames =
		dragData &&
		isMaterialDragData(dragData) &&
		Number.isFinite(dragData.duration) &&
		(dragData.duration ?? 0) > 0
			? (dragData.duration as number)
			: fallbackDurationFrames;
	const elementWidth = materialDurationFrames * ratio;
	const transitionHead = getTransitionDurationParts(materialDurationFrames).head;

	let targetZone: HTMLElement | null = null;
	let screenX = 0;
	let screenY = 0;
	let indicatorHeight = 40;

	if (targetType === "gap") {
		targetZone = document.querySelector<HTMLElement>(
			'[data-track-drop-zone="other"]',
		);
		if (!targetZone) return null;
		const contentArea = targetZone.querySelector<HTMLElement>(
			'[data-track-content-area="other"]',
		);
		if (!contentArea) return null;

		const contentRect = contentArea.getBoundingClientRect();
		const otherTrackCount = parseInt(targetZone.dataset.trackCount || "0", 10);
		const trackHeights = parseTrackHeights(targetZone.dataset.trackHeights);
		const fallbackTrackHeight = parseInt(
			targetZone.dataset.trackHeight || "60",
			10,
		);
		const gapIndex = Math.max(1, trackIndex);
		const gapBaseTrack = Math.min(gapIndex - 1, Math.max(otherTrackCount, 0));
		const gapY =
			trackHeights.length > 0
				? getTrackYFromHeights(
						gapBaseTrack,
						trackHeights,
						Math.max(otherTrackCount, gapBaseTrack),
					)
				: Math.max(0, otherTrackCount - gapBaseTrack) * fallbackTrackHeight;
		const paddingLeft = contentArea.parentElement
			? parseFloat(
					getComputedStyle(contentArea.parentElement).paddingLeft || "0",
				)
			: 0;
		screenX = contentRect.left - paddingLeft;
		screenY = contentRect.top + gapY;

		return createPortal(
			<div
				className="fixed h-px bg-green-500 z-9998 pointer-events-none rounded-full shadow-lg shadow-green-500/50"
				style={{
					left: screenX,
					top: screenY,
					width: contentRect.width + paddingLeft,
				}}
			/>,
			document.body,
		);
	}

	if (trackIndex === 0) {
		targetZone = document.querySelector<HTMLElement>(
			'[data-track-drop-zone="main"]',
		);
		if (targetZone) {
			const contentArea = targetZone.querySelector<HTMLElement>(
				'[data-track-content-area="main"]',
			);
			if (contentArea) {
				const contentRect = contentArea.getBoundingClientRect();
				const scrollLeft = useDragStore.getState().timelineScrollLeft;
				const startTime = isTransitionMaterial ? time - transitionHead : time;
				screenX = contentRect.left + startTime * ratio - scrollLeft;
				screenY = contentRect.top + indicatorOffset;
				indicatorHeight = getElementHeightForTrack(
					contentRect.height || indicatorHeight,
				);
			}
		}
	} else {
		targetZone = document.querySelector<HTMLElement>(
			'[data-track-drop-zone="other"]',
		);
		if (targetZone) {
			const contentArea = targetZone.querySelector<HTMLElement>(
				'[data-track-content-area="other"]',
			);
			const otherTrackCount = parseInt(
				targetZone.dataset.trackCount || "0",
				10,
			);
			const trackHeights = parseTrackHeights(targetZone.dataset.trackHeights);
			const fallbackTrackHeight = parseInt(
				targetZone.dataset.trackHeight || "60",
				10,
			);
			if (contentArea) {
				const contentRect = contentArea.getBoundingClientRect();
				const scrollLeft = useDragStore.getState().timelineScrollLeft;
				const trackFromTop = otherTrackCount - trackIndex;
				const trackHeightForIndex =
					trackHeights.length > 0
						? trackHeights[
								Math.max(0, Math.min(trackHeights.length - 1, trackFromTop))
							]
						: fallbackTrackHeight;
				const trackY =
					trackHeights.length > 0
						? getTrackYFromHeights(trackIndex, trackHeights, otherTrackCount)
						: (otherTrackCount - trackIndex) * fallbackTrackHeight;
				const startTime = isTransitionMaterial ? time - transitionHead : time;
				screenX = contentRect.left + startTime * ratio - scrollLeft;
				screenY = contentRect.top + trackY + indicatorOffset;
				indicatorHeight = getElementHeightForTrack(trackHeightForIndex);
			}
		}
	}

	if (!targetZone) return null;

	return createPortal(
		<div
			className="fixed bg-green-500/20 border-2 border-green-500 border-dashed z-9998 pointer-events-none rounded-md box-border"
			style={{
				left: screenX,
				top: screenY,
				width: elementWidth,
				height: indicatorHeight,
			}}
		/>,
		document.body,
	);
};

const MaterialDragOverlay: React.FC = () => {
	return (
		<>
			<MaterialDragGhost />
			<MaterialDropIndicator />
		</>
	);
};

export default MaterialDragOverlay;
