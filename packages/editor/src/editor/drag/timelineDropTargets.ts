import { clampFrame } from "@/utils/timecode";
import { DEFAULT_TRACK_HEIGHT } from "../timeline/trackConfig";
import { DropTarget } from "../timeline/types";
import { getDropTargetFromHeights } from "../utils/trackAssignment";

export function parseTrackHeights(value?: string): number[] {
	if (!value) return [];
	return value
		.split(",")
		.map((part) => parseInt(part, 10))
		.filter((height) => Number.isFinite(height) && height > 0);
}

export function findTimelineDropTargetFromScreenPosition(
	mouseX: number,
	mouseY: number,
	otherTrackCountFallback: number,
	trackHeightFallback?: number,
	allowOutside?: true,
): DropTarget;
export function findTimelineDropTargetFromScreenPosition(
	mouseX: number,
	mouseY: number,
	otherTrackCountFallback: number,
	trackHeightFallback: number,
	allowOutside: false,
): DropTarget | null;
export function findTimelineDropTargetFromScreenPosition(
	mouseX: number,
	mouseY: number,
	otherTrackCountFallback: number,
	trackHeightFallback: number = DEFAULT_TRACK_HEIGHT,
	allowOutside: boolean = true,
): DropTarget | null {
	const mainZone = document.querySelector<HTMLElement>(
		'[data-track-drop-zone="main"]',
	);
	const otherZone = document.querySelector<HTMLElement>(
		'[data-track-drop-zone="other"]',
	);

	if (mainZone) {
		const rect = mainZone.getBoundingClientRect();
		if (
			mouseY >= rect.top &&
			mouseY <= rect.bottom &&
			mouseX >= rect.left &&
			mouseX <= rect.right
		) {
			return { trackIndex: 0, type: "track" };
		}
	}

	if (otherZone) {
		const rect = otherZone.getBoundingClientRect();
		const datasetTrackCount = parseInt(otherZone.dataset.trackCount || "0", 10);
		const baseTrackCount =
			datasetTrackCount > 0
				? datasetTrackCount
				: Math.max(otherTrackCountFallback, 0);
		const trackHeights = parseTrackHeights(otherZone.dataset.trackHeights);
		// Use rendered heights as a fallback so an empty "other" zone still accepts drops.
		const otherTrackCount = Math.max(baseTrackCount, trackHeights.length);
		const datasetTrackHeight = parseInt(
			otherZone.dataset.trackHeight || "0",
			10,
		);
		const zoneTrackHeight =
			datasetTrackHeight > 0 ? datasetTrackHeight : trackHeightFallback;

		if (
			mouseY >= rect.top &&
			mouseY <= rect.bottom &&
			mouseX >= rect.left &&
			mouseX <= rect.right
		) {
			const contentArea = otherZone.querySelector<HTMLElement>(
				'[data-track-content-area="other"]',
			);
			let contentTop = rect.top;
			if (contentArea) {
				const contentRect = contentArea.getBoundingClientRect();
				contentTop = contentRect.top;
			}

			// No other tracks yet: treat the zone as an insert gap at index 1.
			if (otherTrackCount <= 0) {
				return { trackIndex: 1, type: "gap" };
			}

			const contentRelativeY = mouseY - contentTop;
			if (trackHeights.length > 0) {
				const dropTarget = getDropTargetFromHeights(
					contentRelativeY,
					trackHeights,
					otherTrackCount,
				);
				if (dropTarget) {
					const maxTrackIndex =
						dropTarget.type === "gap" ? otherTrackCount + 1 : otherTrackCount;
					const targetTrackIndex = Math.max(
						1,
						Math.min(maxTrackIndex, dropTarget.trackIndex),
					);
					return { ...dropTarget, trackIndex: targetTrackIndex };
				}
			}

			if (contentRelativeY < 0) {
				return { trackIndex: otherTrackCount + 1, type: "gap" };
			}

			const trackFromTop = Math.floor(contentRelativeY / zoneTrackHeight);
			const targetTrackIndex = Math.max(
				1,
				Math.min(otherTrackCount, otherTrackCount - trackFromTop),
			);
			return { trackIndex: targetTrackIndex, type: "track" };
		}
	}

	if (allowOutside && mainZone && otherZone) {
		const mainRect = mainZone.getBoundingClientRect();
		const otherRect = otherZone.getBoundingClientRect();

		if (mouseY > mainRect.top) {
			return { trackIndex: 0, type: "track" };
		}

		if (mouseY < otherRect.top) {
			const datasetTrackCount = parseInt(
				otherZone.dataset.trackCount || "0",
				10,
			);
			const otherTrackCount =
				datasetTrackCount > 0
					? datasetTrackCount
					: Math.max(otherTrackCountFallback, 0);
			return { trackIndex: Math.max(1, otherTrackCount), type: "track" };
		}
	}

	return allowOutside ? { trackIndex: 0, type: "track" } : null;
}

export function getTimelineDropTimeFromScreenX(
	screenX: number,
	trackIndex: number,
	ratio: number,
	scrollLeft: number,
): number | null {
	const zoneKey = trackIndex === 0 ? "main" : "other";
	const zone = document.querySelector<HTMLElement>(
		`[data-track-drop-zone="${zoneKey}"]`,
	);
	if (!zone) return null;
	const contentArea = zone.querySelector<HTMLElement>(
		`[data-track-content-area="${zoneKey}"]`,
	);
	if (!contentArea) return null;
	const contentRect = contentArea.getBoundingClientRect();
	return clampFrame((screenX - contentRect.left + scrollLeft) / ratio);
}

export interface PreviewDropTargetInfo {
	zone: "preview";
	canvasX: number;
	canvasY: number;
	canDrop: boolean;
}

export function getPreviewDropTargetFromScreenPosition(
	mouseX: number,
	mouseY: number,
): PreviewDropTargetInfo | null {
	const previewZone = document.querySelector<HTMLElement>(
		"[data-preview-drop-zone]",
	);
	if (!previewZone) return null;
	const rect = previewZone.getBoundingClientRect();
	if (
		mouseY < rect.top ||
		mouseY > rect.bottom ||
		mouseX < rect.left ||
		mouseX > rect.right
	) {
		return null;
	}

	const zoomLevel = parseFloat(previewZone.dataset.zoomLevel || "1");
	const offsetX = parseFloat(previewZone.dataset.offsetX || "0");
	const offsetY = parseFloat(previewZone.dataset.offsetY || "0");
	const pictureWidth = parseFloat(previewZone.dataset.pictureWidth || "1920");
	const pictureHeight = parseFloat(previewZone.dataset.pictureHeight || "1080");

	const topLeftX = (mouseX - rect.left - offsetX) / zoomLevel;
	const topLeftY = (mouseY - rect.top - offsetY) / zoomLevel;
	const isInBounds =
		topLeftX >= 0 &&
		topLeftX <= pictureWidth &&
		topLeftY >= 0 &&
		topLeftY <= pictureHeight;

	return {
		zone: "preview",
		canvasX: topLeftX - pictureWidth / 2,
		canvasY: topLeftY - pictureHeight / 2,
		canDrop: isInBounds,
	};
}
