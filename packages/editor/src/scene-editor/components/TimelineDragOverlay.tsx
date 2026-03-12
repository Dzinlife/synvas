import type React from "react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { DragGhostState } from "../contexts/TimelineContext";
import {
	DEFAULT_TRACK_HEIGHT,
	getElementHeightForTrack,
	TRACK_CONTENT_GAP,
} from "../timeline/trackConfig";
import type { ExtendedDropTarget } from "../timeline/types";
import { getTrackYFromHeights } from "../utils/trackAssignment";

interface TimelineDragOverlayProps {
	activeDropTarget: ExtendedDropTarget | null;
	dragGhosts: DragGhostState[];
	ratio: number;
	scrollLeft: number;
	otherTrackCount: number;
	otherTrackHeights: number[];
	audioTrackCount: number;
	audioTrackHeights: number[];
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
			<div ref={containerRef} className="absolute inset-0 opacity-30" />
			<div className="absolute inset-0 border border-white/60 rounded" />
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
	audioTrackCount,
	audioTrackHeights,
	mainTrackHeight,
	timelinePaddingLeft = 0,
}) => {
	const dropIndicatorPortal = useMemo(() => {
		if (!activeDropTarget) return null;
		if (activeDropTarget.type === "track" && dragGhosts.length > 1) {
			const firstTrack = dragGhosts[0]?.element.timeline.trackIndex ?? 0;
			const isSameTrack = dragGhosts.every(
				(ghost) => (ghost.element.timeline.trackIndex ?? 0) === firstTrack,
			);
			if (!isSameTrack) return null;
		}

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
		const resolveAudioTrackHeight = (trackIndex: number) => {
			if (audioTrackCount <= 0 || audioTrackHeights.length === 0) {
				return DEFAULT_TRACK_HEIGHT;
			}
			const audioIndex = Math.min(
				Math.max(1, Math.abs(trackIndex)),
				Math.max(audioTrackCount, 1),
			);
			const trackFromTop = audioIndex - 1;
			const boundedIndex = Math.max(
				0,
				Math.min(audioTrackHeights.length - 1, trackFromTop),
			);
			return audioTrackHeights[boundedIndex] ?? DEFAULT_TRACK_HEIGHT;
		};
		const indicatorHeight = getElementHeightForTrack(
			activeDropTarget.finalTrackIndex === 0
				? mainTrackHeight
				: activeDropTarget.finalTrackIndex < 0
					? resolveAudioTrackHeight(activeDropTarget.finalTrackIndex)
					: resolveOtherTrackHeight(activeDropTarget.finalTrackIndex),
		);
		const indicatorOffset = TRACK_CONTENT_GAP / 2;
		const shouldRenderMainInsertLine =
			activeDropTarget.finalTrackIndex === 0 &&
			activeDropTarget.mainTrackPreviewMode === "insert-line" &&
			Number.isFinite(activeDropTarget.mainTrackInsertTime);
		const shouldRenderMainTailBox =
			activeDropTarget.finalTrackIndex === 0 &&
			activeDropTarget.mainTrackPreviewMode === "box" &&
			Number.isFinite(activeDropTarget.mainTrackInsertTime);
		const shouldRenderOtherVirtualGap =
			activeDropTarget.finalTrackIndex > 0 &&
			activeDropTarget.type === "track" &&
			activeDropTarget.finalTrackIndex > otherTrackCount;

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
					if (shouldRenderMainInsertLine) {
						const insertTime = activeDropTarget.mainTrackInsertTime as number;
						screenX = contentRect.left + insertTime * ratio - scrollLeft;
						screenY = contentRect.top + indicatorOffset;
						const indicator = (
							<div
								className="fixed z-9998 pointer-events-none"
								style={{
									left: screenX - 0.5,
									top: screenY,
									height: indicatorHeight,
								}}
							>
								<div className="absolute left-0 top-0 -translate-x-1/2 h-full w-0.5 bg-white" />
								<div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 w-3 h-0.5 bg-white rounded-full" />
								<div className="absolute left-0 bottom-0 -translate-x-1/2 translate-y-1/2 w-3 h-0.5 bg-white rounded-full" />
							</div>
						);
						return createPortal(indicator, document.body);
					}
					const boxTime = shouldRenderMainTailBox
						? (activeDropTarget.mainTrackInsertTime as number)
						: activeDropTarget.start;
					screenX = contentRect.left + boxTime * ratio - scrollLeft;
					screenY = contentRect.top + indicatorOffset;
				}
			}
		} else if (activeDropTarget.finalTrackIndex > 0) {
			targetZone = document.querySelector<HTMLElement>(
				'[data-track-drop-zone="other"]',
			);
			if (targetZone) {
				const contentArea = targetZone.querySelector<HTMLElement>(
					'[data-track-content-area="other"]',
				);
				if (contentArea) {
					const contentRect = contentArea.getBoundingClientRect();

					if (activeDropTarget.type === "gap" || shouldRenderOtherVirtualGap) {
						const gapTrackBase = shouldRenderOtherVirtualGap
							? Math.min(
									otherTrackCount,
									Math.max(0, activeDropTarget.finalTrackIndex - 1),
								)
							: activeDropTarget.trackIndex - 1;
						const gapY = getTrackYFromHeights(
							gapTrackBase,
							otherTrackHeights,
							otherTrackCount,
						);
						screenX = contentRect.left - timelinePaddingLeft;
						screenY = contentRect.top + gapY;

						const indicator = (
							<div
								className="fixed h-px bg-white z-9998 pointer-events-none"
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
		} else {
			targetZone = document.querySelector<HTMLElement>(
				'[data-track-drop-zone="audio"]',
			);
			if (targetZone) {
				const contentArea = targetZone.querySelector<HTMLElement>(
					'[data-track-content-area="audio"]',
				);
				if (contentArea) {
					const contentRect = contentArea.getBoundingClientRect();
					if (activeDropTarget.type === "gap") {
						const totalTracks = Math.max(audioTrackCount, 0);
						let gapY = 0;
						if (totalTracks > 0) {
							const heights = [...audioTrackHeights];
							if (heights.length < totalTracks) {
								const missing = totalTracks - heights.length;
								for (let i = 0; i < missing; i += 1) {
									heights.push(DEFAULT_TRACK_HEIGHT);
								}
							}
							if (heights.length > totalTracks) {
								heights.length = totalTracks;
							}
							const totalHeight = heights.reduce(
								(sum, height) => sum + height,
								0,
							);
							const absIndex = Math.abs(activeDropTarget.trackIndex);
							if (absIndex > totalTracks) {
								gapY = totalHeight;
							} else {
								const trackFromTop = absIndex - 1;
								for (let i = 0; i < trackFromTop; i += 1) {
									gapY += heights[i] ?? DEFAULT_TRACK_HEIGHT;
								}
							}
						}

						screenX = contentRect.left - timelinePaddingLeft;
						screenY = contentRect.top + gapY;

						const indicator = (
							<div
								className="fixed h-px bg-white z-9998 pointer-events-none"
								style={{
									left: screenX,
									top: screenY,
									width: contentRect.width + timelinePaddingLeft,
								}}
							/>
						);
						return createPortal(indicator, document.body);
					}

					const audioIndex = Math.min(
						Math.max(1, Math.abs(activeDropTarget.finalTrackIndex)),
						Math.max(audioTrackCount, 1),
					);
					const trackFromTop = audioIndex - 1;
					let trackY = 0;
					if (audioTrackHeights.length > 0) {
						for (let i = 0; i < trackFromTop; i += 1) {
							trackY += audioTrackHeights[i] ?? DEFAULT_TRACK_HEIGHT;
						}
					} else {
						trackY = trackFromTop * DEFAULT_TRACK_HEIGHT;
					}
					screenX =
						contentRect.left + activeDropTarget.start * ratio - scrollLeft;
					screenY = contentRect.top + trackY + indicatorOffset;
				}
			}
		}

		if (!targetZone) return null;

		const indicator = (
			<div
				className="fixed bg-white/20 border border-white border-dashed z-9998 pointer-events-none rounded box-border"
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
		dragGhosts,
		ratio,
		scrollLeft,
		otherTrackCount,
		otherTrackHeights,
		audioTrackCount,
		audioTrackHeights,
		mainTrackHeight,
		timelinePaddingLeft,
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
