import { useCallback } from "react";
import type { PinchState } from "../contexts/PreviewProvider";

interface PreviewCoordinateOptions {
	offsetX: number;
	offsetY: number;
	zoomLevel: number;
	pinchState: PinchState;
}

export const usePreviewCoordinates = ({
	offsetX,
	offsetY,
	zoomLevel,
	pinchState,
}: PreviewCoordinateOptions) => {
	const getEffectiveZoom = useCallback(
		() => (pinchState.isPinching ? pinchState.currentZoom : zoomLevel),
		[pinchState, zoomLevel],
	);

	// Stage 坐标 -> Canvas 坐标
	const stageToCanvasCoords = useCallback(
		(stageX: number, stageY: number) => {
			const effectiveZoom = getEffectiveZoom();
			const canvasX = (stageX - offsetX) / effectiveZoom;
			const canvasY = (stageY - offsetY) / effectiveZoom;
			return { canvasX, canvasY };
		},
		[offsetX, offsetY, getEffectiveZoom],
	);

	// Canvas 坐标 -> Stage 坐标
	const canvasToStageCoords = useCallback(
		(canvasX: number, canvasY: number) => {
			const effectiveZoom = getEffectiveZoom();
			const stageX = canvasX * effectiveZoom + offsetX;
			const stageY = canvasY * effectiveZoom + offsetY;
			return { stageX, stageY };
		},
		[offsetX, offsetY, getEffectiveZoom],
	);

	return {
		getEffectiveZoom,
		stageToCanvasCoords,
		canvasToStageCoords,
	};
};
