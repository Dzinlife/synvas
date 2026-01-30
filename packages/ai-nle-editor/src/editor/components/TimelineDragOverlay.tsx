import React, { useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { DragGhostState } from "../contexts/TimelineContext";
import {
	DEFAULT_TRACK_HEIGHT,
	getElementHeightForTrack,
	TRACK_CONTENT_GAP,
} from "../timeline/trackConfig";
import { ExtendedDropTarget } from "../timeline/types";
import { getTrackYFromHeights } from "../utils/trackAssignment";

interface TimelineDragOverlayProps {
	activeDropTarget: ExtendedDropTarget | null;
	dragGhosts: DragGhostState[];
	ratio: number;
	scrollLeft: number;
	otherTrackCount: number;
	otherTrackHeights: number[];
	mainTrackHeight: number;
	timelinePaddingLeft?: number;
}

const GhostClone: React.FC<{ ghost: DragGhostState }> = ({ ghost }) => {
	const containerRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		while (container.firstChild) {
			container.removeChild(container.firstChild);
		}
		if (!ghost.clonedNode) return;
		container.appendChild(ghost.clonedNode);
	}, [ghost.clonedNode]);

	return (
		<div
			className="fixed pointer-events-none"
			style={{
				left: ghost.screenX,
				top: ghost.screenY,
				width: ghost.width,
				height: ghost.height,
				zIndex: 9999,
			}}
		>
			<div ref={containerRef} className="absolute inset-0 opacity-60" />
			<div className="absolute inset-0 border-2 border-blue-500 rounded-md shadow-lg shadow-blue-500/30" />
		</div>
	);
};

const TimelineDragOverlay: React.FC<TimelineDragOverlayProps> = ({
	activeDropTarget,
	dragGhosts,
	ratio,
	scrollLeft,
	otherTrackCount,
	otherTrackHeights,
	mainTrackHeight,
	timelinePaddingLeft = 0,
}) => {
	const dropIndicatorPortal = useMemo(() => {
		if (!activeDropTarget) return null;

		const elementWidth =
			(activeDropTarget.end - activeDropTarget.start) * ratio;
		const resolveOtherTrackHeight = (trackIndex: number) => {
			if (otherTrackCount <= 0 || otherTrackHeights.length === 0) {
				return DEFAULT_TRACK_HEIGHT;
			}
			const trackFromTop = otherTrackCount - trackIndex;
			const boundedIndex = Math.max(
				0,
				Math.min(otherTrackHeights.length - 1, trackFromTop),
			);
			return otherTrackHeights[boundedIndex];
		};
		const indicatorHeight = getElementHeightForTrack(
			activeDropTarget.finalTrackIndex === 0
				? mainTrackHeight
				: resolveOtherTrackHeight(activeDropTarget.finalTrackIndex),
		);
		const indicatorOffset = TRACK_CONTENT_GAP / 2;

		let targetZone: HTMLElement | null = null;
		let screenX = 0;
		let screenY = 0;

		if (activeDropTarget.finalTrackIndex === 0) {
			targetZone = document.querySelector<HTMLElement>(
				'[data-track-drop-zone="main"]',
			);
			if (targetZone) {
				const contentArea = targetZone.querySelector<HTMLElement>(
					'[data-track-content-area="main"]',
				);
				if (contentArea) {
					const contentRect = contentArea.getBoundingClientRect();
					screenX =
						contentRect.left + activeDropTarget.start * ratio - scrollLeft;
					screenY = contentRect.top + indicatorOffset;
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
				if (contentArea) {
					const contentRect = contentArea.getBoundingClientRect();

					if (activeDropTarget.type === "gap") {
						const gapY = getTrackYFromHeights(
							activeDropTarget.trackIndex - 1,
							otherTrackHeights,
							otherTrackCount,
						);
						screenX = contentRect.left - timelinePaddingLeft;
						screenY = contentRect.top + gapY;

						const indicator = (
							<div
								className="fixed h-px bg-green-500 z-9998 pointer-events-none rounded-full shadow-lg shadow-green-500/50"
								style={{
									left: screenX,
									top: screenY,
									width: contentRect.width + timelinePaddingLeft,
								}}
							/>
						);
						return createPortal(indicator, document.body);
					}

					const trackY = getTrackYFromHeights(
						activeDropTarget.finalTrackIndex,
						otherTrackHeights,
						otherTrackCount,
					);
					screenX =
						contentRect.left + activeDropTarget.start * ratio - scrollLeft;
					screenY = contentRect.top + trackY + indicatorOffset;
				}
			}
		}

		if (!targetZone) return null;

		const indicator = (
			<div
				className="fixed bg-blue-500/20 border-2 border-blue-500 border-dashed z-9998 pointer-events-none rounded-md box-border"
				style={{
					left: screenX,
					top: screenY,
					width: elementWidth,
					height: indicatorHeight,
				}}
			/>
		);

		return createPortal(indicator, document.body);
	}, [
		activeDropTarget,
		ratio,
		scrollLeft,
		otherTrackCount,
		otherTrackHeights,
		mainTrackHeight,
	]);

	const ghostElement = useMemo(() => {
		if (!dragGhosts.length) return null;

		const ghosts = dragGhosts.map((ghost) => (
			<GhostClone key={ghost.elementId} ghost={ghost} />
		));

		return createPortal(ghosts, document.body);
	}, [dragGhosts]);

	return (
		<>
			{ghostElement}
			{dropIndicatorPortal}
		</>
	);
};

export default TimelineDragOverlay;
