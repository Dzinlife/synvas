export interface OverlayRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CameraSafeInsets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface CanvasOverlayLayoutInput {
	containerWidth: number;
	containerHeight: number;
	sidebarExpanded: boolean;
	drawerVisible: boolean;
	drawerHeight: number;
	rightPanelVisible: boolean;
	outerPaddingPx?: number;
	gapPx?: number;
	sidebarWidthPx?: number;
	rightPanelWidthPx?: number;
}

export interface CanvasOverlayLayoutMetrics {
	sidebarRect: OverlayRect;
	drawerRect: OverlayRect;
	rightPanelRect: OverlayRect;
	cameraSafeInsets: CameraSafeInsets;
	drawerOffsetLeft: number;
	rightPanelReservedBottom: number;
}

export const CANVAS_OVERLAY_GAP_PX = 2;
export const CANVAS_OVERLAY_OUTER_PADDING_PX = 0;
export const CANVAS_OVERLAY_SIDEBAR_WIDTH_PX = 288;
export const CANVAS_OVERLAY_RIGHT_PANEL_WIDTH_PX = 280;

const clampNonNegative = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, value);
};

export const resolveCanvasOverlayLayout = (
	input: CanvasOverlayLayoutInput,
): CanvasOverlayLayoutMetrics => {
	const containerWidth = clampNonNegative(input.containerWidth);
	const containerHeight = clampNonNegative(input.containerHeight);
	const outerPaddingPx = clampNonNegative(
		input.outerPaddingPx ?? CANVAS_OVERLAY_OUTER_PADDING_PX,
	);
	const gapPx = clampNonNegative(input.gapPx ?? CANVAS_OVERLAY_GAP_PX);
	const availableInnerHeight = Math.max(
		0,
		containerHeight - outerPaddingPx * 2,
	);
	const sidebarBaseWidth = clampNonNegative(
		input.sidebarWidthPx ?? CANVAS_OVERLAY_SIDEBAR_WIDTH_PX,
	);
	const rightPanelBaseWidth = clampNonNegative(
		input.rightPanelWidthPx ?? CANVAS_OVERLAY_RIGHT_PANEL_WIDTH_PX,
	);
	const sidebarWidth = input.sidebarExpanded ? sidebarBaseWidth : 0;
	const drawerHeight = input.drawerVisible
		? Math.min(availableInnerHeight, clampNonNegative(input.drawerHeight))
		: 0;
	const rightPanelWidth = input.rightPanelVisible ? rightPanelBaseWidth : 0;
	const drawerOffsetLeft = sidebarWidth > 0 ? sidebarWidth + gapPx : 0;
	const drawerX = outerPaddingPx + drawerOffsetLeft;
	const drawerRight = Math.max(drawerX, containerWidth - outerPaddingPx);
	const drawerWidth = Math.max(0, drawerRight - drawerX);
	const drawerY = Math.max(
		outerPaddingPx,
		containerHeight - outerPaddingPx - drawerHeight,
	);
	const rightPanelReservedBottom = input.drawerVisible
		? drawerHeight + gapPx
		: 0;
	const rightPanelHeight = Math.max(
		0,
		availableInnerHeight - rightPanelReservedBottom,
	);
	const rightPanelX = Math.max(
		outerPaddingPx,
		containerWidth - outerPaddingPx - rightPanelWidth,
	);

	return {
		sidebarRect: {
			x: outerPaddingPx,
			y: outerPaddingPx,
			width: sidebarWidth,
			height: availableInnerHeight,
		},
		drawerRect: {
			x: drawerX,
			y: drawerY,
			width: drawerWidth,
			height: drawerHeight,
		},
		rightPanelRect: {
			x: rightPanelX,
			y: outerPaddingPx,
			width: rightPanelWidth,
			height: rightPanelHeight,
		},
		cameraSafeInsets: {
			top: outerPaddingPx,
			left: outerPaddingPx + (sidebarWidth > 0 ? sidebarWidth + gapPx : 0),
			right:
				outerPaddingPx + (rightPanelWidth > 0 ? rightPanelWidth + gapPx : 0),
			bottom: outerPaddingPx + (input.drawerVisible ? drawerHeight + gapPx : 0),
		},
		drawerOffsetLeft,
		rightPanelReservedBottom,
	};
};
